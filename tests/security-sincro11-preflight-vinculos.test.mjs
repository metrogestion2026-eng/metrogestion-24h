import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {preflightVinculosSincro11,SPREADSHEET_MANTENIMENT,PREFLIGHT_SINCRO11_VERSION} from '../shared/sincro11-preflight-vinculos.mjs';
const U1='11111111-1111-4111-8111-111111111111';
const U2='22222222-2222-4222-8222-222222222222';
const U3='33333333-3333-4333-8333-333333333333';
const SHEET=SPREADSHEET_MANTENIMENT;
const date='2026-11-17T07:45:00.000Z';
const row=(id=1,patch={})=>({id_fila:id,tipo_h:'AV',nota_e:`METROGESTION_T:${U1}`,dfm:'PRIVADO',pa:'PR-PRIVADA',...patch});
const work=(id=U1,patch={})=>({sync_id:id,designacion:'AV',tipo_trabajo:'A',...patch});
const stage=(id=1,patch={})=>({spreadsheet_id:SHEET,id_fila:id,estado:'ACREDITADA',clase:'TRABAJO',trabajo_sync_id:U1,
  sync_id:U2,revision:3,vector_sha256:'a'.repeat(64),...patch});
const changed=(id=1,patch={})=>({spreadsheet_id:SHEET,id_fila:id,columna:'J',revision:1,detectado_en:'2026-11-17T07:00:00.000Z',...patch});
const run=(patch={})=>preflightVinculosSincro11({observado_en:date,filas:[row()],trabajos:[work()],vinculos:[],cambios:[],...patch});
function passive(res){
  assert.equal(res.autoriza_sincronizar,false);
  assert.equal(res.permite_crear_T,false);
  assert.equal(res.permite_crear_PA,false);
  assert.equal(res.escritura_en_manteniment,false);
  assert.equal(res.escritura_en_tancament,false);
  assert.equal(res.escritura_en_backend,false);
  assert.equal(res.identidades_aptas_para_escritura,0);
  assert.equal(res.eventos_nuevos_autenticados,0);
  assert.ok(res.detalle.every(x=>x.resultado==='RETENER_SIN_ESCRIBIR'));
  assert.equal(res.valores_privados_en_salida,false);
}
test('sin staging la nota coincidente en el servidor nunca acredita T',()=>{
 const r=run();passive(r);assert.equal(r.stats.uuid_presentes_servidor,1);
 assert.equal(r.motivos.SIN_VINCULO_STAGING_POR_T,1);
});
test('notas UUID reconocidas aunque se cambien espacios y mayúsculas',()=>{
 const r=run({filas:[row(1,{nota_e:`Aviso\nmetrogestion_t:  ${U1.toLowerCase()}`})]});passive(r);
 assert.equal(r.stats.nota_uuid_apariciones,1);
});
test('una UUID en dos filas es compartida aunque H sea distinto',()=>{
 const r=run({filas:[row(1),row(2,{tipo_h:'LV'})]});passive(r);
 assert.equal(r.stats.uuid_compartidos,1);assert.equal(r.stats.filas_con_uuid_compartido,2);
 assert.equal(r.stats.uuid_h_unica,1);
});
test('dos UUID diferentes nunca se fusionan por la misma PA ni DFM',()=>{
 const r=run({filas:[row(1),row(2,{nota_e:`METROGESTION_T:${U2}`})],trabajos:[work(),work(U2)]});passive(r);
 assert.equal(r.stats.uuid_distintos,2);
});
test('H igual en dos filas con mismo UUID es correspondencia ambigua',()=>{
 const r=run({filas:[row(1),row(2)]});passive(r);assert.equal(r.stats.uuid_h_multiple,1);
});
test('un UUID sin coincidencia de H no puede inventar designación',()=>{
 const r=run({filas:[row(1,{tipo_h:'ITV'})]});passive(r);assert.equal(r.stats.uuid_h_ninguna,1);
});
test('UUID ausente en el servidor se informa sin inventar objeto',()=>{
 const r=run({trabajos:[]});passive(r);assert.equal(r.stats.uuid_ausentes_servidor,1);
});
test('fila sin UUID y sin staging es lectura histórica sin indicio de enlace',()=>{
 const r=run({filas:[row(1,{nota_e:''})]});passive(r);
 assert.equal(r.stats.filas_propuestas_para_verificacion,0);
});
test('UUID en dos menciones de una misma celda no son dos filas',()=>{
 const r=run({filas:[row(1,{nota_e:`METROGESTION_T:${U1} - METROGESTION_T:${U1}`})]});passive(r);
 assert.equal(r.stats.nota_uuid_apariciones,2);assert.equal(r.stats.uuid_compartidos,0);
});
test('T duplicada detiene toda la auditoría, nunca se toma primera',()=>{
 assert.throws(()=>run({filas:[row(5),row(5)]}),/duplicada/);
});
test('T vacía, 0, decimal, negativa y con cero inicial fallan cerrados',()=>{
 for(const id of ['',0,-1,2.3,'01',null,undefined,'PA-26000'])assert.throws(()=>run({filas:[row(1,{id_fila:id})]}),/ID_FILA/);
});
test('número de fila físico, PA y DFM no se usan como identidad',()=>{
 const r=run({filas:[row(1,{fila_fisica:555,pa:'PA-1',dfm:'1'}),row(2,{fila_fisica:555,pa:'PA-1',dfm:'1',nota_e:''})]});passive(r);
 assert.equal(r.stats.filas_t,2);
});
test('vínculo staging RETENIDA no acredita la fila',()=>{
 const r=run({vinculos:[stage(1,{estado:'RETENIDA'})]});passive(r);
 assert.equal(r.motivos.REGISTRO_STAGING_NO_ACREDITADO,1);
});
test('vínculo staging PENDIENTE_CONCILIACION permanece retenido',()=>{
 const r=run({vinculos:[stage(1,{estado:'PENDIENTE_CONCILIACION'})]});passive(r);
 assert.equal(r.motivos.REGISTRO_STAGING_NO_ACREDITADO,1);
});
test('clase PARADA/TANCAMENT con J contable jamás se mapea como trabajo J',()=>{
 for(const kind of ['PARADA','TANCAMENT 11']){
  const r=run({vinculos:[stage(1,{clase:kind})]});passive(r);
  assert.equal(r.motivos.CLASE_DESTINO_SIN_MAPEO,1);
 }
});
test('vínculo sin trabajo_sync_id no se resuelve por UUID de nota',()=>{
 const r=run({vinculos:[stage(1,{trabajo_sync_id:null})]});passive(r);
 assert.equal(r.motivos.SIN_TRABAJO_UUID_EN_VINCULO,1);
});
test('trabajo_sync_id de staging inexistente en servidor bloquea',()=>{
 const r=run({vinculos:[stage(1,{trabajo_sync_id:U3})]});passive(r);
 assert.equal(r.motivos.VINCULO_AL_TRABAJO_INEXISTENTE,1);
});
test('nota UUID contradice trabajo_sync_id del vínculo: bloqueo',()=>{
 const r=run({trabajos:[work(),work(U2)],vinculos:[stage(1,{trabajo_sync_id:U2})]});passive(r);
 assert.equal(r.motivos.NOTA_UUID_DISCREPANTE_DEL_VINCULO,1);
});
test('UUID compartido exige verificación adicional aunque staging sea ACREDITADA',()=>{
 const r=run({filas:[row(1),row(2)],vinculos:[stage(1)],cambios:[changed(1)]});passive(r);
 assert.equal(r.motivos.UUID_COMPARTIDO_REQUIERE_EVIDENCIA_EXTRA,1);
});
test('H distinto del objetivo no autoriza la traducción de campo',()=>{
 const r=run({filas:[row(1,{tipo_h:'ITV'})],vinculos:[stage(1)]});passive(r);
 assert.equal(r.motivos.DESIGNACION_H_NO_COTEJADA,1);
});
test('staging acreditada sin evento posterior no sirve para sincronizar',()=>{
 const r=run({vinculos:[stage(1)]});passive(r);
 assert.equal(r.motivos.SIN_CAMBIO_POST_CORTE_ACREDITADO,1);
});
test('evento detectado tras corte por staging no acredita autor humano',()=>{
 const r=run({vinculos:[stage(1)],cambios:[changed(1)]});passive(r);
 assert.equal(r.motivos.VINCULO_TECNICO_SOLO_CANDIDATO,1);
 assert.equal(r.stats.vinculos_candidatos_no_autorizados,1);
 assert.equal(r.autor_humano_acreditado,false);
});
test('sin nota pero con T/vínculo explícito se exige igualmente evento',()=>{
 const r=run({filas:[row(1,{nota_e:''})],vinculos:[stage(1)]});passive(r);
 assert.equal(r.motivos.SIN_CAMBIO_POST_CORTE_ACREDITADO,1);
});
test('cambio staging no respaldado por T visible se marca huérfano',()=>{
 const r=run({cambios:[changed(999)]});passive(r);
 assert.equal(r.cambios_staging_sin_t_visible,1);
});
test('vínculo staging sin T visible es huérfano, no alta automática',()=>{
 const r=run({vinculos:[stage(999)]});passive(r);
 assert.equal(r.vinculos_staging_sin_t_visible,1);
});
test('libro distinto y staging de libro distinto siempre se rechazan',()=>{
 assert.throws(()=>run({spreadsheetId:'OTRO'}),/libro origen/);
 assert.throws(()=>run({vinculos:[stage(1,{spreadsheet_id:'OTRO'})]}),/libro incorrecto/);
 assert.throws(()=>run({cambios:[changed(1,{spreadsheet_id:'OTRO'})]}),/otro libro/);
});
test('duplicar una T en registros de staging falla cerrado',()=>{
 assert.throws(()=>run({vinculos:[stage(1),stage(1)]}),/duplicada en staging/);
});
test('duplicar trabajo con mismo UUID en servidor falla cerrado',()=>{
 assert.throws(()=>run({trabajos:[work(),work()]}),/duplicado en servidor/);
});
test('huella invalida y revisión inválida no pasan como acreditación',()=>{
 assert.throws(()=>run({vinculos:[stage(1,{vector_sha256:'falsa'})]}),/huella/);
 assert.throws(()=>run({vinculos:[stage(1,{revision:0})]}),/revisión/);
});
test('cambio staging con columna T no se trata como modificación de campo',()=>{
 assert.throws(()=>run({cambios:[changed(1,{columna:'T'})]}),/columna/);
});
test('fecha de hecho 2024 no implica evento anterior ni nuevo',()=>{
 const r=run({filas:[row(1,{fecha_entrada:'2024-09-14',nota_e:`METROGESTION_T:${U1}`})]});passive(r);
 assert.equal(r.motivos.SIN_VINCULO_STAGING_POR_T,1);
});
test('sello de detección anterior al corte no se acepta',()=>{
 assert.throws(()=>run({cambios:[changed(1,{detectado_en:'2026-11-15T22:59:59.999Z'})]}),/fuera del periodo/);
});
test('fecha exacta de observación debe ser ISO UTC y posterior al corte',()=>{
 for(const x of ['2026-11-17','2026-11-17T10:00:00','2026-11-15T22:59:59.999Z'])assert.throws(()=>run({observado_en:x}),/UTC|corte/);
});
test('no revela ni DFM, PA, UUID, notas ni datos personales',()=>{
 const secret='NOTA PRIVADA VOLANTE 999999';
 const r=run({filas:[row(1,{nota_e:`METROGESTION_T:${U1} ${secret}`,dfm:'DATO PRIVADO',pa:'PA-SECRET'})]});passive(r);
 const txt=JSON.stringify(r);
 for(const s of [secret,'DATO PRIVADO','PA-SECRET',U1])assert.equal(txt.includes(s),false);
});
test('candidato simultáneo de dos campos no mezcla T ni firma efecto',()=>{
 const r=run({vinculos:[stage(1)],cambios:[changed(1),changed(1,{columna:'K',revision:2})]});passive(r);
 assert.equal(r.stats.cambios_staging,2);assert.equal(r.stats.vinculos_candidatos_no_autorizados,1);
});
test('6742 identidades y 177 notas / 140 UUID no conceden autorización',()=>{
 const rows=Array.from({length:6742},(_,i)=>row(i+1,{nota_e:''}));
 let ix=0;for(let i=0;i<113;i++){rows[ix++].nota_e=`METROGESTION_T:${(i+1).toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;}
 for(let i=0;i<27;i++){
  const u=(i+114).toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111';
  const n=i<10?3:2;for(let k=0;k<n;k++)rows[ix++].nota_e=`METROGESTION_T:${u}`;
 }
 // 113 + (10*3 + 17*2) = 177 appearances, 140 distinct, 27 shared across 64 rows.
 const r=run({filas:rows,trabajos:[]});passive(r);
 assert.equal(r.stats.filas_t,6742);assert.equal(r.stats.nota_uuid_apariciones,177);
 assert.equal(r.stats.uuid_distintos,140);assert.equal(r.stats.uuid_compartidos,27);
 assert.equal(r.stats.filas_con_uuid_compartido,64);assert.equal(r.detalle_parcial,true);
});
test('nunca puede recibir más de 25000 filas ni notas excesivas',()=>{
 assert.throws(()=>run({filas:Array.from({length:25001},(_,i)=>row(i+1))}),/lote filas/);
 assert.throws(()=>run({filas:[row(1,{nota_e:'x'.repeat(100000)})]}),/nota/);
});
test('módulo no contiene HTTP, Supabase, Google API ni funciones de escritura',()=>{
 const source=readFileSync(new URL('../shared/sincro11-preflight-vinculos.mjs',import.meta.url),'utf8');
 for(const forbidden of [/SpreadsheetApp/,/UrlFetchApp/,/createClient\(/,/fetch\(/,/\.setValue\(/,/\.setValues\(/,/insert into/i,/delete from/i,/update [a-z]/i,/createTrigger\(/])assert.doesNotMatch(source,forbidden);
 assert.match(PREFLIGHT_SINCRO11_VERSION,/preflight-vinculos/);
});
test('consulta SQL de preflight contiene exclusivamente WITH/SELECT y no permite mutaciones',()=>{
 const src=readFileSync(new URL('../sql/sincro11_preflight_vinculos_solo_lectura_20261117.sql',import.meta.url),'utf8');
 const sql=src.split('\n').filter(x=>!x.trimStart().startsWith('--')).join('\n').trim();
 assert.match(sql,/^WITH\s+censos\s+AS\s*\(/i);
 assert.match(sql,/^WITH[\s\S]+SELECT[\s\S]+FROM censos;$/i);
 assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|CREATE|ALTER|MERGE|GRANT|REVOKE|CALL|EXECUTE|DO|COPY)\b/i);
 assert.equal((sql.match(/;/g)||[]).length,1);
});