import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {clasificarConflictosSincro11, SINCRO11_GUARDIA_VERSION} from '../shared/sincro11-guardia-conflictos.mjs';

const UUID = '11111111-2222-4333-8444-555555555555';
const SHA = 'a'.repeat(64);
const propuesta = (id_fila = 1601, extra = {}) => ({
 id_fila, tipo: 'trabajos', sync_id: UUID, revision: 1,
 payload_sha256: SHA, numero_parada: 'PA-2600300', dfm: '2573',
 datos_privados: 'NO ENVIAR NI ESCRIBIR', ...extra,
});
const fuente = ({cambios = [], altas = [], ausencias = [], parcial = false, fecha_ref = '2026-11-16T05:30:25.000Z', fecha_obs = '2026-11-16T10:00:00.000Z'} = {}) => ({
 resultado: 'SOLO_LECTURA_FUTURA_NO_AUTORIZADA',
 fecha_referencia:fecha_ref,fecha_observacion:fecha_obs,
 filas_referencia:6742,filas_actuales:6742 + altas.length - ausencias.length,
 altas_nuevas:altas.length,cambios_observados:cambios.length,
 identidades_ausentes:ausencias.length,
 altas:altas.map(id_fila=>({id_fila,clase:'ALTA_NO_CONFIRMADA'})),
 cambios:cambios.map(id_fila=>({id_fila,clase:'CONTENIDO_DISTINTO_PENDIENTE_DE_COTEJO'})),
 ausencias:ausencias.map(id_fila=>({id_fila,clase:'AUSENCIA_REQUIERE_REVISION'})),
 lista_parcial:parcial,origen_humano_acreditado:false,fecha_exacta_de_edicion_acreditada:false,
 autoriza_sincronizar:false,escritura_en_hojas:false,escritura_en_backend:false,
});
const guard = (report, proposals) => clasificarConflictosSincro11({informeF2:report,propuestas:proposals});
function noWrites(r) {
 assert.equal(r.autoriza_sincronizar,false);
 assert.equal(r.escritura_en_hojas,false);
 assert.equal(r.escritura_en_backend,false);
 assert.equal(r.permite_crear_T,false);
 assert.equal(r.permite_crear_PA,false);
 assert.equal(r.propuestas_total,r.propuestas_retenidas);
 assert.ok(r.detalles.every(x=>x.decision==='RETENER_SIN_ESCRIBIR'));
}

