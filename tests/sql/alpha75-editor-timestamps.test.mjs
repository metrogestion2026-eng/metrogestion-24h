import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createEditorFixture, seedEditorContinuityPair, editorDetail, editorPayload,
  saveEditor, editorInventory, EDITOR_TIMESTAMP_MIGRATION,
} from './editor-scenarios.mjs';
import { one, snapshotProtectedFacts } from './local-postgres-harness.mjs';
import { normalizeDetail, fichaPayload, stagesPayload } from '../../r1-alpha17/src/modules/hotel-editor-utils.js';

const CORE = 'public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text)';
const GETTER = 'public.obtener_ficha_hotel_edicion_alpha72(uuid)';
const CONTRACT = 'MG75-EDITOR-FECHAS-001';
const CARD_DATES = ['fecha_entrada', 'fecha_limite_sustitucion'];
const STAGE_DATES = ['fecha_prevista', 'fecha_inicio_real', 'fecha_fin_real', 'fecha_real'];
const report = { suite: CONTRACT, started_at: new Date().toISOString(), cases: [] };
let fixture, migration;

before(async () => {
  migration = await readFile(EDITOR_TIMESTAMP_MIGRATION, 'utf8');
  fixture = await createEditorFixture({ prefix: 'editor_times' });
  report.environment = fixture.metadata;
});
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
      && report.temporary_database_dropped === true && report.cases.length === 8
      && report.cases.every(result => result.status === 'passed');
    if (process.env.METROGESTION_EDITOR_TIMESTAMPS_REPORT) {
      const file = path.resolve(process.env.METROGESTION_EDITOR_TIMESTAMPS_REPORT);
      assert.equal(path.extname(file), '.json');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  if (failure) throw failure;
});

function scenario(key, description, body) {
  test(`${key}: ${description}`, { timeout: 60000 }, async context => {
    const result = { key, description, status: 'running' }; report.cases.push(result);
    try {
      await body(fixture.admin, result);
      // JSON timestamp rendering follows the session zone. The parser cases
      // assert actual timestamptz equality in other zones; compare the protected
      // history snapshot using the same UTC representation as its baseline.
      await fixture.admin.query("SET TIME ZONE 'UTC'");
      assert.deepEqual(await snapshotProtectedFacts(fixture.admin), fixture.protectedBefore);
      result.status = 'passed'; context.diagnostic(JSON.stringify({ key, checks: result.checks }));
    } catch (error) {
      result.status = 'failed'; result.error = { code: error.code, message: error.message }; throw error;
    } finally {
      await fixture.admin.query("ROLLBACK; SET TIME ZONE 'UTC'");
    }
  });
}

async function saveCore(db, payload, request) {
  return (await one(db, `SELECT public.guardar_ficha_hotel_edicion_core($1,$2,$3::jsonb,$4::jsonb,$5) AS value`,
    [payload.p_registro_id, payload.p_version, JSON.stringify(payload.p_ficha), JSON.stringify(payload.p_etapas), request])).value;
}

async function assertDates(db, table, id, dates, { local = false } = {}) {
  assert.ok(['registros_hotel', 'etapas_hotel'].includes(table));
  const keys = Object.keys(dates);
  assert.ok(keys.every(key => [...CARD_DATES, ...STAGE_DATES].includes(key)));
  const comparisons = keys.map((key, index) => {
    const expected = local
      ? `(nullif($${index + 2},'')::timestamp AT TIME ZONE 'Europe/Madrid')`
      : `nullif($${index + 2},'')::timestamptz`;
    return `${key} IS NOT DISTINCT FROM ${expected} AS ${key}`;
  });
  const actual = await one(db, `SELECT ${comparisons.join(',')} FROM public.${table} WHERE id=$1`, [id, ...Object.values(dates)]);
  assert.deepEqual(actual, Object.fromEntries(keys.map(key => [key, true])), 'Stored instants differ from the explicitly submitted facts');
}

