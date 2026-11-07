import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createContinuityFixture } from './continuity-scenarios.mjs';
import { one, FIXTURE_ACTOR } from './local-postgres-harness.mjs';

// Default: the existing restricted PostgreSQL17 Unix-socket harness.
// Explicit METROGESTION_SQL_ENGINE=pglite runs the SAME literal SQL in WASM.
// No remote credentials, operational rows, real edit stamps, Sheets or HTTP.
const signature = 'app_private.aplicar_snapshot_manteniment(jsonb,text,uuid,text)';
const baselineMd5 = 'cf7c2a01aaf8db1c2a68c8ba42bd8249';
const candidateMd5 = '4a3fcfe1e98eb6315aef5e5d219c71c0';
const migration = await readFile(new URL(
  '../../supabase/migrations/20261107180725_alpha75_sellos_maestro_iso.sql',
  import.meta.url), 'utf8');
const OLD = '2000-01-01T09:00:00.000Z';
const NEW = '2000-01-02T09:30:00.000Z';
const REGISTRY = '2000-01-03T09:00:00.000Z';
const LATER = '2000-01-04T09:00:00.000Z';
let fixture, db, baselineReproduction, beforeState, afterState;
let beforeMetadata, afterMetadata, beforeOtherFunctions, afterOtherFunctions;
let beforeTriggers, afterTriggers, baselineDefinition, candidateDefinition;

async function createFixture() {
  if (process.env.METROGESTION_SQL_ENGINE !== 'pglite') {
    return createContinuityFixture({ prefix: 'sellos_iso' });
  }
  const engine = new PGlite();
  const admin = {
    query: async (sql, values) => values?.length
      ? engine.query(sql, values)
      : (await engine.exec(sql)).at(-1) ?? { rows: [] },
  };
  try {
    for (const relative of [
      './fixtures/setup.sql',
      '../fixtures/alpha75-24h-paradas-baseline.sql',
      './fixtures/concurrency-history.sql',
      './fixtures/triggers.sql',
      '../../supabase/migrations/20261028174243_alpha75_24h_paradas_independientes.sql',
      './fixtures/recovery-runtime.sql',
      '../integration/fixtures/hotel-views.sql',
      '../integration/fixtures/history-view.sql',
      './fixtures/continuity-runtime.sql',
      './fixtures/continuity-sync-runtime.sql',
      '../../supabase/migrations/20261029060636_alpha75_continuidad_sustitucion_entre_pa.sql',
      '../../supabase/migrations/20261029060925_alpha75_continuidad_barrera_manteniment.sql',
      '../../supabase/migrations/20261031115637_alpha75_panel_sustituciones_proyeccion_unica.sql',
    ]) {
      await admin.query(await readFile(new URL(relative, import.meta.url), 'utf8'));
    }
    return { admin, destroy: () => engine.close(), metadata: { engine: 'pglite', native: false } };
  } catch (error) {
    await engine.close();
    throw error;
  }
}

