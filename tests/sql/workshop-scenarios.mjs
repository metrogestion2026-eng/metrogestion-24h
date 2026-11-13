import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createEditorFixture } from './editor-scenarios.mjs';
import { FIXTURE_ACTOR, FIXTURE_BOARD, one, snapshotProtectedFacts } from './local-postgres-harness.mjs';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const from = relative => new URL(relative, import.meta.url);
export const WORKSHOP_MIGRATION = new URL('20261113171227_alpha75_botones_hitos_taller.sql', migrations);

export async function workshopMigration() {
  return readFile(WORKSHOP_MIGRATION, 'utf8');
}

/** Previous browser journeys use their frozen runtime, including its recovery
 * semantics. Install only the real read-only candidate context block there.
 * No fabricated response and no backfill are added to those historical tests.
 */
export async function loadWorkshopContextRuntime(db) {
  const present = await one(db, "SELECT to_regprocedure('public.obtener_contexto_taller_t_alpha75(uuid[])') IS NOT NULL AS value");
  if (present.value) return;
  const sql = await workshopMigration();
  const begin = '-- BEGIN ALPHA75_TALLER_CONTEXT';
  const end = '-- END ALPHA75_TALLER_CONTEXT';
  assert.equal(sql.split(begin).length, 2);
  assert.equal(sql.split(end).length, 2);
  await db.query(sql.slice(sql.indexOf(begin) + begin.length, sql.indexOf(end)));
}

async function embeddedEditorFixture() {
  const engine = new PGlite();
  // PGlite's prepared query API accepts one statement, while pg.query accepts a
  // SQL script. This adapter preserves the latter for fixture setup only.
  const db = {
    query: (sql, values) => values?.length
      ? engine.query(sql, values)
      : engine.exec(sql).then(results => results.at(-1) || { rows: [] }),
  };
  try {
    for (const relative of [
      './fixtures/setup.sql', '../fixtures/alpha75-24h-paradas-baseline.sql',
      './fixtures/concurrency-history.sql', './fixtures/triggers.sql',
      '../../supabase/migrations/20261028174243_alpha75_24h_paradas_independientes.sql',
      './fixtures/recovery-runtime.sql', '../integration/fixtures/hotel-views.sql',
      '../integration/fixtures/history-view.sql', './fixtures/continuity-runtime.sql',
      './fixtures/continuity-sync-runtime.sql',
      '../../supabase/migrations/20261029060636_alpha75_continuidad_sustitucion_entre_pa.sql',
      '../../supabase/migrations/20261029060925_alpha75_continuidad_barrera_manteniment.sql',
      '../../supabase/migrations/20261031115637_alpha75_panel_sustituciones_proyeccion_unica.sql',
      './fixtures/editor-runtime.sql',
      '../../supabase/migrations/20261029072758_alpha75_editor_timestamps_exactos.sql',
    ]) {
      try { await db.query(await readFile(from(relative), 'utf8')); }
      catch (error) { error.message = `${relative}: ${error.message}`; throw error; }
    }
    await db.query(`INSERT INTO public.usuarios(id,nombre,apellidos,correo,tipo_usuario,permisos,activo)
      VALUES($1,'Hitos','Sintéticos','workshop@example.invalid','administrador_principal','{}',true)`, [FIXTURE_ACTOR]);
    return { admin: db, metadata: { engine: 'PGlite / PostgreSQL17, single connection' }, destroy: () => engine.close() };
  } catch (error) { await engine.close(); throw error; }
}

