import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createLocalFixture, FIXTURE_ACTOR, one, snapshotProtectedFacts } from './local-postgres-harness.mjs';
import { loadRecoveryRuntime } from './recovery-scenarios.mjs';

export const CONTINUITY_RULE = 'MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001';
export const CONTINUITY_MIGRATION = new URL('../../supabase/migrations/20261029060636_alpha75_continuidad_sustitucion_entre_pa.sql', import.meta.url);
export const CONTINUITY_SYNC_MIGRATION = new URL('../../supabase/migrations/20261029060925_alpha75_continuidad_barrera_manteniment.sql', import.meta.url);

/** A fresh, local-only database. No users or operational rows are imported.
 * Views must be loaded BEFORE the migrations; reloading the old view fixtures
 * afterwards would erase the ownership projection under test.
 */
export async function createContinuityFixture({ beforeMigrations, ...options } = {}) {
  const fixture = await createLocalFixture(options);
  try {
    await loadRecoveryRuntime(fixture.admin);
    for (const relative of [
      '../integration/fixtures/hotel-views.sql', '../integration/fixtures/history-view.sql',
      './fixtures/continuity-runtime.sql', './fixtures/continuity-sync-runtime.sql',
    ]) await fixture.admin.query(await readFile(new URL(relative, import.meta.url), 'utf8'));
    if (beforeMigrations) await beforeMigrations(fixture.admin);
    fixture.baseProtectedBefore = fixture.protectedBefore;
    fixture.protectedBefore = await snapshotProtectedFacts(fixture.admin);
    for (const [name, url] of [['continuity', CONTINUITY_MIGRATION], ['continuitySync', CONTINUITY_SYNC_MIGRATION]]) {
      const sql = await readFile(url, 'utf8');
      assert.ok(sql.trim().length > 100, `${name} migration is not ready`);
      await fixture.admin.query(sql);
      fixture.metadata[`${name}MigrationSha256`] = createHash('sha256').update(sql).digest('hex');
    }
    assert.deepEqual(await snapshotProtectedFacts(fixture.admin), fixture.protectedBefore,
      'Installing continuity must not rewrite protected history, manual totals or sync flags');
    return fixture;
  } catch (error) {
    await fixture.destroy();
    throw error;
  }
}

export async function previewContinuity(client, pair, { origin = pair.origin.id, entry = pair.entry.id } = {}) {
  return (await one(client, 'SELECT public.previsualizar_continuidad_sustitucion_alpha75($1,$2,$3) AS value',
    [pair.destination.id, origin, entry])).value;
}

export async function confirmContinuity(client, pair, {
  preview = pair.preview, request = `continuity_${pair.tag}_confirm`,
} = {}) {
  const p = preview.prevision;
  return (await one(client, `SELECT public.confirmar_continuidad_sustitucion_alpha75($1,$2,$3,$4,$5,$6,$7,$8) AS value`,
    [p.origen.id, p.destino.id, p.entrada.id, p.origen.version, p.destino.version, p.entrada.version,
      p.huella_prevision, request])).value;
}

/** Persists an explicit 24H assignment and a separate workshop entry.
 * originDaysAgo=2 / entryDaysAgo=1 gives 1 origin day and 2 destination days.
 * Zero origin days: pass both offsets as 1. All timestamps use Madrid.
 * Manual daily rates are per PA; a null rate uses the synthetic CTM value.
 */