function setDates(target, keys, values) {
  const dates = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  Object.assign(target, dates); return dates;
}

async function catalog(db) {
  return (await db.query(`SELECT p.oid::regprocedure::text AS signature,
    md5(pg_get_functiondef(p.oid)) AS definition_md5,
    to_jsonb(p)-ARRAY['prosrc','prosqlbody'] AS properties
    FROM pg_proc p WHERE p.oid IN ($1::regprocedure,$2::regprocedure) ORDER BY 1`, [CORE, GETTER])).rows;
}

scenario('TF01', 'the unmodified minute-only editor fails against the real pre-fix RPC without partial writes', async (_db, result) => {
  const old = await createEditorFixture({ prefix: 'editor_legacy', timestampFix: false });
  try {
    const pair = await seedEditorContinuityPair(old.admin, { tag: 'TF01' });
    const raw = await editorDetail(old.admin, pair.destination.id);
    assert.equal(raw.contrato_fechas_editor, undefined);
    const normalized = normalizeDetail(raw);
    const minuteCard = fichaPayload(normalized.ficha), minuteStages = stagesPayload(normalized.etapas);
    const payload = await editorPayload(old.admin, pair.destination.id);
    for (const key of CARD_DATES) payload.p_ficha[key] = minuteCard[key];
    for (const stage of payload.p_etapas) {
      const minute = minuteStages.find(item => item.id === stage.id);
      for (const key of STAGE_DATES) stage[key] = minute[key];
    }
    payload.p_ficha.observaciones = 'Esta nota de regresión no debe persistir';
    assert.match(raw.ficha.fecha_entrada, /21\.456789/);
    assert.doesNotMatch(payload.p_ficha.fecha_entrada, /21\.456789/);
    const before = await editorInventory(old.admin, pair);
    await assert.rejects(() => saveEditor(old.admin, payload, 'editor_TF01_legacy_precision'),
      error => error.code === '23514' && /CONTINUIDAD-001: identidad, fechas físicas/.test(error.message));
    assert.deepEqual(await editorInventory(old.admin, pair), before);
    assert.deepEqual(await snapshotProtectedFacts(old.admin), old.protectedBefore);
    result.checks = { actual_legacy_normalizer: true, actual_full_rpc: true, rejection: '23514', committed_rows_unchanged: true };
  } finally { await old.destroy(); }
});

scenario('TF02', 'all six existing date fields preserve explicit instants and microseconds through the real core UPDATE', async (db, result) => {
  const pair = await seedEditorContinuityPair(db, { tag: 'TF02', confirm: false });
  const payload = await editorPayload(db, pair.destination.id);
  const card = setDates(payload.p_ficha, CARD_DATES,
    ['2026-10-20T09:00:21.456789Z', '2026-11-02T18:40:22.987654+01:00']);
  const stage = payload.p_etapas.find(item => item.id === pair.entry.id);
  const dates = setDates(stage, STAGE_DATES, [
    '2026-10-20T09:10:12.123456+02:00', '2026-10-20T11:10:23.234567+02',
    '2026-10-20T12:20:34.345678+0200', '2026-10-20T11:30:45.456789z',
  ]);
  stage.estado = 'realizada';
  await db.query("SET TIME ZONE 'Pacific/Auckland'");
  assert.equal((await saveCore(db, payload, 'editor_TF02_update_exact')).ok, true);
  await assertDates(db, 'registros_hotel', pair.destination.id, card);
  await assertDates(db, 'etapas_hotel', pair.entry.id, dates);
  result.checks = { card_fields: 2, existing_stage_fields: 4, fractional_digits: 6, explicit_offsets: ['Z', '+01:00', '+02', '+0200', 'z'], session_zone_independent: true };
});

