import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const WORK='11111111-1111-4111-8111-111111111111';
const OTHER='11111111-1111-4111-8111-111111111112';
const FOLLOWUP='33333333-3333-4333-8333-333333333333';
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function pg(sql){
  try {return execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',sql],
    {encoding:'utf8',timeout:15000}).trim();}
  catch(e){throw Error(String(e.stderr||e.message));}
}
function status(){
  const s=pg("SELECT jsonb_build_object('estado',estado,'ultimo_error',ultimo_error,"+
    "'payload',payload)::text FROM app_private.manteniment_parada_outbox WHERE seguimiento_id="+
    quote(FOLLOWUP)+"::uuid");
  return JSON.parse(s);
}
function queue(payload){
  const json=quote(JSON.stringify(payload))+'::jsonb';
  pg("UPDATE app_private.manteniment_parada_outbox SET estado='pendiente',"+
    "payload="+json+",ultimo_error='' WHERE seguimiento_id="+quote(FOLLOWUP)+"::uuid");
  return status();
}
function reset(){
  pg("UPDATE app_private.manteniment_parada_outbox "+
    "SET estado='confirmado',payload='{}'::jsonb,ultimo_error='' WHERE seguimiento_id="+quote(FOLLOWUP)+"::uuid");
}
function assertRetained(packet){
  const result=queue(packet);
  assert.equal(result.estado,'retenida_manual');
  assert.match(result.ultimo_error,/S13_K_MANUAL/);
  assert.deepEqual(result.payload,packet,
    'No borrar ni reescribir ningún otro trabajo del lote');
  reset();
  return result;
}
function assertPending(packet){
  const result=queue(packet);
  assert.equal(result.estado,'pendiente');
  assert.equal(result.ultimo_error,'');
  assert.deepEqual(result.payload,packet);
  reset();
}
const assigned=(work,k)=>({trabajo_sync_id:work,clave_fila:'LAB_TRABAJO_01',fecha_entrada:'2026-11-18',fecha_salida:k});
const created=(work,k)=>({trabajo_sync_id:work,dfm:'LABORATORIO-01',fecha_salida:k});

test('prerequisito: corrección K 19/11 ya consumida y aprobada en el laboratorio',()=>{
  assert.equal(pg('SELECT current_database()'),'sincro13_lab');
  const approved=pg("SELECT count(*) FROM app_private.sincro13_k_evidencias "+
    "WHERE trabajo_sync_id="+quote(WORK)+"::uuid AND estado='APLICADA' "+
    "AND valor_nuevo='2026-11-19'::date");
  assert.ok(Number(approved)>=1);
  assert.equal(status().estado,'confirmado');
  const trig=pg("SELECT count(*) FROM pg_trigger WHERE tgname='sincro13_retener_k_manual_outbox_parada' AND NOT tgisinternal");
  assert.equal(trig,'1');
});
test('K antigua en trabajos_asignados: RETENER, no repetir fecha errónea',()=>{
  assertRetained({trabajos_asignados:[assigned(WORK,'2026-11-18')],otros_trabajos:'NO_TOCAR'});
});
test('K actual aprobada: propuesta de ese trabajo sigue permitida',()=>{
  assertPending({trabajos_asignados:[assigned(WORK,'2026-11-19')]});
});
test('K NULL posterior borraría la corrección: retener',()=>{
  assertRetained({trabajos_asignados:[assigned(WORK,null)]});
});
test('K distinta en trabajos_crear también queda retenida',()=>{
  assertRetained({trabajos_crear:[created(WORK,'2026-11-17')]});
});
test('un trabajo distinto sin corrección manual no hereda el bloqueo',()=>{
  assertPending({trabajos_asignados:[assigned(OTHER,'2026-11-17')]});
});
test('varios trabajos, uno contradictorio: mantener todo el lote íntegro',()=>{
  const packet={trabajos_asignados:[
    assigned(OTHER,'2026-11-20'),assigned(WORK,'2026-11-18')
  ],otros_trabajos:'NO_TOCAR'};
  assertRetained(packet);
});
test('K ausente no se inventa ni bloquea otros movimientos',()=>{
  assertPending({trabajos_asignados:[{trabajo_sync_id:WORK,clave_fila:'LAB_TRABAJO_01',actuacion:'DOCUMENTO'}]});
});
test('trabajo con K pero UUID ausente se retiene, nunca usar fila/DFM',()=>{
  assertRetained({trabajos_asignados:[{fila:17,dfm:'LABORATORIO-01',fecha_salida:'2026-11-18'}]});
});
test('array malformed impide omitir control de K',()=>{
  assertRetained({trabajos_asignados:{trabajo_sync_id:WORK,fecha_salida:'2026-11-18'}});
});
test('futuras órdenes confirmadas no se transforman por sistema',()=>{
  reset();
  const packet={trabajos_asignados:[assigned(WORK,'2026-11-18')]};
  pg("UPDATE app_private.manteniment_parada_outbox SET estado='confirmado',"+
    "payload="+quote(JSON.stringify(packet))+"::jsonb WHERE seguimiento_id="+quote(FOLLOWUP)+"::uuid");
  assert.equal(status().estado,'confirmado');
  assert.deepEqual(status().payload,packet);
  reset();
});
test('CAS y datos de origen no cambian por retener una salida',()=>{
  assert.equal(status().estado,'confirmado');
  assert.equal(pg("SELECT fecha_recogida::text FROM app_private.manteniment_t_trabajos WHERE sync_id="+quote(WORK)+"::uuid"),
    '2026-11-19');
  assert.equal(pg('SELECT count(*) FROM app_private.mg9_filas_identidad'),'0');
  assert.equal(pg('SELECT count(*) FROM app_private.sincro13_recibos_t'),'1');
});
