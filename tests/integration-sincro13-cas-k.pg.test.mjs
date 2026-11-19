import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const TOKEN='mg_'+'0'.repeat(64);
const SHEET='sincro13-hoja-sintetica-20261118';
const WORK='11111111-1111-4111-8111-111111111111';
const OTHER='11111111-1111-4111-8111-111111111112';
const FOLLOWUP='33333333-3333-4333-8333-333333333333';
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
function pg(sql){
 try{return execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',sql],
   {encoding:'utf8',timeout:15000}).trim();}
 catch(e){throw new Error(String(e.stderr||e.message));}
}
const k=()=>pg('SELECT COALESCE(fecha_recogida::text,\'NULL\') FROM app_private.manteniment_t_trabajos WHERE sync_id='+q(WORK)+'::uuid');
const j=()=>pg('SELECT COALESCE(fecha_realizada::text,\'NULL\') FROM app_private.manteniment_t_trabajos WHERE sync_id='+q(WORK)+'::uuid');
function claim({row=7100,work=WORK,base=null,next='2026-11-19',at=new Date(Date.now()-60000).toISOString(),source='GOOGLE_INDEPENDIENTE'}={}){
 const id=randomUUID(),request=randomUUID(),actor='88888888-8888-4888-8888-888888888888';
 const vals=[q(id)+'::uuid',q(request)+'::uuid',q(SHEET),row,
  q(work)+'::uuid',q('K'),base===null?'NULL':q(base)+'::date',
  q(next)+'::date',q(at)+'::timestamptz','clock_timestamp()',
  q(source),q(actor)+'::uuid',q('d'.repeat(64))];
 pg('INSERT INTO app_private.sincro13_k_evidencias '+
  '(evidencia_id,solicitud_id,spreadsheet_id,id_fila,trabajo_sync_id,columna,valor_base,valor_nuevo,evento_en,verificado_en,verificador,actor_verificado,evidencia_sha256) '+
  'VALUES ('+vals.join(',')+')');
 return {id,request};
}
function apply(c,token=TOKEN,request=c.request){
 return JSON.parse(pg('SELECT app_private.sincro13_cas_k('+q(token)+','+q(c.id)+'::uuid,'+q(request)+'::uuid)::text;'));
}
const reject=(f,msg)=>assert.throws(f,e=>String(e).includes(msg),msg);

