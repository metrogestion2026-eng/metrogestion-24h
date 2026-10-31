import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContinuityFixture } from './continuity-scenarios.mjs';
import { one, snapshotProtectedFacts, beginReadCommitted, observeAdvisoryWait, FIXTURE_BOARD } from './local-postgres-harness.mjs';
import {
  SYNTHETIC_SYNC_TOKEN, LEGACY_PENDING, LEGACY_CONSUMED, syncFlags, seedLegacySync, syncQueue,
  seedSyncTracking, receiveSync, acknowledgement, acknowledgeSync, validateSync,
  seedSyncContinuityPair, previewSyncContinuity, confirmSyncContinuity, assertRejected,
} from './continuity-sync-scenarios.mjs';

const report = { suite: 'MG75 continuity targeted MANTENIMENT boundary', started_at: new Date().toISOString(), cases: [] };
let fixture, initialFlags, initialQueue, protectedHistory, legacyWithoutOutbox;

before(async () => {
  fixture = await createContinuityFixture({ prefix: 'cont_sync', beforeMigrations: async client => {
    await seedLegacySync(client);
    legacyWithoutOutbox = await seedSyncTracking(client, 'LEGACY-NONE', { enqueue: false });
    initialFlags = await syncFlags(client);
    initialQueue = await syncQueue(client);
  } });
  report.environment = { ...fixture.metadata,
    scope: 'Synthetic native PostgreSQL only; real public sync/ACK wrappers and both candidate migrations. No HTTP, Apps Script or external sheet is executed.' };
  assert.deepEqual(await syncFlags(fixture.admin), initialFlags, 'Installation must preserve all sync flags and token metadata');
  assert.deepEqual(await syncQueue(fixture.admin), initialQueue, 'Installation must preserve existing outbox rows verbatim');
  protectedHistory = await snapshotProtectedFacts(fixture.admin);
  report.installation_preserved_flags_and_queue = true;
});

