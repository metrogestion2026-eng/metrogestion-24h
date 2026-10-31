import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  one, snapshotProtectedFacts, beginReadCommitted, FIXTURE_ACTOR,
} from './local-postgres-harness.mjs';
import {
  seedRecoveryScenario, recoveryInventory, markRecovery,
} from './recovery-scenarios.mjs';
import { createContinuityFixture } from './continuity-scenarios.mjs';

const report = {
  suite: 'MG75-24H-PARADAS-SEPARADAS-002 explicit recovery on native PostgreSQL',
  started_at: new Date().toISOString(), cases: [],
};
let fixture;
before(async () => {
  fixture = await createContinuityFixture({ prefix: 'recovery' });
  report.environment = {
    ...fixture.metadata,
    scope: 'Synthetic explicit recovery; real public RPC, committed PostgreSQL transactions and independent readback',
  };
  report.runtime_functions = (await fixture.admin.query(`SELECT signature,definition_md5,security_definer,configuration,source_owner
    FROM app_private.test_recovery_function_manifest ORDER BY signature`)).rows;
  report.runtime_fixture_loaded = true;
  assert.deepEqual(await snapshotProtectedFacts(fixture.admin), fixture.protectedBefore);
});
after(async () => {
  let failure;
  try {
    if (fixture) {
      assert.deepEqual(await snapshotProtectedFacts(fixture.admin), fixture.protectedBefore);
      report.protected_history_and_barriers_unchanged = true;
    }
  } catch (error) {
    failure = error;
    report.suite_error = { code: error.code, message: error.message };
  } finally {
    try {
      if (fixture) {
        await fixture.destroy();
        report.temporary_database_dropped = true;
      }
    } catch (error) {
      failure ||= error;
      report.cleanup_error = { code: error.code, message: error.message };
    }
    report.finished_at = new Date().toISOString();
    report.passed = !failure && report.runtime_fixture_loaded === true
      && report.protected_history_and_barriers_unchanged === true
      && report.temporary_database_dropped === true
      && report.cases.length === 5 && report.cases.every(item => item.status === 'passed');
    if (process.env.METROGESTION_RECOVERY_REPORT) {
      const filename = path.resolve(process.env.METROGESTION_RECOVERY_REPORT);
      assert.equal(path.extname(filename), '.json', 'Recovery report must be a JSON file');
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  if (failure) throw failure;
});

function omit(object, fields) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !fields.includes(key)));
}

function caseTest(key, description, body) {
  test(description, { timeout: 30000 }, async context => {
    const record = { key, description, status: 'running' };
    report.cases.push(record);
    const worker = await fixture.connect(key);
    try {
      record.connection = await one(worker, `SELECT pg_backend_pid() AS pid,auth.uid()::text AS actor,
        current_database() AS database_name,current_setting('transaction_isolation') AS isolation`);
      const observer = await one(fixture.admin, 'SELECT pg_backend_pid() AS pid,current_database() AS database_name');
      assert.notEqual(record.connection.pid, observer.pid);
      assert.equal(record.connection.database_name, fixture.dbName);
      assert.equal(observer.database_name, fixture.dbName);
      assert.equal(record.connection.actor, FIXTURE_ACTOR);
      record.observer = observer;
      await body(record, worker);
      assert.deepEqual(await snapshotProtectedFacts(fixture.admin), fixture.protectedBefore);
      record.status = 'passed';
      context.diagnostic(JSON.stringify({ case: key, committed: record.committed,
        recovery_state: record.after?.pa.find(row => row.id === record.target_id)?.estado,
        reserve_state: record.after?.reserva.estado, rejection_codes: record.rejections?.map(row => row.code) }));
    } catch (error) {
      record.status = 'failed';
      record.failure = { code: error.code, message: error.message };
      throw error;
    } finally {
      await worker.query('ROLLBACK').catch(() => {});
      try {
        await fixture.close(worker);
      } catch (error) {
        record.status = 'failed';
        record.cleanup_error = { code: error.code, message: error.message };
        throw error;
      }
    }
  });
}

