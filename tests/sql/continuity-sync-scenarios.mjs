import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { one, FIXTURE_ACTOR, FIXTURE_BOARD } from './local-postgres-harness.mjs';
import { seedContinuityPair } from './continuity-scenarios.mjs';

export const SYNTHETIC_SYNC_TOKEN = `mg_${'a'.repeat(64)}`;
export const LEGACY_PENDING = '00000000-0000-4000-8000-000000202556';
export const LEGACY_CONSUMED = '00000000-0000-4000-8000-000000202637';

export async function syncFlags(client) {
  return (await one(client, `SELECT jsonb_build_object(
    'pausa_importacion_identidad',pausa_importacion_identidad,
    'solo_lectura_manual_protegida',solo_lectura_manual_protegida,
    'escritura_segura_manual',escritura_segura_manual,
    'token_activo',token_activo,'token_hash',token_hash,'spreadsheet_id',spreadsheet_id
  ) AS value FROM app_private.manteniment_sync_config WHERE id=1`)).value;
}

export async function seedLegacySync(client) {
  for (const [tracking, consumed] of [[LEGACY_PENDING, false], [LEGACY_CONSUMED, true]]) {
    const row = await one(client, `SELECT s.sync_id,r.numero_parada,r.vehiculo_sustituido AS dfm
      FROM app_private.manteniment_parada_sync s JOIN public.registros_hotel r USING(seguimiento_id)
      WHERE s.seguimiento_id=$1 LIMIT 1`, [tracking]);
    const payload = { sync_id: row.sync_id, seguimiento_id: tracking, numero_parada: `PA-${row.numero_parada}`,
      dfm: row.dfm, estado: 'PARADA', fecha_parada: '2026-10-10', solo_trabajos: false,
      trabajos_asignados: [], trabajos_crear: [] };
    await client.query(`INSERT INTO app_private.manteniment_parada_outbox
      (seguimiento_id,sync_id,revision,estado,payload,confirmado_en,ultimo_error)
      VALUES($1,$2,7,$3,$4::jsonb,CASE WHEN $5 THEN '2026-10-27 10:00Z'::timestamptz END,'Evidencia sintética previa')`,
    [tracking, row.sync_id, consumed ? 'confirmado' : 'pendiente', JSON.stringify(payload), consumed]);
    if (consumed) await client.query(`UPDATE app_private.manteniment_parada_sync
      SET ultimo_payload_confirmado=$2::jsonb,fila_manteniment=41 WHERE seguimiento_id=$1`, [tracking, JSON.stringify(payload)]);
  }
}

export async function syncQueue(client, ids = null) {
  return (await client.query(`SELECT to_jsonb(o) AS value FROM app_private.manteniment_parada_outbox o
    WHERE $1::uuid[] IS NULL OR o.seguimiento_id=ANY($1) ORDER BY seguimiento_id`, [ids])).rows.map(row => row.value);
}

export async function seedSyncTracking(client, tag, { enqueue = true, workOnly = false } = {}) {
  const id = randomUUID();
  const tracking = randomUUID();
  const syncId = randomUUID();
  const pa = `SYNC-${tag}`;
  // Explicit synthetic persistence, not a claim that the full Hotel create form
  // or fleet catalogue is under test in this protocol-only scenario.
  await client.query(`INSERT INTO public.registros_hotel
    (id,pizarra_id,seguimiento_id,numero_parada,vehiculo_sustituido,fecha_parada,creado_por,modificado_por)
    VALUES($1,$2,$3,$4,$5,'2026-10-20',$6,$6)`, [id, FIXTURE_BOARD, tracking, pa, `SYN-${tag}`, FIXTURE_ACTOR]);
  await client.query(`INSERT INTO app_private.manteniment_parada_sync(seguimiento_id,sync_id)
    VALUES($1,$2)`, [tracking, syncId]);
  const work = { sync_id: randomUUID(), tipo_trabajo: 'MCD', fecha_entrada: '2026-10-20' };
  const payload = workOnly
    ? { sync_id: syncId, seguimiento_id: tracking, numero_parada: `PA-${pa}`, solo_trabajos: true,
      trabajos_asignados: [work], trabajos_crear: [] }
    : { sync_id: syncId, seguimiento_id: tracking, numero_parada: `PA-${pa}`, dfm: `SYN-${tag}`,
      estado: 'PARADA', fecha_parada: '2026-10-20', fecha_k: null, dias_parada: 9,
      km_facturables: 270, solo_trabajos: false, trabajos_asignados: [], trabajos_crear: [] };
  if (enqueue) await client.query(`INSERT INTO app_private.manteniment_parada_outbox
    (seguimiento_id,sync_id,payload) VALUES($1,$2,$3::jsonb)`, [tracking, syncId, JSON.stringify(payload)]);
  return { id, tracking, syncId, pa, payload };
}