after(async () => {
  let failure;
  try {
    if (fixture) {
      assert.deepEqual(await syncFlags(fixture.admin), initialFlags);
      assert.deepEqual(await snapshotProtectedFacts(fixture.admin), protectedHistory);
      report.protected_history_and_flags_unchanged = true;
    }
  } catch (error) { failure = error; report.final_error = { code: error.code, message: error.message }; }
  finally {
    try { if (fixture) { await fixture.destroy(); report.temporary_database_dropped = true; } }
    catch (error) { failure ||= error; report.cleanup_error = { code: error.code, message: error.message }; }
    report.finished_at = new Date().toISOString();
    report.passed = !failure && report.installation_preserved_flags_and_queue === true
      && report.protected_history_and_flags_unchanged === true && report.temporary_database_dropped === true
      && report.cases.length === 13 && report.cases.every(item => item.status === 'passed');
    if (process.env.METROGESTION_CONTINUITY_SYNC_REPORT) {
      const target = path.resolve(process.env.METROGESTION_CONTINUITY_SYNC_REPORT);
      assert.equal(path.extname(target), '.json');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  if (failure) throw failure;
});

async function setFixtureFlags(client, values) {
  await client.query(`UPDATE app_private.manteniment_sync_config SET
    pausa_importacion_identidad=$1,solo_lectura_manual_protegida=$2,escritura_segura_manual=$3 WHERE id=1`,
  [values.pausa_importacion_identidad, values.solo_lectura_manual_protegida, values.escritura_segura_manual]);
}

function scenario(key, title, body, { enabled = true } = {}) {
  test(title, { timeout: 45000 }, async () => {
    const record = { key, title, status: 'running' }; report.cases.push(record);
    const worker = await fixture.connect(key);
    try {
      if (enabled) await setFixtureFlags(worker, {
        pausa_importacion_identidad: false, solo_lectura_manual_protegida: false, escritura_segura_manual: false,
      });
      const flags = await syncFlags(worker);
      await body(record, worker);
      assert.deepEqual(await syncFlags(worker), flags, 'The operations must not toggle any sync barrier');
      assert.deepEqual(await snapshotProtectedFacts(fixture.admin), protectedHistory, 'Unrelated historical facts must remain exact');
      record.status = 'passed';
    } catch (error) { record.status = 'failed'; record.error = { code: error.code, message: error.message }; throw error; }
    finally {
      await worker.query('ROLLBACK').catch(() => {});
      await setFixtureFlags(fixture.admin, initialFlags);
      await fixture.close(worker);
    }
  });
}

async function delivery(client, tracking) {
  const result = await receiveSync(client);
  const cmd = result.comandos_manteniment.find(row => row.payload.seguimiento_id === tracking);
  assert.ok(cmd, `A synthetic unlinked pending command for ${tracking} must be delivered`);
  return cmd;
}

async function journal(client, tracking) {
  return (await client.query(`SELECT to_jsonb(e) AS value FROM app_private.manteniment_entregas_continuidad_alpha75 e
    WHERE seguimiento_id=$1 ORDER BY revision`, [tracking])).rows.map(row => row.value);
}

scenario('sc1', 'SC1: installation retains queues/flags and preflight verifies the reviewed receiver with private ACLs', async record => {
  const result = (await one(fixture.admin, 'SELECT app_private.manteniment_preflight_solo_lectura($1,$2::jsonb) AS value',
    [SYNTHETIC_SYNC_TOKEN, JSON.stringify({ version_script: 'alpha75-2026.10.26.1', version_preflight: 'alpha75-preflight-2026.10.27.1',
      spreadsheet_id: 'SYNTHETIC_SHEET_CONTINUITY_75', escritura_segura_manual: true })])).value;
  assert.equal(result.compatible, true);
  assert.equal(result.receptor_coincide, true);
  assert.equal(result.barreras_cerradas, true);
  assert.equal(result.sincronizacion_autorizada, false);
  record.preflight = result;
  for (const signature of [
    'app_private.validar_sync_continuidad_alpha75(uuid[])',
    'app_private.finalizar_entrega_sync_continuidad_alpha75(jsonb)',
    'app_private.confirmar_entrega_sync_continuidad_alpha75(jsonb)',
  ]) {
    const acl = await one(fixture.admin, `SELECT
      has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') AS service`, [signature]);
    assert.deepEqual(acl, { anon: false, authenticated: false, service: true });
  }
  assert.equal((await one(fixture.admin, 'SELECT count(*)::int AS n FROM app_private.manteniment_entregas_continuidad_alpha75')).n, 0);
}, { enabled: false });

scenario('sc2', 'SC2: old pending or missing queues remain ambiguous; an exact old ACK never silently clears their provenance', async (record, worker) => {
  for (const tracking of [LEGACY_PENDING, legacyWithoutOutbox.tracking]) {
    await assertRejected(validateSync(worker, [tracking]), '55000', /LEGADO_AMBIGUO/);
  }
  const oldCard = (await one(worker, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [legacyWithoutOutbox.id])).value;
  await assertRejected(worker.query('UPDATE public.registros_hotel SET seguimiento_id=gen_random_uuid() WHERE id=$1', [legacyWithoutOutbox.id]),
    '23514', /SEGUIMIENTO_INMUTABLE/);
  assert.deepEqual((await one(fixture.admin, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [legacyWithoutOutbox.id])).value, oldCard);
  await assertRejected(validateSync(worker, [LEGACY_CONSUMED]), '55000', /LEGADO_AMBIGUO/);
  const consumed = (await syncQueue(worker, [LEGACY_CONSUMED]))[0];
  const oldSync = (await one(worker, 'SELECT to_jsonb(s) AS value FROM app_private.manteniment_parada_sync s WHERE seguimiento_id=$1', [LEGACY_CONSUMED])).value;
  assert.equal((await acknowledgeSync(worker, [acknowledgement(consumed, { fila: 41 })])).confirmados, 1);
  assert.deepEqual((await syncQueue(fixture.admin, [LEGACY_CONSUMED]))[0], consumed);
  assert.deepEqual((await one(fixture.admin, 'SELECT to_jsonb(s) AS value FROM app_private.manteniment_parada_sync s WHERE seguimiento_id=$1', [LEGACY_CONSUMED])).value, oldSync);
  await assertRejected(validateSync(worker, [LEGACY_CONSUMED]), '55000', /LEGADO_AMBIGUO/);
  const legacy = (await syncQueue(worker, [LEGACY_PENDING]))[0];
  await worker.query('BEGIN');
  const ack = await acknowledgeSync(worker, [acknowledgement(legacy)]);
  assert.equal(ack.confirmados, 1);
  await assertRejected(validateSync(worker, [LEGACY_PENDING]), '55000', /LEGADO_AMBIGUO/);
  await worker.query('ROLLBACK');
  assert.deepEqual((await syncQueue(fixture.admin, [LEGACY_PENDING]))[0], legacy);
  // Rollover carries a tracking ID; a new physical row or copied timestamp is
  // not evidence that an old tracking ID was born after the barrier.
  const copied = await one(worker, `INSERT INTO public.registros_hotel
    (pizarra_id,seguimiento_id,numero_parada,vehiculo_sustituido,creado_en)
    VALUES($1,$2,'SYNC-ROLLOVER','SYN-LEGACY-NONE','2099-01-01') RETURNING id`,
  [FIXTURE_BOARD, legacyWithoutOutbox.tracking]);
  await assertRejected(validateSync(worker, [legacyWithoutOutbox.tracking]), '55000', /LEGADO_AMBIGUO/);
  record.legacy_consumed_still_blocked = true; record.valid_legacy_ack_replayed = true;
  record.rollover_id = copied.id; record.ambiguous_ids = [LEGACY_PENDING, LEGACY_CONSUMED, legacyWithoutOutbox.tracking];
});

scenario('sc3', 'SC3: trigger-certified new tracking with a copied old timestamp and a never-delivered queue is allowed', async (record, worker) => {
  const row = await seedSyncTracking(worker, 'NEW-UNSENT');
  await worker.query("UPDATE public.registros_hotel SET creado_en='2001-01-01' WHERE id=$1", [row.id]);
  const before = await syncQueue(worker, [row.tracking]);
  await validateSync(worker, [row.tracking]);
  assert.deepEqual(await syncQueue(fixture.admin, [row.tracking]), before, 'Validation is read-only');
  assert.equal((await journal(fixture.admin, row.tracking)).length, 0);
  assert.equal((await one(worker, 'SELECT origen FROM app_private.manteniment_origenes_continuidad_alpha75 WHERE seguimiento_id=$1', [row.tracking])).origen, 'post_barrera');
  record.tracking = row.tracking; record.never_delivered_allowed = true;
});

scenario('sc4', 'SC4: delivery is durable before return; exact ACK works after outbox advancement without confirming the new revision', async (record, worker) => {
  const row = await seedSyncTracking(worker, 'ACK-ADVANCED');
  const cmd = await delivery(worker, row.tracking);
  const delivered = await journal(fixture.admin, row.tracking);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].payload_sha256, cmd.payload_sha256);
  assert.ok(delivered[0].entregado_en);
  assert.equal(delivered[0].confirmado_en, null);
  const repeat = await receiveSync(worker);
  assert.equal(repeat.comandos_manteniment.some(item => item.sync_id === cmd.sync_id && item.revision === cmd.revision), false,
    'A legacy ACK cannot identify two cached delivery instances; PARADA is offered at most once per revision');
  assert.ok(repeat.ordenes_en_vuelo_continuidad > 0);
  assert.deepEqual(await journal(fixture.admin, row.tracking), delivered);
  await assertRejected(validateSync(worker, [row.tracking]), '55000', /ENTREGA_PENDIENTE/);
  await worker.query(`UPDATE app_private.manteniment_parada_outbox SET revision=revision+1,
    payload=payload||'{"dias_parada":10}'::jsonb WHERE seguimiento_id=$1`, [row.tracking]);
  const next = (await syncQueue(worker, [row.tracking]))[0];
  assert.equal(next.revision, cmd.revision + 1);
  const ack = acknowledgement(cmd);
  assert.equal((await acknowledgeSync(worker, [ack])).confirmados, 1);
  assert.deepEqual((await syncQueue(fixture.admin, [row.tracking]))[0], next, 'Old ACK must leave a later pending revision intact');
  assert.ok((await journal(fixture.admin, row.tracking))[0].confirmado_en);
  await validateSync(worker, [row.tracking]);
  // The installed legacy client does not echo payload_sha256. The immutable
  // server journal still identifies exactly one payload for this revision.
  const withoutHash = { ...ack }; delete withoutHash.payload_sha256;
  assert.equal((await acknowledgeSync(worker, [withoutHash])).confirmados, 1);
  record.delivered = delivered[0]; record.advanced_revision = next.revision; record.exact_ack_replay = true;
});