async function committedRecovery(record, worker, scenario, options = {}) {
  record.target_id = scenario.targetId;
  record.before = await recoveryInventory(fixture.admin, scenario.dfm, scenario.reserve);
  record.server_time_before = (await one(fixture.admin, 'SELECT clock_timestamp()::text AS value')).value;
  await beginReadCommitted(worker);
  try {
    record.result = await markRecovery(worker, scenario, options);
    // This COMMIT runs the deferred coherence constraints. The observer reads
    // only after it succeeds, so a rolled-back result can never count as passed.
    await worker.query('COMMIT');
    record.committed = true;
  } catch (error) {
    await worker.query('ROLLBACK');
    throw error;
  }
  record.server_time_after = (await one(fixture.admin, 'SELECT clock_timestamp()::text AS value')).value;
  record.after = await recoveryInventory(fixture.admin, scenario.dfm, scenario.reserve);
  record.time_evidence = await one(fixture.admin, `SELECT
    e.fecha_real >= $2::timestamptz AND e.fecha_real <= $3::timestamptz AS server_time_in_bounds,
    e.fecha_real=e.fecha_fin_real AND e.fecha_real=e.marcado_rapido_en AS same_recorded_instant,
    r.fecha_retirado_hotel >= $2::timestamptz AND r.fecha_retirado_hotel <= $3::timestamptz AS withdrawal_in_bounds
    FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id WHERE e.id=$1`,
  [scenario.recovery.id, record.server_time_before, record.server_time_after]);
  assert.deepEqual(record.time_evidence, {
    server_time_in_bounds: true, same_recorded_instant: true, withdrawal_in_bounds: true,
  });
}

function assertRecoveryEffect(record, scenario, { expectedReserve = 'libre' } = {}) {
  const { before, after, result } = record;
  assert.equal(result.ok, true);
  assert.equal(result.registro_estado, 'recuperado');
  assert.equal(result.efecto, 'T realizada; ruta recuperada y sustituto liberado');
  assert.equal(result.datos_pendientes, true);
  assert.deepEqual(after.activaciones, before.activaciones, 'Recovery must not change the open assistance, its facts or links');
  assert.equal(after.activaciones[0].estado, 'abierta');
  assert.equal(after.activaciones[0].estado_seguimiento, 'en_curso');
  assert.equal(after.activaciones[0].fecha_fin_reparacion, null);
  assert.equal(after.activaciones[0].hora_fin_reparacion, null);
  assert.deepEqual(after.peticiones, before.peticiones, 'Recovery must not re-key or replace an assistance identity');
  assert.deepEqual(after.trabajos, before.trabajos);
  assert.deepEqual(after.sync, before.sync, 'The test fixture must not invent a billing cutoff or rewrite its manual rows');
  assert.equal(after.pa.length, before.pa.length);
  assert.equal(after.t.length, before.t.length, 'Explicit recovery must neither create nor remove another T');
  assert.equal(new Set(after.pa.map(row => row.seguimiento_id)).size, after.pa.length);
  assert.equal(new Set(after.pa.map(row => row.numero_parada)).size, after.pa.length);
  const oldCard = before.pa.find(row => row.id === scenario.targetId);
  const card = after.pa.find(row => row.id === scenario.targetId);
  assert.equal(card.estado, 'recuperado');
  assert.equal(card.retirado_hotel_activo, true);
  assert.equal(card.version, oldCard.version + 1);
  assert.equal(card.vehiculo_reserva, scenario.reserve, 'The actual release helper keeps the PA historical replacement fields');
  assert.equal(card.matricula_reserva, scenario.registration);
  const cardFields = ['estado', 'retirado_hotel_activo', 'fecha_retirado_hotel', 'version', 'actualizado_en', 'modificado_por'];
  assert.deepEqual(omit(card, cardFields), omit(oldCard, cardFields), 'PA identity and unrelated/manual fields must remain unchanged');
  assert.deepEqual(after.pa.filter(row => row.id !== scenario.targetId), before.pa.filter(row => row.id !== scenario.targetId),
    'Another PA for the same DFM must remain exactly unchanged');
  assert.deepEqual(after.t.filter(row => row.id !== scenario.recovery.id), before.t.filter(row => row.id !== scenario.recovery.id),
    'All non-recovery T, including the open 24H and pending manual task, must remain unchanged');
  const stage = after.t.find(row => row.id === scenario.recovery.id);
  assert.deepEqual(result.etapa, stage, 'The RPC reply must agree with committed PostgreSQL data');
  assert.equal(stage.estado, 'realizada');
  assert.equal(stage.estado_catalogo_codigo, 'realizada');
  assert.equal(stage.marcado_rapido, true);
  assert.equal(stage.marcado_rapido_por, FIXTURE_ACTOR);
  assert.equal(stage.datos_pendientes, true);
  assert.equal(stage.estado_registro_antes_realizar, oldCard.estado);
  assert.equal(stage.retirado_hotel_antes_realizar, oldCard.retirado_hotel_activo);
  assert.equal(stage.fecha_retirado_hotel_antes_realizar, oldCard.fecha_retirado_hotel);
  const oldStage = before.t.find(row => row.id === scenario.recovery.id);
  assert.equal(stage.version, oldStage.version + 1);
  const stageFields = ['estado', 'estado_catalogo_codigo', 'fecha_fin_real', 'fecha_real', 'marcado_rapido',
    'marcado_rapido_en', 'marcado_rapido_por', 'datos_pendientes', 'datos_completados_en', 'datos_completados_por',
    'modificado_por', 'actualizado_en', 'version', 'estado_registro_antes_realizar',
    'retirado_hotel_antes_realizar', 'fecha_retirado_hotel_antes_realizar'];
  assert.deepEqual(omit(stage, stageFields), omit(oldStage, stageFields));
  assert.equal(after.reserva.estado, expectedReserve);
  assert.deepEqual(omit(after.reserva, ['estado', 'modificado_por']), omit(before.reserva, ['estado', 'modificado_por']));
}

