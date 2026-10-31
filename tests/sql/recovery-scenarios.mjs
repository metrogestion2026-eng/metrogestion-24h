import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIXTURE_ACTOR, one } from './local-postgres-harness.mjs';

/** Complements the shared fixture without changing its existing boundaries. */
export async function loadRecoveryRuntime(client) {
  await client.query(await readFile(new URL('./fixtures/recovery-runtime.sql', import.meta.url), 'utf8'));
  return (await client.query(`SELECT signature,definition_md5,security_definer,configuration,source_owner
    FROM app_private.test_recovery_function_manifest ORDER BY signature`)).rows;
}

export async function recoveryInventory(client, dfm, reserve) {
  return (await one(client, `SELECT jsonb_build_object(
    'activaciones',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]')
      FROM public.activaciones_24h a WHERE a.dfm=$1),
    'pa',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]')
      FROM public.registros_hotel r WHERE r.vehiculo_sustituido=$1),
    't',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]')
      FROM public.etapas_hotel e JOIN public.registros_hotel r ON r.id=e.registro_hotel_id
      WHERE r.vehiculo_sustituido=$1),
    'trabajos',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]')
      FROM public.trabajos_etapa_hotel w JOIN public.etapas_hotel e ON e.id=w.etapa_hotel_id
      JOIN public.registros_hotel r ON r.id=e.registro_hotel_id WHERE r.vehiculo_sustituido=$1),
    'reserva',(SELECT to_jsonb(r) FROM public.reservas_hotel r WHERE r.vehiculo_codigo=$2),
    'peticiones',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.request_id),'[]')
      FROM app_private.activacion_24h_peticion_paradas002 k JOIN public.activaciones_24h a ON a.id=k.activacion_id
      WHERE a.dfm=$1),
    'sync',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.seguimiento_id),'[]')
      FROM app_private.manteniment_parada_sync s WHERE s.seguimiento_id IN
        (SELECT r.seguimiento_id FROM public.registros_hotel r WHERE r.vehiculo_sustituido=$1))
  ) AS value`, [dfm, reserve])).value;
}

/** Creates synthetic, explicit decisions, not an implicit continuity transfer.
 * The normal case has a new workshop PA with its own replacement assignment;
 * the open assistance has no replacement. Recovery is seeded first so later
 * explicit tasks do not require the automatic recovery generator.
 * samePa is a separate manual/legacy scenario: the test explicitly selects the
 * existing blank modality that requires recovery. It is NOT the default
 * reserva_en_reparacion modality produced by a new 24H replacement.
 */
export async function seedRecoveryScenario(client, {
  tag, pendingReserve = '', samePa = false,
} = {}) {
  assert.match(tag || '', /^[A-Z0-9_-]{3,24}$/);
  const dfm = `REC-${tag}`;
  const reserve = `R-REC-${tag}`;
  const registration = `MAT${tag.replaceAll(/[^A-Z0-9]/g, '')}`;
  const request = `recovery_${tag}_assistance`;
  await client.query(`INSERT INTO public.vehiculos_hotel_autocompletar
    (dfm,matricula,tipo_sustituto_catalogo,etiqueta_reserva)
    VALUES($1,$2,'RESERVA','Reserva sintética de recuperación')`, [reserve, registration]);
  await client.query(`INSERT INTO public.reservas_hotel(vehiculo_codigo,matricula,estado,pendientes)
    VALUES($1,$2,'libre',$3)`, [reserve, registration, pendingReserve]);
  const payload = {
    dfm, averia: 'Avería sintética de recuperación', resultado: 'seguimiento_abierto',
    estado_seguimiento: 'en_curso', fecha_activacion: '2026-10-20', hora_activacion: '10:00',
    numero_caso: `SYN-${tag}`,
    ...(samePa ? { resultado: 'necesita_sustitucion', vehiculo_sustituto: reserve, matricula_sustituto: registration } : {}),
  };
  const assistance = (await one(client,
    'SELECT public.guardar_activacion_24h(NULL,$1::jsonb,$2) AS value', [JSON.stringify(payload), request])).value;
  const activation = (await one(client, 'SELECT to_jsonb(a) AS value FROM public.activaciones_24h a WHERE id=$1', [assistance.id])).value;
  let targetId;
  if (samePa) {
    targetId = activation.registro_hotel_id;
    // A manual/legacy modality decision, made only in the synthetic fixture.
    await client.query("UPDATE public.registros_hotel SET modalidad_operativa='' WHERE id=$1", [targetId]);
  } else {
    const workshop = (await one(client, 'SELECT public.crear_ficha_hotel($1::jsonb,$2) AS value', [JSON.stringify({
      vehiculo_sustituido: dfm, vehiculo_reserva: reserve, matricula_reserva: registration,
      estado: 'recogido_pendiente_ruta', tipo_movimiento: 'TALLER', fecha_parada: '2026-10-21',
      lugar: 'Taller sintético independiente', observaciones: 'Recuperación decidida expresamente en fixture',
    }), `recovery_${tag}_workshop`])).value;
    targetId = workshop.id;
  }
  const applicable = await one(client,
    'SELECT app_private.modalidad_hotel_requiere_recuperacion($1) AS value', [targetId]);
  assert.equal(applicable.value, true, 'The seeded case must already require recovery');
  const recovery = (await one(client, `INSERT INTO public.etapas_hotel
    (registro_hotel_id,nombre,posicion,estado,tipo_etapa,accion_sistema,observaciones,creado_por,modificado_por)
    VALUES($1,'Recuperar ruta y liberar reserva',90,'pendiente','otro','recuperar_y_liberar',
      'Decisión explícita sintética de recuperación',$2,$2) RETURNING to_jsonb(etapas_hotel) AS value`, [targetId, FIXTURE_ACTOR])).value;
  const other = (await one(client, `INSERT INTO public.etapas_hotel
    (registro_hotel_id,nombre,posicion,estado,tipo_etapa,lugar,observaciones,fecha_prevista,creado_por,modificado_por)
    VALUES($1,'Trámite manual pendiente que debe conservarse',80,'pendiente','tramite',
      'Lugar manual sintético','La recuperación no realiza este trámite','2026-10-29 09:15 Europe/Madrid',$2,$2)
    RETURNING to_jsonb(etapas_hotel) AS value`, [targetId, FIXTURE_ACTOR])).value;
  const before = await recoveryInventory(client, dfm, reserve);
  assert.equal(before.activaciones[0].estado, 'abierta');
  assert.equal(before.reserva.estado, 'ocupada');
  return { tag, dfm, reserve, registration, request, activation, targetId, recovery, other, samePa, before };
}

export async function markRecovery(client, scenario, {
  version = scenario.recovery.version, request = `quick_${scenario.tag}_explicit_recovery`,
} = {}) {
  return (await one(client, 'SELECT public.marcar_t_realizada_rapida($1,$2,$3) AS value',
    [scenario.recovery.id, version, request])).value;
}
