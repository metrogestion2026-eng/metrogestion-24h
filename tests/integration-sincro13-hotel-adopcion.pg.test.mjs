import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const SHEET='sincro13-hoja-sintetica-20261118';
const WORK='11111111-1111-4111-8111-111111111111';
const STAGE='66666666-6666-4666-8666-666666666666';
const FOLLOWUP='33333333-3333-4333-8333-333333333333';
const ADMIN='88888888-8888-4888-8888-888888888888';
const SESSION='aaaaaaaa-0000-4000-8000-000000000001';
const TIME='2026-11-19T11:00:00+01:00';
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const pg=sql=>{
 try{return execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',sql],
    {encoding:'utf8',timeout:18000}).trim()}
 catch(e){throw Error(String(e.stderr||e.message));}
};
const stageVersion=()=>Number(pg('SELECT version FROM public.etapas_hotel WHERE id='+q(STAGE)+'::uuid'));
const k=()=>pg('SELECT COALESCE(fecha_recogida::text,\'NULL\') FROM app_private.manteniment_t_trabajos WHERE sync_id='+q(WORK)+'::uuid');
const j=()=>pg('SELECT COALESCE(fecha_realizada::text,\'NULL\') FROM app_private.manteniment_t_trabajos WHERE sync_id='+q(WORK)+'::uuid');
const stage=()=>JSON.parse(pg('SELECT jsonb_build_object('+
 "'version',version,'estado',estado,'cancelado',cancelado,"+
 "'inicio',fecha_inicio_real,'fin',fecha_fin_real,"+
 "'recogida',fecha_real,'modificado_por',modificado_por)"+
 '::text FROM public.etapas_hotel WHERE id='+q(STAGE)+'::uuid'));