async function atomicRejection(record, worker, scenario, { code, message, settings = [], ...options }) {
  const before = await recoveryInventory(fixture.admin, scenario.dfm, scenario.reserve);
  let error;
  await worker.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    for (const [key, value] of settings) await worker.query('SELECT set_config($1,$2,true)', [key, value]);
    await markRecovery(worker, scenario, options);
    await worker.query('COMMIT');
  } catch (caught) {
    error = caught;
    await worker.query('ROLLBACK');
  }
  assert.ok(error, 'The recovery operation unexpectedly succeeded');
  assert.equal(error.code, code);
  assert.match(error.message, message);
  (record.rejections ||= []).push({ code: error.code, message: error.message, settings: settings.map(([key]) => key) });
  assert.deepEqual(await recoveryInventory(fixture.admin, scenario.dfm, scenario.reserve), before,
    'Rejected recovery must leave assistance, PA, T, reserve and request rows untouched');
}

caseTest('rec1', 'REC1: recovering an independent workshop PA preserves the open 24H, all other T and identities', async (record, worker) => {
  const scenario = await seedRecoveryScenario(fixture.admin, { tag: 'NATIVE-PAIR' });
  assert.equal(scenario.before.pa.length, 2);
  assert.notEqual(scenario.activation.registro_hotel_id, scenario.targetId);
  assert.equal(scenario.before.t.length, 3);
  await committedRecovery(record, worker, scenario);
  assertRecoveryEffect(record, scenario);
});

caseTest('rec2', 'REC2: explicit applicable recovery within a 24H PA keeps its assistance open and reserve pending work', async (record, worker) => {
  const scenario = await seedRecoveryScenario(fixture.admin, { tag: 'NATIVE-SAMEPA', samePa: true, pendingReserve: 'MCD + ITV' });
  record.modality_precondition = 'Explicit synthetic manual/legacy blank modality; not the new-assistance default';
  assert.equal(scenario.before.pa.length, 1);
  assert.equal(scenario.activation.registro_hotel_id, scenario.targetId);
  await committedRecovery(record, worker, scenario);
  assertRecoveryEffect(record, scenario, { expectedReserve: 'disponible_con_pendientes' });
  assert.equal(record.after.reserva.pendientes, 'MCD + ITV');
});

