import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createContinuityFixture, seedContinuityPair, previewContinuity, confirmContinuity, CONTINUITY_RULE } from './continuity-scenarios.mjs';
import { one, beginReadCommitted, observeAdvisoryWait, snapshotProtectedFacts, FIXTURE_ACTOR } from './local-postgres-harness.mjs';

let fixture;
const report={suite:`${CONTINUITY_RULE} native concurrency`,started_at:new Date().toISOString(),cases:[]};
before(async()=>{fixture=await createContinuityFixture({prefix:'cont_races'});report.environment=fixture.metadata;});
after(async()=>{
  let failure;
  try{if(fixture){assert.deepEqual(await snapshotProtectedFacts(fixture.admin),fixture.protectedBefore);report.protected_history_and_barriers_unchanged=true;}}
  catch(e){failure=e;report.suite_error={code:e.code,message:e.message};}
  finally{
    try{if(fixture){await fixture.destroy();report.temporary_database_dropped=true;}}catch(e){failure||=e;report.cleanup_error=e.message;}
    report.finished_at=new Date().toISOString();
    report.passed=!failure&&report.protected_history_and_barriers_unchanged===true&&report.temporary_database_dropped===true
      &&report.cases.length===7&&report.cases.every(x=>x.status==='passed');
    if(process.env.METROGESTION_CONTINUITY_CONCURRENCY_REPORT){
      const filename=path.resolve(process.env.METROGESTION_CONTINUITY_CONCURRENCY_REPORT);assert.equal(path.extname(filename),'.json');
      await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,`${JSON.stringify(report,null,2)}\n`);
    }
  }
  if(failure)throw failure;
});
function scenario(key,name,body){
  test(`${key}: ${name}`,{timeout:30000},async context=>{
    const r={key,name,status:'running'};report.cases.push(r);
    try{await body(r);assert.deepEqual(await snapshotProtectedFacts(fixture.admin),fixture.protectedBefore);r.status='passed';
      context.diagnostic(JSON.stringify({key,wait:r.wait_proof,b_resolution:r.b_resolution,b_error:r.b_error}));}
    catch(e){r.status='failed';r.error={code:e.code,message:e.message};throw e;}
  });
}

/** Three independent native connections. The observer proves B waits on an
 * advisory lock held by A before A may COMMIT/ROLLBACK. No sleep is evidence.
 */