scenario('TF03', 'new T insertion preserves all four timestamp fields and the chosen explicit offset', async (db, result) => {
  const pair = await seedEditorContinuityPair(db, { tag: 'TF03', confirm: false });
  const payload = await editorPayload(db, pair.destination.id);
  const stage = { id: '', version: '', nombre: 'T sintética con horas explícitas', posicion: 40,
    tipo_etapa: 'otro', estado: 'realizada', lugar: 'Banco de prueba', observaciones: '', trabajos: [], cancelado: false };
  const dates = setDates(stage, STAGE_DATES, [
    '2026-10-20T04:10:12.123456-05:00', '2026-10-20T05:20:23.234567-05',
    '2026-10-20T06:30:34.345678-0500', '2026-10-20T07:40:45.456789-05:00',
  ]);
  payload.p_etapas.push(stage);
  assert.equal((await saveCore(db, payload, 'editor_TF03_insert_exact')).ok, true);
  const created = await one(db, 'SELECT id FROM public.etapas_hotel WHERE registro_hotel_id=$1 AND nombre=$2', [pair.destination.id, stage.nombre]);
  assert.ok(created.id);
  await assertDates(db, 'etapas_hotel', created.id, dates);
  result.checks = { inserted_stage_fields: 4, fractional_digits: 6, negative_offsets_preserved: true };
});

scenario('TF04', 'legacy local timestamps keep Madrid semantics in INSERT and UPDATE, and clearing still writes null', async (db, result) => {
  const pair = await seedEditorContinuityPair(db, { tag: 'TF04', confirm: false });
  const payload = await editorPayload(db, pair.destination.id);
  const card = setDates(payload.p_ficha, CARD_DATES, ['2026-07-15T11:00', '2026-07-16 13:14:15.654321']);
  const entry = payload.p_etapas.find(item => item.id === pair.entry.id);
  const existingDates = setDates(entry, STAGE_DATES,
    ['2026-07-15T08:15', '2026-07-15 09:16:17.123456', '2026-07-15T10:17:18', '2026-07-15T11:18:19.456789']);
  entry.estado = 'realizada';
  const newStage = { id: '', version: '', nombre: 'T local sin zona', posicion: 41, tipo_etapa: 'otro', estado: 'realizada', trabajos: [] };
  const insertedDates = setDates(newStage, STAGE_DATES,
    ['2026-07-15T12:20', '2026-07-15T13:21:22.234567', '2026-07-15 14:22:23.345678', '2026-07-15T15:23']);
  payload.p_etapas.push(newStage);
  await db.query("SET TIME ZONE 'America/New_York'");
  assert.equal((await saveCore(db, payload, 'editor_TF04_local_dates')).ok, true);
  const created = await one(db, 'SELECT id FROM public.etapas_hotel WHERE registro_hotel_id=$1 AND nombre=$2', [pair.destination.id, newStage.nombre]);
  await assertDates(db, 'registros_hotel', pair.destination.id, card, { local: true });
  await assertDates(db, 'etapas_hotel', pair.entry.id, existingDates, { local: true });
  await assertDates(db, 'etapas_hotel', created.id, insertedDates, { local: true });
  const clear = await editorPayload(db, pair.destination.id);
  const clearedCard = setDates(clear.p_ficha, CARD_DATES, ['', null]);
  const target = clear.p_etapas.find(item => item.id === created.id);
  const clearedStage = setDates(target, STAGE_DATES, ['', null, '', null]);
  target.estado = 'pendiente';
  assert.equal((await saveCore(db, clear, 'editor_TF04_clear_dates')).ok, true);
  await assertDates(db, 'registros_hotel', pair.destination.id, clearedCard);
  await assertDates(db, 'etapas_hotel', created.id, clearedStage);
  result.checks = { legacy_conversion_points: 10, session_zone_independent: true, empty_and_null_clear: true };
});