scenario('sc5', 'SC5: wrong hash, tipo, revision and contradictory replay cannot consume a pending PARADA', async (record, worker) => {
  const row = await seedSyncTracking(worker, 'ACK-REJECT');
  const cmd = await delivery(worker, row.tracking);
  const before = await journal(worker, row.tracking);
  const variations = [
    [acknowledgement(cmd, { payload_sha256: '0'.repeat(64) }), '23514', /ACK_INCOMPATIBLE/],
    [acknowledgement(cmd, { tipo: 'trabajos' }), '23514', /ACK_INCOMPATIBLE/],
    [acknowledgement(cmd, { revision: cmd.revision + 99 }), '55000', /ACK_SIN_ENTREGA/],
  ];
  for (const [ack, code, message] of variations) await assertRejected(acknowledgeSync(worker, [ack]), code, message);
  assert.deepEqual(await journal(fixture.admin, row.tracking), before);
  await acknowledgeSync(worker, [acknowledgement(cmd)]);
  await assertRejected(acknowledgeSync(worker, [acknowledgement(cmd, { fila: 43 })]), '23514', /ACK_CONTRADICTORIO/);
  const exact = (await journal(fixture.admin, row.tracking))[0];
  assert.equal(exact.confirmacion.fila, 42);
  record.rejected = variations.length + 1; record.confirmed_row = exact.confirmacion.fila;
});

