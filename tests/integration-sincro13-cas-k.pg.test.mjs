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
function claim({row=7100,work=WORK,base=null,next='2026-11-19',at=new Date(Date.now()-60000).toISOString(),source='GOOGLE_INDEPENDIENTE',approve=true}={}){
 const id=randomUUID(),request=randomUUID();
 const vals=[q(id)+'::uuid',q(request)+'::uuid',q(SHEET),row,
  q(work)+'::uuid',q('K'),base===null?'NULL':q(base)+'::date',
  q(next)+'::date',q(at)+'::timestamptz','clock_timestamp()',
  q(source),'NULL',q('d'.repeat(64))];
 pg('INSERT INTO app_private.sincro13_k_evidencias '+
  '(evidencia_id,solicitud_id,spreadsheet_id,id_fila,trabajo_sync_id,columna,valor_base,valor_nuevo,evento_en,verificado_en,verificador,actor_google_verificado,evidencia_sha256) '+
  'VALUES ('+vals.join(',')+')');
 const c={id,request,row,work,base,next};
 if(approve) approveClaim(c);
 return c;
}
const ADMIN='88888888-8888-4888-8888-888888888888';
const SESSION='aaaaaaaa-0000-4000-8000-000000000001';
function approveClaim(c,{
  admin='PRINCIPAL',device='AUTORIZADO',userState='ACTIVO',sessionState='ACTIVA',
  actor=ADMIN,request=c.request, contrastOverrides={}, declaracion='ADOPTO_CORRECCION_K_VERIFICADA'
}={}){
 const contrast={id_fila:c.row,trabajo_sync_id:c.work,columna:'K',
   valor_base:c.base,valor_nuevo:c.next,evidencia_sha256:'d'.repeat(64),...contrastOverrides};
 const statements=[
  'BEGIN',
  'SET LOCAL request.jwt.claim.sub = '+q(actor),
  'SET LOCAL request.jwt.claims = '+q(JSON.stringify({session_id:SESSION,role:'authenticated'})),
  'SET LOCAL s13.lab.session = '+q(sessionState),
  'SET LOCAL "s13.lab.user" = '+q(userState),
  'SET LOCAL s13.lab.device = '+q(device),
  'SET LOCAL s13.lab.admin = '+q(admin),
  'SET LOCAL ROLE authenticated',
  'SELECT public.sincro13_aprobar_correccion_k('+
    q(c.id)+'::uuid,'+q(request)+'::uuid,'+
    q(JSON.stringify(contrast))+'::jsonb,'+q(declaracion)+')::text',
  'COMMIT'
 ];
 const raw=pg(statements.join(';\n')+';');
 const json=raw.split('\n').find(x=>x.trim().startsWith('{') && x.includes('"sincro13-adopcion-k-v1"'));
 if(!json) throw Error('missing adoption result: '+raw.slice(-900));
 return JSON.parse(json);
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
 const c=claim({approve:false});
 try {
   reject(()=>apply(c,'mg_'+'f'.repeat(64)),'S13_CAS_TOKEN_INVALIDO');
   assert.equal(k(),'NULL');
 } finally {
   // Limpieza exclusivamente del fixture de laboratorio: una evidencia
   // rechazada queda PENDIENTE e impide otra solicitud para la misma T.
   pg('DELETE FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.id)+'::uuid');
 }
});
test('una evidencia técnica sin aprobación expresa JAMÁS activa K',()=>{
 const c=claim({approve:false});
 const res=apply(c);
 assert.equal(res.estado,'RETENIDA');
 assert.equal(res.motivo,'SIN_ADOPCION_EXPLICITA_VIGENTE');
 assert.equal(k(),'NULL');
});
test('usuario no administrador principal no puede adoptar edición',()=>{
 const c=claim({approve:false});
 try {
  reject(()=>approveClaim(c,{admin:'CONSULTA'}),'S13_APROBACION_NO_AUTORIZADA');
  assert.equal(k(),'NULL');
 } finally {
  pg('DELETE FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.id)+'::uuid');
 }
});
test('dispositivo no autorizado no puede aprobar',()=>{
 const c=claim({approve:false});
 try {
  reject(()=>approveClaim(c,{device:'BLOQUEADO'}),'S13_APROBACION_NO_AUTORIZADA');
 } finally {
  pg('DELETE FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.id)+'::uuid');
 }
});
test('sesión caducada no puede aprobar',()=>{
 const c=claim({approve:false});
 try {
  reject(()=>approveClaim(c,{sessionState:'CADUCADA'}),'S13_APROBACION_NO_AUTORIZADA');
 } finally {
  pg('DELETE FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.id)+'::uuid');
 }
});
test('usuario inactivo no puede aprobar',()=>{
 const c=claim({approve:false});
 try {
  reject(()=>approveClaim(c,{userState:'BAJA'}),'S13_APROBACION_NO_AUTORIZADA');
 } finally {
  pg('DELETE FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.id)+'::uuid');
 }
});
test('aprobación sin declaración expresa de adopción no se admite',()=>{
 const c=claim({approve:false});
 try {
  reject(()=>approveClaim(c,{declaracion:'ACEPTO'}),'S13_CONTRASTE_INCOMPLETO');
 } finally {
  pg('DELETE FROM app_private.sincro13_k_evidencias WHERE evidencia_id='+q(c.id)+'::uuid');
 }
});
test('aprobación con fecha distinta a Google queda prohibida',()=>{
 const c=claim({approve:false});
 try {
  reject(()=>approveClaim(c,{contrastOverrides:{valor_nuevo:'2026-11-25'}}),'S13_APROBACION_DATOS_DISTINTOS');
 } finally {
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
 assert.equal(result.escritura_operativa_realizada,false);
 assert.equal(pg('SELECT aprobado_por::text FROM app_private.sincro13_aprobaciones_k WHERE evidencia_id='+q(c.id)+'::uuid'),ADMIN);
 assert.equal(pg('SELECT estado FROM app_private.sincro13_aprobaciones_k WHERE evidencia_id='+q(c.id)+'::uuid'),'CONSUMIDA');
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
test('reintento de aprobación idéntica no crea otra aceptación',()=>{
 const c=claim({base:'2026-11-19',next:'2026-11-19'});
 const res=approveClaim(c);
 assert.equal(res.estado,'APROBADA');
 assert.equal(res.adopcion_expresa,true);
 assert.equal(res.edicion_original_atribuida,false);
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_aprobaciones_k WHERE evidencia_id='+q(c.id)+'::uuid'),'1');
 assert.equal(apply(c).estado,'APLICADA');
 assert.equal(k(),'2026-11-19');
});
test('segunda aprobación con distinto request_id es contradictoria',()=>{
 const c=claim({base:'2026-11-19',next:'2026-11-19'});
 reject(()=>approveClaim(c,{request:randomUUID()}),'S13_APROBACION_CONTRADICTORIA');
 assert.equal(pg('SELECT count(*) FROM app_private.sincro13_aprobaciones_k WHERE evidencia_id='+q(c.id)+'::uuid'),'1');
 assert.equal(apply(c).estado,'APLICADA');
});
test('aprobación caducada bloquea CAS aunque el origen y destino coincidan',()=>{
 const c=claim({base:'2026-11-19',next:'2026-11-19'});
 pg('UPDATE app_private.sincro13_aprobaciones_k SET caduca_en=clock_timestamp()-interval \'1 second\' WHERE evidencia_id='+q(c.id)+'::uuid');
 const r=apply(c);
 assert.equal(r.estado,'RETENIDA');
 assert.equal(r.motivo,'SIN_ADOPCION_EXPLICITA_VIGENTE');
 assert.equal(pg('SELECT estado FROM app_private.sincro13_aprobaciones_k WHERE evidencia_id='+q(c.id)+'::uuid'),'RETENIDA');
 assert.equal(k(),'2026-11-19');
});
test('service_role sin sesión de persona no puede aprobar K',()=>{
 const id=randomUUID(),req=randomUUID();
 reject(()=>pg('SET ROLE service_role; SELECT public.sincro13_aprobar_correccion_k('+
  q(id)+'::uuid,'+q(req)+'::uuid,\'{}\'::jsonb,\'ADOPTO_CORRECCION_K_VERIFICADA\')'),
  'permission denied');
});
test('anon no puede aprobar ni presentando un UUID de prueba',()=>{
 const id=randomUUID(),req=randomUUID();
 reject(()=>pg('SET ROLE anon; SELECT public.sincro13_aprobar_correccion_k('+
  q(id)+'::uuid,'+q(req)+'::uuid,\'{}\'::jsonb,\'ADOPTO_CORRECCION_K_VERIFICADA\')'),
  'permission denied');
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
test('evidencia del corte histórico no se puede aprobar ni aplicar',()=>{
 const c=claim({base:'2026-11-19',next:'2026-11-24',at:'2026-11-12T12:00:00.000Z',approve:false});
 reject(()=>approveClaim(c),'S13_EVIDENCIA_NO_VIGENTE');
 const res=apply(c);
 assert.equal(res.estado,'RETENIDA');
 assert.equal(res.motivo,'SIN_ADOPCION_EXPLICITA_VIGENTE');
 assert.equal(k(),'2026-11-19');
});
test('recogida anterior al fin de taller no se inventa',()=>{
 const c=claim({base:'2026-11-19',next:'2026-11-17'});
 const res=apply(c);
 assert.equal(res.estado,'RETENIDA');
 assert.equal(res.motivo,'RECOGIDA_ANTES_DE_FIN_TRABAJO');
 assert.equal(k(),'2026-11-19');
});
test('Hotel no ha adoptado la nueva K: no escribir caché técnico ni Hotel',()=>{
 pg("UPDATE public.etapas_hotel SET fecha_real='2026-11-21T15:00:00Z' WHERE id='66666666-6666-4666-8666-666666666666'::uuid");
 const c=claim({base:'2026-11-19',next:'2026-11-22'});
 try{
  const r=apply(c);
  assert.equal(r.estado,'RETENIDA');
  assert.equal(r.motivo,'HOTEL_K_NO_ADOPTADA');
  assert.equal(k(),'2026-11-19');
 }finally{
  pg("UPDATE public.etapas_hotel SET fecha_real='2026-11-19T15:00:00Z' WHERE id='66666666-6666-4666-8666-666666666666'::uuid");
 }
});
test('etapa cancelada no acredita ninguna fecha de recogida',()=>{
 pg("UPDATE public.etapas_hotel SET cancelado=true WHERE id='66666666-6666-4666-8666-666666666666'::uuid");
 const c=claim({base:'2026-11-19',next:'2026-11-19'});
 try{
  const r=apply(c);
  assert.equal(r.estado,'RETENIDA');
  assert.equal(r.motivo,'HOTEL_TRABAJO_O_ETAPA_NO_VIGENTE');
  assert.equal(k(),'2026-11-19');
 }finally{
  pg("UPDATE public.etapas_hotel SET cancelado=false WHERE id='66666666-6666-4666-8666-666666666666'::uuid");
 }
});
test('Hotel sin flujo de tres hitos queda retenido por mapeo',()=>{
 pg("UPDATE public.registros_hotel SET hitos=false WHERE id='77777777-7777-4777-8777-777777777777'::uuid");
 const c=claim({base:'2026-11-19',next:'2026-11-19'});
 try{
  const r=apply(c);
  assert.equal(r.estado,'RETENIDA');
  assert.equal(r.motivo,'MODALIDAD_HOTEL_SIN_MAPEO_K');
  assert.equal(k(),'2026-11-19');
 }finally{
  pg("UPDATE public.registros_hotel SET hitos=true WHERE id='77777777-7777-4777-8777-777777777777'::uuid");
 }
});
test('CAS positivo admite solo espejo técnico; no reescribe Hotel',()=>{
 const c=globalThis.__appliedClaim;
 const r=apply(c);
 assert.equal(r.estado,'APLICADA');
 assert.equal(r.escritura_operativa_realizada,false);
 assert.equal(r.escritura_catalogo_tecnico_realizada,true);
 assert.equal(r.hotel_k_ya_adoptada,true);
 assert.equal(pg("SELECT fecha_real::date::text FROM public.etapas_hotel WHERE id='66666666-6666-4666-8666-666666666666'::uuid"),'2026-11-19');
});

test('outbox de activo pendiente para el mismo vehículo retiene K',()=>{
 pg("INSERT INTO app_private.manteniment_activo_outbox(vehiculo_id,estado) VALUES ('99999999-9999-4999-8999-999999999999','pendiente')");
 const c=claim({base:'2026-11-19',next:'2026-11-19'});
 try{
   const r=apply(c);
   assert.equal(r.estado,'RETENIDA');
   assert.equal(r.motivo,'OUTBOX_ACTIVO_PENDIENTE');
   assert.equal(k(),'2026-11-19');
 }finally{
   pg("UPDATE app_private.manteniment_activo_outbox SET estado='confirmado' WHERE vehiculo_id='99999999-9999-4999-8999-999999999999'");
 }
});
test('sin vehículo auxiliar inequívoco no se presupone que la cola sea segura',()=>{
 pg("UPDATE public.vehiculos SET dfm='OTRO-DFM' WHERE id='99999999-9999-4999-8999-999999999999'");
 const c=claim({base:'2026-11-19',next:'2026-11-19'});
 try{
   const r=apply(c);
   assert.equal(r.estado,'RETENIDA');
   assert.equal(r.motivo,'VEHICULO_AUXILIAR_AMBIGUO_O_AUSENTE');
   assert.equal(k(),'2026-11-19');
 }finally{
   pg("UPDATE public.vehiculos SET dfm='LABORATORIO-01' WHERE id='99999999-9999-4999-8999-999999999999'");
 }
});
test('trabajo Hotel cancelado no admite reescribir caché técnico',()=>{
 pg("UPDATE public.trabajos_etapa_hotel SET cancelado=true WHERE id='22222222-2222-4222-8222-222222222222'");
 const c=claim({base:'2026-11-19',next:'2026-11-19'});
 try{
   const r=apply(c);
   assert.equal(r.estado,'RETENIDA');
   assert.equal(r.motivo,'HOTEL_TRABAJO_O_ETAPA_NO_VIGENTE');
   assert.equal(k(),'2026-11-19');
 }finally{
   pg("UPDATE public.trabajos_etapa_hotel SET cancelado=false WHERE id='22222222-2222-4222-8222-222222222222'");
 }
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