test('sin F2 no se inventa una referencia ni se acepta propuesta',()=>{
 const r=guard(null,[propuesta()]);noWrites(r);
 assert.equal(r.fuente,'F2_NO_DISPONIBLE');assert.equal(r.detalles[0].motivo,'SIN_REFERENCIA_F2');
});
test('sin propuestas, ninguna acción ni fichero creado',()=>{
 const r=guard(fuente(),[]);noWrites(r);assert.equal(r.propuestas_total,0);assert.deepEqual(r.detalles,[]);
});
test('identidad única T manda y una fila nueva protegida retiene lo remoto',()=>{
 const r=guard(fuente({altas:[1601]}),[propuesta(1601)]);noWrites(r);
 assert.equal(r.detalles[0].motivo,'ID_FILA_NUEVA_EN_MANTENIMENT');
});
test('corrección real antigua tras el corte protege MANTENIMENT ante salida vieja',()=>{
 const r=guard(fuente({cambios:[1601]}),[propuesta(1601,{fecha_original:'14/09/2024',fecha_editada:'16/11/2026'})]);noWrites(r);
 assert.equal(r.detalles[0].motivo,'CAMBIO_LOCAL_OBSERVADO_EN_MANTENIMENT');
 assert.equal(r.autor_humano_acreditado,false);
});
test('TANCAMENT corregido: retención de propuesta de todos los campos por ID_FILA',()=>{
 const r=guard(fuente({cambios:[4001]}),[propuesta(4001,{tipo:'trabajos',designacion:'TANCAMENT 11',fecha_k:'2026-11-16'})]);noWrites(r);
 assert.equal(r.detalles[0].motivo,'CAMBIO_LOCAL_OBSERVADO_EN_MANTENIMENT');
});
test('misma PA y mismo DFM sin T: nunca emparejar a ojo',()=>{
 const r=guard(fuente(),[propuesta(undefined,{id_fila:null})]);noWrites(r);
 assert.equal(r.detalles[0].id_fila,null);assert.equal(r.detalles[0].motivo,'SIN_ID_FILA_T');
});
test('PR provisional no es identidad aunque se renumere a PA',()=>{
 const r=guard(fuente({cambios:[812]}),[propuesta(812,{numero_parada:'PR-0001'})]);noWrites(r);
 assert.equal(r.detalles[0].id_fila,812);
 assert.equal(r.detalles[0].motivo,'CAMBIO_LOCAL_OBSERVADO_EN_MANTENIMENT');
});
test('cambio DFM no reidentifica una T con mismo ID',()=>{
 const r=guard(fuente({cambios:[812]}),[propuesta(812,{dfm:'OTRA_UNIDAD'})]);noWrites(r);
 assert.equal(r.detalles[0].id_fila,812);
});
test('ID_FILA ausente en hoja no se interpreta como baja de camión',()=>{
 const r=guard(fuente({ausencias:[100]}),[propuesta(100)]);noWrites(r);
 assert.equal(r.detalles[0].motivo,'ID_FILA_AUSENTE_DE_MANTENIMENT');
});
test('filas sin diferencias observadas siguen retenidas hasta cotejo actual',()=>{
 const r=guard(fuente(),[propuesta(100)]);noWrites(r);
 assert.equal(r.detalles[0].motivo,'SIN_DIFERENCIA_OBSERVADA_REQUIERE_COTEJO_ACTUAL');
});
test('un informe parcial nunca sirve para autorizar por ausencia de ID listado',()=>{
 const r=guard(fuente({cambios:[20],parcial:true}),[propuesta(21)]);noWrites(r);
 assert.equal(r.fuente,'F2_PARCIAL_NO_DECISORIO');assert.equal(r.detalles[0].motivo,'INFORME_F2_PARCIAL');
});
test('dos propuestas con el mismo ID_FILA se retienen, nunca primera ni última',()=>{
 const r=guard(fuente(),[propuesta(100),propuesta('100',{revision:2})]);noWrites(r);
 assert.equal(r.propuestas_total,2);assert.deepEqual(r.detalles.map(x=>x.motivo),['PROPUESTAS_MULTIPLES_PARA_ID_FILA','PROPUESTAS_MULTIPLES_PARA_ID_FILA']);
});
test('dos IDs diferentes con igual DFM y PA siguen siendo dos identidades distintas',()=>{
 const r=guard(fuente(),[propuesta(100),propuesta(101)]);noWrites(r);
 assert.deepEqual(r.detalles.map(x=>x.id_fila),[100,101]);
});
test('el lote puede incluir un ID numérico y uno como cadena sin ceros',()=>{
 const r=guard(fuente(),[propuesta(1),propuesta('2')]);noWrites(r);
 assert.deepEqual(r.detalles.map(x=>x.id_fila),[1,2]);
});
test('ID vacío, negativo, decimal, con 0 a la izquierda o no numérico se bloquea',()=>{
 for (const v of ['',0,-1,0.5,'01','PA-100',null,undefined]){
  const r=guard(fuente(),[propuesta(1601,{id_fila:v})]);noWrites(r);
  assert.equal(r.detalles[0].motivo,'SIN_ID_FILA_T');
 }
});
test('referencia remota sin tipo, UUID, revisión o huella no pasa',()=>{
 for(const patch of [
  {tipo:'TANCAMENT'}, {sync_id:'no es uuid'}, {revision:0},
  {payload_sha256:'no_sha'}, {payload_sha256:null},
 ]){
  const r=guard(fuente(),[propuesta(71,patch)]);noWrites(r);
  assert.equal(r.detalles[0].motivo,'REFERENCIA_REMOTA_INCOMPLETA');
 }
});
test('ningún UUID/revisión/huella remoto concede autorización',()=>{
 const r=guard(fuente(),[propuesta(88)]);noWrites(r);
 assert.equal(r.detalles[0].motivo,'SIN_DIFERENCIA_OBSERVADA_REQUIERE_COTEJO_ACTUAL');
});
test('un informe F2 falso con autorización o autor declarado es rechazado',()=>{
 for(const patch of [
  {autoriza_sincronizar:true},{escritura_en_hojas:true},
  {escritura_en_backend:true},{origen_humano_acreditado:true},
  {fecha_exacta_de_edicion_acreditada:true},
 ])assert.throws(()=>guard({...fuente(),...patch},[propuesta()]),/SINCRO11/);
});
test('informe de V1 o un objeto inventado no pasa por F2',()=>{
 assert.throws(()=>guard({...fuente(),resultado:'PREVISION_SOLO_LECTURA'},[]),/informe F2/);
});
test('fecha anterior al corte o invertida en F2 obliga a detener',()=>{
 assert.throws(()=>guard(fuente({fecha_ref:'2026-11-15T22:59:59.999Z'}),[]),/anterior al corte/);
 assert.throws(()=>guard(fuente({fecha_obs:'2026-11-16T05:00:00.000Z'}),[]),/fechas invertidas/);
});
test('fecha F2 inválida o no UTC se rechaza',()=>{
 for(const v of ['2026-02-30T10:00:00.000Z','2026-11-16','2026-11-16T10:00:00+01:00'])
  assert.throws(()=>guard(fuente({fecha_obs:v}),[]),/UTC completo|fecha válida/);
});
test('diferencia entre filas de F2 y altas/ausencias denuncia informe incoherente',()=>{
 assert.throws(()=>guard({...fuente({altas:[2]}),filas_actuales:6742},[]),/conteo/);
});
test('lista no parcial con contador distinto se rechaza',()=>{
 assert.throws(()=>guard({...fuente(),cambios_observados:5},[propuesta()]),/contador F2/);
});
test('ID repetido entre altas y cambios de F2 no autoriza resolver arbitrariamente',()=>{
 assert.throws(()=>guard(fuente({cambios:[101],altas:[101]}),[]),/presente en dos categorías/);
});
test('clase de F2 falsificada se rechaza sin consultar el contenido',()=>{
 const x=fuente({cambios:[20]});x.cambios[0].clase='CONFIRMADO_POR_EL_USUARIO';
 assert.throws(()=>guard(x,[]),/clase de F2 inválida/);
});
test('informe parcial de F2 con 100 registros de muestra y contador mayor se retiene entero',()=>{
 const sample=Array.from({length:100},(_,i)=>({id_fila:i+1,clase:'CONTENIDO_DISTINTO_PENDIENTE_DE_COTEJO'}));
 const x={...fuente(),cambios_observados:200,cambios:sample,lista_parcial:true};
 const r=guard(x,[propuesta(101)]);noWrites(r);assert.equal(r.detalles[0].motivo,'INFORME_F2_PARCIAL');
});
test('sin fuga de payload ni contenido privado en la salida, incluso ante cambios',()=>{
 const secret='NO_SUBIR_123456789';
 const r=guard(fuente({cambios:[11]}),[propuesta(11,{descripcion:secret,observaciones:secret,token:secret,payload:{privado:secret}})]);
 assert.equal(JSON.stringify(r).includes(secret),false);
 assert.equal(JSON.stringify(r).includes('PA-2600300'),false);
 assert.equal(r.expone_datos_privados,false);
 assert.equal(r.expone_payloads,false);
});
test('salida estable por orden de entrada y conteos por motivo',()=>{
 const r=guard(fuente({cambios:[3],altas:[4],ausencias:[5]}),[propuesta(3),propuesta(4),propuesta(5),propuesta(6)]);
 assert.deepEqual(r.detalles.map(x=>x.id_fila),[3,4,5,6]);
 assert.deepEqual(Object.values(r.motivos).sort(),[1,1,1,1]);noWrites(r);
});
test('100 primeras propuestas se muestran, 6742 se cuentan y ninguna se aplica',()=>{
 const proposals=Array.from({length:6742},(_,i)=>propuesta(i+1,{revision:1}));
 const r=guard(fuente({cambios:[1601]}),proposals);
 noWrites(r);assert.equal(r.propuestas_total,6742);assert.equal(r.detalles.length,100);assert.equal(r.lista_parcial,true);
 assert.equal(r.motivos.CAMBIO_LOCAL_OBSERVADO_EN_MANTENIMENT,1);
});
test('miles de propuestas duplicadas se retienen, incluso con 100 previews',()=>{
 const proposals=Array.from({length:500},(_,i)=>propuesta(77,{revision:i+1}));
 const r=guard(fuente(),proposals);noWrites(r);
 assert.equal(r.motivos.PROPUESTAS_MULTIPLES_PARA_ID_FILA,500);
});
test('más de 25000 propuestas falla cerrado',()=>{
 assert.throws(()=>guard(fuente(),Array.from({length:25001},()=>propuesta(1))),/lote de propuestas inválido/);
});
test('sin archivos de red, sincronización o escritura en el módulo',()=>{
 const code=readFileSync(new URL('../shared/sincro11-guardia-conflictos.mjs',import.meta.url),'utf8');
 for(const expr of [/SpreadsheetApp/,/PropertiesService/,/UrlFetchApp/,/\bfetch\(/,/\.update\(/,/\.insert\(/,/\.setValue\(/,/INSERT\s+INTO/i,/UPDATE\s+public\./i,/createTrigger/]){
  assert.doesNotMatch(code,expr);
 }
 assert.match(SINCRO11_GUARDIA_VERSION,/sincro11-guardia-futuro/);
});


test('F2 sin tabla de cambios no interpreta eso como autorización para volcar históricas',()=>{
 const r=guard(fuente(),[propuesta(22,{tipo:'parada',numero_parada:'PA-2600298'})]);
 noWrites(r);assert.equal(r.detalles[0].motivo,'SIN_DIFERENCIA_OBSERVADA_REQUIERE_COTEJO_ACTUAL');
});
test('cuando F2 no ve una edición revertida, tampoco existe permiso para sobrescribir',()=>{
 // Limitación de snapshots: dos cambios intermedios que vuelven al mismo valor
 // no quedan registrados. La ausencia de diferencia nunca autoriza escritura.
 const r=guard(fuente(),[propuesta(911,{tipo:'maestro'})]);
 noWrites(r);assert.equal(r.autor_humano_acreditado,false);
});
test('V1 con hashes antiguos sin informe F2 no es una fuente de prioridades',()=>{
 const r=guard(undefined,[propuesta(1601,{tipo:'trabajos'})]);
 noWrites(r);assert.equal(r.fuente,'F2_NO_DISPONIBLE');
});
test('no se resuelve un número PR mediante coincidencia de su fecha o DFM',()=>{
 const a=propuesta(null,{numero_parada:'PR-005',dfm:'2573',fecha:'2026-11-16'});
 const r=guard(fuente({cambios:[5]}),[a]);
 noWrites(r);assert.equal(r.detalles[0].motivo,'SIN_ID_FILA_T');
});