scenario('sc6', 'SC6: protected or wrong-version responses register no delivery and do not block a new unsent PA', async (record, worker) => {
  const row = await seedSyncTracking(worker, 'FILTERED');
  const openFlags = await syncFlags(worker);
  await setFixtureFlags(worker, { pausa_importacion_identidad: false, solo_lectura_manual_protegida: true, escritura_segura_manual: false });
  const protectedResult = await receiveSync(worker);
  assert.deepEqual(protectedResult.comandos_manteniment, []);
  assert.equal((await journal(worker, row.tracking)).length, 0);
  await validateSync(worker, [row.tracking]);
  await worker.query("UPDATE app_private.manteniment_parada_outbox SET estado='pendiente' WHERE seguimiento_id=$1", [row.tracking]);
  await setFixtureFlags(worker, { pausa_importacion_identidad: false, solo_lectura_manual_protegida: false, escritura_segura_manual: true });
  const versionResult = await receiveSync(worker, { version_script: 'unsupported-synthetic-client' });
  assert.deepEqual(versionResult.comandos_manteniment, []);
  assert.equal((await journal(worker, row.tracking)).length, 0);
  await validateSync(worker, [row.tracking]);
  await setFixtureFlags(worker, openFlags);
  record.filtered_before_journal = true;
});

