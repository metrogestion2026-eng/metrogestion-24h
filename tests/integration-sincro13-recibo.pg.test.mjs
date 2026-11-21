import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const SHEET='sincro13-hoja-sintetica-20261118';
const TOKEN='mg_'+'0'.repeat(64);
const ORDER='44444444-4444-4444-8444-444444444444';
const OLD='55555555-5555-4555-8555-555555555555';
const WORK='11111111-1111-4111-8111-111111111111';
const OTHER='11111111-1111-4111-8111-111111111112';
const sqlString=x=>"'"+String(x).replaceAll("'","''")+"'";
function pg(sql){
  try {return execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',sql],
      {encoding:'utf8',timeout:15000}).trim();}
  catch(e){throw Error(String(e.stderr||e.message));}
}
const hashFor=id=>pg("SELECT payload_sha256 FROM app_private.manteniment_entregas_continuidad_alpha75 WHERE sync_id="+sqlString(id)+"::uuid;");
function payload({order=ORDER,hash=hashFor(order),row=7100,work=WORK,time=new Date(Date.now()-60000).toISOString(),req=randomUUID()}={}){
  return {
    version_ejecucion:'MG75-EJECUCION-ORDEN-001',
    spreadsheet_id:SHEET,request_id:req,
    orden:{tipo:'trabajos',sync_id:order,revision:order===ORDER?7:1,payload_sha256:hash},
    recibos:[{id_fila:row,trabajo_sync_id:work,creado_en:time,
      origen:'ORDEN_AUTORIZADA',estado:'PENDIENTE_COTEJO_OBJETO'}]
  };
}
function receive(p,token=TOKEN){
  const sql="SELECT public.sincro13_registrar_recibo_t("+sqlString(token)+","+
    sqlString(JSON.stringify(p))+"::jsonb)::text;";
  return JSON.parse(pg(sql));
}
function rejects(fn,fragment){
  assert.throws(fn,err=>String(err).includes(fragment),fragment);
}
test('receptor privado: token falso no da acceso',()=>{
  rejects(()=>receive(payload(), 'mg_'+'f'.repeat(64)),'S13_AUTH_DENEGADA');
});
test('la entrega histórica (antes de corte) está excluida incluso con T nueva',()=>{
  rejects(()=>receive(payload({order:OLD,work:OTHER,row:7101})),'S13_ENTREGA_NO_ACREDITADA');
});
test('el primer acuse real de laboratorio queda PENDIENTE, nunca acreditado',()=>{
  const answer=receive(payload());
  assert.equal(answer.protocolo,'sincro13-recibos-nuevos-v1');
  assert.equal(answer.recibidos,1);
  assert.equal(answer.estado,'PENDIENTE_VERIFICACION_GOOGLE');
  assert.equal(answer.autoriza_sincronizar,false);
  assert.equal(pg("SELECT count(*) FROM app_private.sincro13_recibos_t"),"1");
});
test('reintento con otra request_id, mismo recibo exacto, no duplica',()=>{
  const raw=pg("SELECT to_char(asignado_en AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM app_private.sincro13_recibos_t WHERE id_fila=7100");
  const again=receive(payload({time:raw}));
  assert.equal(again.recibidos,1);
  assert.equal(pg("SELECT count(*) FROM app_private.sincro13_recibos_t"),"1");
  assert.equal(pg("SELECT count(*) FROM app_private.sincro13_lotes_t"),"1");
});
test('misma T con trabajo distinto no se convierte en enlace',()=>{
  rejects(()=>receive(payload({row:7100,work:OTHER})),'S13_TRABAJO_NO_ACREDITADO');
});
test('otra T para mismo trabajo dentro de orden ya aceptada es contradictoria',()=>{
  rejects(()=>receive(payload({row:7102})),'S13_LOTE_CONTRADICTORIO');
});
test('nunca convierte un ID_FILA fuera de rango en hecho acreditado',()=>{
  rejects(()=>receive(payload({row:9007199254740992})),'S13_T_INVALIDA');
});
test('rechaza una fecha de alta del operador anterior al corte',()=>{
  rejects(()=>receive(payload({row:7103,time:'2026-11-15T22:00:00.000Z'})),'S13_FECHA_INVALIDA');
});
test('sin permiso de servicio no puede llamarse al wrapper público',()=>{
  rejects(()=>pg("SET ROLE authenticated; SELECT public.sincro13_registrar_recibo_t("+
    sqlString(TOKEN)+","+sqlString(JSON.stringify(payload()))+"::jsonb)"),'permission denied');
});
test('mg9 staging y los objetos operativos siguen intactos',()=>{
  assert.equal(pg("SELECT count(*) FROM app_private.mg9_filas_identidad"),"0");
  assert.equal(pg("SELECT count(*) FROM app_private.manteniment_t_trabajos"),"2");
  assert.equal(pg("SELECT count(*) FROM app_private.manteniment_entregas_continuidad_alpha75"),"2");
  assert.equal(pg("SELECT count(*) FROM app_private.sincro13_recibos_t WHERE estado <> 'PENDIENTE_VERIFICACION_GOOGLE'"),"0");
});
