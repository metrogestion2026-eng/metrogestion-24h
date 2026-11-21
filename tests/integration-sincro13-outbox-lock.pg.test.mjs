import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const TOKEN = 'mg_'+'0'.repeat(64);
const FOLLOWUP='33333333-3333-4333-8333-333333333333';
const WORK='11111111-1111-4111-8111-111111111111';
const VEHICLE='99999999-9999-4999-8999-999999999999';
const SHEET='sincro13-hoja-sintetica-20261118';
const ACTOR='88888888-8888-4888-8888-888888888888';
const SESSION='aaaaaaaa-0000-4000-8000-000000000001';
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const pg=query=>{
  try {
    return execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',query],{
      encoding:'utf8',timeout:18000
    }).trim();
  }catch(e){
    throw Error(String(e.stderr||e.message));
  }
};
const attempts={
  active: "BEGIN; SET LOCAL lock_timeout='250ms';"+
    "UPDATE app_private.manteniment_activo_outbox SET estado='pendiente'"+
    " WHERE vehiculo_id="+quote(VEHICLE)+"::uuid; ROLLBACK;",
  stop: "BEGIN; SET LOCAL lock_timeout='250ms';"+
    "UPDATE app_private.manteniment_parada_outbox SET estado='pendiente'"+
    " WHERE seguimiento_id="+quote(FOLLOWUP)+"::uuid; ROLLBACK;"
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('ambas colas tienen trigger que toma el lock global, mismo que usa CAS',()=>{
  assert.equal(pg('SELECT current_database()'),'sincro13_lab');
  const names=pg("SELECT string_agg(tgname,',' ORDER BY tgname) FROM pg_trigger "+
    "WHERE NOT tgisinternal AND tgrelid IN ("+
    "'app_private.manteniment_activo_outbox'::regclass,"+
    "'app_private.manteniment_parada_outbox'::regclass)");
  assert.match(names,/sincro13_serializar_outbox_activo/);
  assert.match(names,/sincro13_lab_serializar_parada/);
  const definition=pg("SELECT pg_get_functiondef(p.oid) FROM pg_proc p "+
    "JOIN pg_namespace n ON n.oid=p.pronamespace "+
    "WHERE n.nspname='app_private' AND p.proname='sincro13_cas_k'");
  const job=definition.indexOf('WHERE sync_id=v_ev.trabajo_sync_id FOR UPDATE');
  const lock=definition.indexOf('pg_try_advisory_xact_lock(');
  const outbox=definition.indexOf('FROM app_private.manteniment_parada_outbox o');
  assert.ok(job>=0 && lock>job && outbox>lock,
    'The CAS must lock the target first, then global, before checking outbox');
  assert.equal(pg("SELECT estado FROM app_private.manteniment_parada_outbox WHERE seguimiento_id="+
     quote(FOLLOWUP)+"::uuid"),'confirmado');
  assert.equal(pg("SELECT estado FROM app_private.manteniment_activo_outbox WHERE vehiculo_id="+
     quote(VEHICLE)+"::uuid"),'confirmado');
});

const claim={id:randomUUID(),request:randomUUID()};
test('preparar evidencia/APROBACION SOLO en LAB de T real sintética, sin Google ni Hotel',()=>{
  const n=pg("SELECT count(*) FROM app_private.sincro13_k_evidencias WHERE estado='PENDIENTE'");
  assert.equal(n,'0','earlier CAS suite must have no hanging evidence');
  assert.equal(pg("SELECT fecha_recogida::text FROM app_private.manteniment_t_trabajos WHERE sync_id="+
    quote(WORK)+"::uuid"),'2026-11-19');
  const stamp=new Date(Date.now()-30000).toISOString();
  const sha='a'.repeat(64);
  pg("INSERT INTO app_private.sincro13_k_evidencias "+
    "(evidencia_id,solicitud_id,spreadsheet_id,id_fila,trabajo_sync_id,columna,"+
    "valor_base,valor_nuevo,evento_en,verificado_en,verificador,"+
    "actor_google_verificado,editor_google_acreditado,evidencia_sha256) VALUES ("+
    quote(claim.id)+"::uuid,"+quote(claim.request)+"::uuid,"+quote(SHEET)+",7100,"+
    quote(WORK)+"::uuid,'K','2026-11-19'::date,'2026-11-19'::date,"+
    quote(stamp)+"::timestamptz,clock_timestamp(),'GOOGLE_INDEPENDIENTE',"+
    "NULL,false,"+quote(sha)+")");
  pg("INSERT INTO app_private.sincro13_aprobaciones_k "+
    "(evidencia_id,solicitud_aprobacion_id,spreadsheet_id,id_fila,trabajo_sync_id,"+
    "evidencia_sha256,valor_base,valor_nuevo,aprobado_por,sesion_id,aprobado_en,caduca_en)"+
    " VALUES ("+quote(claim.id)+"::uuid,"+quote(claim.request)+"::uuid,"+
    quote(SHEET)+",7100,"+quote(WORK)+"::uuid,"+quote(sha)+
    ",'2026-11-19'::date,'2026-11-19'::date,"+quote(ACTOR)+"::uuid,"+
    quote(SESSION)+"::uuid,clock_timestamp(),clock_timestamp()+interval '5 minutes')");
  assert.equal(pg("SELECT estado FROM app_private.sincro13_k_evidencias "+
    "WHERE evidencia_id="+quote(claim.id)+"::uuid"),'PENDIENTE');
});

test('etapa de Hotel bloqueada: CAS aborta sin esperar ni modificar K',async()=>{
  const holderSql="BEGIN; SELECT 1 FROM public.etapas_hotel "+
    "WHERE id='66666666-6666-4666-8666-666666666666'::uuid FOR UPDATE; "+
    "SELECT pg_sleep(4) /* S13_STAGE_HOLDER */; COMMIT;";
  const holder=spawn('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',holderSql],{
    env:process.env,stdio:['ignore','pipe','pipe']
  });
  let err='',exitCode;
  holder.stderr.on('data',d=>err+=d.toString());
  const finished=new Promise((resolve,reject)=>{
    holder.on('error',reject);
    holder.on('close',code=>{exitCode=code;resolve();});
  });
  try{
    let acquired=false;
    const until=Date.now()+2500;
    while(Date.now()<until){
      const state=pg("SELECT count(*) FROM pg_stat_activity "+
        "WHERE pid<>pg_backend_pid() AND query LIKE '%S13_STAGE_HOLDER%' "+
        "AND wait_event='PgSleep'");
      if(Number(state)>0){acquired=true;break;}
      await sleep(40);
    }
    assert.equal(acquired,true,'holder must have locked Hotel stage');
    const query="BEGIN; SET LOCAL lock_timeout='500ms'; SELECT app_private.sincro13_cas_k("+
      quote(TOKEN)+","+quote(claim.id)+"::uuid,"+
      quote(claim.request)+"::uuid)::text; COMMIT;";
    assert.throws(()=>pg(query),/could not obtain lock on row/,
      'CAS must not wait behind Hotel stage while holding global and work locks');
    assert.equal(pg("SELECT estado FROM app_private.sincro13_k_evidencias WHERE evidencia_id="+
      quote(claim.id)+"::uuid"),'PENDIENTE');
    await finished;
    assert.equal(exitCode,0,'stage holder should commit: '+err);
  }finally{
    if(exitCode===undefined)holder.kill();
    await finished.catch(()=>{});
  }
});