scenario('sc7', 'SC7: confirmed continuity retains both mixed queues, blocks their construction/delivery/deletion and preserves unrelated work', async (record, worker) => {
  const pair = await seedSyncContinuityPair(worker, 'LINK-HOLD');
  const ids = [pair.source.seguimiento_id, pair.target.seguimiento_id];
  const targetSync = await one(worker, 'SELECT sync_id FROM app_private.manteniment_parada_sync WHERE seguimiento_id=$1', [ids[1]]);
  await worker.query(`INSERT INTO app_private.manteniment_parada_outbox(seguimiento_id,sync_id,payload)
    VALUES($1,$2,jsonb_build_object('sync_id',$2::uuid,'seguimiento_id',$1::uuid,'solo_trabajos',false,
      'fecha_parada','2026-10-21','fecha_k',NULL,'numero_parada','PA-SYN-TARGET'))
    ON CONFLICT(seguimiento_id) DO NOTHING`, [ids[1], targetSync.sync_id]);
  const before = await syncQueue(worker, ids);
  assert.equal(before.length, 2);
  const confirmed = await confirmSyncContinuity(worker, pair);
  assert.equal(confirmed.ok, true);
  assert.deepEqual(await syncQueue(fixture.admin, ids), before, 'Confirming continuity must retain the original mixed queues');
  const unrelated = await seedSyncTracking(worker, 'UNRELATED-WORK', { workOnly: true });
  const result = await receiveSync(worker);
  assert.equal(result.comandos_manteniment.some(cmd => ids.includes(cmd.payload.seguimiento_id)), false);
  assert.ok(result.comandos_manteniment.find(cmd => cmd.sync_id === unrelated.syncId));
  assert.ok(result.ordenes_retenidas_continuidad >= 2);
  for (const tracking of ids) {
    assert.equal((await one(worker, 'SELECT app_private.manteniment_construir_payload_parada($1) AS value', [tracking])).value, null);
    await worker.query('SELECT app_private.manteniment_encolar_parada($1)', [tracking]);
    assert.equal((await worker.query('DELETE FROM app_private.manteniment_parada_outbox WHERE seguimiento_id=$1', [tracking])).rowCount, 0);
  }
  assert.deepEqual(await syncQueue(fixture.admin, ids), before);
  record.continuidad_id = confirmed.continuidad_id; record.retained_tracking_ids = ids;
});

scenario('sc8', 'SC8: a separate pure-work envelope remains usable on the linked target and its ACK preserves physical PARADA metadata', async (record, worker) => {
  const pair = await seedSyncContinuityPair(worker, 'LINK-WORK');
  const confirmed = await confirmSyncContinuity(worker, pair);
  assert.equal(confirmed.ok, true);
  const tracking = pair.target.seguimiento_id;
  const sync = await one(worker, 'SELECT sync_id FROM app_private.manteniment_parada_sync WHERE seguimiento_id=$1', [tracking]);
  const payload = { sync_id: sync.sync_id, seguimiento_id: tracking, numero_parada: `PA-${pair.target.numero_parada}`,
    solo_trabajos: true, trabajos_asignados: [{ sync_id: '00000000-0000-4000-8000-000000705555', tipo_trabajo: 'MCD' }], trabajos_crear: [] };
  await worker.query(`UPDATE app_private.manteniment_parada_sync SET fila_manteniment=84,
    ultimo_payload_confirmado='{"evidencia":"physical-row"}'::jsonb WHERE seguimiento_id=$1`, [tracking]);
  await worker.query(`INSERT INTO app_private.manteniment_parada_outbox(seguimiento_id,sync_id,payload)
    VALUES($1,$2,$3::jsonb)`, [tracking, sync.sync_id, JSON.stringify(payload)]);
  const before = (await one(worker, 'SELECT to_jsonb(s) AS value FROM app_private.manteniment_parada_sync s WHERE seguimiento_id=$1', [tracking])).value;
  const cmd = await delivery(worker, tracking);
  assert.equal(cmd.payload.solo_trabajos, true);
  assert.equal((await acknowledgeSync(worker, [acknowledgement(cmd)])).confirmados, 1);
  assert.deepEqual((await one(fixture.admin, 'SELECT to_jsonb(s) AS value FROM app_private.manteniment_parada_sync s WHERE seguimiento_id=$1', [tracking])).value, before);
  assert.equal((await journal(fixture.admin, tracking))[0].tipo, 'trabajos');
  record.continuidad_id = confirmed.continuidad_id; record.physical_row_preserved = true;
});