test('sin evidencia externa acreditada no se modifica ninguna T',()=>{
 const result=JSON.parse(pg('SELECT app_private.sincro13_cas_k('+q(TOKEN)+','+q(randomUUID())+'::uuid,'+q(randomUUID())+'::uuid)::text'));
 assert.equal(result.estado,'RETENIDA');
 assert.equal(result.motivo,'EVIDENCIA_NO_AUTORIZADA');
 assert.equal(k(),'NULL');
});
test('token falso no puede aplicar corrección aunque exista una evidencia',()=>{
 const c=claim();
 try {
   reject(()=>apply(c,'mg_'+'f'.repeat(64)),'S13_CAS_TOKEN_INVALIDO');
   assert.equal(k(),'NULL');
 } finally {
   // Limpieza exclusivamente del fixture de laboratorio: una evidencia
   // rechazada queda PENDIENTE e impide otra solicitud para la misma T.
   pg('DELETE FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.id)+'::uuid');
 }
});
test('CAS positivo actualiza únicamente fecha_recogida de la T y su trabajo exacto',()=>{
 pg('UPDATE app_private.manteniment_t_trabajos SET fecha_realizada=\'2026-11-18\' WHERE sync_id='+q(WORK)+'::uuid');
 const c=claim();
 const result=apply(c);
 assert.equal(result.estado,'APLICADA');
 assert.equal(result.columna,'K');
 assert.equal(result.autoriza_sincronizar,false);
 assert.equal(k(),'2026-11-19');
 assert.equal(j(),'2026-11-18');
 assert.equal(pg('SELECT estado FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.id)+'::uuid'),'APLICADA');
 globalThis.__appliedClaim=c;
});
test('replay de misma solicitud devuelve recibo anterior sin otra mutación',()=>{
 const c=globalThis.__appliedClaim;
 const before=pg('SELECT actualizado_en::text FROM app_private.manteniment_t_trabajos WHERE sync_id='+q(WORK)+'::uuid');
 const result=apply(c);
 assert.equal(result.estado,'APLICADA');
 const after=pg('SELECT actualizado_en::text FROM app_private.manteniment_t_trabajos WHERE sync_id='+q(WORK)+'::uuid');
 assert.equal(after,before);
 assert.equal(k(),'2026-11-19');
});
test('no se puede reutilizar la evidencia con otro request_id',()=>{
 const c=globalThis.__appliedClaim;
 const result=apply(c,TOKEN,randomUUID());
 assert.equal(result.estado,'RETENIDA');
 assert.equal(result.motivo,'EVIDENCIA_NO_AUTORIZADA');
 assert.equal(k(),'2026-11-19');
});
test('valor base obsoleto se retiene sin pisar corrección posterior',()=>{
 const c=claim({base:null,next:'2026-11-21'});
 const res=apply(c);
 assert.equal(res.estado,'RETENIDA');
 assert.equal(res.motivo,'BASE_K_CAMBIADA');
 assert.equal(k(),'2026-11-19');
});
test('outbox no mapeable a T/columna bloquea sobreescritura',()=>{
 pg('INSERT INTO app_private.manteniment_parada_outbox(seguimiento_id,estado) VALUES ('+q(FOLLOWUP)+'::uuid,\'pendiente\')');
 const c=claim({base:'2026-11-19',next:'2026-11-22'});
 const res=apply(c);
 assert.equal(res.estado,'RETENIDA');
 assert.equal(res.motivo,'OUTBOX_SIN_T_CAMPO_PENDIENTE');
 assert.equal(k(),'2026-11-19');
 pg('UPDATE app_private.manteniment_parada_outbox SET estado=\'confirmado\' WHERE seguimiento_id='+q(FOLLOWUP)+'::uuid');
 const retry=apply(c);
 assert.equal(retry.estado,'RETENIDA');
 assert.equal(k(),'2026-11-19');
});
test('T enlazada a otro trabajo no cambia ni el nuevo ni el original',()=>{
 const c=claim({work:OTHER,base:null,next:'2026-11-23'});
 const res=apply(c);
 assert.equal(res.estado,'RETENIDA');
 assert.equal(res.motivo,'T_O_TRABAJO_NO_VINCULADOS');
 assert.equal(k(),'2026-11-19');
 assert.equal(pg('SELECT COALESCE(fecha_recogida::text,\'NULL\') FROM app_private.manteniment_t_trabajos WHERE sync_id='+q(OTHER)+'::uuid'),'NULL');
});
test('evidencia del corte histórico queda retenida',()=>{
 const c=claim({base:'2026-11-19',next:'2026-11-24',at:'2026-11-12T12:00:00.000Z'});
 const res=apply(c);
 assert.equal(res.estado,'RETENIDA');
 assert.equal(res.motivo,'EVIDENCIA_INSUFICIENTE');
 assert.equal(k(),'2026-11-19');
});
test('recogida anterior al fin de taller no se inventa',()=>{
 const c=claim({base:'2026-11-19',next:'2026-11-17'});
 const res=apply(c);
 assert.equal(res.estado,'RETENIDA');
 assert.equal(res.motivo,'RECOGIDA_ANTES_DE_FIN_TRABAJO');
 assert.equal(k(),'2026-11-19');
});
test('permisos de anon/authenticated no dejan llamar a CAS',()=>{
 const c=globalThis.__appliedClaim;
 reject(()=>pg('SET ROLE authenticated; SELECT app_private.sincro13_cas_k('+
  q(TOKEN)+','+q(c.id)+'::uuid,'+q(c.request)+'::uuid);'),'permission denied');
});
test('el servicio de Edge tampoco puede fabricar evidencias',()=>{
 const c=randomUUID();
 reject(()=>pg('SET ROLE service_role; INSERT INTO app_private.sincro13_k_evidencias(evidencia_id) VALUES ('+q(c)+'::uuid);'),'permission denied');
});
test('identidad MG9, cola y otros trabajos permanecen intactos',()=>{
 assert.equal(pg('SELECT count(*) FROM app_private.mg9_filas_identidad'),'0');
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_recibos_t'),'1');
 assert.equal(pg('SELECT count(*) FROM app_private.manteniment_t_trabajos'),'2');
 assert.equal(pg('SELECT estado FROM app_private.manteniment_parada_outbox WHERE seguimiento_id='+q(FOLLOWUP)+'::uuid'),'confirmado');
});
