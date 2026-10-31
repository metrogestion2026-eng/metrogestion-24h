import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createContinuityFixture, seedContinuityPair, confirmContinuity, PANEL_PROJECTION_MIGRATION } from './continuity-scenarios.mjs';
import { one, snapshotProtectedFacts } from './local-postgres-harness.mjs';

const PROJECTION = 'app_private.proyectar_continuidad_sustitucion_alpha75(uuid)';
const METADATA = 'app_private.metadatos_continuidad_alpha75(uuid)';
const PANEL_COLUMNS = 'seguimiento_id,numero_parada,unidad,matricula,sustituto,estado,fecha_inicio_parada,fecha_fin_parada,fecha_inicio_imputacion,fecha_fin_imputacion,dias_imputables_total,continuidad_entrada_id,continuidad_salida_id,clase_facturacion,km_dia';
const PANEL_SQL = `SELECT ${PANEL_COLUMNS} FROM public.paradas_sustitucion_resumen`;
const report = { suite: 'MG75-PANEL-PROYECCION-001', started_at: new Date().toISOString(), cases: [] };

function canonicalRows(rows) {
  return rows.map(row => JSON.stringify(row)).sort();
}

async function contract(db) {
  return (await one(db, `SELECT jsonb_build_object(
    'view_oid',c.oid,'owner',c.relowner,'acl',c.relacl,'options',c.reloptions,
    'columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,
      a.attcollation,a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
      'definition_md5',md5(pg_get_functiondef(p.oid)),'volatility',p.provolatile,
      'security_definer',p.prosecdef,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig)
      ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ($1::regprocedure,$2::regprocedure))
  ) AS value FROM pg_class c WHERE c.oid='public.paradas_sustitucion_resumen'::regclass`,
  [PROJECTION, METADATA])).value;
}

async function businessFacts(db) {
  // These are synthetic fixture rows only. Compare complete rows, not merely
  // counts, to detect accidental DML in the otherwise view-only migration.
  const tables = ['public.registros_hotel', 'public.etapas_hotel', 'public.activaciones_24h',
    'public.ajustes_sustitucion_parada', 'public.facturacion_tancament_cierres',
    'app_private.sustitucion_continuidades_alpha75', 'app_private.manteniment_parada_sync',
    'app_private.test_sync_config'];
  const rows = [];
  for (const table of tables) rows.push(await one(db, `SELECT '${table}' AS name,count(*)::int AS rows,
    md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash
    FROM ${table} t`));
  return rows;
}

async function snapshotViews(db) {
  const summary = (await db.query('SELECT to_jsonb(s) AS value FROM public.paradas_sustitucion_resumen s')).rows;
  const billing = (await db.query('SELECT to_jsonb(b) AS value FROM public.facturacion_dfm_periodos b')).rows;
  const billingR = (await db.query('SELECT to_jsonb(b) AS value FROM public.facturacion_r_sustituciones b')).rows;
  return { summary: canonicalRows(summary), billing: canonicalRows(billing), billingR: canonicalRows(billingR),
    summaryValues: summary.map(row => row.value), billingValues: billing.map(row => row.value),
    billingRValues: billingR.map(row => row.value) };
}