export async function createWorkshopFixture({ native = Boolean(process.env.METROGESTION_LOCAL_PG_DSN) } = {}) {
  const fixture = native ? await createEditorFixture({ prefix: 'workshop' }) : await embeddedEditorFixture();
  try {
    const db = fixture.admin;
    await db.query(`INSERT INTO public.catalogo_estados_hotel(codigo,nombre)
      SELECT x,x FROM unnest(ARRAY['terminado','tramite','gestion','planificado','anulado']) x ON CONFLICT DO NOTHING`);
    for (const name of [
      '20260909073000_alpha74_t_pendientes_30d.sql',
      '20261104063000_alpha75_situacion_operativa_proyeccion.sql',
      '20261104063100_alpha75_situacion_operativa_sincronizacion.sql',
      '20261104091228_alpha75_sustitucion_vigente_por_hechos.sql',
      '20261109084500_alpha75_lugar_desde_t_en_curso.sql',
      '20261109095500_alpha75_cierre_fisico_tramites_posteriores.sql',
      '20261110063000_alpha75_movimiento_fecha_estancia_taller.sql',
      '20261110174000_alpha75_recuperacion_activa_estado.sql',
      '20261111165000_alpha75_estado_real_orden_t.sql',
    ]) {
      try { await db.query(await readFile(new URL(name, migrations), 'utf8')); }
      catch (error) { error.message = `${name}: ${error.message}`; throw error; }
    }
    await db.query(await readFile(from('./fixtures/workshop-runtime.sql'), 'utf8'));
    const baseline = await one(db, "SELECT md5(pg_get_functiondef('app_private.manteniment_fechas_desde_etapa()'::regprocedure)) AS value");
    assert.equal(baseline.value, '44beb99baf31bfedddb7fc99453a34cb');
    const sql = await workshopMigration();
    assert.ok(sql.includes('create or replace function public.registrar_hito_taller_alpha75('), 'Workshop migration is not ready');
    const beforeCandidate = await snapshotProtectedFacts(db);
    await db.query(sql);
    assert.deepEqual(await snapshotProtectedFacts(db), beforeCandidate,
      'Installing the milestone candidate must not rewrite synthetic historical facts or sync barriers');
    fixture.metadata.workshopMigrationSha256 = createHash('sha256').update(sql).digest('hex');
    return fixture;
  } catch (error) { await fixture.destroy(); throw error; }
}

export async function workshopInventory(db, id) {
  return (await one(db, `SELECT jsonb_build_object(
    'ficha',(SELECT to_jsonb(r) FROM public.registros_hotel r WHERE id=$1),
    'etapas',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.posicion,e.id),'[]') FROM public.etapas_hotel e WHERE registro_hotel_id=$1),
    'trabajos',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.trabajos_etapa_hotel t JOIN public.etapas_hotel e ON e.id=t.etapa_hotel_id WHERE e.registro_hotel_id=$1),
    'documentos',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') FROM public.documentos_gestion d WHERE registro_hotel_id=$1),
    'reserva',(SELECT to_jsonb(s) FROM public.reservas_hotel s JOIN public.registros_hotel r ON r.vehiculo_reserva=s.vehiculo_codigo WHERE r.id=$1),
    'propagados',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]') FROM app_private.manteniment_t_trabajos w JOIN public.registros_hotel r ON r.seguimiento_id=w.seguimiento_id WHERE r.id=$1)
  ) AS value`, [id])).value;
}

