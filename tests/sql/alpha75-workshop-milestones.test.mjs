import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkshopFixture, seedWorkshopScenario, markWorkshopMilestone,
  workshopInventory, currentStage,
} from './workshop-scenarios.mjs';
import { FIXTURE_ACTOR, one } from './local-postgres-harness.mjs';
import { normalizeStageType } from '../../r1-alpha75/src/workshop-milestones.js';

let fixture, db;
before(async () => { fixture = await createWorkshopFixture(); db = fixture.admin; });
after(async () => { await fixture?.destroy(); });

async function unchangedRejection(p, operation, message) {
  const before = await workshopInventory(db, p.id);
  await assert.rejects(operation, message);
  assert.deepEqual(await workshopInventory(db, p.id), before, 'A rejected confirmation must leave every stored fact intact');
}

async function serverTimed(p, hito) {
  const lower = (await one(db, 'SELECT clock_timestamp()::text AS value')).value;
  const result = await markWorkshopMilestone(db, p, hito);
  const upper = (await one(db, 'SELECT clock_timestamp()::text AS value')).value;
  const field = { entrada: 'fecha_inicio_real', terminado: 'fecha_fin_real', recogido: 'fecha_real' }[hito];
  assert.equal(result.ok, true);
  assert.equal(result.hito, hito);
  const actual = new Date(result.etapa[field]);
  assert.ok(actual >= new Date(lower) && actual <= new Date(upper), `${hito} must use server time from this RPC`);
  assert.equal(result.etapa.marcado_rapido, false);
  assert.equal(result.etapa.datos_pendientes, false);
  return result;
}

test('context and frontend agree on catalogue aliases; reading does not mutate facts', async () => {
  const p = await seedWorkshopScenario(db, { tag: 'CONTEXT' });
  const before = await workshopInventory(db, p.id);
  const contexts = (await one(db, 'SELECT public.obtener_contexto_taller_t_alpha75($1::uuid[]) AS value',
    [[p.entry.id, p.recovery.id]])).value;
  assert.deepEqual(contexts.map(e => e.id), [p.entry.id, p.recovery.id]);
  assert.equal(contexts[0].tipo_etapa, 'ENTRADA TALLER');
  assert.equal(contexts[0].modelo_flujo_taller, 'entrada_hitos_v1');
  assert.equal(contexts[0].es_entrada_taller, true);
  assert.equal(contexts[1].es_entrada_taller, false);
  for (const type of ['entrada_taller', 'ENTRADA TALLER', 'Entrada en taller', 'entrada_a_taller', '  entrada__en taller  ', 'otro', 'recogida_taller', 'tramite', '']) {
    const sql = await one(db, 'SELECT app_private.es_tipo_entrada_taller_alpha75($1) AS value', [type]);
    assert.equal(sql.value, normalizeStageType(type) === 'entrada_taller', type);
  }
  assert.deepEqual(await workshopInventory(db, p.id), before);
});