async function transactionWait(blocker,waiter,isSettled){
  const start=performance.now();let evidence;
  while(performance.now()-start<10000){
    evidence=await one(fixture.admin,`SELECT a.pid,a.state,a.wait_event_type,a.wait_event,pg_blocking_pids(a.pid) AS blocking_pids,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('transactionid',w.transactionid::text,'wait_mode',w.mode,
        'held_mode',h.mode,'wait_granted',w.granted,'held_granted',h.granted)),'[]')
       FROM pg_locks w JOIN pg_locks h ON h.locktype=w.locktype AND h.transactionid=w.transactionid
       WHERE w.pid=a.pid AND w.locktype='transactionid' AND NOT w.granted AND h.pid=$1 AND h.granted) AS matching_waits
      FROM pg_stat_activity a WHERE a.pid=$2`,[blocker,waiter]);
    if(evidence?.wait_event_type==='Lock'&&evidence.wait_event==='transactionid'
      &&evidence.blocking_pids.includes(blocker)&&evidence.matching_waits.length>0)
      return{...evidence,blocker_pid:blocker,observed_after_ms:Math.round(performance.now()-start)};
    if(isSettled())throw new Error('Recovery finished before a proven row-transaction wait');
    await delay(20);
  }
  throw new Error(`No proven row-transaction wait: ${JSON.stringify(evidence)}`);
}
async function race(r,operationA,operationB,resolution='COMMIT',waitKind='advisory'){
  const a=await fixture.connect(`${r.key}_a`),b=await fixture.connect(`${r.key}_b`);
  let resolved=false,pending,settled=false,stateB;
  try{
    const stateA=await beginReadCommitted(a);stateB=await beginReadCommitted(b);
    const observer=await one(fixture.admin,'SELECT pg_backend_pid() AS pid,current_database() AS database_name');
    assert.equal(new Set([stateA.pid,stateB.pid,observer.pid]).size,3);
    for(const x of [stateA,stateB,observer])assert.equal(x.database_name,fixture.dbName);
    assert.equal(stateA.actor,FIXTURE_ACTOR);assert.equal(stateB.actor,FIXTURE_ACTOR);
    r.connections={a:stateA,b:stateB,observer};
    const first=await operationA(a);r.a_result=first;
    pending=operationB(b).then(value=>{settled=true;return{ok:true,value};},error=>{settled=true;return{ok:false,error};});
    r.expected_wait=waitKind;
    r.wait_proof=waitKind==='transactionid'
      ? await transactionWait(stateA.pid,stateB.pid,()=>settled)
      : await observeAdvisoryWait(fixture.admin,stateA.pid,stateB.pid,{isSettled:()=>settled});
    assert.equal(settled,false);await a.query(resolution);resolved=true;r.a_resolution=resolution;
    const second=await pending;
    if(second.ok){await b.query('COMMIT');r.b_resolution='COMMIT';r.b_result=second.value;}
    else{await b.query('ROLLBACK');r.b_resolution='ROLLBACK';r.b_error={code:second.error.code,message:second.error.message};}
    return{first,second};
  }finally{
    if(!resolved)await a.query('ROLLBACK').catch(()=>{});
    if(pending&&!settled&&stateB)await fixture.admin.query('SELECT pg_cancel_backend($1)',[stateB.pid]).catch(()=>{});
    if(pending)await pending;
    await b.query('ROLLBACK').catch(()=>{});
    const closed=await Promise.allSettled([fixture.close(a),fixture.close(b)]);
    for(const result of closed)if(result.status==='rejected')throw result.reason;
  }
}
function rejection(outcome,code,pattern){assert.equal(outcome.ok,false);assert.equal(outcome.error.code,code);assert.match(outcome.error.message,pattern);}
async function inventory(pair){
  return(await one(fixture.admin,`SELECT jsonb_build_object(
    'links',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM app_private.sustitucion_continuidades_alpha75 c WHERE afectado_dfm=$1),
    'cards',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.registros_hotel r WHERE vehiculo_sustituido=$1),
    'stages',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id WHERE vehiculo_sustituido=$1),
    'activations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.activaciones_24h a WHERE dfm=$1),
    'summary',(SELECT jsonb_agg(to_jsonb(s) ORDER BY seguimiento_id) FROM public.paradas_sustitucion_resumen s WHERE unidad=$1),
    'reserve',(SELECT to_jsonb(r) FROM public.reservas_hotel r WHERE vehiculo_codigo=$2)) AS value`,[pair.dfm,pair.reserve])).value;
}
function assertConfirmed(state,pair){
  assert.equal(state.links.length,1);assert.equal(state.cards.length,2);assert.equal(state.summary.length,2);
  assert.equal(state.summary.filter(x=>x.sustitucion_vigente).length,1);
  assert.equal(state.summary.find(x=>x.sustitucion_vigente).seguimiento_id,pair.destination.seguimiento_id);
  assert.equal(state.reserve.estado,'ocupada');assert.equal(state.activations.length,1);assert.equal(state.activations[0].estado,'abierta');
}
async function sourceRecovery(pair){
  await fixture.admin.query("UPDATE public.registros_hotel SET modalidad_operativa='' WHERE id=$1",[pair.origin.id]);
  const e=(await one(fixture.admin,`INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,estado,tipo_etapa,accion_sistema)
    VALUES($1,'Recuperar ruta y liberar reserva',80,'pendiente','otro','recuperar_y_liberar') RETURNING id,version`,[pair.origin.id]));
  pair.preview=await previewContinuity(fixture.admin,pair);assert.equal(pair.preview.confirmable,true,JSON.stringify(pair.preview.bloqueos));
  return e;
}
async function quick(client,e,tag){return(await one(client,'SELECT public.marcar_t_realizada_rapida($1,$2,$3) AS value',[e.id,e.version,`quick_race_${tag}`])).value;}