export async function seedWorkshopScenario(db, { tag, type = 'ENTRADA TALLER', model = 'entrada_hitos_v1' } = {}) {
  assert.match(tag || '', /^[A-Z0-9_]{2,24}$/);
  const reserve = `R-HITO-${tag}`, dfm = `SYN-HITO-${tag}`;
  await db.query(`INSERT INTO public.vehiculos_hotel_autocompletar(dfm,matricula,tipo_sustituto_catalogo,etiqueta_reserva)
    VALUES($1,$2,'RESERVA','Reserva sintética de hitos')`, [reserve, `M${tag}`]);
  await db.query("INSERT INTO public.reservas_hotel(vehiculo_codigo,matricula,estado) VALUES($1,$2,'libre')", [reserve, `M${tag}`]);
  const saved = (await one(db, 'SELECT public.crear_ficha_hotel($1::jsonb,$2) AS value', [JSON.stringify({
    vehiculo_sustituido: dfm, vehiculo_reserva: reserve, matricula_reserva: `M${tag}`,
    estado: 'pendiente_taller', tipo_movimiento: 'TALLER', fecha_parada: '2026-11-12',
    lugar: 'Taller sintético', observaciones: 'Fixture hitos sin datos operativos',
  }), `fixture_hitos_${tag}`])).value;
  const id = saved.id;
  if (model) await db.query(`INSERT INTO app_private.hotel_flujo_modelo(seguimiento_id,modelo,creado_por)
    SELECT seguimiento_id,$2,$3 FROM public.registros_hotel WHERE id=$1
    ON CONFLICT(seguimiento_id) DO UPDATE SET modelo=excluded.modelo`, [id, model, FIXTURE_ACTOR]);
  // Explicitly choose manual positions. Inserting recovery first avoids the
  // unrelated automatic generator, without disabling any product trigger.
  const recovery = (await one(db, `INSERT INTO public.etapas_hotel
    (registro_hotel_id,nombre,posicion,tipo_etapa,accion_sistema,creado_por,modificado_por)
    VALUES($1,'Recuperar ruta y liberar reserva',30,'otro','recuperar_y_liberar',$2,$2)
    RETURNING to_jsonb(etapas_hotel) AS value`, [id, FIXTURE_ACTOR])).value;
  const entry = (await one(db, `INSERT INTO public.etapas_hotel
    (registro_hotel_id,nombre,posicion,tipo_etapa,lugar,creado_por,modificado_por)
    VALUES($1,'Entrada taller sintético',10,$2,'Taller sintético',$3,$3)
    RETURNING to_jsonb(etapas_hotel) AS value`, [id, type, FIXTURE_ACTOR])).value;
  const work = (await one(db, `INSERT INTO public.trabajos_etapa_hotel
    (etapa_hotel_id,tipo_trabajo,descripcion,motivo_entrada,creado_por,modificado_por)
    VALUES($1,'TST','Trabajo sintético preservado','Revisión sintética',$2,$2) RETURNING id`, [entry.id, FIXTURE_ACTOR])).id;
  await db.query(`INSERT INTO public.documentos_gestion(registro_hotel_id,etapa_hotel_id,grupo_etapa_id,seguimiento_id,nombre_original)
    SELECT $1,e.id,e.grupo_documental_id,e.seguimiento_id,'archivo-sintetico-taller.pdf' FROM public.etapas_hotel e WHERE e.id=$2`, [id, entry.id]);
  await db.query(`INSERT INTO public.documentos_gestion(registro_hotel_id,etapa_hotel_id,grupo_etapa_id,seguimiento_id,nombre_original)
    SELECT $1,e.id,e.grupo_documental_id,e.seguimiento_id,'archivo-sintetico-recuperacion.pdf' FROM public.etapas_hotel e WHERE e.id=$2`, [id, recovery.id]);
  const visit = (await one(db, `INSERT INTO app_private.manteniment_t_visitas(seguimiento_id,modalidad,grupo_entrada_id)
    SELECT seguimiento_id,'taller',$2 FROM public.registros_hotel WHERE id=$1 RETURNING id`, [id, entry.grupo_documental_id])).id;
  await db.query(`INSERT INTO app_private.manteniment_t_trabajos(seguimiento_id,visita_id,trabajo_hotel_id,designacion)
    SELECT seguimiento_id,$2,$3,'Revisión sintética' FROM public.registros_hotel WHERE id=$1`, [id, visit, work]);
  await db.query(`INSERT INTO app_private.manteniment_parada_sync(seguimiento_id)
    SELECT seguimiento_id FROM public.registros_hotel WHERE id=$1 ON CONFLICT DO NOTHING`, [id]);
  return { id, tag, dfm, reserve, entry, recovery, work, board: FIXTURE_BOARD,
    before: await workshopInventory(db, id) };
}

export async function currentStage(db, id) {
  return (await one(db, 'SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE id=$1', [id])).value;
}

export async function markWorkshopMilestone(db, scenario, hito, { version, request, stageId = scenario.entry.id } = {}) {
  const stage = await currentStage(db, stageId);
  return (await one(db, 'SELECT public.registrar_hito_taller_alpha75($1,$2,$3,$4) AS value',
    [stageId, version ?? stage.version, hito, request ?? `fixture_${scenario.tag}_${hito}`])).value;
}