export async function seedContinuityPair(client, {
  tag, originDaysAgo = 2, entryDaysAgo = 1, substituteType = 'RESERVA',
  originManualRate = null, destinationManualRate = null,
} = {}) {
  assert.match(tag || '', /^[A-Z0-9_-]{3,24}$/);
  assert.ok(Number.isInteger(originDaysAgo) && Number.isInteger(entryDaysAgo));
  assert.ok(originDaysAgo >= 0 && entryDaysAgo >= 0);
  assert.ok(['RESERVA', 'FLOTA'].includes(substituteType));
  const dfm = `TEST-C-${tag}`, reserve = `${substituteType === 'RESERVA' ? 'R' : 'F'}-C-${tag}`;
  const registration = `MC${tag.replaceAll(/[^A-Z0-9]/g, '')}`;
  const dates = await one(client, `SELECT
    ((clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date)::text AS today,
    ((clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date-$1::int)::text AS origin,
    ((clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date-$2::int)::text AS entry`, [originDaysAgo, entryDaysAgo]);
  await client.query(`INSERT INTO public.vehiculos_hotel_autocompletar(dfm,matricula,tipo_sustituto_catalogo,etiqueta_reserva)
    VALUES($1,$2,$3,'Sustituto sintético de continuidad')`, [reserve, registration, substituteType]);
  if (substituteType === 'RESERVA') await client.query(`INSERT INTO public.reservas_hotel(vehiculo_codigo,matricula,estado,pendientes)
    VALUES($1,$2,'libre','')`, [reserve, registration]);
  // Explicit synthetic windows straddle today, including the first day of a
  // real month. Positive tests never fail merely because yesterday just closed.
  await client.query(`INSERT INTO public.cierres_facturacion(periodo,fecha_inicio,fecha_cierre)
    VALUES(to_char($1::date-interval '1 month','YYYY-MM'),$1::date-40,$1::date-11),
      (to_char($1::date,'YYYY-MM'),$1::date-10,$1::date+20),
      (to_char($1::date+interval '1 month','YYYY-MM'),$1::date+21,$1::date+50)
    ON CONFLICT DO NOTHING`, [dates.today]);
  await client.query('INSERT INTO public.medias_km_dfm(dfm,km_dia) VALUES($1,100)', [dfm]);
  const activation = (await one(client, 'SELECT public.guardar_activacion_24h(NULL,$1::jsonb,$2) AS value', [JSON.stringify({
    dfm, averia: 'Avería sintética con continuidad explícita', resultado: 'necesita_sustitucion',
    estado_seguimiento: 'en_curso', fecha_activacion: dates.origin, hora_activacion: '09:00',
    numero_caso: `SYN-C-${tag}`, vehiculo_sustituto: reserve, matricula_sustituto: registration,
  }), `continuity_${tag}_assistance`])).value;
  const originId = (await one(client, 'SELECT registro_hotel_id FROM public.activaciones_24h WHERE id=$1', [activation.id])).registro_hotel_id;
  const result = (await one(client, 'SELECT public.crear_ficha_hotel($1::jsonb,$2) AS value', [JSON.stringify({
    vehiculo_sustituido: dfm, estado: 'en_taller', tipo_movimiento: 'TALLER', fecha_parada: dates.entry,
    lugar: 'Taller sintético de continuidad', observaciones: `PA destino sintética ${tag}`,
  }), `continuity_${tag}_workshop`])).value;
  const destinationId = result.id;
  await client.query(`INSERT INTO app_private.hotel_flujo_modelo(seguimiento_id,modelo,creado_por)
    SELECT seguimiento_id,'entrada_hitos_v1',$2 FROM public.registros_hotel WHERE id=$1
    ON CONFLICT(seguimiento_id) DO UPDATE SET modelo=excluded.modelo`, [destinationId, FIXTURE_ACTOR]);
  const entry = (await one(client, `INSERT INTO public.etapas_hotel
    (registro_hotel_id,nombre,posicion,estado,tipo_etapa,fecha_inicio_real,lugar,observaciones,creado_por,modificado_por)
    VALUES($1,'Entrada real de continuidad',10,'en_curso','entrada_taller',($2::date+time '11:00') AT TIME ZONE 'Europe/Madrid',
      'Taller sintético de continuidad','Hecho real sintético guardado antes de la confirmación',$3,$3)
    RETURNING to_jsonb(etapas_hotel) AS value`, [destinationId, dates.entry, FIXTURE_ACTOR])).value;
  let recovery = (await one(client, `SELECT to_jsonb(e) AS value FROM public.etapas_hotel e
    WHERE registro_hotel_id=$1 AND NOT cancelado AND accion_sistema='recuperar_y_liberar'
    ORDER BY posicion,id LIMIT 1`, [destinationId]))?.value;
  if (!recovery) recovery = (await one(client, `INSERT INTO public.etapas_hotel
    (registro_hotel_id,nombre,posicion,estado,tipo_etapa,accion_sistema,observaciones,creado_por,modificado_por)
    VALUES($1,'Recuperar ruta y liberar reserva',90,'pendiente','otro','recuperar_y_liberar',
      'Recuperación futura elegida expresamente para el ensayo',$2,$2)
    RETURNING to_jsonb(etapas_hotel) AS value`, [destinationId, FIXTURE_ACTOR])).value;
  for (const [id, rate] of [[originId, originManualRate], [destinationId, destinationManualRate]]) {
    if (rate != null) await client.query(`INSERT INTO public.ajustes_sustitucion_parada(seguimiento_id,km_dia_manual,observaciones)
      SELECT seguimiento_id,$2,'Media manual sintética propia de esta PA' FROM public.registros_hotel WHERE id=$1`, [id, rate]);
  }
  const origin = (await one(client, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [originId])).value;
  const destination = (await one(client, 'SELECT to_jsonb(r) AS value FROM public.registros_hotel r WHERE id=$1', [destinationId])).value;
  const pair = { tag, dfm, reserve, registration, dates, origin, destination, entry, recovery, activation };
  pair.preview = await previewContinuity(client, pair);
  return pair;
}