scenario('TF05', 'both occurrences of the Madrid autumn hour remain distinct after a complete note save', async (db, result) => {
  const values = ['2026-10-25T02:30:37.123456+02:00', '2026-10-25T02:30:37.123456+01:00'];
  const epochs = [];
  for (let index = 0; index < values.length; index++) {
    const pair = await seedEditorContinuityPair(db, { tag: `TF05_${index}`, confirm: false });
    await db.query(`UPDATE public.registros_hotel SET fecha_entrada=$2::timestamptz WHERE id=$1`, [pair.destination.id, values[index]]);
    await db.query(`UPDATE public.etapas_hotel SET fecha_inicio_real=$2::timestamptz WHERE id=$1`, [pair.entry.id, values[index]]);
    const payload = await editorPayload(db, pair.destination.id);
    payload.p_ficha.observaciones = `Nota en la ocurrencia ${index + 1} de la hora repetida`;
    assert.equal((await saveEditor(db, payload, `editor_TF05_fold_${index}`)).ok, true);
    await assertDates(db, 'registros_hotel', pair.destination.id, { fecha_entrada: values[index] });
    await assertDates(db, 'etapas_hotel', pair.entry.id, { fecha_inicio_real: values[index] });
    epochs.push((await one(db, `SELECT extract(epoch FROM fecha_inicio_real)::text AS epoch
      FROM public.etapas_hotel WHERE id=$1`, [pair.entry.id])).epoch);
  }
  assert.equal(Number(epochs[1]) - Number(epochs[0]), 3600);
  result.checks = { full_editor_saves: 2, repeated_wall_time: '2026-10-25T02:30', instants_seconds_apart: 3600, fractional_digits: 6 };
});

scenario('TF06', 'a malformed explicit offset rejects and rolls back the earlier card write', async (db, result) => {
  const pair = await seedEditorContinuityPair(db, { tag: 'TF06', confirm: false });
  const payload = await editorPayload(db, pair.destination.id);
  payload.p_ficha.observaciones = 'No debe persistir antes del error de la T';
  payload.p_etapas.find(item => item.id === pair.entry.id).fecha_inicio_real = '2026-10-20T11:10:23.234567+99:99';
  const before = await editorInventory(db, pair);
  await assert.rejects(() => saveCore(db, payload, 'editor_TF06_bad_offset'),
    error => ['22007', '22008', '22009'].includes(error.code));
  assert.deepEqual(await editorInventory(db, pair), before);
  result.checks = { invalid_offset_rejected: true, card_stage_and_sync_unchanged: true };
});

scenario('TF07', 'parser and capability become visible together at commit and preserve exact function properties', async (_db, result) => {
  const pending = await createEditorFixture({ prefix: 'editor_atomic', timestampFix: false });
  try {
    const pair = await seedEditorContinuityPair(pending.admin, { tag: 'TF07', confirm: false });
    const peer = await pending.connect('capability_observer');
    const before = await catalog(peer);
    assert.equal((await editorDetail(peer, pair.destination.id)).contrato_fechas_editor, undefined);
    assert.ok(migration.endsWith('COMMIT;\n'));
    const uncommitted = migration.slice(0, -'COMMIT;\n'.length);
    await pending.admin.query(uncommitted);
    assert.equal((await editorDetail(pending.admin, pair.destination.id)).contrato_fechas_editor, CONTRACT);
    assert.deepEqual(await catalog(peer), before, 'Another session observed an uncommitted parser or capability');
    assert.equal((await editorDetail(peer, pair.destination.id)).contrato_fechas_editor, undefined);
    await pending.admin.query('ROLLBACK');
    assert.deepEqual(await catalog(peer), before);
    assert.equal((await editorDetail(peer, pair.destination.id)).contrato_fechas_editor, undefined);
    await pending.admin.query(migration);
    const after = await catalog(peer);
    assert.deepEqual(after.map(row => row.properties), before.map(row => row.properties));
    assert.ok(after.every((row, index) => row.definition_md5 !== before[index].definition_md5));
    assert.equal((await editorDetail(peer, pair.destination.id)).contrato_fechas_editor, CONTRACT);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one(peer, 'SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, CORE])).allowed, false);
    }
    assert.equal((await one(peer, 'SELECT has_function_privilege(\'authenticated\',$1,\'EXECUTE\') AS allowed', [GETTER])).allowed, true);
    const protectedAfter = await snapshotProtectedFacts(peer);
    assert.deepEqual(protectedAfter, pending.protectedBefore);
    const committed = await catalog(peer);
    await assert.rejects(() => pending.admin.query(migration), error => error.code === '55000' && /EDITOR-FECHAS-001: deriva/.test(error.message));
    await pending.admin.query('ROLLBACK');
    assert.deepEqual(await catalog(peer), committed, 'Repeated installation changed the committed candidate');
    result.checks = { uncommitted_invisible: true, rollback_removes_both: true, commit_publishes_both: true,
      exact_metadata_preserved: true, no_new_execute_privileges: true, repeated_install_fails_closed: true };
  } finally { await pending.destroy(); }
});

