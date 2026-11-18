import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditarCorreccionesExistentesS12 as auditar,
  huellaLoteS12} from '../shared/sincro12-correccion-existente-lab.mjs';

const SHEET='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const UID=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const H=n=>n.toString(16).padStart(64,'0');
const T={
 now:'2026-11-18T10:00:00.000Z',
 capture:'2026-11-18T08:10:00.000Z',
 confirm:'2026-11-18T08:11:00.000Z',
 read:'2026-11-18T08:12:00.000Z',
 target:'2026-11-18T08:13:00.000Z'
};
function fixture(options={}){
 const id=options.id??90001,ev=UID(options.event??1),obj=UID(options.object??2);
 const origin=options.origin??'EDITOR_CONTROLADO_LAB';
 const evento={
  evento_id:ev,spreadsheet_id:SHEET,id_fila:id,columna:'K',clase:'TRABAJO',
  significado:'RECOGIDA_REAL_TALLER',revision_anterior:6,revision_nueva:7,
  hash_anterior:H(1),hash_nuevo:H(2),capturado_en:T.capture,origen:origin
 };
 const vinculo={evento_id:ev,spreadsheet_id:SHEET,id_fila:id,columna:'K',
  clase:'TRABAJO',significado:'RECOGIDA_REAL_TALLER',
  objeto_id:obj,tabla_destino:'app_private.manteniment_t_trabajos',
  campo_destino:'fecha_recogida',revision_vinculo:1,origen:'REGISTRO_CANONICO_FICTICIO'};
 const lectura={evento_id:ev,spreadsheet_id:SHEET,id_fila:id,columna:'K',
  revision_lectura:7,hash_vigente:H(2),leido_en:T.read,origen:'RELECTURA_HOJA_FICTICIA'};
 const destino={evento_id:ev,objeto_id:obj,
  tabla_destino:'app_private.manteniment_t_trabajos',
  campo_destino:'fecha_recogida',revision_destino:3,
  hash_destino:H(3),leido_en:T.target,origen:'RELECTURA_DESTINO_FICTICIA'};
 return {evento,vinculo,lectura,destino};
}
function paquete(fixes,{accion,aprobacion}={}){
 const eventos=fixes.map(f=>f.evento);
 const modo=accion??(eventos[0]?.origen==='ADOPCION_EXPRESA_ACTUAL_LAB'
  ?'ADOPTAR_VALORES_ACTUALES':'CONFIRMAR_CAMBIOS_CONTROLADOS');
 const ok=aprobacion??{
  lote_id:UID(10),spreadsheet_id:SHEET,actor_id:UID(11),sesion_id:UID(12),
  dispositivo_id:UID(13),nonce:UID(14),aal:'aal2',
  permiso:'CONFIRMAR_CORRECCION_EXISTENTE',accion:modo,
  huella_lote:huellaLoteS12(eventos),
  confirmado_en:T.confirm,origen:'SERVIDOR_LAB_NO_AUTENTICA'
 };
 return {
  observado_en:T.now,eventos,aprobacion:ok,
  vinculos:fixes.map(f=>f.vinculo),
  lecturas:fixes.map(f=>f.lectura),
  destinos:fixes.map(f=>f.destino)
 };
}
const result=(f,extra={})=>auditar({...paquete([f]),...extra});
const motive=(f,extra={})=>result(f,extra).detalles[0].motivo;
function closed(r){
 for(const key of ['usuario_real_autenticado','autor_edicion_hoja_acreditado',
 'autorizacion_real_de_retorno','autoriza_sincronizar','permiso_crear_T',
 'permiso_crear_PA','escribe_manteniment','escribe_tancament','escribe_supabase'])
  assert.equal(r[key],false,key);
 assert.equal(r.vinculos_reales_acreditados,0);
 assert.equal(r.eventos_reales_acreditados,0);
}
test('ninguna corrección nueva: sin eventos ni permisos',()=>{
 const r=auditar({observado_en:T.now});
 assert.equal(r.total,0);assert.equal(r.candidatos_de_laboratorio,0);closed(r);
});
test('captura de editor controlado ficticio con 4 pruebas: solo candidato',()=>{
 const r=result(fixture());
 assert.equal(r.candidatos_de_laboratorio,1);
 assert.equal(r.detalles[0].motivo,'CAMBIO_CONTROLADO_SOLO_LAB');closed(r);
});
test('adopción actual explícita: NO demuestra autoría de edición anterior',()=>{
 const r=result(fixture({origin:'ADOPCION_EXPRESA_ACTUAL_LAB'}));
 assert.equal(r.detalles[0].motivo,'ADOPCION_ACTUAL_SOLO_LAB_SIN_AUTORIA_ORIGINAL');
 assert.equal(r.autor_edicion_hoja_acreditado,false);closed(r);
});
test('cambiar una fecha histórica mediante evento nuevo no usa fecha del contenido',()=>{
 const r=result(fixture());assert.equal(r.candidatos_de_laboratorio,1);closed(r);
});
test('cotejo de dos T distintas conserva dos campos independientes',()=>{
 const f=[fixture(),fixture({id:90002,event:100,object:200})];
 const r=auditar(paquete(f));
 assert.equal(r.total,2);assert.equal(r.candidatos_de_laboratorio,2);closed(r);
});
test('el orden de filas no altera huella de aprobación de lote',()=>{
 const a=fixture(),b=fixture({id:90002,event:100});
 assert.equal(huellaLoteS12([a.evento,b.evento]),
  huellaLoteS12([b.evento,a.evento]));
});
test('cambiar el hash de una sola K invalida aprobación global del lote',()=>{
 const f=fixture();const p=paquete([f]);
 p.eventos[0]={...p.eventos[0],hash_nuevo:H(9)};
 const r=auditar(p);assert.equal(r.detalles[0].motivo,'APROBACION_DE_LOTE_AUSENTE_O_INCOMPLETA');closed(r);
});
test('un lote no puede aprobar silenciosamente campos agregados después',()=>{
 const a=fixture(),p=paquete([a]);
 p.eventos.push(fixture({id:90002,event:99}).evento);
 const r=auditar(p);
 assert.equal(r.total,2);assert.equal(r.candidatos_de_laboratorio,0);closed(r);
});
test('sin aprobación explícita, retener',()=>{
 const p=paquete([fixture()]);p.aprobacion=null;
 assert.equal(auditar(p).detalles[0].motivo,'APROBACION_DE_LOTE_AUSENTE_O_INCOMPLETA');
});
test('F2 y lectura de diferencias no son eventos manuales',()=>{
 for(const origin of ['F2_SNAPSHOT','LECTURA_HOJA','BARRIDO_DIFERENCIAS']){
  const f=fixture();f.evento.origen=origin;
  assert.equal(motive(f),'ORIGEN_SOLO_OBSERVADO_NO_ES_EVENTO');
 }
});
test('onEdit aislado no demuestra autoría',()=>{
 const f=fixture();f.evento.origen='ON_EDIT';
 assert.equal(motive(f),'ORIGEN_SOLO_OBSERVADO_NO_ES_EVENTO');
});
test('confirmación de adopción no sustituye acción de cambio controlado',()=>{
 const f=fixture({origin:'ADOPCION_EXPRESA_ACTUAL_LAB'});
 assert.equal(motive(f,{aprobacion:paquete([f],{accion:'CONFIRMAR_CAMBIOS_CONTROLADOS'}).aprobacion}),
 'ACCION_DE_CONFIRMACION_NO_COINCIDE_CON_ORIGEN');
});
test('una fecha de evento del 15/11 anterior al corte se retiene',()=>{
 const f=fixture();f.evento.capturado_en='2026-11-15T22:59:59.000Z';
 assert.equal(motive(f),'NO_EVENTO_POSITIVO_POST_CORTE');
});
test('firma del servidor ficticia no implica sesión real validada',()=>{
 const r=result(fixture());assert.equal(r.usuario_real_autenticado,false);closed(r);
});
test('aal1 no admite confirmación',()=>{
 const f=fixture(),p=paquete([f]);p.aprobacion.aal='aal1';
 assert.equal(auditar(p).detalles[0].motivo,'APROBACION_DE_LOTE_AUSENTE_O_INCOMPLETA');
});
test('permiso no válido no admite confirmación',()=>{
 const f=fixture(),p=paquete([f]);p.aprobacion.permiso='LECTURA';
 assert.equal(auditar(p).detalles[0].motivo,'APROBACION_DE_LOTE_AUSENTE_O_INCOMPLETA');
});
test('nonce no válido no admite confirmación',()=>{
 const f=fixture(),p=paquete([f]);p.aprobacion.nonce='NO_UUID';
 assert.equal(auditar(p).detalles[0].motivo,'APROBACION_DE_LOTE_AUSENTE_O_INCOMPLETA');
});
test('cliente que dice servidor real no autentica el origen de prueba',()=>{
 const f=fixture(),p=paquete([f]);p.aprobacion.origen='SERVIDOR_REAL';
 assert.equal(auditar(p).detalles[0].motivo,'APROBACION_DE_LOTE_AUSENTE_O_INCOMPLETA');
});
test('confirmación anterior a evento se retiene',()=>{
 const f=fixture(),p=paquete([f]);p.aprobacion.confirmado_en='2026-11-18T08:00:00.000Z';
 assert.equal(auditar(p).detalles[0].motivo,'CONFIRMACION_FUERA_DE_SECUENCIA');
});
test('evento de otro libro se rechaza',()=>{
 const f=fixture();f.evento.spreadsheet_id='otro';
 assert.equal(motive(f),'IDENTIDAD_T_CAMPO_U_HOJA_INVALIDA');
});
test('posición física no es ID_FILA',()=>{
 const f=fixture();f.evento.id_fila='T1234';
 assert.equal(motive(f),'IDENTIDAD_T_CAMPO_U_HOJA_INVALIDA');
});
test('columna T es identidad, no editable',()=>{
 const f=fixture();f.evento.columna='T';
 assert.equal(motive(f),'IDENTIDAD_T_CAMPO_U_HOJA_INVALIDA');
});
test('cambio inexistente mismo hash antes/después no es evento',()=>{
 const f=fixture();f.evento.hash_anterior=H(2);
 assert.equal(motive(f),'REVISION_O_CAMBIO_NO_ACREDITADO');
});
test('revisión de hoja no consecutiva se rechaza',()=>{
 const f=fixture();f.evento.revision_nueva=12;
 assert.equal(motive(f),'REVISION_O_CAMBIO_NO_ACREDITADO');
});
test('evento ya consumido no se aplica otra vez',()=>{
 const f=fixture();
 assert.equal(motive(f,{eventos_consumidos:[f.evento.evento_id]}),'EVENTO_YA_CONSUMIDO');
});
test('T excluida por ID_FILA queda fuera',()=>{
 const f=fixture();
 assert.equal(motive(f,{identidades_excluidas:[90001]}),'T_EXCLUIDA_POR_OPERADOR');
});
test('ausencia de vínculo no se reconstruye por UUID compartido',()=>{
 const f=fixture(),p=paquete([f]);p.vinculos=[];
 assert.equal(auditar(p).detalles[0].motivo,'VINCULO_T_OBJETO_AUSENTE');
});
test('vínculo con otra T no sirve',()=>{
 const f=fixture();f.vinculo.id_fila=90002;
 assert.equal(motive(f),'VINCULO_T_OBJETO_INCORRECTO');
});
test('vínculo con otro objeto no es reemplazable por nota',()=>{
 const f=fixture();f.vinculo.objeto_id=UID(98);
 assert.equal(motive(f),'DESTINO_NO_CORRESPONDE');
});
test('J de TRABAJO no se equipara con fecha_realizada por coincidencia',()=>{
 const f=fixture();f.evento.columna='J';f.vinculo.columna='J';f.lectura.columna='J';
 assert.equal(motive(f),'CLASE_Y_CAMPO_SIN_EQUIVALENCIA_VERIFICADA');
});
test('J de PARADA no es entrada a taller',()=>{
 const f=fixture();
 f.evento.columna='J';f.evento.clase='PARADA';f.evento.significado='INICIO_TRAMO_FACTURABLE';
 f.vinculo.columna='J';f.vinculo.clase='PARADA';f.vinculo.significado='INICIO_TRAMO_FACTURABLE';
 f.lectura.columna='J';
 assert.equal(motive(f),'CLASE_Y_CAMPO_SIN_EQUIVALENCIA_VERIFICADA');
});
test('G/H de TRABAJO requieren semántica diferenciada',()=>{
 for(const col of ['G','H']){
  const f=fixture();f.evento.columna=col;f.vinculo.columna=col;f.lectura.columna=col;
  assert.equal(motive(f),'CLASE_Y_CAMPO_SIN_EQUIVALENCIA_VERIFICADA');
 }
});
test('lectura de hoja ausente no concede identidad',()=>{
 const f=fixture(),p=paquete([f]);p.lecturas=[];
 assert.equal(auditar(p).detalles[0].motivo,'SIN_RELECTURA_FRESCA_DE_CELDA');
});
test('hoja ya modificada por tercero tras confirmación se retiene',()=>{
 const f=fixture();f.lectura.hash_vigente=H(8);
 assert.equal(motive(f),'LECTURA_DE_HOJA_NO_COINCIDE');
});
test('lectura con revisión anterior al evento no sirve',()=>{
 const f=fixture();f.lectura.revision_lectura=6;
 assert.equal(motive(f),'LECTURA_DE_HOJA_NO_COINCIDE');
});
test('lectura anterior a confirmación no sirve',()=>{
 const f=fixture();f.lectura.leido_en='2026-11-18T08:10:30.000Z';
 assert.equal(motive(f),'RELECTURA_DE_HOJA_FUERA_DE_SECUENCIA');
});
test('destino ausente se retiene',()=>{
 const f=fixture(),p=paquete([f]);p.destinos=[];
 assert.equal(auditar(p).detalles[0].motivo,'SIN_LECTURA_VIGENTE_DEL_DESTINO');
});
test('destino con otro UUID se retiene',()=>{
 const f=fixture();f.destino.objeto_id=UID(93);
 assert.equal(motive(f),'DESTINO_NO_CORRESPONDE');
});
test('destino ya coincide no requiere escribir',()=>{
 const f=fixture();f.destino.hash_destino=H(2);
 const r=result(f);assert.equal(r.detalles[0].motivo,'DESTINO_YA_IGUAL_SIN_ESCRITURA');
 closed(r);
});
test('relectura del destino anterior a confirmación se retiene',()=>{
 const f=fixture();f.destino.leido_en='2026-11-18T08:09:00.000Z';
 assert.equal(motive(f),'LECTURA_DESTINO_FUERA_DE_SECUENCIA');
});
test('evento duplicado: no gana el segundo ni el último',()=>{
 const f=fixture(),p=paquete([f,f]);
 const r=auditar(p);
 assert.equal(r.motivos.EVENTO_O_T_CAMPO_DUPLICADO,2);closed(r);
});
test('mismo T+campo con dos eventos distintos se bloquea',()=>{
 const a=fixture(),b=fixture({event:99});
 const r=auditar(paquete([a,b]));
 assert.equal(r.motivos.EVENTO_O_T_CAMPO_DUPLICADO,2);closed(r);
});
test('doble enlace para el mismo evento se retiene',()=>{
 const f=fixture(),p=paquete([f]);p.vinculos.push({...f.vinculo});
 assert.equal(auditar(p).detalles[0].motivo,'EVIDENCIA_EVENTO_DUPLICADA');
});
test('dos T con UUID destino compartido requieren vínculo individual',()=>{
 const a=fixture(),b=fixture({event:99,id:90002,object:2});
 const r=auditar(paquete([a,b]));
 assert.equal(r.candidatos_de_laboratorio,2);
 assert.deepEqual(r.detalles.map(x=>x.id_fila),[90001,90002]);closed(r);
});
test('listado de más de 100: resumen completo sin valores privados',()=>{
 const lot=Array.from({length:101},(_,i)=>fixture({id:90001+i,event:100+i,object:200+i}));
 const r=auditar(paquete(lot));
 assert.equal(r.total,101);assert.equal(r.detalles.length,100);
 assert.equal(r.detalles_parciales,true);closed(r);
 assert.ok(!JSON.stringify(r).includes(H(2)));
 assert.ok(!JSON.stringify(r).includes(UID(200)));
});
test('sin permiso real de escritura ni bibliotecas de red',()=>{
 const s=readFileSync(new URL('../shared/sincro12-correccion-existente-lab.mjs',import.meta.url),'utf8');
 for(const rx of [/SpreadsheetApp\./,/UrlFetchApp\./,/createClient\(/,
  /\bfetch\(/,/\bINSERT INTO\b/,/\bUPDATE \w+ SET\b/,/service_role/i])
   assert.doesNotMatch(s,rx);
});
test('lotes desmesurados e identidad excluida ilegible fallan cerrados',()=>{
 const f=fixture();
 assert.throws(()=>auditar({observado_en:T.now,eventos:Array(5001).fill(f.evento)}),/lote eventos/);
 assert.throws(()=>auditar({observado_en:T.now,identidades_excluidas:['R1515']}),/requiere ID_FILA/);
});
