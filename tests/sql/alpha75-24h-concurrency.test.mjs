import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createLocalFixture, one, beginReadCommitted, observeAdvisoryWait,
  snapshotProtectedFacts, FIXTURE_ACTOR,
} from './local-postgres-harness.mjs';

const report = { suite: 'MG75-24H-PARADAS-SEPARADAS-002 native concurrency', started_at: new Date().toISOString(), cases: [] };
let fixture;
before(async () => {
  fixture = await createLocalFixture({ prefix: 'concurrency' });
  report.environment = fixture.metadata;
});
after(async () => {
  let finalFailure;
  try {
    if (fixture) {
      assert.deepEqual(await snapshotProtectedFacts(fixture.observer), fixture.protectedBefore);
      report.protected_history_and_barriers_unchanged = true;
    }
  } catch (error) {
    finalFailure = error;
    report.suite_error = { code: error.code, message: error.message };
  } finally {
    try {
      if (fixture) {
        await fixture.destroy();
        report.temporary_database_dropped = true;
      }
    } catch (error) {
      finalFailure ||= error;
      report.cleanup_error = { code: error.code, message: error.message };
    }
    report.finished_at = new Date().toISOString();
    report.passed = !finalFailure && report.protected_history_and_barriers_unchanged === true
      && report.temporary_database_dropped === true
      && report.cases.length === 6 && report.cases.every(item => item.status === 'passed');
    if (process.env.METROGESTION_CONCURRENCY_REPORT) {
      const filename = path.resolve(process.env.METROGESTION_CONCURRENCY_REPORT);
      assert.equal(path.extname(filename), '.json', 'Concurrency report must be a JSON file');
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  if (finalFailure) throw finalFailure;
});

const payload = dfm => ({
  dfm, averia: 'Avería sintética para carrera nativa', resultado: 'seguimiento_abierto',
  estado_seguimiento: 'en_curso', fecha_activacion: '2026-10-20', hora_activacion: '10:00',
});
async function save(client, data, request) {
  return (await one(client, 'SELECT public.guardar_activacion_24h(NULL,$1::jsonb,$2) AS value', [JSON.stringify(data), request])).value;
}
async function workshop(client, dfm, request, extra = {}) {
  return (await one(client, 'SELECT app_private.crear_ficha_hotel($1::jsonb,$2) AS value', [JSON.stringify({
    vehiculo_sustituido: dfm, estado: 'pendiente_taller', tipo_movimiento: 'TALLER', fecha_parada: '2026-10-21', ...extra,
  }), request])).value;
}
async function addReserve(code, registration) {
  await fixture.observer.query(`INSERT INTO public.vehiculos_hotel_autocompletar(dfm,matricula,tipo_sustituto_catalogo,etiqueta_reserva)
    VALUES($1,$2,'RESERVA','Reserva sintética de concurrencia')`, [code, registration]);
  await fixture.observer.query("INSERT INTO public.reservas_hotel(vehiculo_codigo,matricula,estado) VALUES($1,$2,'libre')", [code, registration]);
}
async function inventory(dfms, requests = []) {
  return (await one(fixture.observer, `SELECT jsonb_build_object(
    'activaciones',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.activaciones_24h a WHERE a.dfm=ANY($1::text[])),
    'pa',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.registros_hotel r WHERE r.vehiculo_sustituido=ANY($1::text[])),
    't',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.etapas_hotel e
      JOIN public.registros_hotel r ON r.id=e.registro_hotel_id WHERE r.vehiculo_sustituido=ANY($1::text[])),
    'peticiones',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.actor_id,k.request_id),'[]')
      FROM app_private.activacion_24h_peticion_paradas002 k WHERE k.request_id=ANY($2::text[]))
  ) AS value`, [dfms, requests])).value;
}
async function assignments(code) {
  return (await fixture.observer.query(`SELECT r.id,r.seguimiento_id,r.numero_parada,r.vehiculo_sustituido,
    r.vehiculo_reserva,r.matricula_reserva,r.tipo_movimiento
    FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
    WHERE p.estado='en_curso' AND NOT r.cancelado AND NOT r.retirado_hotel_activo
      AND r.estado NOT IN ('recuperado','reserva_liberada','anulado') AND r.vehiculo_reserva=$1 ORDER BY r.id`, [code])).rows;
}
async function assertReserveOccupied(record, code) {
  record.reserve = await one(fixture.observer, 'SELECT vehiculo_codigo,estado,pendientes FROM public.reservas_hotel WHERE vehiculo_codigo=$1', [code]);
  assert.equal(record.reserve?.estado, 'ocupada', 'Committed assignment must keep the reserve occupied');
}
function assertInventory(actual, { activations, cards, stages, requests }) {
  assert.equal(actual.activaciones.length, activations, 'Unexpected activation or orphan');
  assert.equal(actual.pa.length, cards, 'Unexpected PA or orphan');
  assert.equal(actual.t.length, stages, 'Unexpected T or orphan');
  assert.equal(actual.peticiones.length, requests, 'Unexpected idempotency key');
  assert.equal(new Set(actual.pa.map(row => row.seguimiento_id)).size, cards, 'Different PA must have different tracking identities');
  assert.equal(new Set(actual.pa.map(row => row.numero_parada)).size, cards, 'Different PA must have different PA numbers');
}
function assertBusinessError(outcome, code, message) {
  assert.equal(outcome.ok, false, 'The conflicting operation unexpectedly succeeded');
  assert.equal(outcome.error.code, code, `Expected business error, received ${outcome.error.code}: ${outcome.error.message}`);
  assert.match(outcome.error.message, message);
}

/** Both operations run on different real connections. A completes its mutation
 * but keeps its transaction uncommitted. B then starts the conflicting command.
 * Only the observer's proven advisory wait authorizes resolving A.
 */
async function race(record, operationA, operationB, resolution = 'COMMIT') {
  assert.ok(['COMMIT', 'ROLLBACK'].includes(resolution));
  const [a, b] = await Promise.all([fixture.connect(`${record.key}_a`), fixture.connect(`${record.key}_b`)]);
  let aResolved = false;
  let pendingB;
  let bSettled = false;
  let stateB;
  try {
    const stateA = await beginReadCommitted(a);
    stateB = await beginReadCommitted(b);
    const observer = await one(fixture.observer, 'SELECT pg_backend_pid() AS pid,current_database() AS database_name');
    assert.equal(stateA.database_name, fixture.dbName);
    assert.equal(stateB.database_name, fixture.dbName);
    assert.equal(observer.database_name, fixture.dbName);
    assert.equal(new Set([stateA.pid, stateB.pid, observer.pid]).size, 3, 'Workers and observer must be three independent connections');
    assert.equal(stateA.actor, FIXTURE_ACTOR);
    assert.equal(stateB.actor, stateA.actor);
    record.connections = { a: stateA, b: stateB, observer };
    const valueA = await operationA(a);
    record.a_result = valueA;
    pendingB = operationB(b).then(
      value => { bSettled = true; return { ok: true, value }; },
      error => { bSettled = true; return { ok: false, error }; },
    );
    record.wait_proof = await observeAdvisoryWait(fixture.observer, stateA.pid, stateB.pid, { isSettled: () => bSettled });
    assert.equal(bSettled, false, 'B must still be waiting before resolving A');
    await a.query(resolution);
    aResolved = true;
    record.a_resolution = resolution;
    const outcome = await pendingB;
    if (outcome.ok) {
      await b.query('COMMIT');
      record.b_result = outcome.value;
      record.b_resolution = 'COMMIT';
    } else {
      await b.query('ROLLBACK');
      record.b_error = { code: outcome.error.code, message: outcome.error.message };
      record.b_resolution = 'ROLLBACK';
    }
    return { valueA, outcome };
  } finally {
    // Release the blocker first: queuing ROLLBACK on a still-blocked B would
    // wait behind B's pending query and could hide a harness failure.
    if (!aResolved) await a.query('ROLLBACK').catch(() => {});
    if (pendingB && !bSettled && stateB) {
      await fixture.observer.query('SELECT pg_cancel_backend($1)', [stateB.pid]).catch(() => {});
    }
    if (pendingB) await pendingB;
    await b.query('ROLLBACK').catch(() => {});
    await Promise.allSettled([fixture.close(a), fixture.close(b)]);
  }
}

function scenario(key, name, body) {
  test(name, { timeout: 30000 }, async context => {
    const record = { key, name, status: 'running' };
    report.cases.push(record);
    try {
      await body(record);
      assert.deepEqual(await snapshotProtectedFacts(fixture.observer), fixture.protectedBefore, 'Race changed protected history/manual counters or sync barriers');
      record.status = 'passed';
      context.diagnostic(JSON.stringify({ case: key, wait_proof: record.wait_proof, b_resolution: record.b_resolution, b_error: record.b_error }));
    } catch (error) {
      record.status = 'failed';
      record.failure = { code: error.code, message: error.message };
      throw error;
    }
  });
}

scenario('rc1', 'RC1: same actor/request and payload wait, then return one activation and one PA', async record => {
  const dfm = 'RC1-SAME-REQUEST';
  const request = 'native_rc1_same_request';
  const data = payload(dfm);
  const { valueA, outcome } = await race(record, a => save(a, data, request), b => save(b, data, request));
  assert.equal(outcome.ok, true, outcome.error?.message);
  assert.equal(outcome.value.id, valueA.id);
  assert.equal(outcome.value.reutilizada, true);
  assert.equal(outcome.value.version, valueA.version, 'Replay must not change the version');
  record.inventory = await inventory([dfm], [request]);
  assertInventory(record.inventory, { activations: 1, cards: 1, stages: 1, requests: 1 });
  assert.equal(record.inventory.activaciones[0].id, valueA.id);
  assert.equal(record.inventory.peticiones[0].activacion_id, valueA.id);
});

scenario('rc2', 'RC2: same actor/request with a different payload waits, then rejects without a duplicate', async record => {
  const dfm = 'RC2-DIFFERENT-PAYLOAD';
  const request = 'native_rc2_same_request';
  const data = payload(dfm);
  const { valueA, outcome } = await race(record,
    a => save(a, data, request), b => save(b, { ...data, averia: 'Contenido distinto rechazado' }, request));
  assertBusinessError(outcome, 'P0001', /PARADAS-002:.*otros datos/);
  record.inventory = await inventory([dfm], [request]);
  assertInventory(record.inventory, { activations: 1, cards: 1, stages: 1, requests: 1 });
  assert.equal(record.inventory.activaciones[0].id, valueA.id);
  assert.equal(record.inventory.activaciones[0].averia, data.averia);
});

scenario('rc3', 'RC3: a rolled-back first request releases the waiter to create exactly one valid activation', async record => {
  const dfm = 'RC3-ROLLED-BACK-CREATE';
  const request = 'native_rc3_rollback';
  const data = payload(dfm);
  const { valueA, outcome } = await race(record, a => save(a, data, request), b => save(b, data, request), 'ROLLBACK');
  assert.equal(outcome.ok, true, outcome.error?.message);
  assert.notEqual(outcome.value.id, valueA.id);
  assert.notEqual(outcome.value.reutilizada, true);
  record.inventory = await inventory([dfm], [request]);
  assertInventory(record.inventory, { activations: 1, cards: 1, stages: 1, requests: 1 });
  assert.equal(record.inventory.activaciones[0].id, outcome.value.id);
  assert.equal(record.inventory.peticiones[0].activacion_id, outcome.value.id);
  assert.equal((await one(fixture.observer, 'SELECT count(*)::int AS n FROM public.activaciones_24h WHERE id=$1', [valueA.id])).n, 0);
});

scenario('rc4', 'RC4: DFM-only and plate-only competing assignments wait, then prevent a second PA charge', async record => {
  const dfm = 'RC4-SAME-AFFECTED';
  const code = 'R-NATIVE-4';
  const registration = 'NATIVE004';
  const request = 'native_rc4_assistance';
  await addReserve(code, registration);
  const { valueA, outcome } = await race(record,
    a => save(a, { ...payload(dfm), resultado: 'necesita_sustitucion', vehiculo_sustituto: code }, request),
    b => workshop(b, dfm, 'native_rc4_workshop', { matricula_reserva: registration }));
  assertBusinessError(outcome, '23514', /PARADAS-002:.*continúa asignado/);
  record.inventory_after_conflict = await inventory([dfm], [request]);
  assertInventory(record.inventory_after_conflict, { activations: 1, cards: 1, stages: 1, requests: 1 });
  assert.equal(record.inventory_after_conflict.activaciones[0].id, valueA.id);
  assert.equal((await assignments(code)).length, 1);
  // Independent workshop identity remains possible without copying the charge.
  const next = await workshop(fixture.observer, dfm, 'native_rc4_workshop_unassigned');
  record.inventory = await inventory([dfm], [request]);
  assertInventory(record.inventory, { activations: 1, cards: 2, stages: 1, requests: 1 });
  assert.notEqual(next.id, record.inventory.activaciones[0].registro_hotel_id);
  record.assignments = await assignments(code);
  assert.equal(record.assignments.length, 1);
  await assertReserveOccupied(record, code);
});

scenario('rc5', 'RC5: a rolled-back workshop assignment lets the waiting 24H claim the reserve without orphan rows', async record => {
  const dfm = 'RC5-ROLLED-BACK-ASSIGNMENT';
  const code = 'R-NATIVE-5';
  const registration = 'NATIVE005';
  const request = 'native_rc5_assistance';
  await addReserve(code, registration);
  const { valueA, outcome } = await race(record,
    a => workshop(a, dfm, 'native_rc5_workshop', { vehiculo_reserva: code }),
    b => save(b, { ...payload(dfm), resultado: 'necesita_sustitucion', matricula_sustituto: registration }, request),
    'ROLLBACK');
  assert.equal(outcome.ok, true, outcome.error?.message);
  record.inventory = await inventory([dfm], [request]);
  assertInventory(record.inventory, { activations: 1, cards: 1, stages: 1, requests: 1 });
  assert.equal(record.inventory.activaciones[0].id, outcome.value.id);
  assert.equal((await one(fixture.observer, 'SELECT count(*)::int AS n FROM public.registros_hotel WHERE id=$1', [valueA.id])).n, 0);
  record.assignments = await assignments(code);
  assert.equal(record.assignments.length, 1);
  assert.equal(record.assignments[0].id, record.inventory.activaciones[0].registro_hotel_id);
  await assertReserveOccupied(record, code);
});

scenario('rc6', 'RC6: reactivating an unchanged old assignment waits and rejects a concurrent active 24H claim', async record => {
  const dfmA = 'RC6-NEW-ASSISTANCE';
  const dfmB = 'RC6-DORMANT-WORKSHOP';
  const code = 'R-NATIVE-6';
  const registration = 'NATIVE006';
  const request = 'native_rc6_assistance';
  await addReserve(code, registration);
  const dormant = await workshop(fixture.observer, dfmB, 'native_rc6_dormant', { vehiculo_reserva: code, matricula_reserva: registration });
  await fixture.observer.query('UPDATE public.registros_hotel SET retirado_hotel_activo=true WHERE id=$1', [dormant.id]);
  const dormantBefore = (await one(fixture.observer, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [dormant.id])).value;
  const { outcome } = await race(record,
    a => save(a, { ...payload(dfmA), resultado: 'necesita_sustitucion', vehiculo_sustituto: code, matricula_sustituto: registration }, request),
    async b => (await one(b, 'UPDATE public.registros_hotel SET retirado_hotel_activo=false WHERE id=$1 RETURNING id', [dormant.id])));
  assertBusinessError(outcome, '23514', /PARADAS-002:.*continúa asignado/);
  assert.deepEqual((await one(fixture.observer, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [dormant.id])).value, dormantBefore);
  record.inventory = await inventory([dfmA, dfmB], [request]);
  assertInventory(record.inventory, { activations: 1, cards: 2, stages: 1, requests: 1 });
  record.assignments = await assignments(code);
  assert.equal(record.assignments.length, 1);
  assert.equal(record.assignments[0].vehiculo_sustituido, dfmA);
  await assertReserveOccupied(record, code);
});