test('dos conexiones PG: PARADA, ACTIVOS y CAS se serializan con bloqueo real',async()=>{
  const sql="BEGIN; SELECT app_private.bloquear_sync_continuidad_alpha75();"+
    " SELECT pg_sleep(4); COMMIT;";
  const holder=spawn('psql',['-X','-v','ON_ERROR_STOP=1','-At','-c',sql],{
    env:process.env,stdio:['ignore','pipe','pipe']
  });
  let stderr='',stdout='',exitCode;
  holder.stderr.on('data',d=>{stderr+=d.toString();});
  holder.stdout.on('data',d=>{stdout+=d.toString();});
  const ended=new Promise((resolve,reject)=>{
    holder.on('error',reject);
    holder.on('close',code=>{exitCode=code;resolve();});
  });
  try{
    let locked=false;
    const until=Date.now()+2000;
    while(Date.now()<until){
      const n=Number(pg("SELECT count(*) FROM pg_locks "+
        "WHERE locktype='advisory' AND granted AND pid<>pg_backend_pid()"));
      if(n>0){locked=true;break;}
      await sleep(45);
    }
    assert.equal(locked,true,'holder must acquire the actual PG advisory lock');
    for(const [name,query] of Object.entries(attempts)){
      assert.throws(()=>pg(query),/canceling statement due to lock timeout/,
        name+' must wait behind the shared lock');
    }
    const casQuery="BEGIN; SET LOCAL lock_timeout='250ms'; SELECT app_private.sincro13_cas_k("+
      quote(TOKEN)+","+quote(claim.id)+"::uuid,"+quote(claim.request)+
      "::uuid)::text; COMMIT;";
    assert.throws(()=>pg(casQuery),/S13_CAS_COLA_CONCURRENTE/,
      'CAS must fail fast (no wait/deadlock) while global lock is held');
    assert.equal(pg("SELECT estado FROM app_private.sincro13_k_evidencias WHERE evidencia_id="+
      quote(claim.id)+"::uuid"),'PENDIENTE');
    await ended;
    assert.equal(exitCode,0,'holder transaction should commit cleanly: '+stderr);
    // Reattempt the two outbox operations in ROLLBACK transactions:
    // they now pass the trigger without leaving any pending outbound item.
    for(const [name,query]of Object.entries(attempts)){
      const rollback=query.replace("SET LOCAL lock_timeout='250ms';","");
      assert.doesNotThrow(()=>pg(rollback),name+' should release after COMMIT');
    }
    const result=JSON.parse(pg("SELECT app_private.sincro13_cas_k("+
      quote(TOKEN)+","+quote(claim.id)+"::uuid,"+
      quote(claim.request)+"::uuid)::text"));
    assert.equal(result.estado,'APLICADA');
    assert.equal(result.escritura_operativa_realizada,false);
    assert.equal(pg("SELECT estado FROM app_private.sincro13_aprobaciones_k WHERE evidencia_id="+
      quote(claim.id)+"::uuid"),'CONSUMIDA');
  } finally{
    if(exitCode===undefined)holder.kill();
    await ended.catch(()=>{});
  }
});

test('los outboxes conservan sus estados; MG9 y T no se alteran',()=>{
  assert.equal(pg("SELECT estado FROM app_private.manteniment_parada_outbox WHERE seguimiento_id="+
    quote(FOLLOWUP)+"::uuid"),'confirmado');
  assert.equal(pg("SELECT estado FROM app_private.manteniment_activo_outbox WHERE vehiculo_id="+
    quote(VEHICLE)+"::uuid"),'confirmado');
  assert.equal(pg("SELECT count(*) FROM app_private.mg9_filas_identidad"),'0');
  assert.equal(pg("SELECT count(*) FROM app_private.sincro13_recibos_t"),'1');
  assert.equal(pg("SELECT fecha_recogida::text FROM app_private.manteniment_t_trabajos WHERE sync_id="+
    quote(WORK)+"::uuid"),'2026-11-19');
});