test('three confirmations preserve dates, documents and next T; only separate recovery releases the reserve', async () => {
  const p = await seedWorkshopScenario(db, { tag: 'SEQUENCE' });
  const started = await serverTimed(p, 'entrada');
  assert.equal(started.etapa.estado, 'en_curso');
  assert.equal(started.etapa.fecha_fin_real, null);
  assert.equal(started.etapa.fecha_real, null);
  assert.equal(started.registro_estado, 'en_taller');
  assert.equal(started.siguiente_etapa, null);
  const afterEntry = await workshopInventory(db, p.id);
  assert.equal(afterEntry.ficha.fecha_entrada, started.etapa.fecha_inicio_real);
  assert.equal(afterEntry.propagados[0].fecha_realizada, null);
  assert.equal(afterEntry.propagados[0].fecha_recogida, null);

  const finished = await serverTimed(p, 'terminado');
  assert.equal(finished.etapa.estado, 'en_curso');
  assert.equal(finished.etapa.fecha_inicio_real, started.etapa.fecha_inicio_real);
  assert.equal(finished.etapa.fecha_real, null);
  assert.equal(finished.registro_estado, 'terminado_pendiente_recogida');
  const afterFinish = await workshopInventory(db, p.id);
  assert.equal(afterFinish.ficha.fecha_entrada, finished.etapa.fecha_fin_real);
  const finishDay = (await one(db, "SELECT ($1::timestamptz AT TIME ZONE 'Europe/Madrid')::date::text AS value", [finished.etapa.fecha_fin_real])).value;
  assert.equal(afterFinish.propagados[0].fecha_realizada, finishDay);
  assert.equal(afterFinish.propagados[0].fecha_recogida, null, 'Finishing work must not propagate physical pickup');

  const pickedUp = await serverTimed(p, 'recogido');
  assert.equal(pickedUp.etapa.estado, 'realizada');
  assert.equal(pickedUp.etapa.fecha_inicio_real, started.etapa.fecha_inicio_real);
  assert.equal(pickedUp.etapa.fecha_fin_real, finished.etapa.fecha_fin_real);
  assert.equal(pickedUp.registro_estado, 'recogido_pendiente_ruta');
  assert.equal(pickedUp.siguiente_etapa.id, p.recovery.id);
  assert.equal(pickedUp.siguiente_etapa.estado, 'pendiente');
  const afterPickup = await workshopInventory(db, p.id);
  const pickupDay = (await one(db, "SELECT ($1::timestamptz AT TIME ZONE 'Europe/Madrid')::date::text AS value", [pickedUp.etapa.fecha_real])).value;
  assert.equal(afterPickup.propagados[0].fecha_realizada, finishDay);
  assert.equal(afterPickup.propagados[0].fecha_recogida, pickupDay);
  assert.ok((await one(db, `SELECT count(*)::int AS value FROM app_private.test_workshop_queue
    WHERE seguimiento_id=$1`, [afterPickup.ficha.seguimiento_id])).value > 0, 'Real date trigger reaches the declared local queue recorder');
  for (const inventory of [afterEntry, afterFinish, afterPickup]) {
    assert.deepEqual(inventory.documentos, p.before.documentos);
    assert.deepEqual(inventory.trabajos, p.before.trabajos);
    assert.deepEqual(inventory.etapas.find(e => e.id === p.recovery.id), p.before.etapas.find(e => e.id === p.recovery.id));
    assert.deepEqual(inventory.etapas.map(e => [e.id, e.posicion, e.tipo_etapa, e.grupo_documental_id]),
      p.before.etapas.map(e => [e.id, e.posicion, e.tipo_etapa, e.grupo_documental_id]));
    assert.equal(inventory.reserva.estado, 'ocupada');
    assert.equal(inventory.ficha.vehiculo_reserva, p.reserve);
    assert.equal(inventory.ficha.fecha_parada, p.before.ficha.fecha_parada);
    assert.equal(inventory.ficha.retirado_hotel_activo, false);
  }
  const recovery = await currentStage(db, p.recovery.id);
  const released = (await one(db, 'SELECT public.marcar_t_realizada_rapida($1,$2,$3) AS value',
    [recovery.id, recovery.version, 'fixture_recovery_after_pickup'])).value;
  assert.equal(released.ok, true);
  const afterRecovery = await workshopInventory(db, p.id);
  assert.equal(afterRecovery.reserva.estado, 'libre');
  assert.equal(afterRecovery.ficha.vehiculo_reserva, p.reserve);
  assert.deepEqual(afterRecovery.documentos, p.before.documentos);
  assert.deepEqual(afterRecovery.etapas.find(e => e.id === p.entry.id), afterPickup.etapas.find(e => e.id === p.entry.id));
});

test('an existing precise entry timestamp survives finishing and pickup byte for byte', async () => {
  const p = await seedWorkshopScenario(db, { tag: 'PRECISE', type: 'entrada_taller' });
  await db.query("UPDATE public.etapas_hotel SET estado='en_curso',fecha_inicio_real='2026-11-12T12:55:00.123456Z' WHERE id=$1", [p.entry.id]);
  const original = await currentStage(db, p.entry.id);
  const finished = await markWorkshopMilestone(db, p, 'terminado');
  const pickedUp = await markWorkshopMilestone(db, p, 'recogido');
  assert.equal(finished.etapa.fecha_inicio_real, original.fecha_inicio_real);
  assert.equal(pickedUp.etapa.fecha_inicio_real, original.fecha_inicio_real);
  assert.equal(pickedUp.etapa.fecha_fin_real, finished.etapa.fecha_fin_real);
});