scenario('CR1','same actor/request waits and replays one link',async r=>{
  const p=await seedContinuityPair(fixture.admin,{tag:'CR1'});
  const {first,second}=await race(r,a=>confirmContinuity(a,p),b=>confirmContinuity(b,p));
  assert.equal(second.ok,true,second.error?.message);assert.equal(second.value.reutilizada,true);assert.equal(second.value.continuidad_id,first.continuidad_id);
  r.inventory=await inventory(p);assertConfirmed(r.inventory,p);
});
scenario('CR2','same actor/request with changed payload waits and rejects as business conflict',async r=>{
  const p=await seedContinuityPair(fixture.admin,{tag:'CR2'});const other=structuredClone(p.preview);other.prevision.origen.version+=1;
  const {second}=await race(r,a=>confirmContinuity(a,p),b=>confirmContinuity(b,p,{preview:other}));
  rejection(second,'23514',/petición ya confirmó otra selección/);r.inventory=await inventory(p);assertConfirmed(r.inventory,p);
});
scenario('CR3','rollback of first confirmation lets the waiter create exactly one link',async r=>{
  const p=await seedContinuityPair(fixture.admin,{tag:'CR3'});
  const {first,second}=await race(r,a=>confirmContinuity(a,p),b=>confirmContinuity(b,p),'ROLLBACK');
  assert.equal(second.ok,true,second.error?.message);assert.equal(second.value.reutilizada,false);assert.notEqual(second.value.continuidad_id,first.continuidad_id);
  r.inventory=await inventory(p);assertConfirmed(r.inventory,p);
});
scenario('CR4','concurrent plate-only assignment waits and cannot duplicate the effective destination owner',async r=>{
  const p=await seedContinuityPair(fixture.admin,{tag:'CR4'});
  const {second}=await race(r,a=>confirmContinuity(a,p),async b=>(await one(b,'SELECT public.crear_ficha_hotel($1::jsonb,$2) AS value',
    [JSON.stringify({vehiculo_sustituido:'TEST-CR4-OTHER',matricula_reserva:p.registration,fecha_parada:p.dates.today,estado:'pendiente_taller',tipo_movimiento:'TALLER'}),'continuity_CR4_competing_assignment'])).value);
  rejection(second,'23514',/PARADAS-002: el sustituto continúa asignado/);r.inventory=await inventory(p);assertConfirmed(r.inventory,p);
  assert.equal((await one(fixture.admin,"SELECT count(*)::int AS n FROM public.registros_hotel WHERE vehiculo_sustituido='TEST-CR4-OTHER'")).n,0);
});
scenario('CR5','source recovery committed first makes a waiting confirmation stale without creating a link',async r=>{
  const p=await seedContinuityPair(fixture.admin,{tag:'CR5'});const e=await sourceRecovery(p);
  const {second}=await race(r,a=>quick(a,e,'CR5'),b=>confirmContinuity(b,p));
  rejection(second,'40001',/CONTINUIDAD-001: la PA o la entrada ha cambiado/);
  r.inventory=await inventory(p);assert.equal(r.inventory.links.length,0);assert.equal(r.inventory.reserve.estado,'libre');
  assert.equal(r.inventory.activations[0].estado,'abierta');assert.equal(r.inventory.cards.find(x=>x.id===p.destination.id).vehiculo_reserva,'');
});
scenario('CR6','continuity committed first blocks the waiting recovery on the ceded source',async r=>{
  const p=await seedContinuityPair(fixture.admin,{tag:'CR6'});const e=await sourceRecovery(p);const before=await inventory(p);
  const {second}=await race(r,a=>confirmContinuity(a,p),b=>quick(b,e,'CR6'),'COMMIT','transactionid');
  rejection(second,'23514',/CONTINUIDAD-001: esta PA cedió el sustituto/);r.inventory=await inventory(p);assertConfirmed(r.inventory,p);
  assert.deepEqual(r.inventory.stages,before.stages);assert.deepEqual(r.inventory.activations,before.activations);
});
scenario('CR7','rollover first makes the old concrete confirmation invalid while preserving logical PA identities',async r=>{
  const p=await seedContinuityPair(fixture.admin,{tag:'CR7'});
  const {second}=await race(r,async a=>{
    const board=(await one(a,"INSERT INTO public.pizarras(estado,fecha) VALUES('en_curso',CURRENT_DATE+4) RETURNING id")).id;
    const ids=[];
    for(const source of [p.origin,p.destination]){
      const row=(await one(a,'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1',[source.id])).value;
      const inserted=await one(a,`INSERT INTO public.registros_hotel
        SELECT (jsonb_populate_record(NULL::public.registros_hotel,$1::jsonb||jsonb_build_object('id',gen_random_uuid(),'pizarra_id',$2::uuid))).* RETURNING id`,[JSON.stringify(row),board]);
      ids.push(inserted.id);
    }
    await a.query("UPDATE public.pizarras SET estado='archivada' WHERE id=$1",[p.origin.pizarra_id]);
    return{board,clone_ids:ids};
  },b=>confirmContinuity(b,p));
  rejection(second,'23514',/CONTINUIDAD-001: La confirmación requiere la PA destino de la Pizarra actual/);
  r.inventory=await inventory(p);assert.equal(r.inventory.links.length,0);assert.equal(r.inventory.summary.length,2);assert.equal(r.inventory.cards.length,4);
  assert.equal(r.inventory.reserve.estado,'ocupada');assert.equal(new Set(r.inventory.cards.map(x=>x.seguimiento_id)).size,2);
  assert.equal(new Set(r.inventory.cards.filter(x=>x.seguimiento_id===p.origin.seguimiento_id).map(x=>x.numero_parada)).size,1);
  assert.equal(new Set(r.inventory.cards.filter(x=>x.seguimiento_id===p.destination.seguimiento_id).map(x=>x.numero_parada)).size,1);
});