scenario('sc9', 'SC9: stale external J/K/L/P for both linked PA are retained as evidence and unrelated imports continue', async (record, worker) => {
  const pair = await seedSyncContinuityPair(worker, 'IMPORT');
  await confirmSyncContinuity(worker, pair);
  const ids = [pair.source.seguimiento_id, pair.target.seguimiento_id];
  const before = (await worker.query('SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE seguimiento_id=ANY($1) ORDER BY id', [ids])).rows;
  const stages = (await worker.query('SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE registro_hotel_id=ANY($1) ORDER BY id', [[pair.source.id, pair.target.id]])).rows;
  const syncBefore = (await worker.query('SELECT to_jsonb(s) AS value FROM app_private.manteniment_parada_sync s WHERE seguimiento_id=ANY($1) ORDER BY seguimiento_id', [ids])).rows;
  const stale = syncBefore.map(row => ({ sync_id: row.value.sync_id, fila: 86, estado: 'PARADA', dfm: 'IDENTITY-MUST-NOT-IMPORT',
    fecha_parada: '2001-01-01', fecha_k: '2026-10-20', dias_parada: 999, km_facturables: 999999, tancament: '' }));
  const unrelated = await seedSyncTracking(worker, 'IMPORT-OTHER', { enqueue: false });
  const result = await receiveSync(worker, { paradas: [...stale,
    { sync_id: unrelated.syncId, estado: 'PARADA', fila: 87, fecha_parada: '2026-10-22', fecha_inicio_parada: '2026-10-22', fecha_k: null, tancament: '' }] });
  assert.equal(result.paradas_recibidas, 1);
  assert.deepEqual((await fixture.admin.query('SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE seguimiento_id=ANY($1) ORDER BY id', [ids])).rows, before);
  assert.deepEqual((await fixture.admin.query('SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE registro_hotel_id=ANY($1) ORDER BY id', [[pair.source.id, pair.target.id]])).rows, stages);
  assert.deepEqual((await fixture.admin.query('SELECT to_jsonb(s) AS value FROM app_private.manteniment_parada_sync s WHERE seguimiento_id=ANY($1) ORDER BY seguimiento_id', [ids])).rows, syncBefore);
  assert.equal((await one(fixture.admin, 'SELECT fecha_parada::text AS fecha FROM public.registros_hotel WHERE id=$1', [unrelated.id])).fecha, '2026-10-22');
  const retained = (await fixture.admin.query(`SELECT seguimiento_id,payload_sha256,recepciones,payload
    FROM app_private.manteniment_importaciones_retenidas_continuidad_alpha75 WHERE seguimiento_id=ANY($1)`, [ids])).rows;
  assert.equal(retained.length, 2);
  for (const item of retained) { assert.match(item.payload_sha256, /^[0-9a-f]{64}$/); assert.equal(item.payload.fecha_k, '2026-10-20'); }
  record.imported_unrelated = 1; record.retained = retained;
});

