/**
 * SINCRO12 - ledger duradero en PostgreSQL 17 exclusivamente ficticio.
 * Dos procesos psql, dos sesiones; nunca Supabase, Google ni datos operativos.
 * El bloqueador de nombre de BD NO se puede omitir.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGDATABASE,'sincro11_lab','S12: base ficticia obligatoria');
assert.equal(process.env.PGUSER,'laboratorio','S12: rol laboratorio obligatorio');
const f=n=>String(n).padStart(12,'0');
const uuid=(pref,n)=>pref+'0000000-0000-4000-8000-'+f(n);
const LOT=n=>uuid('c',n),REQ=n=>uuid('f',n),NONCE=n=>uuid('9',n);
const SESSION_OK='a1111111-1111-4111-8111-111111111111';
const SESSION_AAL1='a2222222-2222-4222-8222-222222222222';
const SESSION_REVOKED='a3333333-3333-4333-8333-333333333333';
function sqlsync(sql,{reject,reason}={}){
 const x=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],
 {encoding:'utf8',timeout:30000,env:process.env});
 if(x.error)throw x.error;
 if(reject){
  assert.notEqual(x.status,0,'Debió rechazarse: '+sql.slice(0,100));
  if(reason)assert.match(String(x.stderr),reason);
 }else assert.equal(x.status,0,'psql falló: '+x.stderr+'\n'+sql.slice(0,180));
 return String(x.stdout??'').trim();
}
function sqlasync(sql){
 const p=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],
 {env:process.env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 p.stdout.on('data',b=>stdout+=b.toString());
 p.stderr.on('data',b=>stderr+=b.toString());
 return {process:p,result:new Promise((res,rej)=>{
  p.on('error',rej);p.on('close',code=>res({code,stdout:stdout.trim(),stderr}));
 })};
}
function huella(lote){return sqlsync("SELECT s12_lab.huella_lote_ficticia('"+LOTE(lote)+"'::uuid)");}
function call(lote,req,session,nonce,digest=huella(lote)){
 return "SELECT s12_lab.confirmar_lote_ficticio('"+LOTE(lote)+"'::uuid,'"+
 REQ(req)+"'::uuid,'"+session+"'::uuid,'"+NONCE(nonce)+"'::uuid,'"+digest+"');";
}
function estados(lote){
 return sqlsync("SELECT string_agg(id_fila||':'||columna||':'||resultado||':'||autoriza_sincronizar,',' ORDER BY id_fila) FROM s12_lab.candidatos_del_lote_ficticio('"+LOTE(lote)+"'::uuid)");
}
async function awaitLock(lock,session){
 for(let i=0;i<100;i++){
  if(session.process.exitCode!==null)throw Error('Sesión terminó prematuramente');
  const status=sqlsync('SELECT pg_try_advisory_lock('+lock+');');
  if(status==='f')return;
  assert.equal(status,'t');await new Promise(r=>setTimeout(r,50));
 }
 throw Error('No se observó solapamiento real de sesiones');
}
test('solo existe laboratorio y no son tablas operativas',()=>{
 assert.equal(sqlsync('SELECT current_database()'),'sincro11_lab');
 assert.equal(sqlsync("SELECT count(*) FROM pg_namespace WHERE nspname='s12_lab'"),'1');
 assert.equal(sqlsync('SELECT count(*) FROM s12_lab.recibos_inmutables'),'0');
});
test('sesiones ficticias sin AAL2, revocadas o inexistentes se retienen',()=>{
 sqlsync(call(1,1,SESSION_AAL1,1),{reject:true,reason:/S12_SESION_FICTICIA_NO_ADMITIDA/});
 sqlsync(call(1,1,SESSION_REVOKED,1),{reject:true,reason:/S12_SESION_FICTICIA_NO_ADMITIDA/});
 sqlsync(call(1,1,REQ(99),1),{reject:true,reason:/S12_SESION_FICTICIA_NO_ADMITIDA/});
 assert.equal(sqlsync('SELECT count(*) FROM s12_lab.recibos_inmutables'),'0');
});
test('lote sin hash exacto no produce recibo ni aprobación',()=>{
 sqlsync(call(1,1,SESSION_OK,1,'f'.repeat(64)),{
  reject:true,reason:/S12_HUELLA_LOTE_DISTINTA/
 });
 assert.equal(sqlsync("SELECT estado FROM s12_lab.lotes WHERE lote_id='"+LOTE(1)+"'"),'BORRADOR');
});
test('dos conexiones, mismo request y hash: un solo recibo duradero e idempotencia',async()=>{
 const lock=87881201;
 const q=call(1,1,SESSION_OK,1);
 const first=sqlasync('BEGIN; '+q+' SELECT pg_advisory_xact_lock('+lock+'); SELECT pg_sleep(3); COMMIT;');
 await awaitLock(lock,first);
 const second=sqlasync(q);
 const [a,b]=await Promise.all([first.result,second.result]);
 assert.equal(a.code,0,a.stderr);assert.equal(b.code,0,b.stderr);
 assert.match(a.stdout,/CONFIRMADO_FICTICIO/);
 assert.match(b.stdout,/"reintento": true/);
 assert.equal(sqlsync('SELECT count(*) FROM s12_lab.recibos_inmutables'),'1');
 assert.equal(sqlsync("SELECT estado FROM s12_lab.lotes WHERE lote_id='"+LOTE(1)+"'"),'CONFIRMADO_FICTICIO');
});
test('request repetido con payload distinto rechaza replay',()=>{
 sqlsync(call(1,1,SESSION_OK,99),{reject:true,reason:/S12_REPLAY_PAYLOAD_DISTINTO/});
 sqlsync(call(1,1,SESSION_OK,1,'b'.repeat(64)),{reject:true,reason:/S12_REPLAY_PAYLOAD_DISTINTO/});
});
test('segundo request para lote ya confirmado no duplica confirmación',()=>{
 sqlsync(call(1,91,SESSION_OK,91),{reject:true,reason:/S12_LOTE_YA_CONFIRMADO/});
 assert.equal(sqlsync("SELECT count(*) FROM s12_lab.recibos_inmutables WHERE lote_id='"+LOTE(1)+"'"),'1');
});
test('recibo confirmado no puede actualizarse ni borrarse',()=>{
 sqlsync("UPDATE s12_lab.recibos_inmutables SET huella=repeat('f',64) WHERE lote_id='"+LOTE(1)+"'",{
  reject:true,reason:/S12_RECIBO_INMUTABLE/
 });
 sqlsync("DELETE FROM s12_lab.recibos_inmutables WHERE lote_id='"+LOTE(1)+"'",{
  reject:true,reason:/S12_RECIBO_INMUTABLE/
 });
});
test('eventos del lote sellado no pueden rejuvenecerse ni agregarse',()=>{
 sqlsync("UPDATE s12_lab.eventos SET hash_nuevo=repeat('9',64) WHERE lote_id='"+LOTE(1)+"'",{
  reject:true,reason:/S12_LOTE_SELLADO_NO_MODIFICAR_EVENTOS/
 });
 sqlsync("DELETE FROM s12_lab.eventos WHERE lote_id='"+LOTE(1)+"'",{
  reject:true,reason:/S12_LOTE_SELLADO_NO_MODIFICAR_EVENTOS/
 });
 assert.equal(sqlsync("SELECT count(*) FROM s12_lab.eventos WHERE lote_id='"+LOTE(1)+"'"),'1');
});
test('sin lectura posterior a aprobación no existe candidato',()=>{
 assert.match(estados(1),/90001:K:HOJA_NO_RELEIDA_O_CAMBIADA:false/);
});
test('coteja lectura de la misma T posterior al lote sin modificar destino',()=>{
 sqlsync("INSERT INTO s12_lab.lecturas_hoja VALUES (90001,'K',7,repeat('b',64),clock_timestamp())");
 assert.match(estados(1),/90001:K:CANDIDATO_LAB_NO_AUTORIZADO:false/);
 assert.equal(sqlsync("SELECT hash_vigente FROM s12_lab.destinos WHERE objeto_id='e0000000-0000-4000-8000-000000000001'"),'a'.repeat(64));
});
test('si cambia la K después de aprobar, retener sin tocar otras T',()=>{
 sqlsync("UPDATE s12_lab.lecturas_hoja SET hash_vigente=repeat('f',64),leido_en=clock_timestamp() WHERE id_fila=90001 AND columna='K'");
 assert.match(estados(1),/HOJA_NO_RELEIDA_O_CAMBIADA:false/);
 sqlsync("UPDATE s12_lab.lecturas_hoja SET hash_vigente=repeat('b',64),leido_en=clock_timestamp() WHERE id_fila=90001 AND columna='K'");
 assert.match(estados(1),/CANDIDATO_LAB_NO_AUTORIZADO:false/);
});
test('si el destino ya coincide, no propondrá escribir',()=>{
 sqlsync("UPDATE s12_lab.destinos SET hash_vigente=repeat('b',64) WHERE objeto_id='e0000000-0000-4000-8000-000000000001'");
 assert.match(estados(1),/DESTINO_YA_COINCIDE:false/);
});
test('nonce reutilizado por segundo lote se rechaza en la misma transacción',()=>{
 sqlsync(call(2,2,SESSION_OK,1),{reject:true,reason:/duplicate key value violates unique constraint/});
 assert.equal(sqlsync("SELECT estado FROM s12_lab.lotes WHERE lote_id='"+LOTE(2)+"'"),'BORRADOR');
});
test('adopción expresa crea acto de conformidad ficticio, NO autoría anterior',()=>{
 const x=sqlsync(call(2,2,SESSION_OK,2));
 assert.match(x,/CONFIRMADO_FICTICIO/);
 assert.match(x,/"autor_edicion_hoja_acreditado": false/);
 assert.match(x,/"permiso_produccion": false/);
 assert.equal(sqlsync('SELECT count(*) FROM s12_lab.recibos_inmutables'),'2');
 assert.match(estados(2),/HOJA_NO_RELEIDA_O_CAMBIADA:false/);
});
test('T sin vínculo positivo, T excluida y evento anterior al corte se rechazan',()=>{
 for(const [lot,reason] of [[3,/S12_EVENTO_O_VINCULO_NO_ACREDITADO_LAB/],
 [4,/S12_EVENTO_O_VINCULO_NO_ACREDITADO_LAB/],
 [5,/S12_EVENTO_O_VINCULO_NO_ACREDITADO_LAB/]]){
  sqlsync(call(lot,lot,SESSION_OK,lot),{reject:true,reason});
  assert.equal(sqlsync("SELECT estado FROM s12_lab.lotes WHERE lote_id='"+LOTE(lot)+"'"),'BORRADOR');
 }
});
test('J de taller sin mapeo acreditado se bloquea, no es fecha_realizada',()=>{
 sqlsync(call(6,6,SESSION_OK,6),{reject:true,reason:/S12_EVENTO_O_VINCULO_NO_ACREDITADO_LAB/});
});
test('un lote de dos T: una relectura cambiada retiene solo su campo',()=>{
 const x=sqlsync(call(7,7,SESSION_OK,7));
 assert.match(x,/"cantidad": 2/);
 sqlsync("INSERT INTO s12_lab.lecturas_hoja VALUES (90007,'K',3,repeat('2',64),clock_timestamp()),(90008,'K',3,repeat('f',64),clock_timestamp())");
 const result=estados(7);
 assert.match(result,/90007:K:CANDIDATO_LAB_NO_AUTORIZADO:false/);
 assert.match(result,/90008:K:HOJA_NO_RELEIDA_O_CAMBIADA:false/);
});
test('independencia de lotes: confirmar otro T con un nonce nuevo',()=>{
 const x=sqlsync(call(8,8,SESSION_OK,8));
 assert.match(x,/CONFIRMADO_FICTICIO/);
 assert.equal(sqlsync('SELECT count(*) FROM s12_lab.recibos_inmutables'),'4');
});
test('el ledger es duradero y auditable entre conexiones, pero no acredita humano',()=>{
 assert.equal(sqlsync("SELECT count(*) FROM s12_lab.lotes WHERE estado='CONFIRMADO_FICTICIO'"),'4');
 assert.equal(sqlsync("SELECT count(*) FROM s12_lab.recibos_inmutables"),'4');
 assert.equal(sqlsync("SELECT count(*) FROM s12_lab.lotes WHERE estado='BORRADOR'"),'4');
 assert.equal(sqlsync("SELECT count(*) FROM s12_lab.sesiones_ficticias WHERE segundo_factor_simulado"),'2');
 assert.equal(sqlsync("SELECT count(*) FROM information_schema.tables WHERE table_schema='s12_lab'"),'8');
});