function createClaim({approve=true}={}){
 const c={evidence:randomUUID(),request:randomUUID(),stage:STAGE,version:stageVersion(),time:TIME};
 const now=new Date(Date.now()-20000).toISOString();
 pg('INSERT INTO app_private.sincro13_k_evidencias('+
  'evidencia_id,solicitud_id,spreadsheet_id,id_fila,trabajo_sync_id,'+
  'columna,valor_base,valor_nuevo,evento_en,verificado_en,verificador,'+
  'actor_google_verificado,editor_google_acreditado,evidencia_sha256) VALUES ('+
   q(c.evidence)+'::uuid,'+q(c.request)+'::uuid,'+q(SHEET)+',7100,'+
   q(WORK)+"::uuid,'K',NULL,'2026-11-19'::date,"+
   q(now)+"::timestamptz,clock_timestamp(),'GOOGLE_INDEPENDIENTE',"+
   "NULL,false,"+q('e'.repeat(64))+')');
 if(approve){
  const approval={
   id_fila:7100,trabajo_sync_id:WORK,columna:'K',
   valor_base:null,valor_nuevo:'2026-11-19',evidencia_sha256:'e'.repeat(64)
  };
  const resp=withActor('SELECT public.sincro13_aprobar_correccion_k('+
   q(c.evidence)+'::uuid,'+q(c.request)+'::uuid,'+
   q(JSON.stringify(approval))+"::jsonb,'ADOPTO_CORRECCION_K_VERIFICADA')::text");
  assert.match(resp,/"APROBADA"/);
 }
 return c;
}
function withActor(sql,{role='authenticated',actor=ADMIN,principal=true,device=true,session=true}={}){
 const statements=[
  'BEGIN',
  'SET LOCAL request.jwt.claim.sub='+q(actor),
  'SET LOCAL request.jwt.claims='+q(JSON.stringify({session_id:SESSION,role})),
  'SET LOCAL "s13.lab.session"='+q(session?'ACTIVA':'CADUCADA'),
  'SET LOCAL "s13.lab.user"='+q('ACTIVO'),
  'SET LOCAL "s13.lab.device"='+q(device?'AUTORIZADO':'BLOQUEADO'),
  'SET LOCAL "s13.lab.admin"='+q(principal?'PRINCIPAL':'CONSULTA'),
  'SET LOCAL ROLE '+role,
  sql,
  'COMMIT'
 ];
 return pg(statements.join(';\n')+';');
}
function adopt(c,{time=c.time,version=c.version,stageId=c.stage,
 declaration='CONFIRMO_RECOGIDA_HORA_REAL',actor=ADMIN,
 principal=true,device=true,session=true,request=c.request}={}){
 const sql='SELECT public.sincro13_adoptar_hotel_k('+
  q(c.evidence)+'::uuid,'+q(request)+'::uuid,'+
  q(stageId)+'::uuid,'+version+','+q(time)+','+
  q(declaration)+')::text';
 const raw=withActor(sql,{actor,principal,device,session});
 const json=raw.split('\n').find(x=>x.trim().startsWith('{')&&x.includes('sincro13-hotel-k-v1'));
 if(!json)throw Error('S13_LAB_NO_RECEIPT '+raw.slice(-600));
 return JSON.parse(json);
}
function cleanup(c){
 pg('DELETE FROM app_private.sincro13_aprobaciones_k WHERE evidencia_id='+q(c.evidence)+'::uuid');
 pg('DELETE FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.evidence)+'::uuid');
}
function rejected(label,options={}){
 const c=createClaim();const before=stage(),previous=k();
 try{
   assert.throws(()=>adopt(c,options),/S13_HOTEL_/,'Expected fail-closed: '+label);
   assert.deepEqual(stage(),before,'Hotel stage cannot change when rejected: '+label);
   assert.equal(k(),previous,'technical K cannot change when rejected: '+label);
 }finally{cleanup(c);}
}
test('preparación: sólo LAB sintético, no hay K ni fecha real de recogida',()=>{
 assert.equal(pg('SELECT current_database()'),'sincro13_lab');
 assert.equal(k(),'NULL');
 assert.equal(j(),'2026-11-18');
 assert.equal(stage().recogida,null);
 assert.equal(stage().estado,'en_taller');
 assert.equal(pg("SELECT estado FROM app_private.manteniment_parada_outbox WHERE seguimiento_id="+q(FOLLOWUP)+'::uuid'),'confirmado');
});
test('fecha K sola sin HORA explícita es rechazada',()=>{
 rejected('no time',{time:'2026-11-19'});
});
test('día de la hora distinto de K de Google es rechazado',()=>{
 rejected('day mismatch',{time:'2026-11-18T11:00:00+01:00'});
});
test('versión T vieja o adelantada impide adopción',()=>{
 rejected('stale stage version',{version:stageVersion()+1});
});
test('T de Hotel ajena no puede recibir la K por el mismo DFM',()=>{
 rejected('foreign stage',{stageId:randomUUID()});
});
test('confirmación de recogida no explícita impide escritura',()=>{
 rejected('missing declaracion',{declaration:'OK'});
});
test('administrador desautorizado no puede modificar Hotel',()=>{
 rejected('not an admin',{principal:false});
});
test('dispositivo bloqueado no puede modificar Hotel',()=>{
 rejected('device blocked',{device:false});
});
test('sesión caducada no puede modificar Hotel',()=>{
 rejected('session expired',{session:false});
});
test('outbox PARADA pendiente impide adoptar K',()=>{
 pg('UPDATE app_private.manteniment_parada_outbox SET estado=\'pendiente\' WHERE seguimiento_id='+q(FOLLOWUP)+'::uuid');
 try{rejected('outbox pending');}
 finally{
  pg("UPDATE app_private.manteniment_parada_outbox SET estado='confirmado' WHERE seguimiento_id="+q(FOLLOWUP)+'::uuid');
 }
});
test('ficha sin autorización de edición piloto bloquea',()=>{
 pg("UPDATE public.hotel_edicion_piloto SET activo=false WHERE registro_hotel_id='77777777-7777-4777-8777-777777777777'");
 try{rejected('not in editor pilot');}
 finally{
  pg("UPDATE public.hotel_edicion_piloto SET activo=true WHERE registro_hotel_id='77777777-7777-4777-8777-777777777777'");
 }
});
test('hora de recogida anterior al fin de taller no se inventa',()=>{
 pg('UPDATE public.etapas_hotel SET fecha_fin_real=\'2026-11-19T11:30:00Z\' WHERE id='+q(STAGE)+'::uuid');
 try{rejected('before end');}
 finally{
  pg('UPDATE public.etapas_hotel SET fecha_fin_real=\'2026-11-18T15:00:00Z\' WHERE id='+q(STAGE)+'::uuid');
 }
});
test('hora futura no puede marcar recogida pasada',()=>{
 rejected('future time',{time:'2030-11-19T11:00:00+01:00'});
});
test('hora y día reales adoptados: sólo fecha_real cambia en etapa; triggers proyectan K',()=>{
 const c=createClaim();
 const before=stage();
 const result=adopt(c);
 assert.equal(result.estado,'ADOPTADA_EN_HOTEL');
 assert.equal(result.autoriza_sincronizar,false);
 assert.equal(result.escritura_operativa_realizada,true);
 assert.equal(result.editor_google_acreditado,false);
 assert.equal(result.dia_google,'2026-11-19');
 assert.equal(result.id_fila,7100);
 assert.equal(result.version_antes,before.version);
 const after=stage();
 assert.equal(after.version,before.version+1);
 assert.equal(after.estado,before.estado);
 assert.equal(after.cancelado,before.cancelado);
 assert.equal(after.fin,before.fin);
 assert.equal(after.inicio,before.inicio);
 assert.equal(after.modificado_por,ADMIN);
 assert.ok(after.recogida);
 assert.equal(k(),'2026-11-19');
 assert.equal(j(),'2026-11-18','J must not be changed by a K correction');
 assert.equal(pg("SELECT estado FROM app_private.manteniment_parada_outbox WHERE seguimiento_id="+q(FOLLOWUP)+'::uuid'),'pendiente');
 assert.equal(pg('SELECT estado FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.evidence)+'::uuid'),'APLICADA');
 assert.equal(pg('SELECT estado FROM app_private.sincro13_aprobaciones_k WHERE evidencia_id='+q(c.evidence)+'::uuid'),'CONSUMIDA');
 globalThis.__accepted=c;
});
test('replay exacto retorna mismo acuse sin modificar la versión ni hora',()=>{
 const c=globalThis.__accepted;
 const before=stage(),r=adopt(c);
 assert.equal(r.estado,'ADOPTADA_EN_HOTEL');
 assert.deepEqual(stage(),before);
});
test('replay con otra hora o nonce se rechaza aunque K de calendario sea igual',()=>{
 const c=globalThis.__accepted,before=stage();
 assert.throws(()=>adopt(c,{time:'2026-11-19T11:30:00+01:00'}),/S13_HOTEL_REINTENTO_CONTRADICTORIO/);
 assert.throws(()=>adopt(c,{request:randomUUID()}),/S13_HOTEL_REINTENTO_CONTRADICTORIO/);
 assert.deepEqual(stage(),before);
});
test('la auditoría conserva identidad de administrador, nunca autor Google',()=>{
 const c=globalThis.__accepted;
 assert.equal(pg('SELECT adoptado_por::text FROM app_private.sincro13_adopciones_hotel_k WHERE evidencia_id='+q(c.evidence)+'::uuid'),ADMIN);
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_adopciones_hotel_k WHERE evidencia_id='+q(c.evidence)+'::uuid'),'1');
 assert.equal(pg('SELECT editor_google_acreditado::text FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.evidence)+'::uuid'),'false');
});