async function raceDeliveryAndContinuity(record, worker, { continuityFirst = false, rollbackDelivery = false } = {}) {
  const tag = continuityFirst ? 'RACE-LINK' : rollbackDelivery ? 'RACE-ROLLBACK' : 'RACE-DELIVER';
  const pair = await seedSyncContinuityPair(worker, tag);
  const preview = await previewSyncContinuity(worker, pair);
  assert.equal(preview.confirmable, true, JSON.stringify(preview.bloqueos));
  const b = await fixture.connect(`${record.key}_b`);
  const stateA = await beginReadCommitted(worker);
  const stateB = await beginReadCommitted(b);
  let pending, settled = false;
  try {
    if (continuityFirst) {
      const result = await confirmSyncContinuity(worker, pair, `sync_race_${tag}`, preview);
      assert.equal(result.ok, true);
      pending = receiveSync(b).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    } else {
      const cmd = await delivery(worker, pair.source.seguimiento_id);
      record.delivered_revision = cmd.revision;
      pending = confirmSyncContinuity(b, pair, `sync_race_${tag}`, preview)
        .then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    }
    record.wait_proof = await observeAdvisoryWait(fixture.admin, stateA.pid, stateB.pid, { isSettled: () => settled });
    await worker.query(rollbackDelivery ? 'ROLLBACK' : 'COMMIT');
    const outcome = await pending;
    if (!continuityFirst && !rollbackDelivery) {
      assert.ok(outcome.error);
      assert.equal(outcome.error.code, '23514', 'The public confirm RPC wraps the precise preview block as a business constraint');
      assert.match(outcome.error.message, /ENTREGA_PENDIENTE/);
      await b.query('ROLLBACK');
      assert.equal((await one(fixture.admin, `SELECT count(*)::int AS n FROM app_private.sustitucion_continuidades_alpha75
        WHERE origen_seguimiento_id=$1`, [pair.source.seguimiento_id])).n, 0);
      record.rejected_sqlstate = outcome.error.code;
    } else {
      if (outcome.error) throw outcome.error;
      if (continuityFirst) assert.equal(outcome.value.comandos_manteniment.some(cmd =>
        [pair.source.seguimiento_id, pair.target.seguimiento_id].includes(cmd.payload.seguimiento_id)), false);
      else assert.equal(outcome.value.ok, true);
      await b.query('COMMIT');
      assert.equal((await one(fixture.admin, `SELECT count(*)::int AS n FROM app_private.sustitucion_continuidades_alpha75
        WHERE origen_seguimiento_id=$1`, [pair.source.seguimiento_id])).n, 1);
      record.committed = true;
    }
    record.worker_a = stateA; record.worker_b = stateB; record.rollback_delivery = rollbackDelivery;
  } finally {
    await worker.query('ROLLBACK').catch(() => {});
    await b.query('ROLLBACK').catch(() => {});
    await fixture.close(b);
  }
}

scenario('sc10', 'SC10: committed delivery wins the common lock and rejects a concurrent continuity before any link is inserted', async (record, worker) => {
  await raceDeliveryAndContinuity(record, worker);
});

scenario('sc11', 'SC11: committed continuity wins the common lock and a waiting public sync never receives either linked PARADA', async (record, worker) => {
  await raceDeliveryAndContinuity(record, worker, { continuityFirst: true });
});

scenario('sc12', 'SC12: rolled-back delivery leaves no phantom in-flight order and a waiting continuity can commit', async (record, worker) => {
  await raceDeliveryAndContinuity(record, worker, { rollbackDelivery: true });
});