caseTest('rec3', 'REC3: stale versions and repeated confirmation reject atomically without rewriting recovery time', async (record, worker) => {
  const scenario = await seedRecoveryScenario(fixture.admin, { tag: 'NATIVE-VERSION' });
  await fixture.admin.query("UPDATE public.etapas_hotel SET observaciones='Cambio manual posterior a cargar el botón' WHERE id=$1", [scenario.recovery.id]);
  await atomicRejection(record, worker, scenario, { code: 'P0001', message: /La T ha cambiado desde que se cargó/ });
  const fresh = await one(fixture.admin, 'SELECT version FROM public.etapas_hotel WHERE id=$1', [scenario.recovery.id]);
  await committedRecovery(record, worker, scenario, { version: fresh.version });
  assertRecoveryEffect(record, scenario);
  await atomicRejection(record, worker, scenario, { version: fresh.version, code: 'P0001', message: /La T ha cambiado desde que se cargó/ });
  await atomicRejection(record, worker, scenario, { version: record.result.etapa.version, code: 'P0001', message: /ya está marcada como realizada/ });
  assert.deepEqual(await recoveryInventory(fixture.admin, scenario.dfm, scenario.reserve), record.after);
});

caseTest('rec4', 'REC4: missing actor, unauthorized device and non-primary admin reject the actual RPC without effects', async (record, worker) => {
  const scenario = await seedRecoveryScenario(fixture.admin, { tag: 'NATIVE-AUTH' });
  record.auth_boundary = 'Controllable synthetic auth/device/admin helpers; real RPC permission branch, not JWT/RLS certification';
  for (const settings of [[['test.actor', '']], [['test.device_allowed', 'false']], [['test.primary_admin', 'false']]]) {
    await atomicRejection(record, worker, scenario, {
      settings, code: 'P0001', message: /Solo el administrador principal puede marcar rápidamente/,
    });
  }
  const privileges = await one(fixture.admin, `SELECT
    has_function_privilege('authenticated','public.marcar_t_realizada_rapida(uuid,integer,text)','execute') AS authenticated_rpc,
    has_function_privilege('anon','public.marcar_t_realizada_rapida(uuid,integer,text)','execute') AS anonymous_rpc,
    has_function_privilege('authenticated','app_private.marcar_t_realizada_rapida(uuid,integer,text)','execute') AS authenticated_core,
    has_function_privilege('anon','app_private.marcar_t_realizada_rapida(uuid,integer,text)','execute') AS anonymous_core`);
  assert.deepEqual(privileges, { authenticated_rpc: true, anonymous_rpc: false, authenticated_core: true, anonymous_core: false });
  record.privileges = privileges;
  record.after = await recoveryInventory(fixture.admin, scenario.dfm, scenario.reserve);
  assert.equal(record.after.reserva.estado, 'ocupada');
});

caseTest('rec5', 'REC5: a preserved manual recovery T cannot be completed when the current modality makes it inapplicable', async (record, worker) => {
  const scenario = await seedRecoveryScenario(fixture.admin, { tag: 'NATIVE-MODALITY' });
  // The pending T is a manual fact. Changing to a no-recovery modality does
  // not authorize completing, deleting or automatically annulling that fact.
  await fixture.admin.query("UPDATE public.registros_hotel SET modalidad_operativa='reserva_en_reparacion' WHERE id=$1", [scenario.targetId]);
  assert.equal((await one(fixture.admin, 'SELECT app_private.modalidad_hotel_requiere_recuperacion($1) AS value', [scenario.targetId])).value, false);
  await atomicRejection(record, worker, scenario, { code: '23514', message: /REC-001: esta ficha no requiere recuperación/ });
  record.after = await recoveryInventory(fixture.admin, scenario.dfm, scenario.reserve);
  assert.equal(record.after.reserva.estado, 'ocupada');
  assert.equal(record.after.t.find(row => row.id === scenario.recovery.id).estado, 'pendiente');
  assert.equal(record.after.t.find(row => row.id === scenario.recovery.id).observaciones, scenario.recovery.observaciones);
});
