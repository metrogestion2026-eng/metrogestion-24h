-- CANDIDATE ONLY: not an installed migration.
-- Scope: only app_private.manteniment_trabajos_por_crear(uuid).
-- Source baseline: live pg_get_functiondef, 2026-11-01, MD5
-- 87cbb18160b9c88696ae38a98ce7d577. No operational data is embedded.
-- Does not alter stored dates, registrars, importers, outboxes, ACKs or barriers.
-- Deploy only with the version-2 client gate; old queued payloads remain unchanged.
-- Existing owner and EXECUTE privileges are preserved by CREATE OR REPLACE.

BEGIN;

DO $preflight$
DECLARE
  v_target regprocedure := to_regprocedure('app_private.manteniment_trabajos_por_crear(uuid)');
  v_definition_md5 text;
BEGIN
  IF v_target IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='MG_FECHAS_BASE_NO_ACREDITADA: falta el exportador existente';
  END IF;
  SELECT md5(pg_get_functiondef(v_target)) INTO v_definition_md5;
  IF v_definition_md5 NOT IN (
    '87cbb18160b9c88696ae38a98ce7d577',
    'e7d3262d1aebacb0f057551019dc3e7a'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='MG_FECHAS_BASE_NO_ACREDITADA: revisar la definición antes de sustituirla';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION app_private.manteniment_trabajos_por_crear(p_seguimiento_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'trabajo_sync_id', w.sync_id,
      'trabajo_hotel_id', w.trabajo_hotel_id,
      'dfm', coalesce(r.vehiculo_sustituido,''),
      'matricula', coalesce(r.matricula_sustituido,''),
      'tipo', coalesce(nullif(r.tipo_unidad,''), v.tipo_manteniment, ''),
      'upc', coalesce(nullif(r.upc,''), v.upc, ''),
      'numero_parada', 'PA-' || btrim(r.numero_parada),
      'taller', coalesce(w.taller,''),
      'tipo_trabajo', coalesce(w.tipo_trabajo,''),
      'designacion', w.designacion,
      -- The inherited date is kept for audit/compatibility only. It has no
      -- accredited MANTENIMENT origin and must never supply column I.
      'fecha_necesidad', w.fecha_necesidad,
      'significado_fecha_necesidad', 'contextual_legacy_no_acreditada',
      'contrato_fechas_version', 2,
      'fecha_necesidad_origen', null::date,
      'procedencia_fecha_necesidad', 'no_acreditada',
      'fecha_programada_visita', etapa_actual.fecha_prevista,
      'fecha_inicio_real', etapa_actual.fecha_inicio_real,
      'fecha_fin_real', etapa_actual.fecha_fin_real,
      'fecha_real', etapa_actual.fecha_real,
      'etapa_fechas_id', etapa_actual.id,
      'procedencia_fecha_programada_visita', 'etapas_hotel.fecha_prevista',
      'procedencia_hitos_reales', 'etapas_hotel',
      'contexto_operativo_vigente', r.contexto_operativo_vigente,
      -- Every proposal in this exporter has fuentes=[]; no source date has
      -- been accredited. Keep the proposal visible, but explicitly retained.
      'retener_propuesta', true,
      'motivos_retencion', jsonb_build_array('FECHA_NECESIDAD_ORIGEN_NO_ACREDITADA')
        || case when r.contexto_operativo_vigente then '[]'::jsonb
          else jsonb_build_array('CONTEXTO_OPERATIVO_NO_VIGENTE_O_AMBIGUO') end,
      'fecha_entrada', w.fecha_realizada,
      'fecha_salida', w.fecha_recogida,
      'marca', coalesce(nullif(r.marca,''), v.marca, ''),
      'km_averia', trabajo.km_averia,
      'expediente', coalesce(trabajo.expediente,''),
      'motivo_entrada', coalesce(trabajo.motivo_entrada,''),
      'diagnostico_real', coalesce(trabajo.diagnostico_real,''),
      'detalle', concat_ws(E'\n',
        nullif(trabajo.motivo_entrada,''),
        nullif(trabajo.diagnostico_real,''),
        nullif(trabajo.descripcion,'')
      )
    )
    order by w.fecha_necesidad, w.creado_en, w.id
  ), '[]'::jsonb)
  from app_private.manteniment_t_trabajos w
  join public.trabajos_etapa_hotel trabajo on trabajo.id = w.trabajo_hotel_id
  join public.etapas_hotel etapa_origen on etapa_origen.id = trabajo.etapa_hotel_id
  join public.etapas_hotel etapa_actual on etapa_actual.id =
    app_private.manteniment_etapa_actual(w.seguimiento_id, trabajo.etapa_hotel_id)
  join lateral (
    select h.*,
      coalesce(
        p.estado='en_curso'
        and not h.cancelado
        and not h.retirado_hotel_activo
        -- Whitelist from hotel-operational-state.js: pre-entry, exception
        -- and explicitly derived operational states. Unknown/custom states
        -- do not accredit an operational context merely by not being closed.
        and h.estado in (
          'planificado','pendiente_taller','tramite','gestion','t_pendientes','realizada',
          'pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos',
          'entrada_taller_programada','en_taller','terminado_pendiente_recogida',
          'recogido_pendiente_ruta','asistencia_24h'
        )
        and (
          select count(*) from public.registros_hotel vigente
          join public.pizarras pizarra_vigente on pizarra_vigente.id=vigente.pizarra_id
          where vigente.seguimiento_id=h.seguimiento_id
            and pizarra_vigente.estado='en_curso'
            and not vigente.cancelado
            and not vigente.retirado_hotel_activo
        )=1,
        false
      ) as contexto_operativo_vigente
    from public.registros_hotel h
    join public.pizarras p on p.id=h.pizarra_id
    where h.seguimiento_id=w.seguimiento_id
    order by (p.estado='en_curso') desc,p.fecha desc,h.actualizado_en desc,h.id desc
    limit 1
  ) r on true
  left join public.vehiculos v
    on v.dfm = regexp_replace(upper(btrim(coalesce(r.vehiculo_sustituido,''))),'[[:space:]]+','','g')
  where w.seguimiento_id = p_seguimiento_id
    and jsonb_array_length(coalesce(w.fuentes,'[]'::jsonb)) = 0
    and not trabajo.cancelado
    and not etapa_actual.cancelado
    and etapa_actual.estado <> 'anulada'
    and upper(btrim(coalesce(etapa_actual.tipo_etapa,''))) <> '24H';
$function$;

COMMIT;