async function seedCases(db) {
  const ordinary = await seedContinuityPair(db, { tag: 'PPORD' });
  const manual = await seedContinuityPair(db, { tag: 'PPMAN', originDaysAgo: 8, entryDaysAgo: 3,
    originManualRate: 37.25, destinationManualRate: 80.5 });
  const previous = await one(db, `SELECT * FROM public.cierres_facturacion
    WHERE fecha_cierre<$1::date ORDER BY fecha_cierre DESC LIMIT 1`, [manual.dates.origin]);
  await db.query(`INSERT INTO public.facturacion_tancament_cierres(source_key,seguimiento_id,dfm,
    numero_parada,sustituto,tancament,periodo,fecha_inicio_tramo,fecha_fin_tramo,
    dias_facturables,km_facturables,payload_hash)
    VALUES('PPMAN-closed',$1,$2,$3,$4,'TANCAMENT 1',$5,$6,$7,11,409.75,'synthetic-panel-closed')`,
  [manual.origin.seguimiento_id, manual.dfm, manual.origin.numero_parada, manual.reserve,
    previous.periodo, previous.fecha_inicio, previous.fecha_cierre]);
  await confirmContinuity(db, manual);
  const zero = await seedContinuityPair(db, { tag: 'PPZERO', originDaysAgo: 1, entryDaysAgo: 1 });
  await confirmContinuity(db, zero);
  const recovered = await seedContinuityPair(db, { tag: 'PPREC' });
  await confirmContinuity(db, recovered);
  await db.query(`UPDATE public.etapas_hotel SET estado='realizada',
    fecha_fin_real=clock_timestamp()-interval '2 minutes',fecha_real=clock_timestamp()-interval '1 minute'
    WHERE id=$1`, [recovered.entry.id]);
  const recovery = await one(db, 'SELECT version FROM public.etapas_hotel WHERE id=$1', [recovered.recovery.id]);
  await db.query('SELECT public.marcar_t_realizada_rapida($1,$2,$3)',
    [recovered.recovery.id, recovery.version, 'quick_panel_projection_recovery']);
  const historical = await seedContinuityPair(db, { tag: 'PPHIST', originDaysAgo: 6, entryDaysAgo: 2 });
  await confirmContinuity(db, historical);
  const board = (await one(db, `INSERT INTO public.pizarras(estado,fecha)
    VALUES('archivada',CURRENT_DATE-1) RETURNING id`)).id;
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('app.clonando_pizarra','1',true)");
    for (const id of [historical.origin.id, historical.destination.id]) {
      const row = (await one(db, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [id])).value;
      delete row.id; row.pizarra_id = board;
      await db.query(`INSERT INTO public.registros_hotel SELECT
        (jsonb_populate_record(NULL::public.registros_hotel,$1::jsonb||jsonb_build_object('id',gen_random_uuid()))).*`,
      [JSON.stringify(row)]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  // A separate R-class affected vehicle exercises the other billing consumer
  // of the same summary view. It is unrelated to the confirmed DFM chains.
  await db.query(`INSERT INTO public.vehiculos_hotel_autocompletar(dfm,matricula,tipo_sustituto_catalogo,etiqueta_reserva)
    VALUES('R-PPBILL-SUB','MCRPPBILL','RESERVA','Reserva sintética de facturación R')`);
  await db.query(`INSERT INTO public.reservas_hotel(vehiculo_codigo,matricula,estado,pendientes)
    VALUES('R-PPBILL-SUB','MCRPPBILL','libre','')`);
  const rClass = (await one(db, `SELECT public.crear_ficha_hotel($1::jsonb,$2) AS value`, [JSON.stringify({
    vehiculo_sustituido: 'R-PPBILL', vehiculo_reserva: 'R-PPBILL-SUB', estado: 'en_taller',
    tipo_movimiento: 'TALLER', fecha_parada: ordinary.dates.entry, lugar: 'Taller sintético R',
  }), 'panel_projection_r_billing'])).value;
  return { ordinary, manual, zero, recovered, historical, rClass };
}

async function seedRepresentativeVolume(db) {
  // Ten daily physical copies of each of 140 additional logical PA, with eight
  // synthetic tasks per copy. Runtime triggers remain enabled during loading.
  // The fixture has no operational rows and its harness refuses remote/TCP DSNs.
  await db.query(`INSERT INTO public.pizarras(id,estado,fecha)
    SELECT md5('panel-volume-board-'||age)::uuid,
      CASE WHEN age=0 THEN 'en_curso' ELSE 'archivada' END,CURRENT_DATE-age
    FROM generate_series(0,9) age`);
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('app.clonando_pizarra','1',true)");
    await db.query(`INSERT INTO public.registros_hotel(id,pizarra_id,seguimiento_id,numero_parada,
      vehiculo_sustituido,matricula_sustituido,estado,fecha_parada,tipo_movimiento,modalidad_operativa,observaciones)
      SELECT md5('panel-volume-card-'||n||'-'||age)::uuid,md5('panel-volume-board-'||age)::uuid,
        md5('panel-volume-logical-'||n)::uuid,'VOLUME-'||n,'TEST-PANEL-LOAD-'||n,'MTLOAD'||n,
        'en_taller',CURRENT_DATE-20,'TALLER','sin_sustitucion','Volumen sintético de consulta del Panel'
      FROM generate_series(1,140) n CROSS JOIN generate_series(0,9) age`);
    await db.query(`INSERT INTO public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,
      estado,tipo_etapa,fecha_real,observaciones)
      SELECT r.id,md5('panel-volume-task-'||r.seguimiento_id::text||'-'||n)::uuid,
        'Revisión sintética de volumen '||n,n*10,CASE WHEN n<=4 THEN 'realizada' ELSE 'pendiente' END,
        'otro',CASE WHEN n<=4 THEN (p.fecha+time '12:00') AT TIME ZONE 'Europe/Madrid' END,
        'Datos sintéticos, sin carga desde producción'
      FROM public.registros_hotel r JOIN public.pizarras p ON p.id=r.pizarra_id
        CROSS JOIN generate_series(1,8) n
      WHERE r.vehiculo_sustituido LIKE 'TEST-PANEL-LOAD-%'`);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  await db.query('ANALYZE public.registros_hotel; ANALYZE public.etapas_hotel; ANALYZE public.pizarras;');
  return one(db, `SELECT
    (SELECT count(DISTINCT seguimiento_id)::int FROM public.registros_hotel) AS logical_pa,
    (SELECT count(*)::int FROM public.registros_hotel) AS physical_records,
    (SELECT count(*)::int FROM public.etapas_hotel) AS stages`);
}

async function allowSyntheticAuthenticatedRead(db) {
  // These policies are explicit authorization doubles, not captures of the
  // deployed Supabase user/device/RLS model. They exercise invoker semantics
  // and the existing role branch of the unchanged projection helper.
  for (const table of ['registros_hotel', 'etapas_hotel', 'pizarras', 'medias_km_dfm', 'ajustes_sustitucion_parada']) {
    await db.query(`GRANT SELECT ON public.${table} TO authenticated;
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY panel_fixture_read ON public.${table} FOR SELECT TO authenticated
      USING (public.usuario_activo() AND public.dispositivo_autorizado() AND public.puede_ver_modulo('resumen'));`);
  }
}

test('native PostgreSQL evaluates the Panel continuity projection once without changing results', { timeout: 120000 }, async t => {
  let fixture;
  let failure;
  let serial = 0;
  async function check(key, description, body) {
    const result = { key, description, status: 'running' }; report.cases.push(result);
    await t.test(`${key}: ${description}`, async context => {
      try { await body(result); result.status = 'passed'; context.diagnostic(JSON.stringify(result)); }
      catch (error) { result.status = 'failed'; result.error = { code: error.code, message: error.message }; throw error; }
    });
    assert.equal(result.status, 'passed', `${key} failed; do not continue with an invalid fixture`);
  }
  async function measure(sql, values = [], { authenticated = false, statementTimeoutMs = null, viewAllowed = true } = {}) {
    const client = await fixture.connect(`projection_${++serial}`);
    try {
      // No VOLATILE counter/wrapper: that would inhibit CTE inlining itself and
      // conceal the regression. Transaction-local native statistics are
      // immediate, so no global stats reset, polling or timing threshold is used.
      await client.query("SET track_functions='pl'; BEGIN READ ONLY;");
      if (statementTimeoutMs !== null) {
        assert.equal(statementTimeoutMs, 8000, 'The representative Panel budget is exactly eight seconds');
        await client.query("SELECT set_config('statement_timeout','8000ms',true)");
      }
      await client.query("SELECT set_config('test.view_allowed',$1,true)", [String(viewAllowed)]);
      if (authenticated) await client.query('SET LOCAL ROLE authenticated');
      const started = performance.now();
      const rows = (await client.query(sql, values)).rows;
      const elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
      const calls = await one(client, `SELECT
        coalesce((SELECT calls::int FROM pg_stat_xact_user_functions WHERE funcid=$1::regprocedure),0) AS projection,
        coalesce((SELECT calls::int FROM pg_stat_xact_user_functions WHERE funcid=$2::regprocedure),0) AS metadata`,
      [PROJECTION, METADATA]);
      await client.query('COMMIT');
      return { rows: canonicalRows(rows), rowCount: rows.length, calls, elapsedMs };
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await fixture.close(client);
    }
  }
  try {
    const migration = await readFile(PANEL_PROJECTION_MIGRATION, 'utf8');
    assert.ok(migration.trim().length > 100, 'The projection migration is not ready');
    const frontend = await readFile(new URL('../../r1-alpha75/src/panel-native-hf23.js', import.meta.url), 'utf8');
    assert.ok(frontend.includes(`from('paradas_sustitucion_resumen').select('${PANEL_COLUMNS}')`),
      'Update the regression query when the actual Panel projection changes');
    fixture = await createContinuityFixture({ prefix: 'panel_project', applyPanelProjectionMigration: false });
    report.environment = fixture.metadata;
    report.migration_sha256 = createHash('sha256').update(migration).digest('hex');
    const db = fixture.admin;
    const cases = await seedCases(db);
    assert.deepEqual(await snapshotProtectedFacts(db), fixture.protectedBefore);
    const beforeContract = await contract(db);
    const beforeFacts = await businessFacts(db);
    const originalView = (await one(db, `SELECT pg_get_viewdef(
      'public.paradas_sustitucion_resumen'::regclass,true) AS value`)).value;
    const originalFunction = (await one(db, `SELECT pg_get_functiondef($1::regprocedure) AS value`, [PROJECTION])).value;
    const beforeViews = await snapshotViews(db);
    const filteredSql = `${PANEL_SQL} WHERE seguimiento_id=$1::uuid`;
    const rangeSql = `${PANEL_SQL} WHERE fecha_inicio_imputacion<=$1::date
      AND coalesce(fecha_fin_imputacion,$1::date)>=$2::date`;
    const noMetadataSql = 'SELECT seguimiento_id,numero_parada,unidad FROM public.paradas_sustitucion_resumen';
    const countSql = 'SELECT count(*)::int AS n FROM public.paradas_sustitucion_resumen';
    const rangeValues = [cases.manual.dates.today, cases.manual.dates.entry];
    const baseline = {
      panel: await measure(PANEL_SQL),
      single: await measure(filteredSql, [cases.manual.destination.seguimiento_id]),
      range: await measure(rangeSql, rangeValues),
      identities: await measure(noMetadataSql),
      count: await measure(countSql),
    };
    await check('P01', 'the unchanged STABLE baseline reproduces repeated calls in the exact Panel query', async r => {
      for (const fn of beforeContract.functions) assert.equal(fn.volatility, 's', fn.signature);
      assert.ok(baseline.panel.rowCount >= 10, 'The fixture must include several independent logical PA');
      assert.ok(baseline.panel.calls.projection > baseline.panel.rowCount);
      assert.equal(baseline.panel.calls.metadata, baseline.panel.calls.projection);
      assert.equal(baseline.single.rowCount, 1);
      assert.ok(baseline.single.calls.projection > 1);
      assert.equal(baseline.identities.calls.projection, 0);
      assert.equal(baseline.count.calls.projection, 0);
      r.checks = { rows: baseline.panel.rowCount, baseline_calls: baseline.panel.calls,
        baseline_single_calls: baseline.single.calls, metadata_free_calls: baseline.identities.calls };
    });

    await db.query(migration);
    const afterContract = await contract(db);
    const afterViews = await snapshotViews(db);
    const fixed = {
      panel: await measure(PANEL_SQL),
      single: await measure(filteredSql, [cases.manual.destination.seguimiento_id]),
      range: await measure(rangeSql, rangeValues),
      identities: await measure(noMetadataSql),
      count: await measure(countSql),
    };
    await check('P02', 'full summary, billing and closed manual facts remain identical', async r => {
      assert.deepEqual(afterViews.summary, beforeViews.summary);
      assert.deepEqual(afterViews.billing, beforeViews.billing);
      assert.deepEqual(afterViews.billingR, beforeViews.billingR);
      assert.deepEqual(await businessFacts(db), beforeFacts);
      assert.deepEqual(await snapshotProtectedFacts(db), fixture.protectedBefore);
      const find = id => afterViews.summaryValues.find(row => row.seguimiento_id === id);
      assert.equal(find(cases.zero.origin.seguimiento_id).dias_imputables_total, 0);
      assert.equal(find(cases.manual.origin.seguimiento_id).dias_imputables_total, 5);
      assert.equal(find(cases.manual.destination.seguimiento_id).dias_imputables_total, 4);
      assert.equal(find(cases.manual.origin.seguimiento_id).km_dia, 37.25);
      assert.equal(find(cases.manual.destination.seguimiento_id).km_dia, 80.5);
      assert.equal(find(cases.recovered.destination.seguimiento_id).fin_imputacion_motivo, 'recuperacion');
      assert.equal(find(cases.recovered.destination.seguimiento_id).sustitucion_vigente, false);
      assert.equal(find(cases.historical.destination.seguimiento_id).propietario_sustitucion_seguimiento_id,
        cases.historical.destination.seguimiento_id);
      assert.equal(afterViews.summaryValues.filter(row => row.unidad === cases.historical.dfm).length, 2);
      const closed = afterViews.billingValues.filter(row => row.dfm === cases.manual.dfm && row.km_dia_fuente === 'TANCAMENT');
      assert.equal(closed.length, 1); assert.equal(closed[0].dias_facturables, 11); assert.equal(closed[0].km_facturables, 409.75);
      const rBilling = afterViews.billingRValues.filter(row => row.r_sustituido === 'R-PPBILL');
      assert.equal(rBilling.length, 1); assert.equal(rBilling[0].unidades, 1); assert.equal(rBilling[0].importe, 100);
      r.checks = { summary_rows: afterViews.summary.length, billing_rows: afterViews.billing.length,
        r_billing_rows: afterViews.billingR.length, r_billing_amount: 100,
        zero_day_origin: true, manual_rates: [37.25, 80.5], recovered_destination: true,
        physical_history_deduplicated: true, closed_days: 11, closed_km: 409.75, business_rows_unchanged: true };
    });
    await check('P03', 'the exact Panel query makes one real projection and metadata call per logical PA', async r => {
      assert.deepEqual(fixed.panel.rows, baseline.panel.rows);
      assert.equal(fixed.panel.calls.projection, fixed.panel.rowCount);
      assert.equal(fixed.panel.calls.metadata, fixed.panel.rowCount);
      r.checks = { rows: fixed.panel.rowCount, before: baseline.panel.calls, after: fixed.panel.calls };
    });
    await check('P04', 'a single seguimiento filters before projection and range results stay exact', async r => {
      assert.deepEqual(fixed.single.rows, baseline.single.rows);
      assert.equal(fixed.single.rowCount, 1);
      assert.deepEqual(fixed.single.calls, { projection: 1, metadata: 1 });
      assert.deepEqual(fixed.range.rows, baseline.range.rows);
      assert.ok(fixed.range.rowCount > 0 && fixed.range.rowCount < fixed.panel.rowCount);
      assert.ok(fixed.range.calls.projection <= fixed.panel.rowCount);
      assert.equal(fixed.range.calls.metadata, fixed.range.calls.projection);
      r.checks = { single: fixed.single.calls, range_rows: fixed.range.rowCount,
        range_calls: fixed.range.calls, all_logical_rows: fixed.panel.rowCount };
    });
    await check('P05', 'identities and count queries still prune the unused metadata projection', async r => {
      for (const key of ['identities', 'count']) {
        assert.deepEqual(fixed[key].rows, baseline[key].rows);
        assert.deepEqual(fixed[key].calls, { projection: 0, metadata: 0 });
      }
      r.checks = { identities: fixed.identities.calls, count: fixed.count.calls };
    });
    await check('P06', 'view identity, security, ACL and both original STABLE functions are preserved', async r => {
      assert.deepEqual(afterContract, beforeContract);
      assert.ok(afterContract.options.includes('security_invoker=true'));
      assert.equal((await one(db, `SELECT has_table_privilege('authenticated',
        'app_private.sustitucion_continuidades_alpha75','SELECT') AS allowed`)).allowed, false);
      await db.query('GRANT USAGE ON SCHEMA app_private,auth TO authenticated');
      const reader = await fixture.connect('denied_projection');
      try {
        await reader.query('SET ROLE authenticated');
        for (const setting of ['test.view_allowed', 'test.device_allowed', 'test.user_active']) {
          await reader.query("SELECT set_config($1,'false',false)", [setting]);
          await assert.rejects(() => reader.query(`SELECT ${PROJECTION.replace('(uuid)', '($1)')}`,
            [cases.ordinary.origin.seguimiento_id]), e => e.code === '42501');
          await reader.query("SELECT set_config($1,'true',false)", [setting]);
        }
      } finally { await fixture.close(reader); }
      r.checks = { view_identity_and_contract_unchanged: true, functions_unchanged_and_stable: true,
        security_invoker: true, private_ledger_unreadable: true, permission_denials: 3 };
    });
    await check('P07', 'view security and projection-source drift abort the migration without changing the fixed view', async r => {
      for (const mode of ['view', 'projection']) {
        await db.query('BEGIN');
        try {
          await db.query(`CREATE OR REPLACE VIEW public.paradas_sustitucion_resumen
            WITH(security_invoker=true) AS ${originalView}`);
          if (mode === 'view') await db.query('ALTER VIEW public.paradas_sustitucion_resumen SET(security_invoker=false)');
          else await db.query(originalFunction.replace('BEGIN', 'BEGIN\n -- synthetic projection drift'));
          await assert.rejects(() => db.query(migration), e => e.code === '55000' && /MG75-PANEL-PROYECCION-001/.test(e.message));
        } finally { await db.query('ROLLBACK'); }
        assert.deepEqual(await contract(db), afterContract);
      }
      r.checks = { view_security_drift_rejected: true, function_drift_rejected: true, fixed_view_restored: true };
    });
    await check('P08', 'representative volume stays inside the eight-second Panel budget with one call per PA', async r => {
      const volume = await seedRepresentativeVolume(db);
      assert.ok(volume.logical_pa >= 140);
      assert.ok(volume.physical_records >= 1400 && volume.physical_records < 1500);
      assert.ok(volume.stages >= 10808);
      assert.deepEqual(await snapshotProtectedFacts(db), fixture.protectedBefore);
      const facts = await businessFacts(db);
      const ownerRead = await measure(PANEL_SQL, [], { statementTimeoutMs: 8000 });
      await allowSyntheticAuthenticatedRead(db);
      const authenticatedRead = await measure(PANEL_SQL, [], { authenticated: true, statementTimeoutMs: 8000 });
      assert.deepEqual(authenticatedRead.rows, ownerRead.rows);
      for (const read of [ownerRead, authenticatedRead]) {
        assert.ok(read.rowCount >= 140);
        assert.equal(read.calls.projection, read.rowCount);
        assert.equal(read.calls.metadata, read.rowCount);
      }
      assert.deepEqual(await businessFacts(db), facts);
      assert.deepEqual(await contract(db), afterContract);
      r.checks = { ...volume, returned_rows: ownerRead.rowCount, statement_timeout_ms: 8000,
        owner: { calls: ownerRead.calls, query_ms: ownerRead.elapsedMs },
        authenticated: { calls: authenticatedRead.calls, query_ms: authenticatedRead.elapsedMs },
        authorization_scope: 'Synthetic user/device functions and RLS policies; not deployed Supabase RLS',
        complete_result_parity: true };
      report.representative_volume = r.checks;
    });
    await check('P09', 'synthetic RLS denial removes all rows before the invoker projection runs', async r => {
      const denied = await measure(PANEL_SQL, [], { authenticated: true, viewAllowed: false, statementTimeoutMs: 8000 });
      assert.equal(denied.rowCount, 0);
      assert.deepEqual(denied.calls, { projection: 0, metadata: 0 });
      assert.deepEqual(await snapshotProtectedFacts(db), fixture.protectedBefore);
      r.checks = { denied_rows: 0, calls: denied.calls, synthetic_rls_only: true };
    });
    report.protected_history_and_barriers_unchanged = true;
    report.native_call_counts = { before: baseline.panel.calls, after: fixed.panel.calls, rows: fixed.panel.rowCount };
  } catch (error) {
    failure = error; report.suite_error = { code: error.code, message: error.message };
  } finally {
    if (fixture) {
      try { await fixture.destroy(); report.temporary_database_dropped = true; }
      catch (error) { failure ||= error; report.cleanup_error = error.message; }
    }
    report.finished_at = new Date().toISOString();
    report.passed = !failure && report.cases.length === 9 && report.cases.every(c => c.status === 'passed')
      && report.protected_history_and_barriers_unchanged === true && report.temporary_database_dropped === true;
    if (process.env.METROGESTION_PANEL_PROJECTION_REPORT) {
      const filename = path.resolve(process.env.METROGESTION_PANEL_PROJECTION_REPORT);
      assert.equal(path.extname(filename), '.json');
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  if (failure) throw failure;
});
