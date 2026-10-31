import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContinuityFixture, seedContinuityPair, previewContinuity, confirmContinuity } from './continuity-scenarios.mjs';
import { one, FIXTURE_ACTOR, snapshotProtectedFacts } from './local-postgres-harness.mjs';

export const EDITOR_TIMESTAMP_MIGRATION = new URL('../../supabase/migrations/20261029072758_alpha75_editor_timestamps_exactos.sql', import.meta.url);

/** Complete candidate plus literal editor persistence/reader functions.
 * No remote connection, operational row, JWT or external service is imported.
 * The owner/authorization mapping is the same synthetic harness as continuity.
 */
export async function createEditorFixture({ timestampFix = true, beforeTimestampMigration, ...options } = {}) {
  const fixture = await createContinuityFixture({ prefix: 'editor', ...options });
  try {
    const sql = await readFile(new URL('./fixtures/editor-runtime.sql', import.meta.url), 'utf8');
    await fixture.admin.query(sql);
    fixture.metadata.editorRuntimeSha256 = createHash('sha256').update(sql).digest('hex');
    if (beforeTimestampMigration) await beforeTimestampMigration(fixture.admin);
    if (timestampFix) {
      const migration = await readFile(EDITOR_TIMESTAMP_MIGRATION, 'utf8');
      assert.ok(migration.trim().length > 100, 'The timestamp migration is not ready');
      await fixture.admin.query(migration);
      fixture.metadata.editorTimestampMigrationSha256 = createHash('sha256').update(migration).digest('hex');
    }
    await fixture.admin.query(`
      INSERT INTO public.usuarios(id,nombre,apellidos,correo,tipo_usuario,permisos,activo)
      VALUES($1,'Editor','Sintético','editor@example.invalid','administrador_principal','{}',true)
    `, [FIXTURE_ACTOR]);
    await fixture.admin.query(`
      UPDATE public.catalogo_estados_hotel SET nombre=codigo;
      UPDATE public.catalogo_estados_etapa_hotel SET nombre=codigo;
      INSERT INTO public.catalogo_tipos_etapa_hotel(codigo,nombre)
      SELECT x,x FROM unnest(ARRAY['otro','24H','entrada_taller','recogida_taller']) x;
      INSERT INTO public.catalogo_tipos_trabajo(codigo,nombre,requiere_expediente,requiere_diagnostico,activo)
      VALUES('AV','Avería sintética',false,false,true),('TST','Trabajo sintético',false,false,true);
    `);
    assert.deepEqual(await snapshotProtectedFacts(fixture.admin), fixture.protectedBefore);
    return fixture;
  } catch (error) {
    await fixture.destroy();
    throw error;
  }
}

export async function editorDetail(db, id) {
  return (await one(db, 'SELECT public.obtener_ficha_hotel_edicion_alpha72($1) AS value', [id])).value;
}

/** Real-editor payload preserving the raw SQL ISO strings by default. The
 * optional legacy Madrid form exists only for before-fix regression evidence.
 * SQL serialization retains all six fractional digits. Browser tests use the
 * actual product JS instead of this helper.
 */
export async function editorPayload(db, id, { timestampFormat = 'raw' } = {}) {
  assert.ok(['raw','madrid'].includes(timestampFormat));
  const detail = await editorDetail(db, id);
  const exact = timestampFormat === 'madrid' ? (await one(db, `SELECT jsonb_build_object(
    'ficha',(SELECT jsonb_build_object(
      'fecha_entrada',to_char(fecha_entrada AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD"T"HH24:MI:SS.US'),
      'fecha_limite_sustitucion',to_char(fecha_limite_sustitucion AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD"T"HH24:MI:SS.US'))
      FROM public.registros_hotel WHERE id=$1),
    'etapas',(SELECT jsonb_object_agg(id,jsonb_build_object(
      'fecha_prevista',to_char(fecha_prevista AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD"T"HH24:MI:SS.US'),
      'fecha_inicio_real',to_char(fecha_inicio_real AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD"T"HH24:MI:SS.US'),
      'fecha_fin_real',to_char(fecha_fin_real AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD"T"HH24:MI:SS.US'),
      'fecha_real',to_char(fecha_real AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD"T"HH24:MI:SS.US')))
      FROM public.etapas_hotel WHERE registro_hotel_id=$1)
  ) AS value`, [id])).value : null;
  const f = { ...detail.ficha, ...exact?.ficha, anotaciones_manuales: detail.anotaciones_manuales };
  const etapas = detail.etapas.map(e => ({ ...e, ...exact?.etapas[e.id] }));
  return {
    p_registro_id: id, p_version: detail.ficha.version, p_ficha: f, p_etapas: etapas,
    p_identidad: {
      registro_id: id, seguimiento_id: f.seguimiento_id, pizarra_id: f.pizarra_id,
      numero_parada: f.numero_parada, vehiculo_sustituido: f.vehiculo_sustituido,
      matricula_sustituido: f.matricula_sustituido,
    },
  };
}

