import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const ID=7100;
const SHEET='sincro13-hoja-sintetica-20261118';
const WORK='11111111-1111-4111-8111-111111111111';
const SECRET='s13g_'+'1'.repeat(64);
const str=s=>"'"+String(s).replaceAll("'","''")+"'";
function pg(sql){
 try {return execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',sql],
  {encoding:'utf8',timeout:12000}).trim();}
 catch(e){throw new Error(String(e.stderr||e.message));}
}
function payload({request=randomUUID(),work=WORK,book=SHEET,date='2026-11-20',
 read=new Date(Date.now()-10000).toISOString(),count=2,attributed=false}={}){
 return {protocolo:'sincro13-google-k-lectura-v1',
 solicitud_id:request,spreadsheet_id:book,id_fila:ID,trabajo_sync_id:work,
 columna:'K',valor_nuevo:date,observado_en:read,lecturas_independientes:count,
 editor_google_acreditado:attributed,escritura_realizada:false};
}
function call(p,token=SECRET){
 return JSON.parse(pg('SELECT public.sincro13_recibir_lectura_google_k('+
 str(token)+','+str(JSON.stringify(p))+'::jsonb)::text;'));
}
const rejects=(fn,reason)=>assert.throws(fn,e=>String(e).includes(reason),reason);

test('verificador está desactivado por defecto: ningún acceso ni evidencia',()=>{
 rejects(()=>call(payload()),'S13_LECTOR_NO_AUTORIZADO');
 assert.equal(pg("SELECT habilitado::text FROM app_private.sincro13_verificador_config WHERE id=1"),'false');
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_k_evidencias'),'0');
});
test('habilitación se aplica EXCLUSIVAMENTE a esta base PostgreSQL ficticia',()=>{
 assert.equal(pg('SELECT current_database()'),'sincro13_lab');
 pg("UPDATE app_private.sincro13_verificador_config SET "+
   "secreto_sha256=encode(extensions.digest("+str(SECRET)+",'sha256'),'hex'),"+
   "habilitado=true WHERE id=1");
 assert.equal(pg("SELECT habilitado::text FROM app_private.sincro13_verificador_config WHERE id=1"),'true');
});
test('token Apps Script mg_ NO vale como secreto independiente',()=>{
 rejects(()=>call(payload(),'mg_'+'0'.repeat(64)),'S13_LECTOR_NO_AUTORIZADO');
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_k_evidencias'),'0');
});
test('sin dos lecturas independientes no se registra corrección',()=>{
 rejects(()=>call(payload({count:1})),'S13_LECTURA_INVALIDA');
});
test('nadie puede atribuir al editor de Google en esta revisión',()=>{
 rejects(()=>call(payload({attributed:true})),'S13_LECTURA_INVALIDA');
});
test('spreadsheet equivocada no puede generar evidencia T',()=>{
 rejects(()=>call(payload({book:'sincro13-hoja-falsa-20261119'})),'S13_HOJA_NO_AUTORIZADA');
});
test('UUID de trabajo cambiado no se acepta aunque exista la T',()=>{
 rejects(()=>call(payload({work:'11111111-1111-4111-8111-111111111112'})),'S13_T_TRABAJO_NO_ACREDITADOS');
});
test('fecha de lectura vieja no se presenta como evento reciente',()=>{
 rejects(()=>call(payload({read:'2026-11-16T10:00:00.000Z'})),'S13_LECTURA_CADUCADA_O_INVALIDA');
});
test('evidencia de servidor toma K base del backend y NO la del llamante',()=>{
 const p=payload();
 const r=call(p);
 assert.equal(r.estado,'PENDIENTE_ADOPCION');
 assert.equal(r.columna,'K');assert.equal(r.id_fila,ID);
 assert.equal(r.valor_base,null);assert.equal(r.valor_nuevo,'2026-11-20');
 assert.equal(r.editor_google_acreditado,false);
 assert.equal(r.autoriza_sincronizar,false);
 assert.equal(r.escritura_realizada,false);
 assert.match(r.evidencia_sha256,/^[0-9a-f]{64}$/);
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_k_evidencias'),'1');
 assert.equal(pg('SELECT COALESCE(actor_google_verificado::text,\'NULL\') FROM app_private.sincro13_k_evidencias'),'NULL');
 assert.equal(pg('SELECT editor_google_acreditado::text FROM app_private.sincro13_k_evidencias'),'false');
 globalThis.proof={p,r};
});
test('mismo nonce y lectura exacta devuelve mismo ID sin otra evidencia',()=>{
 const {p,r}=globalThis.proof;
 const again=call(p);
 assert.equal(again.evidencia_id,r.evidencia_id);
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_k_evidencias'),'1');
});
test('replay con mismo nonce y K alterada se rechaza',()=>{
 const {p}=globalThis.proof;
 rejects(()=>call({...p,valor_nuevo:'2026-11-21'}),'S13_LECTURA_REPLAY_CONTRADICTORIO');
});
test('otro nonce para misma T crea colisión pendiente y NO sustituye la prueba',()=>{
 rejects(()=>call(payload()),'duplicate key value');
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_k_evidencias'),'1');
});
test('una K ya igual al catálogo técnico no crea trabajo nuevo',()=>{
 pg("UPDATE app_private.manteniment_t_trabajos SET fecha_recogida='2026-11-22' WHERE sync_id="+str(WORK)+"::uuid");
 try {
   const r=call(payload({date:'2026-11-22'}));
   assert.equal(r.estado,'SIN_CAMBIO');
   assert.equal(pg('SELECT count(*) FROM app_private.sincro13_k_evidencias'),'1');
 }finally {
   pg('UPDATE app_private.manteniment_t_trabajos SET fecha_recogida=NULL WHERE sync_id='+str(WORK)+'::uuid');
 }
});
test('roles públicos no pueden llamar al registro independiente',()=>{
 const p=payload();
 rejects(()=>pg('SET ROLE authenticated; SELECT public.sincro13_recibir_lectura_google_k('+
   str(SECRET)+','+str(JSON.stringify(p))+'::jsonb);'),'permission denied');
 rejects(()=>pg('SET ROLE anon; SELECT public.sincro13_recibir_lectura_google_k('+
   str(SECRET)+','+str(JSON.stringify(p))+'::jsonb);'),'permission denied');
});
test('limpieza EXCLUSIVAMENTE del laboratorio; no tocar MG9 ni Hotel',()=>{
 pg('DELETE FROM app_private.sincro13_k_evidencias WHERE solicitud_id='+str(globalThis.proof.p.solicitud_id)+'::uuid');
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_k_evidencias'),'0');
 assert.equal(pg('SELECT count(*) FROM app_private.mg9_filas_identidad'),'0');
 assert.equal(pg('SELECT count(*) FROM app_private.manteniment_t_trabajos'),'2');
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_recibos_t'),'1');
});
