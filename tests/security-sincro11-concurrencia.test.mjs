/**
 * METROGES SINCRO11 · 2 sesiones REALES en PostgreSQL 17 AISLADO.
 * Precondición: setup SQL ejecutado SOLO sobre sincro11_lab.
 * No existe conector a Supabase o Google; no se importan datos reales.
 * Esquema s11_ci se limpia por el workflow incluso si falla un test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,spawnSync} from 'node:child_process';

assert.equal(process.env.PGDATABASE,'sincro11_lab','S11: prohibido ejecutar fuera de base ficticia');
assert.equal(process.env.PGUSER,'laboratorio','S11: usuario de prueba obligatorio');
const SLEEP_MS=70;
const DELAY=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
function psqlSync(sql,{shouldFail=false,match}={}){
 const x=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{
   encoding:'utf8',timeout:25000,env:process.env,
 });
 if(x.error)throw x.error;
 if(shouldFail){
   assert.notEqual(x.status,0,'Se esperaba rechazo seguro y la sentencia se aceptó: '+sql.slice(0,100));
   assert.match(x.stderr,match);
 }else{
   assert.equal(x.status,0,`Postgres debe aceptar la sentencia\n${x.stderr}\n${sql.slice(0,300)}`);
 }
 return String(x.stdout??'').trim();
}
function psqlAsync(sql){
 const child=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{
   stdio:['ignore','pipe','pipe'],env:process.env
 });
 let stdout='',stderr='';
 child.stdout.on('data',x=>stdout+=x.toString());
 child.stderr.on('data',x=>stderr+=x.toString());
 const result=new Promise((resolve,reject)=>{
   child.on('error',reject);
   child.on('close',(code)=>resolve({code,stdout:stdout.trim(),stderr}));
 });
 return {child,result};
}
async function waitForLockedAdvisory(n,session){
 for(let i=0;i<65;i++){
   if(session.child.exitCode!==null)throw Error(`Sesión terminó antes de marcar bloqueo: ${session.child.exitCode}`);
   const canGet=psqlSync(`SELECT pg_try_advisory_lock(${n});`);
   if(canGet==='f')return;
   assert.equal(canGet,'t','PG debe responder t/f');
   await DELAY(SLEEP_MS);
 }
 throw Error(`No se pudo acreditar transacción solapada con lock ${n}`);
}
const id1='90001',id2='90002';
const hash='a'.repeat(64),hash2='b'.repeat(64),hash3='c'.repeat(64),hash4='d'.repeat(64);
function apply({id,field,event,request,digest,sourceRev,mapRev,destRev}){
 return `SELECT s11_ci.aplicar_correccion_ficticia(${id},'${field}',
 '${event}'::uuid,'${request}'::uuid,'${digest}',${sourceRev},${mapRev},${destRev});`;
}
const A=apply({id:id1,field:'J',event:'a1111111-1111-4111-8111-111111111111',request:'c1111111-1111-4111-8111-111111111111',digest:hash,sourceRev:4,mapRev:1,destRev:7});
const B=apply({id:id1,field:'J',event:'a2222222-2222-4222-8222-222222222222',request:'c2222222-2222-4222-8222-222222222222',digest:hash2,sourceRev:4,mapRev:1,destRev:7});
const C=apply({id:id2,field:'J',event:'a3333333-3333-4333-8333-333333333333',request:'c3333333-3333-4333-8333-333333333333',digest:hash3,sourceRev:8,mapRev:2,destRev:3});
const D=apply({id:id2,field:'K',event:'a4444444-4444-4444-8444-444444444444',request:'c4444444-4444-4444-8444-444444444444',digest:hash4,sourceRev:8,mapRev:3,destRev:5});

test('SINCRO11: el receptor no tiene conexión a producción ni autoriza crear T/PA',()=>{
 assert.equal(psqlSync('SELECT current_database()'),'sincro11_lab');
 assert.equal(psqlSync("SELECT count(*) FROM information_schema.tables WHERE table_schema='s11_ci'"),'7');
 assert.equal(psqlSync("SELECT count(*) FROM s11_ci.identidades"),'5');
});

test('CAS REAL: dos sesiones modifican misma T/J y solo una vence; la otra no sobrescribe',async()=>{
 const first=psqlAsync(`BEGIN; SET LOCAL statement_timeout='15s'; ${A}
  SELECT pg_advisory_xact_lock(77111101); SELECT pg_sleep(3.5); COMMIT;`);
 await waitForLockedAdvisory(77111101,first);
 const second=psqlAsync(`SET statement_timeout='15s'; ${B}`);
 const [r1,r2]=await Promise.all([first.result,second.result]);
 assert.equal(r1.code,0,r1.stderr);
 assert.match(r1.stdout,/APLICADA_FICCION/);
 assert.notEqual(r2.code,0,'B debería rechazar la revisión obsoleta');
 assert.match(r2.stderr,/S11_CI_CAS_DESTINO/);
 assert.equal(psqlSync("SELECT valor::text||'|'||revision FROM s11_ci.destinos WHERE trabajo_sync_id='11111111-1111-4111-8111-111111111111' AND campo_destino='fecha_realizada'"),'2024-09-19|8');
 assert.equal(psqlSync("SELECT count(*) FROM s11_ci.auditoria WHERE id_fila=90001"),'1');
 assert.equal(psqlSync("SELECT count(*) FROM s11_ci.recibos"),'1');
 assert.equal(psqlSync("SELECT estado FROM s11_ci.eventos WHERE evento_id='a2222222-2222-4222-8222-222222222222'"),'PENDIENTE');
});

test('outbox antigua se retiene solo por T+campo+revisión; otras no se tocan',()=>{
 const summary=psqlSync("SELECT string_agg(columna||':'||revision_destino||':'||estado,',' ORDER BY columna,revision_destino) FROM s11_ci.outbox WHERE id_fila=90001");
 assert.equal(summary,'J:7:RETENIDA_OBSOLETA,J:10:PENDIENTE,K:1:PENDIENTE');
 const audit=psqlSync('SELECT retenidas FROM s11_ci.auditoria WHERE id_fila=90001');
 assert.equal(audit,'1');
});

test('CAS REAL: dos sesiones sobre T=90002, J y K independientes, ambos cambios se conservan',async()=>{
 const first=psqlAsync(`BEGIN; SET LOCAL statement_timeout='15s'; ${C}
  SELECT pg_advisory_xact_lock(77111102); SELECT pg_sleep(3.5); COMMIT;`);
 await waitForLockedAdvisory(77111102,first);
 const second=psqlAsync(`SET statement_timeout='15s'; ${D}`);
 const secondResult=await second.result;
 const aStillHolding = first.child.exitCode === null;
 const firstResult=await first.result;
 assert.equal(firstResult.code,0,firstResult.stderr);
 assert.equal(secondResult.code,0,secondResult.stderr);
 assert.ok(aStillHolding,'K tiene que completarse mientras J mantiene su transacción abierta');
 assert.equal(psqlSync("SELECT string_agg(campo_destino||'='||valor||'@'||revision,',' ORDER BY campo_destino) FROM s11_ci.destinos WHERE trabajo_sync_id='22222222-2222-4222-8222-222222222222'"),'fecha_realizada=2024-10-09@4,fecha_recogida=2024-10-11@6');
 assert.equal(psqlSync('SELECT count(*) FROM s11_ci.auditoria WHERE id_fila=90002'),'2');
});

test('mismo request y payload devuelve recibo idempotente sin segunda auditoría',()=>{
 const replay=psqlSync(A);
 assert.match(replay,/"reintento": true/);
 assert.equal(psqlSync('SELECT count(*) FROM s11_ci.auditoria'),'3');
 assert.equal(psqlSync('SELECT count(*) FROM s11_ci.recibos'),'3');
 psqlSync(A.replace("'"+hash+"'","'"+hash2+"'"),{shouldFail:true,match:/S11_CI_REINTENTO_PAYLOAD_DISTINTO/});
});

test('rechazar T ausente, TANCAMENT sin mapeo y exclusión del operador, sin emparejar por DFM/PA',()=>{
 const base=apply({id:'90003',field:'J',event:'a3333333-3333-4333-8333-333333333333',request:'d3333333-3333-4333-8333-333333333333',digest:hash,sourceRev:2,mapRev:1,destRev:3});
 psqlSync(base,{shouldFail:true,match:/S11_CI_CLASE_SIN_MAPEO/});
 psqlSync(base.replace('90003','90004').replace(',2,1,3',',3,1,3'),{shouldFail:true,match:/S11_CI_T_EXCLUIDA/});
 psqlSync(base.replace('90003','99999'),{shouldFail:true,match:/S11_CI_T_SIN_ACREDITAR/});
 psqlSync(base.replace('90003','90005').replace(',2,1,3',',8,2,3'),{shouldFail:true,match:/S11_CI_T_SIN_ACREDITAR/});
 assert.equal(psqlSync('SELECT count(*) FROM s11_ci.auditoria'),'3');
});

test('la prueba solo contiene valores sintéticos, sin tabla real ni firma humana',()=>{
 const status=psqlSync("SELECT count(*) FROM s11_ci.eventos WHERE origen<>'FICCION_NO_ACREDITA_HUMANO'");
 assert.equal(status,'0');
 assert.equal(psqlSync("SELECT count(*) FROM information_schema.tables WHERE table_schema='s11_ci'"),'7');
});