export async function saveEditor(db, payload, request) {
  return (await one(db, 'SELECT public.guardar_ficha_hotel_edicion_alpha73($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6) AS value',
    [payload.p_registro_id, payload.p_version, JSON.stringify(payload.p_ficha), JSON.stringify(payload.p_etapas),
      JSON.stringify(payload.p_identidad), request])).value;
}

/** Ready-to-edit source and destination, existing T/work, precise persisted
 * physical facts, normalized positions before the immutable continuity cut.
 */
export async function seedEditorContinuityPair(db, { tag, precision = true, confirm = true, ...options } = {}) {
  const pair = await seedContinuityPair(db, { tag, ...options });
  await db.query(`INSERT INTO public.hotel_edicion_piloto(registro_hotel_id,activo,observaciones)
    VALUES($1,true,'Editor sintético'),($2,true,'Editor sintético')
    ON CONFLICT(registro_hotel_id) DO UPDATE SET activo=true`, [pair.origin.id,pair.destination.id]);
  if (precision) {
    await db.query(`UPDATE public.registros_hotel SET fecha_entrada=(fecha_parada+time '09:00:21.456789') AT TIME ZONE 'Europe/Madrid'
      WHERE id=ANY($1::uuid[])`, [[pair.origin.id,pair.destination.id]]);
    await db.query(`UPDATE public.etapas_hotel SET fecha_inicio_real=($2::date+time '11:00:37.123456') AT TIME ZONE 'Europe/Madrid'
      WHERE id=$1`, [pair.entry.id,pair.dates.entry]);
  }
  pair.work = (await one(db, `INSERT INTO public.trabajos_etapa_hotel
    (etapa_hotel_id,tipo_trabajo,categoria_tecnica,motivo_entrada,diagnostico_real,expediente,descripcion,observaciones,creado_por,modificado_por)
    VALUES($1,'TST','Revisión sintética','Taller','Diagnóstico sintético','SYN-EDITOR','Trabajo ya existente','Nota de trabajo inicial',$2,$2)
    RETURNING to_jsonb(trabajos_etapa_hotel) AS value`, [pair.entry.id,FIXTURE_ACTOR])).value;
  await db.query('SELECT app_private.normalizar_orden_t_parada($1),app_private.normalizar_orden_t_parada($2)', [pair.origin.id,pair.destination.id]);
  pair.origin=(await one(db,'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1',[pair.origin.id])).value;
  pair.destination=(await one(db,'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1',[pair.destination.id])).value;
  pair.entry=(await one(db,'SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE id=$1',[pair.entry.id])).value;
  pair.recovery=(await one(db,'SELECT to_jsonb(e) AS value FROM public.etapas_hotel e WHERE id=$1',[pair.recovery.id])).value;
  pair.preview=await previewContinuity(db,pair);
  if (confirm) pair.confirmation=await confirmContinuity(db,pair);
  return pair;
}

export async function editorInventory(db, pair) {
  return (await one(db,`SELECT jsonb_build_object(
    'pa',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.registros_hotel r WHERE vehiculo_sustituido=$1),
    'etapas',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id WHERE r.vehiculo_sustituido=$1),
    'trabajos',(SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.trabajos_etapa_hotel w JOIN public.etapas_hotel e ON e.id=w.etapa_hotel_id JOIN public.registros_hotel r ON r.id=e.registro_hotel_id WHERE r.vehiculo_sustituido=$1),
    'notas',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]') FROM public.anotaciones_manuales_hotel n WHERE seguimiento_id IN ($3,$4)),
    'activacion',(SELECT to_jsonb(a) FROM public.activaciones_24h a WHERE a.dfm=$1),
    'links',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM app_private.sustitucion_continuidades_alpha75 c WHERE afectado_dfm=$1),
    'reserva',(SELECT to_jsonb(r) FROM public.reservas_hotel r WHERE vehiculo_codigo=$2),
    'sync',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.seguimiento_id) FROM app_private.manteniment_parada_sync s WHERE seguimiento_id IN ($3,$4)),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.seguimiento_id),'[]') FROM app_private.manteniment_parada_outbox o WHERE seguimiento_id IN ($3,$4))
  ) AS value`,[pair.dfm,pair.reserve,pair.origin.seguimiento_id,pair.destination.seguimiento_id])).value;
}