test('next T follows manual order, including a manual task before recovery, and is never executed', async () => {
  const p = await seedWorkshopScenario(db, { tag: 'NEXT' });
  const next = (await one(db, `INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,tipo_etapa)
    VALUES($1,'Trámite sintético antes de Recuperar',20,'tramite') RETURNING id`, [p.id])).id;
  // Generator compaction preserves relative order; place this explicit manual
  // task between the entry and recovery using the same deferrable constraint.
  await db.query('BEGIN');
  try {
    await db.query('SET CONSTRAINTS etapas_hotel_posicion_activa_uq DEFERRED');
    await db.query('UPDATE public.etapas_hotel SET posicion=2 WHERE id=$1', [next]);
    await db.query('UPDATE public.etapas_hotel SET posicion=3 WHERE id=$1', [p.recovery.id]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  const otherBefore = await currentStage(db, next);
  await markWorkshopMilestone(db, p, 'entrada');
  await markWorkshopMilestone(db, p, 'terminado');
  const result = await markWorkshopMilestone(db, p, 'recogido');
  assert.equal(result.siguiente_etapa.id, next);
  assert.equal(result.registro_estado, 'tramite');
  assert.deepEqual(await currentStage(db, next), otherBefore);
  assert.equal((await currentStage(db, p.recovery.id)).estado, 'pendiente');
});

test('wrong milestone, stale version and the generic quick route cannot skip workshop facts', async () => {
  const p = await seedWorkshopScenario(db, { tag: 'GUARDS' });
  await unchangedRejection(p, () => markWorkshopMilestone(db, p, 'terminado'), /siguiente hito pendiente.*Entrada/);
  await unchangedRejection(p, () => markWorkshopMilestone(db, p, 'recogido'), /siguiente hito pendiente.*Entrada/);
  await unchangedRejection(p, () => markWorkshopMilestone(db, p, 'entrada', { version: 0 }), /ha cambiado/);
  await unchangedRejection(p, async () => {
    const stage = await currentStage(db, p.entry.id);
    return db.query('SELECT public.marcar_t_realizada_rapida($1,$2,$3)', [stage.id, stage.version, 'fixture_forbidden_generic']);
  }, /por hitos/);
  await markWorkshopMilestone(db, p, 'entrada');
  await unchangedRejection(p, () => markWorkshopMilestone(db, p, 'entrada'), /siguiente hito pendiente.*Terminado/);
});

test('partial, inverted, future and already realized facts are rejected without guessing missing dates', async () => {
  for (const [tag, assignment, message] of [
    ['NO_START', "fecha_fin_real='2026-11-12T15:00Z'", /incompletos/],
    ['INVERTED', "fecha_inicio_real='2026-11-12T15:00Z',fecha_fin_real='2026-11-12T14:00Z'", /fuera de orden/],
    ['FUTURE', "fecha_inicio_real=clock_timestamp()+interval '1 hour'", /futura/],
    ['NO_PICKUP', "estado='realizada',fecha_inicio_real='2026-11-12T13:00Z',fecha_fin_real='2026-11-12T14:00Z'", /realizada sin una recogida/],
  ]) {
    const p = await seedWorkshopScenario(db, { tag });
    // These test-only literals construct pre-existing invalid rows. The new
    // RPC must refuse to silently repair them or add another current timestamp.
    await db.query(`UPDATE public.etapas_hotel SET ${assignment} WHERE id=$1`, [p.entry.id]);
    await unchangedRejection(p, () => markWorkshopMilestone(db, p, 'terminado'), message);
  }
});

test('authorization, legacy, cancelled and archived rows cannot be advanced by the new RPC', async () => {
  const p = await seedWorkshopScenario(db, { tag: 'AUTH' });
  for (const [key, denied] of [['test.actor', ''], ['test.device_allowed', 'false'], ['test.primary_admin', 'false']]) {
    await db.query('SELECT set_config($1,$2,false)', [key, denied]);
    try {
      await unchangedRejection(p, () => markWorkshopMilestone(db, p, 'entrada'), /administrador principal/);
    } finally { await db.query('SELECT set_config($1,$2,false)', [key, key === 'test.actor' ? FIXTURE_ACTOR : 'true']); }
  }
  const legacy = await seedWorkshopScenario(db, { tag: 'LEGACY', model: 'legacy' });
  await unchangedRejection(legacy, () => markWorkshopMilestone(db, legacy, 'entrada'), /flujo por hitos/);
  const cancelled = await seedWorkshopScenario(db, { tag: 'CANCELLED' });
  await db.query("UPDATE public.etapas_hotel SET cancelado=true,motivo_cancelacion='Anulación sintética' WHERE id=$1", [cancelled.entry.id]);
  await unchangedRejection(cancelled, () => markWorkshopMilestone(db, cancelled, 'entrada'), /anulada/);
  const archived = await seedWorkshopScenario(db, { tag: 'ARCHIVED' });
  await db.query("UPDATE public.registros_hotel SET pizarra_id='00000000-0000-4000-8000-000000000011' WHERE id=$1", [archived.id]);
  await unchangedRejection(archived, () => markWorkshopMilestone(db, archived, 'entrada'), /Pizarra actual/);
});

test('public wrappers expose only the intended RPCs and anonymous execution stays denied', async () => {
  const acl = await one(db, `SELECT
    has_function_privilege('authenticated','public.registrar_hito_taller_alpha75(uuid,integer,text,text)','execute') AS allowed_write,
    has_function_privilege('authenticated','public.obtener_contexto_taller_t_alpha75(uuid[])','execute') AS allowed_read,
    has_function_privilege('anon','public.registrar_hito_taller_alpha75(uuid,integer,text,text)','execute') AS anonymous_write,
    has_function_privilege('anon','public.obtener_contexto_taller_t_alpha75(uuid[])','execute') AS anonymous_read,
    has_function_privilege('authenticated','app_private.contexto_etapa_taller_alpha75(uuid)','execute') AS raw_serializer`);
  assert.deepEqual(acl, { allowed_write: true, allowed_read: true, anonymous_write: false, anonymous_read: false, raw_serializer: false });
});