export async function receiveSync(client, overrides = {}) {
  const payload = { version_script: 'alpha75-2026.10.26.1', modo: 'prueba', filas: [], trabajos: [], paradas: [],
    generado_en: '2026-10-29T10:00:00Z', ...overrides };
  return (await one(client, 'SELECT public.recibir_snapshot_manteniment($1,$2::jsonb) AS value',
    [SYNTHETIC_SYNC_TOKEN, JSON.stringify(payload)])).value;
}

export function acknowledgement(command, { fila = 42, ...changes } = {}) {
  return { tipo: command.payload.solo_trabajos === true ? 'trabajos' : 'parada',
    sync_id: command.sync_id, revision: command.revision, estado: 'aplicado',
    ...(command.payload.solo_trabajos === true ? {} : { fila }),
    ...(command.payload_sha256 ? { payload_sha256: command.payload_sha256 } : {}), ...changes };
}

export async function acknowledgeSync(client, items) {
  return (await one(client, 'SELECT public.confirmar_comandos_manteniment($1,$2::jsonb) AS value',
    [SYNTHETIC_SYNC_TOKEN, JSON.stringify(items)])).value;
}

export async function validateSync(client, ids) {
  await client.query('SELECT app_private.validar_sync_continuidad_alpha75($1::uuid[])', [ids]);
}

export async function seedSyncContinuityPair(client, tag, options = {}) {
  const pair = await seedContinuityPair(client, { tag, ...options });
  // The shared harness labels manteniment_registro_hotel_trigger as a double.
  // Explicitly seed the target's canonical sync identity so this suite can test
  // real dispatch/import for both endpoints without pretending to exercise that
  // unrelated automatic metadata trigger.
  await client.query(`INSERT INTO app_private.manteniment_parada_sync(seguimiento_id)
    VALUES($1) ON CONFLICT(seguimiento_id) DO NOTHING`, [pair.destination.seguimiento_id]);
  return { ...pair, source: pair.origin, target: pair.destination };
}

export async function previewSyncContinuity(client, pair) {
  return (await one(client, 'SELECT public.previsualizar_continuidad_sustitucion_alpha75($1,$2,$3) AS value',
    [pair.target.id, pair.source.id, pair.entry.id])).value;
}

export async function confirmSyncContinuity(client, pair, request = `sync_link_${randomUUID()}`, preview = null) {
  const context = preview || await previewSyncContinuity(client, pair);
  assert.equal(context.confirmable, true, JSON.stringify(context.bloqueos));
  const p = context.prevision;
  return (await one(client, `SELECT public.confirmar_continuidad_sustitucion_alpha75($1,$2,$3,$4,$5,$6,$7,$8) AS value`,
    [p.origen.id, p.destino.id, p.entrada.id, p.origen.version, p.destino.version, p.entrada.version,
      p.huella_prevision, request])).value;
}

export async function assertRejected(work, code, message) {
  await assert.rejects(work, error => {
    assert.equal(error.code, code);
    assert.match(error.message, message);
    return true;
  });
}