scenario('sc13', 'SC13: real TANCAMENT importer retains linked sync/PA+DFM rows and cannot mark their prior snapshots absent', async (record, worker) => {
  const pair = await seedSyncContinuityPair(worker, 'TANCAMENT', { originDaysAgo: 40 });
  const ids = [pair.source.seguimiento_id, pair.target.seguimiento_id];
  const sync = (await worker.query('SELECT seguimiento_id,sync_id FROM app_private.manteniment_parada_sync WHERE seguimiento_id=ANY($1)', [ids])).rows;
  const sourceSync = sync.find(row => row.seguimiento_id === ids[0]).sync_id;
  const past = await one(worker, `SELECT periodo,
    greatest(fecha_inicio,$1::date)::text AS start,fecha_cierre::text AS finish,
    (greatest(fecha_inicio,$1::date)+1)::text AS second_start,
    ('TANCAMENT '||(split_part(periodo,'-',2)::int)::text) AS label
    FROM public.cierres_facturacion WHERE fecha_cierre<(clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date
    ORDER BY fecha_cierre DESC LIMIT 1`, [pair.dates.origin]);
  assert.ok(past && past.start < past.finish, 'The synthetic source must cover a genuinely earlier closed period');
  const keys = [`SYNC|${sourceSync}|${past.periodo}|${past.start}|${pair.reserve}`, `SYNTHETIC_UNKEYED_${sourceSync}`];
  await worker.query(`INSERT INTO public.facturacion_tancament_cierres
    (source_key,sync_id,seguimiento_id,dfm,matricula,numero_parada,sustituto,tancament,periodo,
      fecha_inicio_tramo,fecha_fin_tramo,dias_facturables,km_facturables,payload_hash)
    VALUES($1,$2,$3,$4,'',$5,$6,$7,$8,$9,$9,1,123.45,'manual-synthetic-a'),
      ($10,NULL,NULL,$4,'',$5,$6,$7,$8,$11,$12,7,987.65,'manual-synthetic-b')`,
  [keys[0], sourceSync, ids[0], pair.dfm, `PA-${pair.source.numero_parada}`, pair.reserve, past.label, past.periodo,
    past.start, keys[1], past.second_start, past.finish]);
  await confirmSyncContinuity(worker, pair);
  const before = (await worker.query('SELECT to_jsonb(f) AS value FROM public.facturacion_tancament_cierres f WHERE source_key=ANY($1) ORDER BY source_key', [keys])).rows;
  const originalQueue = await syncQueue(worker, ids);
  const stale = [
    { sync_id: sourceSync, dfm: 'EXTERNAL-IDENTITY-MUST-NOT-WIN', numero_parada: `PA-${pair.source.numero_parada}`,
      sustituto: pair.reserve, estado: 'PARADA', tancament: past.label, fecha_parada: past.start,
      fecha_k: past.finish, dias_parada: 999, km_facturables: 999999, fila: 91 },
    { dfm: `  ${pair.dfm.toLowerCase()}  `, numero_parada: ` pa- ${pair.target.numero_parada} `,
      sustituto: pair.reserve, estado: 'PARADA', tancament: past.label, fecha_parada: past.start,
      fecha_k: past.finish, dias_parada: 888, km_facturables: 888888, fila: 92 },
    { dfm: 'TANCAMENT-UNRELATED', numero_parada: 'PA-SYN-UNRELATED', sustituto: 'R-SYN-UNRELATED',
      estado: 'PARADA', tancament: past.label, fecha_parada: past.start, fecha_k: past.finish,
      dias_parada: 3, km_facturables: 90, fila: 93 },
  ];
  const result = await receiveSync(worker, { cierres_facturacion: stale });
  assert.deepEqual(result.cierres_facturacion, { recibidos: 3, actualizados: 1, retenidos_continuidad: 2 });
  assert.deepEqual((await fixture.admin.query('SELECT to_jsonb(f) AS value FROM public.facturacion_tancament_cierres f WHERE source_key=ANY($1) ORDER BY source_key', [keys])).rows, before,
    'Both keyed and unkeyed protected snapshots must retain their exact manual values and presence flag');
  assert.deepEqual(await syncQueue(fixture.admin, ids), originalQueue);
  const retained = (await fixture.admin.query(`SELECT seguimientos,payload_sha256,payload,recepciones
    FROM app_private.manteniment_cierres_retenidos_continuidad_alpha75 WHERE seguimientos && $1::uuid[]`, [ids])).rows;
  assert.equal(retained.length, 2);
  assert.deepEqual([...new Set(retained.flatMap(row => row.seguimientos))].sort(), [...ids].sort());
  for (const item of retained) assert.match(item.payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal((await one(fixture.admin, "SELECT count(*)::int AS n FROM public.facturacion_tancament_cierres WHERE dfm='TANCAMENT-UNRELATED' AND presente_en_manteniment")).n, 1);
  record.counts = result.cierres_facturacion; record.protected_snapshot_keys = keys; record.retained = retained;
});