async function definition() {
  return (await one(db, 'SELECT pg_get_functiondef($1::regprocedure) AS value', [signature])).value;
}
async function metadata() {
  return one(db, 'SELECT p.oid::text,to_jsonb(p)-\'prosrc\' AS properties FROM pg_proc p WHERE oid=$1::regprocedure', [signature]);
}
async function otherFunctions() {
  return (await db.query(`SELECT p.oid::text,md5(pg_get_functiondef(p.oid)) AS body,
    to_jsonb(p)-'prosrc' AS properties
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','app_private') AND p.prokind='f'
      AND p.oid<>$1::regprocedure ORDER BY p.oid`, [signature])).rows;
}
async function triggers() {
  return (await db.query(`SELECT t.oid::text,to_jsonb(t) AS properties,
    pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','app_private') AND NOT t.tgisinternal
    ORDER BY t.oid`)).rows;
}
async function protectedState() {
  return (await one(db, `SELECT jsonb_build_object(
    'hotel',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.registros_hotel x),
    'stages',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.etapas_hotel x),
    'sync',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_parada_sync x),
    'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY seguimiento_id) FROM app_private.manteniment_parada_outbox x),
    'active_queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY vehiculo_id) FROM app_private.manteniment_activo_outbox x),
    'deliveries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY sync_id,revision) FROM app_private.manteniment_entregas_continuidad_alpha75 x),
    'reviews',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM app_private.manteniment_revision_identidad_alpha75 x),
    'flags',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM app_private.manteniment_sync_config x)
  ) AS value`)).value;
}
async function inventory() {
  return {
    protected: await protectedState(),
    vehicles: (await db.query('SELECT to_jsonb(v) AS value FROM public.vehiculos v ORDER BY id')).rows,
    stamps: (await db.query('SELECT to_jsonb(m) AS value FROM app_private.vehiculo_campo_maestro m ORDER BY vehiculo_id,campo')).rows,
    executions: (await db.query('SELECT to_jsonb(e) AS value FROM public.manteniment_sync_ejecuciones e ORDER BY id')).rows,
  };
}
async function isolated(fn) {
  await db.query('BEGIN');
  try { return await fn(); } finally { await db.query('ROLLBACK'); }
}
async function seed(tag, { registry = null, value = 'SYNTHETIC-OLD-VIN' } = {}) {
  const id = randomUUID(), dfm = `SYN-SELLOS-${tag}`;
  await db.query('INSERT INTO public.vehiculos(id,dfm,bastidor) VALUES($1,$2,$3)', [id, dfm, value]);
  // Explicit fictitious initial states, independent of wall-clock time.
  await db.query(`UPDATE app_private.vehiculo_campo_maestro
      SET valor_manteniment=$2,manteniment_cambio_en=$3::timestamptz,
          registro_cambio_en=$4::timestamptz,
          ganador=CASE WHEN $4::timestamptz IS NULL THEN 'baseline' ELSE 'registro' END,
          ganador_en=$4::timestamptz
    WHERE vehiculo_id=$1 AND campo='bastidor'`, [id, value, OLD, registry]);
  return { id, dfm, value };
}
async function state(s) {
  return one(db, `SELECT v.bastidor,
    (SELECT to_jsonb(m) FROM app_private.vehiculo_campo_maestro m
      WHERE m.vehiculo_id=v.id AND m.campo='bastidor') AS stamp
    FROM public.vehiculos v WHERE v.id=$1`, [s.id]);
}
async function receive(s, {
  stamp = NEW, value = 'SYNTHETIC-NEW-VIN', missing = false, field = 'bastidor',
} = {}) {
  const changes = missing ? {} : { [field]: stamp };
  const payload = {
    generado_en: '2000-01-05T00:00:00.000Z',
    filas: [{ dfm: s.dfm, estado: 'ALTA', bastidor: value, cambios_maestro: changes }],
    paradas: [], trabajos: [], pendientes: [],
  };
  return (await one(db, `SELECT app_private.aplicar_snapshot_manteniment(
    $1::jsonb,'manual',$2::uuid,'synthetic_stamp_test') AS value`,
  [JSON.stringify(payload), FIXTURE_ACTOR])).value;
}
const iso = value => value == null ? null : new Date(value).toISOString();

