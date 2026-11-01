import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const runtime = await readFile(new URL('./fixtures/manteniment-export-fechas-runtime.sql', import.meta.url), 'utf8');
const baseline = await readFile(new URL('./fixtures/manteniment-trabajos-crear-v1.sql', import.meta.url), 'utf8');
const candidate = await readFile(new URL('../../supabase/candidates/alpha75_export_fechas_origen_v2.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const follow = id(1), board = id(2), record = id(3), stage = id(4), stageFollow = id(5), group = id(6), job = id(7), work = id(8), sync = id(9);
const actual = '2026-10-21T05:44:00+00:00';

async function row(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function exported(db, tracking = follow) {
  return (await row(db, 'SELECT app_private.manteniment_trabajos_por_crear($1::uuid) AS value', [tracking])).value;
}
async function snapshot(db) {
  return (await row(db, `SELECT jsonb_build_object(
    'works',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM app_private.manteniment_t_trabajos x),
    'jobs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.trabajos_etapa_hotel x),
    'stages',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.etapas_hotel x),
    'records',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.registros_hotel x),
    'boards',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.pizarras x),
    'sentinels',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM app_private.test_sync_sentinels x)
  ) AS value`)).value;
}
async function metadata(db) {
  return row(db, `SELECT p.oid::text, pg_get_userbyid(p.proowner) AS owner,
    p.proacl::text AS acl, p.prosecdef, p.provolatile, p.proconfig
    FROM pg_proc p WHERE p.oid='app_private.manteniment_trabajos_por_crear(uuid)'::regprocedure`);
}
async function boot() {
  const db = new PGlite();
  await db.exec(runtime);
  await db.exec(baseline);
  await db.exec('SET timezone = \'UTC\'; GRANT EXECUTE ON FUNCTION app_private.manteniment_trabajos_por_crear(uuid) TO service_role;');
  await db.query('INSERT INTO public.pizarras VALUES($1,$2,$3)', [board, 'en_curso', '2026-11-01']);
  await db.query(`INSERT INTO public.registros_hotel
    (id,seguimiento_id,pizarra_id,numero_parada,vehiculo_sustituido,matricula_sustituido,tipo_unidad,upc,marca,actualizado_en,estado)
    VALUES($1,$2,$3,'SINT-001','TEST-A','SYN0001','TR','UPC SINTETICA','MARCA SINTETICA','2026-11-01T08:00:00Z','en_taller')`, [record, follow, board]);
  await db.query(`INSERT INTO public.etapas_hotel
    (id,registro_hotel_id,seguimiento_id,grupo_documental_id,creado_en,estado,tipo_etapa,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real)
    VALUES($1,$2,$3,$4,'2026-10-22T06:00:00Z','realizada','TRÁMITE',NULL,$5,$5,$5)`, [stage, record, stageFollow, group, actual]);
  await db.query(`INSERT INTO public.trabajos_etapa_hotel
    (id,etapa_hotel_id,km_averia,expediente,motivo_entrada,diagnostico_real,descripcion)
    VALUES($1,$2,12345,'SINT-EXP','Motivo sintético','Diagnóstico sintético','Descripción sintética')`, [job, stage]);
  await db.query(`INSERT INTO app_private.manteniment_t_trabajos
    (id,sync_id,seguimiento_id,trabajo_hotel_id,taller,tipo_trabajo,designacion,fecha_necesidad,fecha_realizada,fecha_recogida,creado_en)
    VALUES($1,$2,$3,$4,'TALLER SINTETICO','TRÁMITE','44TN','2026-10-21','2026-10-21','2026-10-21','2026-10-22T06:00:01Z')`, [work, sync, follow, job]);
  return db;
}
async function isolated(fn) {
  const db = await boot();
  try { await fn(db); } finally { await db.close(); }
}

test('baseline is the captured live exporter and reproduces the ambiguous date contract', async () => isolated(async db => {
  const hash = await row(db, "SELECT md5(pg_get_functiondef('app_private.manteniment_trabajos_por_crear(uuid)'::regprocedure)) AS value");
  assert.equal(hash.value, '87cbb18160b9c88696ae38a98ce7d577');
  const [old] = await exported(db);
  assert.equal(old.fecha_necesidad, '2026-10-21');
  assert.equal(old.fecha_entrada, '2026-10-21');
  assert.equal(Object.hasOwn(old, 'contrato_fechas_version'), false);
  assert.equal(Object.hasOwn(old, 'fecha_necesidad_origen'), false);
  assert.equal(Object.hasOwn(old, 'fecha_programada_visita'), false);
}));

test('real October date does not fill source need or missing agenda; legacy date stays explicitly marked', async () => isolated(async db => {
  const before = await snapshot(db);
  await db.exec(candidate);
  const [value] = await exported(db);
  assert.equal(value.contrato_fechas_version, 2);
  assert.equal(value.fecha_necesidad_origen, null);
  assert.equal(value.procedencia_fecha_necesidad, 'no_acreditada');
  assert.equal(value.fecha_programada_visita, null);
  assert.equal(value.fecha_inicio_real, actual);
  assert.equal(value.fecha_fin_real, actual);
  assert.equal(value.fecha_real, actual);
  assert.equal(value.fecha_necesidad, '2026-10-21');
  assert.equal(value.significado_fecha_necesidad, 'contextual_legacy_no_acreditada');
  assert.equal(value.retener_propuesta, true);
  assert.deepEqual(value.motivos_retencion, ['FECHA_NECESIDAD_ORIGEN_NO_ACREDITADA']);
  assert.equal(value.contexto_operativo_vigente, true);
  assert.deepEqual(await snapshot(db), before);
}));

test('a scheduled visit keeps its timestamp independently of real facts and legacy date', async () => isolated(async db => {
  const scheduled = '2026-10-20T23:30:00+00:00';
  await db.query('UPDATE public.etapas_hotel SET fecha_prevista=$1 WHERE id=$2', [scheduled, stage]);
  await db.query('UPDATE app_private.manteniment_t_trabajos SET fecha_necesidad=$1 WHERE id=$2', ['2026-04-12', work]);
  await db.exec(candidate);
  const [value] = await exported(db);
  assert.equal(value.fecha_programada_visita, scheduled);
  assert.equal(value.fecha_inicio_real, actual);
  assert.equal(value.fecha_necesidad, '2026-04-12');
  assert.equal(value.fecha_necesidad_origen, null);
  assert.equal(value.procedencia_fecha_programada_visita, 'etapas_hotel.fecha_prevista');
  assert.equal(value.etapa_fechas_id, stage);
}));

test('agenda does not manufacture actual dates when all real facts are absent', async () => isolated(async db => {
  await db.query(`UPDATE public.etapas_hotel SET fecha_prevista='2026-11-04T08:30:00Z',
    fecha_inicio_real=NULL,fecha_fin_real=NULL,fecha_real=NULL,estado='pendiente' WHERE id=$1`, [stage]);
  await db.exec(candidate);
  const [value] = await exported(db);
  assert.equal(value.fecha_programada_visita, '2026-11-04T08:30:00+00:00');
  assert.equal(value.fecha_inicio_real, null);
  assert.equal(value.fecha_fin_real, null);
  assert.equal(value.fecha_real, null);
  assert.equal(value.fecha_necesidad_origen, null);
}));

test('archived and recovered proposal remains visible and retained, without applying or acknowledging it', async () => isolated(async db => {
  await db.query("UPDATE public.pizarras SET estado='archivada',fecha='2026-10-22' WHERE id=$1", [board]);
  await db.query("UPDATE public.registros_hotel SET estado='recuperado',retirado_hotel_activo=true WHERE id=$1", [record]);
  const before = await snapshot(db);
  const old = await exported(db);
  await db.exec(candidate);
  const values = await exported(db);
  assert.equal(values.length, old.length);
  assert.equal(values.length, 1);
  assert.equal(values[0].contexto_operativo_vigente, false);
  assert.equal(values[0].retener_propuesta, true);
  assert.deepEqual(values[0].motivos_retencion, ['FECHA_NECESIDAD_ORIGEN_NO_ACREDITADA', 'CONTEXTO_OPERATIVO_NO_VIGENTE_O_AMBIGUO']);
  assert.deepEqual(await snapshot(db), before);
}));

test('each closed, withdrawn, cancelled or unknown record fails the operational-context flag', async () => isolated(async db => {
  await db.exec(candidate);
  for (const estado of ['recuperado', 'reserva_liberada', 'anulado', null]) {
    await db.query('UPDATE public.registros_hotel SET estado=$1 WHERE id=$2', [estado, record]);
    assert.equal((await exported(db))[0].contexto_operativo_vigente, false);
  }
  await db.query("UPDATE public.registros_hotel SET estado='en_taller',retirado_hotel_activo=true WHERE id=$1", [record]);
  assert.equal((await exported(db))[0].contexto_operativo_vigente, false);
  await db.query('UPDATE public.registros_hotel SET retirado_hotel_activo=false,cancelado=true WHERE id=$1', [record]);
  assert.equal((await exported(db))[0].contexto_operativo_vigente, false);
}));

test('two live records in the same board do not accredit a unique operational context', async () => isolated(async db => {
  await db.query(`INSERT INTO public.registros_hotel
    SELECT $1,seguimiento_id,pizarra_id,numero_parada,vehiculo_sustituido,matricula_sustituido,tipo_unidad,upc,marca,
      '2026-10-31T08:00:00Z',estado,cancelado,retirado_hotel_activo FROM public.registros_hotel WHERE id=$2`, [id(13), record]);
  await db.exec(candidate);
  const [value] = await exported(db);
  assert.equal(value.contexto_operativo_vigente, false);
  assert.equal(value.retener_propuesta, true);
  assert.ok(value.motivos_retencion.includes('CONTEXTO_OPERATIVO_NO_VIGENTE_O_AMBIGUO'));
}));

test('unknown, blank and noncanonical states remain visible but cannot accredit operational context', async () => isolated(async db => {
  await db.exec(candidate);
  for (const estado of ['desconocido', '', 'EN_TALLER', 'en_taller ']) {
    await db.query('UPDATE public.registros_hotel SET estado=$1 WHERE id=$2', [estado, record]);
    const values = await exported(db);
    assert.equal(values.length, 1);
    assert.equal(values[0].contexto_operativo_vigente, false);
    assert.equal(values[0].retener_propuesta, true);
    assert.ok(values[0].motivos_retencion.includes('CONTEXTO_OPERATIVO_NO_VIGENTE_O_AMBIGUO'));
  }
}));

test('recognized operational states from the application retain their current-context classification', async () => isolated(async db => {
  await db.exec(candidate);
  for (const estado of [
    'planificado', 'pendiente_taller', 'tramite', 'gestion', 't_pendientes', 'realizada',
    'pendiente_diagnostico', 'pendiente_autorizacion', 'pendiente_repuestos',
    'entrada_taller_programada', 'en_taller', 'terminado_pendiente_recogida',
    'recogido_pendiente_ruta', 'asistencia_24h',
  ]) {
    await db.query('UPDATE public.registros_hotel SET estado=$1 WHERE id=$2', [estado, record]);
    const [value] = await exported(db);
    assert.equal(value.contexto_operativo_vigente, true, estado);
    assert.equal(value.retener_propuesta, true, 'the source need remains unaccredited');
  }
}));

test('two current boards with the same tracking identity are globally ambiguous and stay visible', async () => isolated(async db => {
  await db.query("INSERT INTO public.pizarras VALUES($1,'en_curso','2026-10-30')", [id(30)]);
  await db.query(`INSERT INTO public.registros_hotel
    SELECT $1,seguimiento_id,$2,numero_parada,vehiculo_sustituido,matricula_sustituido,tipo_unidad,upc,marca,
      '2026-10-30T08:00:00Z',estado,cancelado,retirado_hotel_activo FROM public.registros_hotel WHERE id=$3`, [id(31), id(30), record]);
  const before = await snapshot(db);
  const old = await exported(db);
  await db.exec(candidate);
  const values = await exported(db);
  assert.equal(values.length, old.length);
  assert.equal(values.length, 1);
  assert.equal(values[0].contexto_operativo_vigente, false);
  assert.equal(values[0].retener_propuesta, true);
  assert.ok(values[0].motivos_retencion.includes('CONTEXTO_OPERATIVO_NO_VIGENTE_O_AMBIGUO'));
  assert.deepEqual(await snapshot(db), before);
}));

test('dates come from the resolved current stage, retaining old job identities and history', async () => isolated(async db => {
  await db.query("UPDATE public.pizarras SET estado='archivada',fecha='2026-10-22' WHERE id=$1", [board]);
  await db.query("INSERT INTO public.pizarras VALUES($1,'en_curso','2026-11-01')", [id(20)]);
  await db.query(`INSERT INTO public.registros_hotel
    SELECT $1,seguimiento_id,$2,numero_parada,vehiculo_sustituido,matricula_sustituido,tipo_unidad,upc,marca,
      '2026-11-01T09:00:00Z',estado,cancelado,retirado_hotel_activo FROM public.registros_hotel WHERE id=$3`, [id(21), id(20), record]);
  await db.query(`INSERT INTO public.etapas_hotel
    SELECT $1,$2,seguimiento_id,grupo_documental_id,'2026-11-01T09:00:00Z',estado,cancelado,tipo_etapa,
      '2026-11-03T09:30:00Z','2026-11-01T09:15:00Z',NULL,NULL FROM public.etapas_hotel WHERE id=$3`, [id(22), id(21), stage]);
  const before = await snapshot(db);
  await db.exec(candidate);
  const [value] = await exported(db);
  assert.equal(value.trabajo_hotel_id, job);
  assert.equal(value.trabajo_sync_id, sync);
  assert.equal(value.etapa_fechas_id, id(22));
  assert.equal(value.fecha_programada_visita, '2026-11-03T09:30:00+00:00');
  assert.equal(value.fecha_inicio_real, '2026-11-01T09:15:00+00:00');
  assert.equal(value.fecha_fin_real, null);
  assert.equal(value.fecha_real, null);
  assert.equal(value.fecha_necesidad_origen, null);
  assert.deepEqual(await snapshot(db), before);
}));

test('all previous business fields and deterministic ordering are preserved', async () => isolated(async db => {
  await db.query(`INSERT INTO public.trabajos_etapa_hotel
    SELECT $1,etapa_hotel_id,km_averia,expediente,motivo_entrada,diagnostico_real,descripcion,cancelado
    FROM public.trabajos_etapa_hotel WHERE id=$2`, [id(17), job]);
  await db.query(`INSERT INTO app_private.manteniment_t_trabajos
    SELECT $1,$2,seguimiento_id,$3,taller,tipo_trabajo,designacion,'2026-04-12',fecha_realizada,fecha_recogida,
      fuentes,'2026-10-23T06:00:00Z' FROM app_private.manteniment_t_trabajos WHERE id=$4`, [id(18), id(19), id(17), work]);
  const before = await exported(db);
  assert.deepEqual(before.map(x => x.trabajo_sync_id), [id(19), sync]);
  await db.exec(candidate);
  const after = await exported(db);
  assert.deepEqual(after.map(value => Object.fromEntries(Object.keys(before[0]).map(key => [key, value[key]]))), before);
  assert.deepEqual(await exported(db), after);
  assert.deepEqual(await exported(db, id(999)), []);
}));

test('existing source/cancellation/24H exclusions are unchanged', async () => isolated(async db => {
  const variants = [
    { sql: "UPDATE app_private.manteniment_t_trabajos SET fuentes='[{\"fila\":5}]'::jsonb WHERE id=$1", params: [work] },
    { sql: 'UPDATE public.trabajos_etapa_hotel SET cancelado=true WHERE id=$1', params: [job] },
    { sql: "UPDATE public.etapas_hotel SET tipo_etapa='24H' WHERE id=$1", params: [stage] },
    { sql: "UPDATE public.etapas_hotel SET estado='anulada' WHERE id=$1", params: [stage] },
  ];
  for (const change of variants) {
    await db.exec('BEGIN');
    await db.query(change.sql, change.params);
    const old = await exported(db);
    await db.exec('ROLLBACK');
    await db.exec(candidate);
    await db.exec('BEGIN');
    await db.query(change.sql, change.params);
    assert.deepEqual(await exported(db), old);
    assert.deepEqual(old, []);
    await db.exec('ROLLBACK');
    await db.exec(baseline);
  }
}));

test('replacement and repeated installation preserve owner, privileges, signature, stability and data', async () => isolated(async db => {
  const beforeMeta = await metadata(db);
  const beforeData = await snapshot(db);
  await db.exec(candidate);
  await db.exec(candidate);
  assert.deepEqual(await metadata(db), beforeMeta);
  assert.deepEqual(await snapshot(db), beforeData);
  assert.equal(beforeMeta.prosecdef, true);
  assert.equal(beforeMeta.provolatile, 's');
  assert.deepEqual(beforeMeta.proconfig, ['search_path=pg_catalog, public, app_private']);
}));

test('candidate rejects a missing or drifted base instead of creating/replacing an unverified export', async () => isolated(async db => {
  await db.exec("COMMENT ON FUNCTION app_private.manteniment_trabajos_por_crear(uuid) IS 'not a definition change';");
  await db.exec(candidate);
  await db.exec("ALTER FUNCTION app_private.manteniment_trabajos_por_crear(uuid) SET search_path TO pg_catalog;");
  await assert.rejects(db.exec(candidate), /MG_FECHAS_BASE_NO_ACREDITADA/);
  await db.exec('ROLLBACK');
  assert.deepEqual((await metadata(db)).proconfig, ['search_path=pg_catalog']);
  await db.exec('DROP FUNCTION app_private.manteniment_trabajos_por_crear(uuid)');
  await assert.rejects(db.exec(candidate), /MG_FECHAS_BASE_NO_ACREDITADA/);
  await db.exec('ROLLBACK');
  assert.equal((await row(db, "SELECT to_regprocedure('app_private.manteniment_trabajos_por_crear(uuid)') AS value")).value, null);
}));
