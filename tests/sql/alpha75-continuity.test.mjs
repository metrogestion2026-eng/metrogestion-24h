import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createContinuityFixture, seedContinuityPair, previewContinuity, confirmContinuity, CONTINUITY_RULE } from './continuity-scenarios.mjs';
import { one, snapshotProtectedFacts, FIXTURE_ACTOR } from './local-postgres-harness.mjs';

const report = { suite: CONTINUITY_RULE, started_at: new Date().toISOString(), cases: [] };
let fixture;
before(async () => { fixture = await createContinuityFixture({ prefix: 'continuity' }); report.environment = fixture.metadata; });
after(async () => {
  let failure;
  try {
    if (fixture) {
      assert.deepEqual(await snapshotProtectedFacts(fixture.admin), fixture.protectedBefore);
      report.protected_history_and_barriers_unchanged = true;
    }
  } catch (error) { failure = error; report.suite_error = { code: error.code, message: error.message }; }
  finally {
    try { if (fixture) { await fixture.destroy(); report.temporary_database_dropped = true; } }
    catch (error) { failure ||= error; report.cleanup_error = error.message; }
    report.finished_at = new Date().toISOString();
    report.passed = !failure && report.protected_history_and_barriers_unchanged === true
      && report.temporary_database_dropped === true && report.cases.length >= 12 && report.cases.every(c => c.status === 'passed');
    if (process.env.METROGESTION_CONTINUITY_REPORT) {
      const filename = path.resolve(process.env.METROGESTION_CONTINUITY_REPORT);
      assert.equal(path.extname(filename), '.json');
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  if (failure) throw failure;
});

function scenario(key, description, body) {
  test(`${key}: ${description}`, { timeout: 30000 }, async context => {
    const result = { key, description, status: 'running' }; report.cases.push(result);
    try {
      await body(fixture.admin, result);
      assert.deepEqual(await snapshotProtectedFacts(fixture.admin), fixture.protectedBefore);
      result.status = 'passed'; context.diagnostic(JSON.stringify({ key, checks: result.checks }));
    } catch (error) { result.status = 'failed'; result.error = { code: error.code, message: error.message }; throw error; }
    finally { await fixture.admin.query('ROLLBACK'); }
  });
}

async function inventory(db, pair) {
  return (await one(db, `SELECT jsonb_build_object(
    'pa',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.registros_hotel r WHERE vehiculo_sustituido=$1),
    't',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id WHERE r.vehiculo_sustituido=$1),
    'a',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.activaciones_24h a WHERE a.dfm=$1),
    'links',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM app_private.sustitucion_continuidades_alpha75 c WHERE afectado_dfm=$1),
    'reserve',(SELECT to_jsonb(r) FROM public.reservas_hotel r WHERE vehiculo_codigo=$2),
    'summary',(SELECT jsonb_agg(to_jsonb(p) ORDER BY seguimiento_id) FROM public.paradas_sustitucion_resumen p WHERE unidad=$1),
    'billing',(SELECT jsonb_agg(to_jsonb(p) ORDER BY seguimiento_id,periodo) FROM public.facturacion_dfm_periodos p WHERE dfm=$1)
  ) AS value`, [pair.dfm, pair.reserve])).value;
}
async function rejectUnchanged(db, pair, operation, code = '23514', pattern = /CONTINUIDAD-001/) {
  const before = await inventory(db, pair);
  await assert.rejects(operation, error => error.code === code && pattern.test(error.message), 'Expected the specific domain rejection, not timeout/permission/SQL syntax');
  assert.deepEqual(await inventory(db, pair), before, 'Rejected operation changed committed facts');
}
export async function completeWorkshop(db, pair) {
  await db.query(`UPDATE public.etapas_hotel SET estado='realizada',fecha_fin_real=clock_timestamp()-interval '2 minutes',
    fecha_real=clock_timestamp()-interval '1 minute' WHERE id=$1`, [pair.entry.id]);
}
async function recover(db, pair) {
  const e = await one(db, 'SELECT version FROM public.etapas_hotel WHERE id=$1', [pair.recovery.id]);
  return (await one(db, 'SELECT public.marcar_t_realizada_rapida($1,$2,$3) AS value',
    [pair.recovery.id, e.version, `quick_continuity_${pair.tag}`])).value;
}

scenario('C01', 'context, confirmation, allocation and replay preserve the source and all T', async (db, r) => {
  const p = await seedContinuityPair(db, { tag: 'C01' });
  const context = await previewContinuity(db, p, { origin: null, entry: null });
  assert.equal(context.ok, true); assert.equal(context.prevision, null); assert.equal(context.confirmable, false);
  assert.equal(context.origenes[0].id, p.origin.id); assert.equal(context.entradas[0].registro_hotel_id, p.destination.id);
  assert.equal(context.entradas[0].seguimiento_parada_id, p.destination.seguimiento_id);
  assert.notEqual(context.entradas[0].seguimiento_id, p.destination.seguimiento_id);
  const before = await inventory(db, p);
  const c = await confirmContinuity(db, p);
  assert.equal(c.regla, CONTINUITY_RULE); assert.equal(c.reutilizada, false);
  assert.equal(c.propietario_al_confirmar.id, p.destination.id); assert.equal(c.propietario_actual.id, p.destination.id);
  assert.equal(c.tramos.origen.dias_imputables, 1); assert.equal(c.tramos.destino.dias_imputables, 2);
  const after = await inventory(db, p);
  assert.deepEqual(after.t, before.t); assert.deepEqual(after.a, before.a);
  assert.deepEqual(after.pa.find(x => x.id === p.origin.id), before.pa.find(x => x.id === p.origin.id));
  assert.equal(after.reserve.estado, 'ocupada'); assert.equal(after.links.length, 1);
  assert.equal(after.summary.length, 2);
  const origin = after.summary.find(x => x.seguimiento_id === p.origin.seguimiento_id);
  const destination = after.summary.find(x => x.seguimiento_id === p.destination.seguimiento_id);
  assert.equal(origin.fecha_inicio_parada, p.dates.origin); assert.equal(origin.fecha_fin_parada, null);
  assert.equal(origin.fecha_fin_imputacion, p.dates.origin); assert.equal(origin.fin_imputacion_motivo, 'continuidad');
  assert.equal(origin.dias_parada_total, 3); assert.equal(origin.dias_imputables_total, 1);
  assert.equal(origin.sustitucion_vigente, false); assert.equal(destination.sustitucion_vigente, true);
  assert.equal(destination.propietario_sustitucion_seguimiento_id, p.destination.seguimiento_id);
  assert.equal(after.billing.reduce((n, x) => n + x.dias_facturables, 0), 3);
  assert.equal(after.billing.reduce((n, x) => n + Number(x.km_facturables), 0), 300);
  const replay = await confirmContinuity(db, p);
  assert.equal(replay.reutilizada, true); assert.equal(replay.continuidad_id, c.continuidad_id);
  assert.deepEqual(await inventory(db, p), after);
  const payload={...after.a[0],estado:'cerrada',estado_seguimiento:'realizada',resultado:'trasladado_taller',
    trasladado_taller:true,taller_traslado:'Taller sintético de continuidad',estado_operativo_confirmado:false,
    fecha_fin_reparacion:p.dates.entry,hora_fin_reparacion:'12:00'};
  const closed=(await one(db,'SELECT public.guardar_activacion_24h($1,$2::jsonb,$3) AS value',
    [p.activation.id,JSON.stringify(payload),'continuity_C01_close_assistance'])).value;
  assert.equal(closed.estado,'cerrada');assert.equal(closed.estado_seguimiento,'realizada');
  const closedState=await inventory(db,p);
  assert.deepEqual(closedState.pa.find(x=>x.id===p.destination.id),after.pa.find(x=>x.id===p.destination.id));
  assert.deepEqual(closedState.t.filter(x=>x.registro_hotel_id===p.destination.id),after.t.filter(x=>x.registro_hotel_id===p.destination.id));
  assert.equal(closedState.reserve.estado,'ocupada');
  assert.equal(closedState.summary.find(x=>x.seguimiento_id===p.origin.seguimiento_id).fecha_fin_parada,null);
  r.checks = { continuity_id: c.continuidad_id, origin_days: 1, destination_days: 2, total_km: 300, replay: true,
    source_assistance_can_close_independently:true };
});

scenario('C02', 'entry on delivery day gives zero origin days and no double charge', async (db, r) => {
  const p = await seedContinuityPair(db, { tag: 'C02', originDaysAgo: 1, entryDaysAgo: 1 });
  assert.equal(p.preview.prevision.tramo_origen.dias_imputables, 0);
  await confirmContinuity(db, p);
  const state = await inventory(db, p);
  assert.equal(state.summary.find(x => x.seguimiento_id === p.origin.seguimiento_id).dias_imputables_total, 0);
  assert.equal(state.billing.reduce((n, x) => n + x.dias_facturables, 0), 2);
  assert.equal(state.billing.reduce((n, x) => n + Number(x.km_facturables), 0), 200);
  r.checks = { origin_days: 0, total_days: 2, total_km: 200 };
});

scenario('C03', 'manual daily rates stay on their PA and closed snapshots remain exact', async (db, r) => {
  const p = await seedContinuityPair(db, { tag: 'C03', originManualRate: 37.25, destinationManualRate: 80.5 });
  const previous = await one(db, `SELECT * FROM public.cierres_facturacion WHERE fecha_cierre<$1::date ORDER BY fecha_cierre DESC LIMIT 1`, [p.dates.origin]);
  await db.query(`INSERT INTO public.facturacion_tancament_cierres(source_key,seguimiento_id,dfm,numero_parada,sustituto,
    tancament,periodo,fecha_inicio_tramo,fecha_fin_tramo,dias_facturables,km_facturables,payload_hash)
    VALUES($1,$2,$3,$4,$5,'TANCAMENT 1',$6,$7,$8,11,409.75,'synthetic-closed-hash')`,
    ['C03-snapshot', p.origin.seguimiento_id, p.dfm, p.origin.numero_parada, p.reserve, previous.periodo, previous.fecha_inicio, previous.fecha_cierre]);
  const before = (await inventory(db, p)).billing.filter(x => x.km_dia_fuente === 'TANCAMENT');
  p.preview = await previewContinuity(db, p);
  assert.equal(p.preview.confirmable, true, JSON.stringify(p.preview.bloqueos));
  await confirmContinuity(db, p);
  const after = await inventory(db, p);
  assert.deepEqual(after.billing.filter(x => x.km_dia_fuente === 'TANCAMENT'), before);
  const live = after.billing.filter(x => x.km_dia_fuente !== 'TANCAMENT');
  assert.equal(live.find(x => x.seguimiento_id === p.origin.seguimiento_id).km_dia, 37.25);
  assert.equal(live.find(x => x.seguimiento_id === p.destination.seguimiento_id).km_dia, 80.5);
  assert.equal(live.reduce((n, x) => n + Number(x.km_facturables), 0), 198);
  r.checks = { manual_origin: 37.25, manual_destination: 80.5, untouched_snapshot_days: 11, untouched_snapshot_km: 409.75 };
});

scenario('C04', 'explicit destination recovery releases once and preserves the open assistance and source', async (db, r) => {
  const p = await seedContinuityPair(db, { tag: 'C04' });
  await confirmContinuity(db, p);
  await completeWorkshop(db, p);
  const before = await inventory(db, p);
  await db.query('BEGIN'); const result = await recover(db, p); await db.query('COMMIT');
  assert.equal(result.ok, true); assert.equal(result.registro_estado, 'recuperado');
  const after = await inventory(db, p);
  assert.equal(after.reserve.estado, 'libre'); assert.deepEqual(after.a, before.a);
  assert.equal(after.a[0].estado, 'abierta'); assert.deepEqual(after.pa.find(x => x.id === p.origin.id), before.pa.find(x => x.id === p.origin.id));
  assert.deepEqual(after.t.filter(x => x.id !== p.recovery.id), before.t.filter(x => x.id !== p.recovery.id));
  const d = after.summary.find(x => x.seguimiento_id === p.destination.seguimiento_id);
  assert.equal(d.fecha_fin_imputacion, p.dates.today); assert.equal(d.fin_imputacion_motivo, 'recuperacion');
  assert.equal(d.propietario_sustitucion_seguimiento_id, null); assert.equal(d.sustitucion_vigente, false);
  const replay = await confirmContinuity(db, p);
  assert.equal(replay.reutilizada, true); assert.equal(replay.propietario_actual, null);
  assert.equal(replay.propietario_al_confirmar.id, p.destination.id);
  await db.query('SELECT app_private.liberar_sustituto_registro($1)', [p.origin.id]);
  assert.equal((await inventory(db, p)).reserve.estado, 'libre');
  r.checks = { committed: true, reserve: 'libre', assistance: 'abierta', replay_after_recovery: true };
});

scenario('C05', 'ceded source cannot recover, retire, cancel, reassign or change cut facts', async (db, r) => {
  const p = await seedContinuityPair(db, { tag: 'C05' }); await confirmContinuity(db, p);
  const commands = [
    ['UPDATE public.registros_hotel SET estado=\'recuperado\' WHERE id=$1', [p.origin.id]],
    ['UPDATE public.registros_hotel SET retirado_hotel_activo=true WHERE id=$1', [p.origin.id]],
    ['UPDATE public.registros_hotel SET cancelado=true WHERE id=$1', [p.origin.id]],
    ['UPDATE public.registros_hotel SET vehiculo_reserva=\'OTHER\' WHERE id=$1', [p.origin.id]],
    ['UPDATE public.registros_hotel SET fecha_parada=fecha_parada-1 WHERE id=$1', [p.origin.id]],
    ['UPDATE public.etapas_hotel SET fecha_inicio_real=fecha_inicio_real+interval \'1 minute\' WHERE id=$1', [p.entry.id]],
    ['UPDATE public.etapas_hotel SET cancelado=true WHERE id=$1', [p.entry.id]],
    ['DELETE FROM public.etapas_hotel WHERE id=$1', [p.entry.id]],
    ['UPDATE public.activaciones_24h SET registro_hotel_id=$2,seguimiento_hotel_id=$3 WHERE id=$1', [p.activation.id,p.destination.id,p.destination.seguimiento_id]],
  ];
  for (const [sql, values] of commands) await rejectUnchanged(db, p, () => db.query(sql, values));
  await db.query('SELECT app_private.liberar_sustituto_registro($1)', [p.origin.id]);
  assert.equal((await inventory(db, p)).reserve.estado, 'ocupada');
  await db.query('SELECT app_private.liberar_sustituto_registro($1)', [p.destination.id]);
  assert.equal((await inventory(db, p)).reserve.estado, 'ocupada', 'Calling the release helper alone cannot free the effective owner');
  r.checks = { rejected_mutations: commands.length, direct_release_safe: true };
});

scenario('C06', 'real recovery cannot predate entry, move PA, change T identity or reopen', async (db, r) => {
  const p = await seedContinuityPair(db, { tag: 'C06' }); await confirmContinuity(db, p); await completeWorkshop(db, p);
  await rejectUnchanged(db, p, () => db.query(`UPDATE public.etapas_hotel SET estado='realizada',
    fecha_real=$2::timestamptz-interval '1 day',fecha_fin_real=$2::timestamptz-interval '1 day' WHERE id=$1`, [p.recovery.id,p.entry.fecha_inicio_real]));
  await recover(db, p);
  await rejectUnchanged(db, p, () => db.query('UPDATE public.etapas_hotel SET registro_hotel_id=$2 WHERE id=$1', [p.recovery.id,p.origin.id]));
  await rejectUnchanged(db, p, () => db.query('UPDATE public.etapas_hotel SET seguimiento_id=gen_random_uuid() WHERE id=$1', [p.recovery.id]));
  await rejectUnchanged(db, p, () => db.query("UPDATE public.etapas_hotel SET estado='pendiente',fecha_real=NULL,fecha_fin_real=NULL WHERE id=$1", [p.recovery.id]));
  await rejectUnchanged(db, p, () => db.query("UPDATE public.registros_hotel SET estado='en_taller',retirado_hotel_activo=false WHERE id=$1", [p.destination.id]));
  await rejectUnchanged(db,p,()=>db.query(`INSERT INTO public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,accion_sistema,fecha_real,fecha_fin_real)
    SELECT registro_hotel_id,gen_random_uuid(),nombre,95,estado,tipo_etapa,accion_sistema,fecha_real,fecha_fin_real
    FROM public.etapas_hotel WHERE id=$1`,[p.recovery.id]));
  await rejectUnchanged(db,p,()=>db.query(`INSERT INTO public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,accion_sistema,fecha_real,fecha_fin_real)
    SELECT registro_hotel_id,seguimiento_id,nombre,95,estado,tipo_etapa,accion_sistema,fecha_real-interval '1 second',fecha_fin_real-interval '1 second'
    FROM public.etapas_hotel WHERE id=$1`,[p.recovery.id]));
  const card=(await one(db,'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1',[p.destination.id])).value;
  await rejectUnchanged(db,p,()=>db.query(`INSERT INTO public.registros_hotel
    SELECT (jsonb_populate_record(NULL::public.registros_hotel,$1::jsonb||jsonb_build_object('id',gen_random_uuid(),
      'estado','en_taller','retirado_hotel_activo',false,'fecha_retirado_hotel',NULL))).*`,[JSON.stringify(card)]));
  const archive=(await one(db,"INSERT INTO public.pizarras(estado,fecha) VALUES('archivada',CURRENT_DATE+2) RETURNING id")).id;
  await rejectUnchanged(db,p,()=>db.query('UPDATE public.registros_hotel SET pizarra_id=$2 WHERE id=$1',[p.destination.id,archive]));
  const clone=(await one(db,`INSERT INTO public.registros_hotel
    SELECT (jsonb_populate_record(NULL::public.registros_hotel,$1::jsonb||jsonb_build_object('id',gen_random_uuid(),'pizarra_id',$2::uuid))).*
    RETURNING id`,[JSON.stringify(card),archive])).id;
  await db.query(`INSERT INTO public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,accion_sistema,fecha_real,fecha_fin_real)
    SELECT $2,seguimiento_id,nombre,posicion,estado,tipo_etapa,accion_sistema,fecha_real,fecha_fin_real
    FROM public.etapas_hotel WHERE id=$1`,[p.recovery.id,clone]);
  assert.equal((await inventory(db,p)).summary.find(x=>x.seguimiento_id===p.destination.seguimiento_id).propietario_sustitucion_seguimiento_id,null);
  r.checks = { chronology_rejected: true, identity_rejected: true, reopened_rejected: true,
    duplicate_recovery_rejected:true,active_clone_rejected:true,retired_exact_clone_allowed:true };
});

scenario('C07', 'notes remain editable through current Alpha73 editor wrapper without duplicating assignment', async (db, r) => {
  const p = await seedContinuityPair(db, { tag: 'C07' }); await confirmContinuity(db, p);
  const before = await inventory(db, p);
  const current = before.pa.find(x => x.id === p.origin.id);
  const identity = { registro_id: current.id, ...Object.fromEntries(['pizarra_id','seguimiento_id','numero_parada','vehiculo_sustituido','matricula_sustituido'].map(k => [k,current[k]])) };
  const result = (await one(db, 'SELECT public.guardar_ficha_hotel_edicion_alpha73($1,$2,$3,$4,$5,$6) AS value',
    [current.id,current.version,JSON.stringify({...current,observaciones:'Nota inocua tras continuidad'}),'[]',JSON.stringify(identity),'continuity_C07_note'])).value;
  assert.equal(result.ok, true); assert.equal(result.identidad_validada, true);
  const after = await inventory(db, p);
  assert.equal(after.pa.find(x => x.id === p.origin.id).observaciones, 'Nota inocua tras continuidad');
  assert.deepEqual(after.t, before.t); assert.deepEqual(after.a, before.a); assert.deepEqual(after.links, before.links);
  assert.equal(after.reserve.estado, 'ocupada');
  r.checks = { public_editor: 'alpha73', note_saved: true, tasks_unchanged: true };
});

scenario('C08', 'stale versions, preview-rate drift and changed idempotency payload fail without writes', async (db, r) => {
  const p = await seedContinuityPair(db, { tag: 'C08' });
  await db.query("UPDATE public.registros_hotel SET observaciones='Cambio posterior al preview' WHERE id=$1", [p.destination.id]);
  await rejectUnchanged(db, p, () => confirmContinuity(db,p), '40001');
  p.preview = await previewContinuity(db,p);
  await db.query('INSERT INTO public.ajustes_sustitucion_parada(seguimiento_id,km_dia_manual) VALUES($1,123)',[p.destination.seguimiento_id]);
  await rejectUnchanged(db,p,()=>confirmContinuity(db,p),'40001');
  p.preview = await previewContinuity(db,p); await confirmContinuity(db,p);
  const modified=structuredClone(p.preview); modified.prevision.origen.version+=1;
  await rejectUnchanged(db,p,()=>confirmContinuity(db,p,{preview:modified}),'23514',/petición ya confirmó otra selección/);
  r.checks={stale_version:true,preview_rate_drift:true,idempotency_payload_conflict:true};
});

scenario('C09', 'manual totals, closed cuts, incompatible modality, R affected and missing actual entry block', async (db, r) => {
  const cases=[
    ['DAYS',`INSERT INTO app_private.manteniment_parada_sync(seguimiento_id,dias_parada_manual) VALUES($1,9) ON CONFLICT(seguimiento_id) DO UPDATE SET dias_parada_manual=9`, p=>[p.origin.seguimiento_id],'TOTALES_MANUALES_PROTEGIDOS'],
    ['KM',`INSERT INTO app_private.manteniment_parada_sync(seguimiento_id,km_facturables_manual) VALUES($1,999) ON CONFLICT(seguimiento_id) DO UPDATE SET km_facturables_manual=999`, p=>[p.origin.seguimiento_id],'TOTALES_MANUALES_PROTEGIDOS'],
    ['CUT',`INSERT INTO app_private.manteniment_parada_sync(seguimiento_id,tancament_supervisado,fecha_corte) VALUES($1,true,$2) ON CONFLICT(seguimiento_id) DO UPDATE SET tancament_supervisado=true,fecha_corte=excluded.fecha_corte`, p=>[p.origin.seguimiento_id,p.dates.entry],'TOTALES_MANUALES_PROTEGIDOS'],
    ['MODE',`UPDATE public.registros_hotel SET modalidad_operativa='sin_sustitucion' WHERE id=$1`,p=>[p.destination.id],'MODALIDAD_DESTINO_INCOMPATIBLE'],
    ['NOENTRY',`UPDATE public.etapas_hotel SET fecha_inicio_real=NULL WHERE id=$1`,p=>[p.entry.id],'ENTRADA_SIN_HECHO_REAL'],
    ['R',`UPDATE public.registros_hotel SET vehiculo_sustituido='R-AFECTADO-C09' WHERE id IN($1,$2)`,p=>[p.origin.id,p.destination.id],'AFECTADO_NO_DFM'],
  ];
  for (const [suffix,sql,args,code] of cases) {
    const p=await seedContinuityPair(db,{tag:`C09${suffix}`}); await db.query(sql,args(p));
    const preview=await previewContinuity(db,p);
    assert.equal(preview.confirmable,false); assert.ok(preview.bloqueos.some(x=>x.codigo===code),JSON.stringify(preview.bloqueos));
    await rejectUnchanged(db,p,()=>confirmContinuity(db,p,{preview}), '23514');
  }
  const frozen=await seedContinuityPair(db,{tag:'C09SNAP'});
  await db.query(`INSERT INTO public.facturacion_tancament_cierres(source_key,seguimiento_id,dfm,numero_parada,sustituto,
    tancament,periodo,fecha_inicio_tramo,fecha_fin_tramo,dias_facturables,km_facturables,payload_hash)
    VALUES('C09-frozen',$1,$2,$3,$4,'TANCAMENT 9',$5,$6,$7,9,900,'synthetic')`,[frozen.origin.seguimiento_id,frozen.dfm,
    frozen.origin.numero_parada,frozen.reserve,frozen.preview.prevision.periodo.periodo,frozen.dates.origin,frozen.dates.today]);
  const frozenPreview=await previewContinuity(db,frozen);
  assert.ok(frozenPreview.bloqueos.some(x=>x.codigo==='SNAPSHOT_PROTEGIDO'));
  await rejectUnchanged(db,frozen,()=>confirmContinuity(db,frozen,{preview:frozenPreview}));
  r.checks={blocked:cases.map(x=>x[0])};
});

scenario('C10', 'unlinked current ownership and archived FLOTA colors retain their previous meaning', async (db, r) => {
  const p=await seedContinuityPair(db,{tag:'C10',substituteType:'FLOTA'});
  let row=await one(db,'SELECT propietario_sustitucion_seguimiento_id,sustitucion_vigente FROM public.hotel_actual WHERE id=$1',[p.origin.id]);
  assert.equal(row.propietario_sustitucion_seguimiento_id,p.origin.seguimiento_id);assert.equal(row.sustitucion_vigente,true);
  const board=(await one(db,"INSERT INTO public.pizarras(estado,fecha) VALUES('archivada','2026-09-01') RETURNING id")).id;
  const old=(await one(db,`INSERT INTO public.registros_hotel(pizarra_id,vehiculo_sustituido,vehiculo_reserva,tipo_sustituto,numero_parada,fecha_parada)
    VALUES($1,'TEST-ARCHIVED-AFFECTED',$2,'FLOTA','SYN-ARCH-FLEET-A','2026-09-01') RETURNING id`,[board,p.reserve])).id;
  const fleet=(await one(db,`INSERT INTO public.registros_hotel(pizarra_id,vehiculo_sustituido,numero_parada,fecha_parada)
    VALUES($1,$2,'SYN-ARCH-FLEET-B','2026-09-01') RETURNING id`,[board,p.reserve])).id;
  row=await one(db,'SELECT estado,fondo_visual FROM public.hotel_por_dia WHERE id=$1',[fleet]);
  assert.equal(row.estado,'sustitucion_momentanea');assert.equal(row.fondo_visual,'marron');
  await confirmContinuity(db,p);
  await completeWorkshop(db,p);await recover(db,p);
  assert.deepEqual(await one(db,'SELECT estado,fondo_visual FROM public.hotel_por_dia WHERE id=$1',[fleet]),row);
  r.checks={unlinked_owner:true,historical_fleet_unchanged:true,archived_record:old};
});

scenario('C11', 'read/edit/device permission gates and private ledger ACL remain enforced', async (db, r) => {
  const p=await seedContinuityPair(db,{tag:'C11'});
  const checks=await one(db,`SELECT
    has_table_privilege('authenticated','app_private.sustitucion_continuidades_alpha75','SELECT') AS ledger_read,
    has_table_privilege('authenticated','app_private.sustitucion_continuidades_alpha75','INSERT') AS ledger_write,
    has_function_privilege('anon','public.confirmar_continuidad_sustitucion_alpha75(uuid,uuid,uuid,integer,integer,integer,text,text)','EXECUTE') AS anon_confirm,
    has_function_privilege('authenticated','app_private.es_titular_continuidad_alpha75(uuid)','EXECUTE') AS raw_helper`);
  assert.deepEqual(checks,{ledger_read:false,ledger_write:false,anon_confirm:false,raw_helper:false});
  for (const setting of ['test.device_allowed','test.user_active','test.edit_allowed']) {
    await db.query('SELECT set_config($1,\'false\',false)',[setting]);
    await assert.rejects(()=>confirmContinuity(db,p),error=>error.code==='42501');
    await db.query('SELECT set_config($1,\'true\',false)',[setting]);
  }
  // Scoped auth double models only module access; this does not claim to test
  // the deployed RLS policy data model. Existing view policies are untouched.
  await db.query(`CREATE OR REPLACE FUNCTION public.puede_ver_modulo(text) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('test.view_allowed',true),'')::boolean,true)
      AND (coalesce(current_setting('test.only_module',true),'')='' OR $1=current_setting('test.only_module',true)) $$;
    GRANT USAGE ON SCHEMA app_private,auth TO authenticated;`);
  const reader=await fixture.connect('permission_reader');
  try {
    await reader.query('SET ROLE authenticated');
    for (const module of ['listados','resumen']) {
      await reader.query("SELECT set_config('test.only_module',$1,false)",[module]);
      const metadata=(await one(reader,'SELECT app_private.proyectar_continuidad_sustitucion_alpha75($1) AS value',[p.origin.seguimiento_id])).value;
      assert.equal(metadata.sustitucion_vigente,true);
      await assert.rejects(()=>previewContinuity(reader,p),error=>error.code==='42501');
    }
    await reader.query("SELECT set_config('test.only_module','none',false)");
    await assert.rejects(()=>reader.query('SELECT app_private.proyectar_continuidad_sustitucion_alpha75($1)',[p.origin.seguimiento_id]),e=>e.code==='42501');
    await assert.rejects(()=>reader.query('SELECT * FROM app_private.sustitucion_continuidades_alpha75'),e=>e.code==='42501');
  } finally { await fixture.close(reader); }
  r.checks={...checks,projection_listados:true,projection_resumen:true,no_module_denied:true};
});

scenario('C12', 'rollover clones retain one logical summary row and the effective owner', async (db, r) => {
  const p=await seedContinuityPair(db,{tag:'C12'});await confirmContinuity(db,p);
  const before=await inventory(db,p);
  const board=(await one(db,"INSERT INTO public.pizarras(estado,fecha) VALUES('en_curso',CURRENT_DATE+1) RETURNING id")).id;
  // Clone only this synthetic chain to a new daily board. The unchanged source
  // and destination identities are evidence; app.clonando_pizarra is no guard bypass.
  await db.query('BEGIN');await db.query("SELECT set_config('app.clonando_pizarra','1',true)");
  const clones=[];
  for(const id of [p.origin.id,p.destination.id]){
    const row=(await one(db,'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1',[id])).value;
    delete row.id;row.pizarra_id=board;
    const clone=(await one(db,`INSERT INTO public.registros_hotel SELECT (jsonb_populate_record(NULL::public.registros_hotel,$1::jsonb||jsonb_build_object('id',gen_random_uuid()))).* RETURNING id`,[JSON.stringify(row)])).id;
    clones.push(clone);
    const stages=(await db.query('SELECT to_jsonb(e)-\'id\'-\'posicion_activa\' AS value FROM public.etapas_hotel e WHERE registro_hotel_id=$1',[id])).rows;
    for (const {value} of stages) {
      value.registro_hotel_id=clone;
      const columns=Object.keys(value); const parameters=columns.map((_,i)=>`$${i+1}`);
      await db.query(`INSERT INTO public.etapas_hotel(${columns.map(x=>`"${x}"`).join(',')}) VALUES(${parameters.join(',')})`,Object.values(value));
    }
  }
  await db.query("UPDATE public.pizarras SET estado='archivada' WHERE id=$1",[p.origin.pizarra_id]);
  await db.query('COMMIT');
  const after=await inventory(db,p);assert.equal(after.links.length,1);assert.equal(after.summary.length,2);
  assert.equal(after.pa.find(x=>x.id===clones[0]).numero_parada,p.origin.numero_parada);
  assert.equal(after.pa.find(x=>x.id===clones[1]).numero_parada,p.destination.numero_parada);
  assert.equal(after.summary.find(x=>x.seguimiento_id===p.origin.seguimiento_id).dias_imputables_total,1);
  assert.equal(after.summary.find(x=>x.seguimiento_id===p.destination.seguimiento_id).propietario_sustitucion_seguimiento_id,p.destination.seguimiento_id);
  assert.deepEqual(after.pa.filter(x=>[p.origin.id,p.destination.id].includes(x.id)),before.pa);
  assert.equal(after.reserve.estado,'ocupada');
  const replay=await confirmContinuity(db,p);assert.equal(replay.reutilizada,true);assert.equal(replay.propietario_actual.id,clones[1]);
  const cloneEntry=await one(db,'SELECT id FROM public.etapas_hotel WHERE registro_hotel_id=$1 AND seguimiento_id=$2',[clones[1],p.entry.seguimiento_id]);
  const cloneRecovery=await one(db,'SELECT id,version FROM public.etapas_hotel WHERE registro_hotel_id=$1 AND seguimiento_id=$2',[clones[1],p.recovery.seguimiento_id]);
  await completeWorkshop(db,{...p,entry:cloneEntry});
  await db.query('SELECT public.marcar_t_realizada_rapida($1,$2,$3)',[cloneRecovery.id,cloneRecovery.version,'quick_C12_current_clone']);
  await db.query("UPDATE public.registros_hotel SET observaciones='Nota sobre copia histórica activa aquel día' WHERE id=$1",[p.destination.id]);
  const recovered=await inventory(db,p);
  assert.equal(recovered.summary.find(x=>x.seguimiento_id===p.destination.seguimiento_id).propietario_sustitucion_seguimiento_id,null);
  assert.equal(recovered.reserve.estado,'libre');
  assert.equal(recovered.pa.find(x=>x.id===p.destination.id).estado,p.destination.estado);
  r.checks={logical_rows:2,physical_rows:4,links:1,replay_owner_clone:clones[1],archived_note_after_recovery_allowed:true};
});

scenario('C13', 'migration rejects function and view-security drift and destroys its temporary databases', async (db, r) => {
  const databases=[];
  for (const mode of ['function','view']) {
    await assert.rejects(()=>createContinuityFixture({prefix:`drift_${mode}`,beforeMigrations:async client=>{
      databases.push((await one(client,'SELECT current_database() AS value')).value);
      if(mode==='view')await client.query('ALTER VIEW public.hotel_actual SET(security_invoker=false)');
      else{
        const definition=(await one(client,"SELECT pg_get_functiondef('app_private.proteger_sustitucion_paradas002()'::regprocedure) AS value")).value;
        await client.query(definition.replace('BEGIN','BEGIN\n -- synthetic preflight drift'));
      }
    }}),e=>e.code==='55000'&&/CONTINUIDAD-001: deriva de/.test(e.message));
  }
  assert.equal((await one(db,'SELECT count(*)::int AS n FROM pg_database WHERE datname=ANY($1::text[])',[databases])).n,0);
  r.checks={function_drift_rejected:true,view_security_drift_rejected:true,temporary_databases_dropped:true};
});