scenario('TF08', 'definition, owner, ACL, search path and security drift abort before advertising the capability', async (_db, result) => {
  const checks = [
    ['core definition', async db => { const row = await one(db, 'SELECT pg_get_functiondef($1::regprocedure) AS body', [CORE]); await db.query(row.body.replace("No tienes permiso para modificar Hotel", "Permiso modificado por ensayo")); }],
    ['getter definition', async db => { const row = await one(db, 'SELECT pg_get_functiondef($1::regprocedure) AS body', [GETTER]); await db.query(row.body.replace('select app_private.', 'select /* deriva sintética */ app_private.')); }],
    ['core owner', db => db.query(`ALTER FUNCTION ${CORE} OWNER TO metrogestion_test`)],
    ['getter owner', db => db.query(`ALTER FUNCTION ${GETTER} OWNER TO metrogestion_test`)],
    ['core PUBLIC grant', db => db.query(`GRANT EXECUTE ON FUNCTION ${CORE} TO PUBLIC`)],
    ['getter anonymous grant', db => db.query(`GRANT EXECUTE ON FUNCTION ${GETTER} TO anon`)],
    ['getter missing authenticated grant', db => db.query(`REVOKE EXECUTE ON FUNCTION ${GETTER} FROM authenticated`)],
    ['core grant option', db => db.query(`GRANT EXECUTE ON FUNCTION ${CORE} TO service_role WITH GRANT OPTION`)],
    ['core search path', db => db.query(`ALTER FUNCTION ${CORE} SET search_path=public,pg_catalog`)],
    ['getter security definer', db => db.query(`ALTER FUNCTION ${GETTER} SECURITY DEFINER`)],
    ['core volatility', db => db.query(`ALTER FUNCTION ${CORE} STABLE`)],
    ['core parallel flag', db => db.query(`ALTER FUNCTION ${CORE} PARALLEL SAFE`)],
  ];
  for (let index = 0; index < checks.length; index++) {
    const [name, change] = checks[index];
    const drift = await createEditorFixture({ prefix: 'editor_drift', timestampFix: false });
    try {
      await change(drift.admin);
      const before = await catalog(drift.admin);
      await assert.rejects(() => drift.admin.query(migration),
        error => error.code === '55000' && /EDITOR-FECHAS-001: deriva/.test(error.message), name);
      await drift.admin.query('ROLLBACK');
      assert.deepEqual(await catalog(drift.admin), before, `${name}: installation partially changed the functions`);
      const getter = await one(drift.admin, 'SELECT pg_get_functiondef($1::regprocedure) AS body', [GETTER]);
      assert.ok(!getter.body.includes(CONTRACT), `${name}: capability was advertised without an installed parser`);
      assert.deepEqual(await snapshotProtectedFacts(drift.admin), drift.protectedBefore);
    } finally { await drift.destroy(); }
  }
  result.checks = { rejected_drift_variants: checks.map(([name]) => name), no_partial_installation: true };
});