before(async () => {
  fixture = await createFixture();
  db = fixture.admin;
  await db.query("SET TIME ZONE 'UTC'; SET standard_conforming_strings=on;");
  for (const file of [
    '20261029184748_alpha75_autorizar_ejecucion_manteniment.sql',
    '20261101203000_alpha75_sincro7_resolver_tancament_calendario_real.sql',
    '20261107135502_alpha75_sincro_identidad_pa_tramos.sql',
  ]) {
    await db.query(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.query(await readFile(new URL('./fixtures/alpha75-sellos-maestro-iso-runtime.sql', import.meta.url), 'utf8'));
  // Fictitious receiver state: input allowed; output protection remains closed.
  await db.query(`UPDATE app_private.manteniment_sync_config SET
    pausa_importacion_identidad=false,
    solo_lectura_manual_protegida=true,escritura_segura_manual=false WHERE id=1`);
  baselineDefinition = await definition();
  assert.equal((await one(db, 'SELECT md5(pg_get_functiondef($1::regprocedure)) AS value', [signature])).value, baselineMd5);
  baselineReproduction = await isolated(async () => {
    const s = await seed('BASELINE');
    await receive(s);
    return {
      state: await state(s),
      admitted: (await one(db, 'SELECT count(*)::int AS n FROM pg_temp.tmp_manteniment_cambios_maestro')).n,
    };
  });
  await seed('INSTALL-INVARIANT');
  beforeState = await inventory();
  beforeMetadata = await metadata();
  beforeOtherFunctions = await otherFunctions();
  beforeTriggers = await triggers();
  await db.query(migration);
  afterState = await inventory();
  afterMetadata = await metadata();
  afterOtherFunctions = await otherFunctions();
  afterTriggers = await triggers();
  candidateDefinition = await definition();
  console.log(JSON.stringify({
    engine: process.env.METROGESTION_SQL_ENGINE === 'pglite' ? 'pglite' : 'native-postgresql',
    version: (await one(db, 'SELECT version() AS value')).value,
    baseline_md5: baselineMd5, candidate_md5: candidateMd5,
    scope: 'Synthetic data; literal wrapper, stamp arbiter and candidate SQL; base fleet import is a labelled boundary double',
  }));
});
after(async () => { if (fixture) await fixture.destroy(); });

test('SM01 exact installed baseline rejects a valid ISO edit stamp and keeps the prior master value', () => {
  assert.equal(baselineReproduction.admitted, 0);
  assert.equal(baselineReproduction.state.bastidor, 'SYNTHETIC-OLD-VIN');
  assert.equal(baselineReproduction.state.stamp.valor_manteniment, 'SYNTHETIC-NEW-VIN');
  assert.equal(baselineReproduction.state.stamp.ganador, 'baseline');
  assert.equal(iso(baselineReproduction.state.stamp.manteniment_cambio_en), OLD);
});

test('SM02 installation changes one literal filter only; OID/ACL/owner/contracts/triggers/data/barriers stay identical', async () => {
  assert.deepEqual(afterState, beforeState);
  assert.deepEqual(afterMetadata, beforeMetadata);
  assert.deepEqual(afterOtherFunctions, beforeOtherFunctions);
  assert.deepEqual(afterTriggers, beforeTriggers);
  assert.equal((await one(db, 'SELECT md5(pg_get_functiondef($1::regprocedure)) AS value', [signature])).value, candidateMd5);
});

test('SM03 a real supplied newer ISO stamp is admitted and the unchanged arbiter applies the correction', async () => isolated(async () => {
  const s = await seed('NEWER'), protectedBefore = await protectedState();
  await receive(s);
  const current = await state(s);
  assert.equal(current.bastidor, 'SYNTHETIC-NEW-VIN');
  assert.equal(current.stamp.ganador, 'manteniment_alta');
  assert.equal(iso(current.stamp.manteniment_cambio_en), NEW);
  assert.equal(iso(current.stamp.ganador_en), NEW);
  assert.equal(current.stamp.registro_cambio_en, null);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM pg_temp.tmp_manteniment_cambios_maestro')).n, 1);
  assert.deepEqual(await protectedState(), protectedBefore);
}));

test('SM04 old and equal edit stamps cannot overwrite a previously observed field', async () => {
  for (const stamp of ['1999-12-31T09:00:00.000Z', OLD]) {
    await isolated(async () => {
      const s = await seed('STALE'), initial = await state(s);
      await receive(s, { stamp });
      assert.deepEqual(await state(s), initial);
    });
  }
});

test('SM05 absent, null, empty and malformed stamps keep the prior value without generating timestamps', async () => {
  for (const options of [{ missing: true }, { stamp: null }, { stamp: '' }, { stamp: 'not-an-iso-stamp' }]) {
    await isolated(async () => {
      const s = await seed('UNSTAMPED');
      await receive(s, options);
      const current = await state(s);
      assert.equal(current.bastidor, s.value);
      assert.equal(current.stamp.ganador, 'baseline');
      assert.equal(current.stamp.ganador_en, null);
      assert.equal(iso(current.stamp.manteniment_cambio_en), OLD);
      assert.equal((await one(db, 'SELECT count(*)::int AS n FROM pg_temp.tmp_manteniment_cambios_maestro')).n, 0);
    });
  }
});

test('SM06 invalid calendar/time values still fail the timestamptz cast atomically', async () => {
  for (const stamp of ['2000-13-01T09:00:00.000Z', '2000-01-02T99:00:00.000Z']) {
    await isolated(async () => {
      const s = await seed('BAD-DATE'), initial = await inventory();
      await db.query('SAVEPOINT invalid_stamp');
      await assert.rejects(receive(s, { stamp }), error => ['22007', '22008'].includes(error.code));
      await db.query('ROLLBACK TO SAVEPOINT invalid_stamp');
      assert.deepEqual(await inventory(), initial);
    });
  }
});

test('SM07 a newer/equal Registro edit wins over a supplied older/equal Sheet edit', async () => {
  for (const stamp of [NEW, REGISTRY]) {
    await isolated(async () => {
      const s = await seed('REGISTRY-WINS', { registry: REGISTRY, value: 'SYNTHETIC-REGISTRY-VIN' });
      await receive(s, { stamp });
      const current = await state(s);
      assert.equal(current.bastidor, s.value);
      assert.equal(current.stamp.ganador, 'registro');
      assert.equal(iso(current.stamp.ganador_en), REGISTRY);
      assert.equal(iso(current.stamp.registro_cambio_en), REGISTRY);
      assert.equal(iso(current.stamp.manteniment_cambio_en), stamp);
    });
  }
});

test('SM08 a genuinely later supplied Sheet edit wins without changing the Registro stamp', async () => isolated(async () => {
  const s = await seed('SHEET-WINS', { registry: REGISTRY });
  await receive(s, { stamp: LATER });
  const current = await state(s);
  assert.equal(current.bastidor, 'SYNTHETIC-NEW-VIN');
  assert.equal(current.stamp.ganador, 'manteniment_alta');
  assert.equal(iso(current.stamp.ganador_en), LATER);
  assert.equal(iso(current.stamp.registro_cambio_en), REGISTRY);
}));

test('SM09 replaying an observed stamp cannot rejuvenate it or authorize a different later value', async () => isolated(async () => {
  const s = await seed('REPLAY');
  await receive(s);
  const accepted = await state(s);
  await receive(s, { value: 'SYNTHETIC-UNSTAMPED-LATER-VIN' });
  assert.deepEqual(await state(s), accepted);
}));

test('SM10 the existing field whitelist does not let an unrelated stamp authorize bastidor', async () => isolated(async () => {
  const s = await seed('WHITELIST');
  await receive(s, { field: 'not_a_master_field' });
  const current = await state(s);
  assert.equal(current.bastidor, s.value);
  assert.equal(current.stamp.ganador, 'baseline');
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM pg_temp.tmp_manteniment_cambios_maestro')).n, 0);
}));

test('SM11 the existing identity-import pause still rejects before effects; no output flag is opened', async () => isolated(async () => {
  const s = await seed('PAUSED');
  await db.query('UPDATE app_private.manteniment_sync_config SET pausa_importacion_identidad=true WHERE id=1');
  const initial = await inventory();
  await db.query('SAVEPOINT paused_import');
  await assert.rejects(receive(s), /MG_SYNC_PAUSADA_IDENTIDAD/);
  await db.query('ROLLBACK TO SAVEPOINT paused_import');
  assert.deepEqual(await inventory(), initial);
}));

test('SM12 exact baseline guard rejects reinstallation and a drifted importer without replacing either', async () => {
  const initial = await inventory();
  await assert.rejects(db.query(migration), /MG_SELLOS_BASE_INESPERADA/);
  await db.query('ROLLBACK');
  assert.equal(await definition(), candidateDefinition);
  assert.deepEqual(await inventory(), initial);

  const drift = baselineDefinition.replace('  v_payload jsonb := p_payload;', '  v_payload jsonb := p_payload; -- synthetic drift');
  assert.notEqual(drift, baselineDefinition);
  try {
    await db.query(drift);
    const driftedDefinition = await definition();
    await assert.rejects(db.query(migration), /MG_SELLOS_BASE_INESPERADA/);
    await db.query('ROLLBACK');
    assert.equal(await definition(), driftedDefinition);
    assert.deepEqual(await inventory(), initial);
  } finally {
    await db.query('ROLLBACK');
    await db.query(candidateDefinition);
  }
});
