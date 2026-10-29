-- Synthetic continuity integration boundary; not a deployment script.
-- Loaded after PARADAS-002, recovery-runtime and Hotel/History view fixtures.
-- Finance views and Alpha72/73 wrappers below are exact schema-only captures.
-- Auth/catalog/core editor persistence remain explicit test doubles. No sync runs.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
SET LOCAL check_function_bodies=off;
CREATE FUNCTION public.usuario_activo() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('test.user_active',true),'')::boolean,true)
$$;
CREATE FUNCTION public.puede_ver_modulo(text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('test.view_allowed',true),'')::boolean,true)
$$;
CREATE TABLE public.medias_km_dfm(dfm text PRIMARY KEY,km_dia numeric(12,3));
CREATE TABLE public.config_facturacion_sustituciones(id integer PRIMARY KEY,precio_r_unidad numeric);
INSERT INTO public.config_facturacion_sustituciones VALUES(1,100);
CREATE TABLE public.ajustes_sustitucion_parada(
 id uuid DEFAULT gen_random_uuid() NOT NULL,
 seguimiento_id uuid NOT NULL,
 km_dia_manual numeric(10,3),
 observaciones text DEFAULT ''::text NOT NULL,
 creado_por uuid,
 modificado_por uuid,
 creado_en timestamp with time zone DEFAULT now() NOT NULL,
 actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT ajustes_sustitucion_km_dia_ck CHECK (km_dia_manual IS NULL OR km_dia_manual > 0::numeric AND km_dia_manual <= 5000::numeric),
 CONSTRAINT ajustes_sustitucion_parada_pkey PRIMARY KEY (id),
 CONSTRAINT ajustes_sustitucion_parada_seguimiento_id_key UNIQUE (seguimiento_id)
);
ALTER TABLE public.ajustes_sustitucion_parada ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.cierres_facturacion(
 periodo text NOT NULL,
 fecha_inicio date NOT NULL,
 fecha_cierre date NOT NULL,
 CONSTRAINT cierres_facturacion_check CHECK (fecha_inicio <= fecha_cierre),
 CONSTRAINT cierres_facturacion_pkey PRIMARY KEY (periodo)
);
ALTER TABLE public.cierres_facturacion ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.facturacion_tancament_cierres(
 id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
 source_key text NOT NULL,
 sync_id uuid,
 seguimiento_id uuid,
 fila_manteniment integer,
 dfm text NOT NULL,
 matricula text,
 numero_parada text,
 sustituto text,
 tancament text NOT NULL,
 periodo text NOT NULL,
 fecha_programada date,
 fecha_inicio_tramo date NOT NULL,
 fecha_fin_tramo date NOT NULL,
 dias_facturables integer,
 km_facturables numeric,
 marca text,
 presente_en_manteniment boolean DEFAULT true NOT NULL,
 payload_hash text NOT NULL,
 capturado_en timestamp with time zone DEFAULT now() NOT NULL,
 actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT facturacion_tancament_cierres_dias_nonnegative CHECK (dias_facturables IS NULL OR dias_facturables >= 0),
 CONSTRAINT facturacion_tancament_cierres_km_nonnegative CHECK (km_facturables IS NULL OR km_facturables >= 0::numeric),
 CONSTRAINT facturacion_tancament_cierres_pkey PRIMARY KEY (id),
 CONSTRAINT facturacion_tancament_cierres_q CHECK (tancament ~ '^TANCAMENT [0-9]+$'::text),
 CONSTRAINT facturacion_tancament_cierres_source_key_key UNIQUE (source_key)
);
ALTER TABLE public.facturacion_tancament_cierres ENABLE ROW LEVEL SECURITY;
-- Runtime view MD5: 799e539b5cd19c51d3faf2f5dad4deb6
CREATE VIEW public.paradas_sustitucion_resumen WITH(security_invoker=true) AS
 WITH ranked AS (
         SELECT r.id,
            r.pizarra_id,
            r.seguimiento_id,
            r.numero_parada,
            r.vehiculo_sustituido,
            r.matricula_sustituido,
            r.vehiculo_reserva,
            r.matricula_reserva,
            r.etiqueta_reserva,
            r.tipo_unidad,
            r.marca,
            r.tipo_motor,
            r.modelo,
            r.upc,
            r.telefono,
            r.prioridad,
            r.estado,
            r.lugar,
            r.fecha_parada,
            r.fecha_entrada,
            r.tipo_movimiento,
            r.causa,
            r.trabajos_reserva,
            r.incidencia,
            r.proximo,
            r.observaciones,
            r.sustitucion_temporal,
            r.motivo_sustitucion_temporal,
            r.fecha_limite_sustitucion,
            r.orden,
            r.retirado_hotel_activo,
            r.fecha_retirado_hotel,
            r.cancelado,
            r.motivo_cancelacion,
            r.cancelado_en,
            r.cancelado_por,
            r.version,
            r.creado_por,
            r.modificado_por,
            r.creado_en,
            r.actualizado_en,
            r.tipo_sustituto,
            r.trazo_marron,
            r.modalidad_operativa,
            p.fecha AS fecha_pizarra,
            row_number() OVER (PARTITION BY r.seguimiento_id ORDER BY p.fecha DESC, r.actualizado_en DESC, r.id DESC) AS rn
           FROM registros_hotel r
             JOIN pizarras p ON p.id = r.pizarra_id
        ), latest AS (
         SELECT ranked.id,
            ranked.pizarra_id,
            ranked.seguimiento_id,
            ranked.numero_parada,
            ranked.vehiculo_sustituido,
            ranked.matricula_sustituido,
            ranked.vehiculo_reserva,
            ranked.matricula_reserva,
            ranked.etiqueta_reserva,
            ranked.tipo_unidad,
            ranked.marca,
            ranked.tipo_motor,
            ranked.modelo,
            ranked.upc,
            ranked.telefono,
            ranked.prioridad,
            ranked.estado,
            ranked.lugar,
            ranked.fecha_parada,
            ranked.fecha_entrada,
            ranked.tipo_movimiento,
            ranked.causa,
            ranked.trabajos_reserva,
            ranked.incidencia,
            ranked.proximo,
            ranked.observaciones,
            ranked.sustitucion_temporal,
            ranked.motivo_sustitucion_temporal,
            ranked.fecha_limite_sustitucion,
            ranked.orden,
            ranked.retirado_hotel_activo,
            ranked.fecha_retirado_hotel,
            ranked.cancelado,
            ranked.motivo_cancelacion,
            ranked.cancelado_en,
            ranked.cancelado_por,
            ranked.version,
            ranked.creado_por,
            ranked.modificado_por,
            ranked.creado_en,
            ranked.actualizado_en,
            ranked.tipo_sustituto,
            ranked.trazo_marron,
            ranked.modalidad_operativa,
            ranked.fecha_pizarra,
            ranked.rn
           FROM ranked
          WHERE ranked.rn = 1 AND NOT COALESCE(ranked.cancelado, false) AND ranked.estado <> 'anulado'::text
        ), starts AS (
         SELECT registros_hotel.seguimiento_id,
            min(registros_hotel.fecha_parada) AS fecha_inicio_parada
           FROM registros_hotel
          WHERE NOT COALESCE(registros_hotel.cancelado, false)
          GROUP BY registros_hotel.seguimiento_id
        ), recoveries AS (
         SELECT r.seguimiento_id,
            max((COALESCE(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) AT TIME ZONE 'Europe/Madrid'::text)::date) AS fecha_recuperacion_real
           FROM registros_hotel r
             JOIN etapas_hotel e ON e.registro_hotel_id = r.id
          WHERE NOT COALESCE(r.cancelado, false) AND NOT COALESCE(e.cancelado, false) AND e.estado = 'realizada'::text AND e.tipo_etapa = 'recuperar_ruta'::text AND COALESCE(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) IS NOT NULL
          GROUP BY r.seguimiento_id
        ), base AS (
         SELECT l.id,
            l.pizarra_id,
            l.seguimiento_id,
            l.numero_parada,
            l.vehiculo_sustituido,
            l.matricula_sustituido,
            l.vehiculo_reserva,
            l.matricula_reserva,
            l.etiqueta_reserva,
            l.tipo_unidad,
            l.marca,
            l.tipo_motor,
            l.modelo,
            l.upc,
            l.telefono,
            l.prioridad,
            l.estado,
            l.lugar,
            l.fecha_parada,
            l.fecha_entrada,
            l.tipo_movimiento,
            l.causa,
            l.trabajos_reserva,
            l.incidencia,
            l.proximo,
            l.observaciones,
            l.sustitucion_temporal,
            l.motivo_sustitucion_temporal,
            l.fecha_limite_sustitucion,
            l.orden,
            l.retirado_hotel_activo,
            l.fecha_retirado_hotel,
            l.cancelado,
            l.motivo_cancelacion,
            l.cancelado_en,
            l.cancelado_por,
            l.version,
            l.creado_por,
            l.modificado_por,
            l.creado_en,
            l.actualizado_en,
            l.tipo_sustituto,
            l.trazo_marron,
            l.modalidad_operativa,
            l.fecha_pizarra,
            l.rn,
            s.fecha_inicio_parada,
                CASE
                    WHEN rec.fecha_recuperacion_real IS NOT NULL THEN rec.fecha_recuperacion_real
                    WHEN l.retirado_hotel_activo OR (l.estado = ANY (ARRAY['recuperado'::text, 'reserva_liberada'::text])) THEN COALESCE((l.fecha_retirado_hotel AT TIME ZONE 'Europe/Madrid'::text)::date, l.fecha_pizarra)
                    ELSE NULL::date
                END AS fecha_fin_parada,
            m.km_dia AS km_dia_automatico,
            aj.km_dia_manual,
            COALESCE(aj.km_dia_manual, m.km_dia) AS km_dia,
                CASE
                    WHEN aj.km_dia_manual IS NOT NULL THEN 'MANUAL'::text
                    WHEN m.km_dia IS NOT NULL THEN 'CTM'::text
                    ELSE 'SIN_MEDIA'::text
                END AS km_dia_fuente,
            aj.observaciones AS ajuste_observaciones
           FROM latest l
             JOIN starts s USING (seguimiento_id)
             LEFT JOIN recoveries rec USING (seguimiento_id)
             LEFT JOIN medias_km_dfm m ON m.dfm = l.vehiculo_sustituido
             LEFT JOIN ajustes_sustitucion_parada aj USING (seguimiento_id)
        ), totals AS (
         SELECT b.id,
            b.pizarra_id,
            b.seguimiento_id,
            b.numero_parada,
            b.vehiculo_sustituido,
            b.matricula_sustituido,
            b.vehiculo_reserva,
            b.matricula_reserva,
            b.etiqueta_reserva,
            b.tipo_unidad,
            b.marca,
            b.tipo_motor,
            b.modelo,
            b.upc,
            b.telefono,
            b.prioridad,
            b.estado,
            b.lugar,
            b.fecha_parada,
            b.fecha_entrada,
            b.tipo_movimiento,
            b.causa,
            b.trabajos_reserva,
            b.incidencia,
            b.proximo,
            b.observaciones,
            b.sustitucion_temporal,
            b.motivo_sustitucion_temporal,
            b.fecha_limite_sustitucion,
            b.orden,
            b.retirado_hotel_activo,
            b.fecha_retirado_hotel,
            b.cancelado,
            b.motivo_cancelacion,
            b.cancelado_en,
            b.cancelado_por,
            b.version,
            b.creado_por,
            b.modificado_por,
            b.creado_en,
            b.actualizado_en,
            b.tipo_sustituto,
            b.trazo_marron,
            b.modalidad_operativa,
            b.fecha_pizarra,
            b.rn,
            b.fecha_inicio_parada,
            b.fecha_fin_parada,
            b.km_dia_automatico,
            b.km_dia_manual,
            b.km_dia,
            b.km_dia_fuente,
            b.ajuste_observaciones,
                CASE
                    WHEN b.fecha_inicio_parada IS NULL THEN 0
                    ELSE GREATEST(0, COALESCE(b.fecha_fin_parada, (now() AT TIME ZONE 'Europe/Madrid'::text)::date) - b.fecha_inicio_parada + 1)
                END AS dias_parada_total
           FROM base b
        )
 SELECT seguimiento_id,
    numero_parada,
    NULLIF(vehiculo_sustituido, ''::text) AS unidad,
    NULLIF(matricula_sustituido, ''::text) AS matricula,
    NULLIF(vehiculo_reserva, ''::text) AS sustituto,
    NULLIF(matricula_reserva, ''::text) AS matricula_sustituto,
    tipo_sustituto,
    estado,
    tipo_unidad,
    incidencia,
    causa,
    upc,
    fecha_inicio_parada,
    fecha_fin_parada,
    dias_parada_total,
        CASE
            WHEN COALESCE(vehiculo_sustituido, ''::text) ~ '^R'::text THEN 'R'::text
            ELSE 'DFM'::text
        END AS clase_facturacion,
    km_dia_automatico,
    km_dia_manual,
    km_dia,
    km_dia_fuente,
    ajuste_observaciones,
    NULL::numeric AS km_sustitucion_total
   FROM totals;
GRANT SELECT ON public.paradas_sustitucion_resumen TO authenticated,service_role;
-- Runtime view MD5: 391cc436c4bd29c65fd97c4babb62627
CREATE VIEW public.facturacion_dfm_periodos WITH(security_invoker=true) AS
 WITH snapshot AS (
         SELECT f.seguimiento_id,
            regexp_replace(COALESCE(f.numero_parada, ''::text), '^PA-'::text, ''::text, 'i'::text) AS numero_parada,
            f.dfm,
            f.matricula,
            f.sustituto,
            NULL::text AS matricula_sustituto,
            p.incidencia,
            p.causa,
            p.upc,
            f.periodo,
            c.fecha_inicio AS periodo_inicio,
            c.fecha_cierre AS periodo_cierre,
            f.fecha_inicio_tramo AS tramo_inicio,
            f.fecha_fin_tramo AS tramo_fin,
            f.dias_facturables,
            NULL::numeric(12,3) AS km_dia_automatico,
            NULL::numeric(10,3) AS km_dia_manual,
                CASE
                    WHEN COALESCE(f.dias_facturables, 0) > 0 AND f.km_facturables IS NOT NULL THEN round(f.km_facturables / f.dias_facturables::numeric, 3)
                    ELSE NULL::numeric
                END AS km_dia,
            'TANCAMENT'::text AS km_dia_fuente,
            f.km_facturables,
            f.dias_facturables AS dias_parada_total,
            NULL::numeric AS km_sustitucion_total,
            COALESCE(p.estado, 'tancament'::text) AS estado
           FROM facturacion_tancament_cierres f
             JOIN cierres_facturacion c ON c.periodo = f.periodo
             LEFT JOIN paradas_sustitucion_resumen p USING (seguimiento_id)
          WHERE f.presente_en_manteniment AND f.dfm !~* '^R'::text AND c.fecha_cierre < (now() AT TIME ZONE 'Europe/Madrid'::text)::date
        ), live_tramos AS (
         SELECT p.seguimiento_id,
            p.numero_parada,
            p.unidad AS dfm,
            p.matricula,
            p.sustituto,
            p.matricula_sustituto,
            p.incidencia,
            p.causa,
            p.upc,
            c.periodo,
            c.fecha_inicio AS periodo_inicio,
            c.fecha_cierre AS periodo_cierre,
            GREATEST(p.fecha_inicio_parada, c.fecha_inicio) AS tramo_inicio,
            LEAST(COALESCE(p.fecha_fin_parada, CURRENT_DATE), c.fecha_cierre, CURRENT_DATE) AS tramo_fin,
            GREATEST(0, LEAST(COALESCE(p.fecha_fin_parada, CURRENT_DATE), c.fecha_cierre, CURRENT_DATE) - GREATEST(p.fecha_inicio_parada, c.fecha_inicio) + 1) AS dias_facturables,
            p.km_dia_automatico,
            p.km_dia_manual,
            p.km_dia,
            p.km_dia_fuente,
                CASE
                    WHEN p.km_dia IS NULL THEN NULL::numeric
                    ELSE round(GREATEST(0, LEAST(COALESCE(p.fecha_fin_parada, CURRENT_DATE), c.fecha_cierre, CURRENT_DATE) - GREATEST(p.fecha_inicio_parada, c.fecha_inicio) + 1)::numeric * p.km_dia)
                END AS km_facturables,
            p.dias_parada_total,
            p.km_sustitucion_total,
            p.estado
           FROM paradas_sustitucion_resumen p
             JOIN cierres_facturacion c ON p.clase_facturacion = 'DFM'::text AND p.sustituto IS NOT NULL AND p.km_dia IS NOT NULL AND p.fecha_inicio_parada <= c.fecha_cierre AND COALESCE(p.fecha_fin_parada, CURRENT_DATE) >= c.fecha_inicio AND c.fecha_inicio <= CURRENT_DATE
        )
 SELECT snapshot.seguimiento_id,
    snapshot.numero_parada,
    snapshot.dfm,
    snapshot.matricula,
    snapshot.sustituto,
    snapshot.matricula_sustituto,
    snapshot.incidencia,
    snapshot.causa,
    snapshot.upc,
    snapshot.periodo,
    snapshot.periodo_inicio,
    snapshot.periodo_cierre,
    snapshot.tramo_inicio,
    snapshot.tramo_fin,
    snapshot.dias_facturables,
    snapshot.km_dia_automatico,
    snapshot.km_dia_manual,
    snapshot.km_dia,
    snapshot.km_dia_fuente,
    snapshot.km_facturables,
    snapshot.dias_parada_total,
    snapshot.km_sustitucion_total,
    snapshot.estado
   FROM snapshot
UNION ALL
 SELECT l.seguimiento_id,
    l.numero_parada,
    l.dfm,
    l.matricula,
    l.sustituto,
    l.matricula_sustituto,
    l.incidencia,
    l.causa,
    l.upc,
    l.periodo,
    l.periodo_inicio,
    l.periodo_cierre,
    l.tramo_inicio,
    l.tramo_fin,
    l.dias_facturables,
    l.km_dia_automatico,
    l.km_dia_manual,
    l.km_dia,
    l.km_dia_fuente,
    l.km_facturables,
    l.dias_parada_total,
    l.km_sustitucion_total,
    l.estado
   FROM live_tramos l
  WHERE l.periodo_cierre >= (now() AT TIME ZONE 'Europe/Madrid'::text)::date OR NOT (EXISTS ( SELECT 1
           FROM snapshot s
          WHERE s.periodo = l.periodo));
GRANT SELECT ON public.facturacion_dfm_periodos TO authenticated,service_role;
-- Runtime view MD5: cb2c0dae5c9f094aed1aad78c25e2cc0
CREATE VIEW public.facturacion_r_sustituciones WITH(security_invoker=true) AS
 SELECT p.seguimiento_id,
    p.numero_parada,
    p.unidad AS r_sustituido,
    p.matricula,
    p.sustituto AS r_sustituto,
    p.matricula_sustituto,
    p.fecha_inicio_parada,
    p.fecha_fin_parada,
    p.dias_parada_total,
    p.incidencia,
    p.causa,
    p.upc,
    1 AS unidades,
    cfg.precio_r_unidad,
        CASE
            WHEN cfg.precio_r_unidad IS NULL THEN NULL::numeric
            ELSE cfg.precio_r_unidad
        END AS importe
   FROM paradas_sustitucion_resumen p
     CROSS JOIN config_facturacion_sustituciones cfg
  WHERE p.clase_facturacion = 'R'::text AND p.sustituto IS NOT NULL;
GRANT SELECT ON public.facturacion_r_sustituciones TO authenticated,service_role;
-- Runtime function MD5: b807a719cec96f77b40fe35a993bdf9f
CREATE OR REPLACE FUNCTION app_private.guardar_ficha_hotel_edicion_alpha72(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_before public.registros_hotel%rowtype;
  v_board_state text;
  v_target_board uuid;
  v_requested_state text;
  v_requested_cancelled boolean;
  v_reactivation boolean := false;
  v_reactivated_id uuid;
  v_etapas_reabiertas integer := 0;
  v_codigo text;
  v_ficha_out jsonb := p_ficha;
  v_etapas_out jsonb := p_etapas;
  v_saved jsonb;
  v_version integer;
  v_notas integer;
  v_audit_count integer;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;

  select * into v_before
  from public.registros_hotel
  where id = p_registro_id
  for update;
  if not found then raise exception 'Ficha de Hotel no encontrada'; end if;
  v_codigo := app_private.resolver_modalidad_operativa_hotel(p_ficha->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa',v_codigo,true);
  perform set_config('app.rec001_registro_id',p_registro_id::text,true);
  perform app_private.modalidad_hotel_requiere_recuperacion(p_registro_id);

  select p.estado into v_board_state
  from public.pizarras p
  where p.id = v_before.pizarra_id;
  v_target_board := v_before.pizarra_id;

  v_requested_state := lower(btrim(coalesce(p_ficha->>'estado', v_before.estado)));
  v_requested_cancelled := coalesce((p_ficha->>'cancelado')::boolean, v_before.cancelado);
  v_reactivation := (
      v_before.cancelado
      or v_before.retirado_hotel_activo
      or v_before.estado in ('recuperado', 'reserva_liberada', 'anulado')
    )
    and not v_requested_cancelled
    and v_requested_state not in ('realizada', 'recuperado', 'reserva_liberada', 'anulado');

  perform set_config('app.rec001_reactivando',case when v_reactivation then '1' else '0' end,true);
  if v_reactivation then
    select count(*) into v_etapas_reabiertas
    from public.etapas_hotel e
    where e.registro_hotel_id = p_registro_id
      and not e.cancelado
      and e.accion_sistema in ('recuperar_y_liberar', 'liberar_reserva')
      and (
        e.estado = 'realizada'
        or e.fecha_fin_real is not null
        or e.fecha_real is not null
        or e.marcado_rapido
      );

    if v_board_state = 'archivada' then
      -- El registro historico se conserva retirado. La copia de la Pizarra
      -- actual es la que vuelve a quedar operativa.
      select p.id into v_target_board
      from public.pizarras p
      where p.estado = 'en_curso'
      order by p.fecha desc
      limit 1;
      if v_target_board is null then
        raise exception 'No existe una Pizarra actual en la que reactivar la ficha';
      end if;
      v_ficha_out := jsonb_set(v_ficha_out, '{retirado_hotel_activo}', 'true'::jsonb, true);
    else
      v_ficha_out := jsonb_set(v_ficha_out, '{retirado_hotel_activo}', 'false'::jsonb, true);
      v_etapas_out := app_private.preparar_etapas_reactivacion_hotel(
        p_registro_id,
        p_etapas
      );
    end if;
  end if;

  if not v_requested_cancelled
     and v_requested_state not in ('realizada', 'recuperado', 'reserva_liberada', 'anulado')
     and nullif(btrim(p_ficha->>'vehiculo_reserva'), '') is not null
     and exists (
       select 1
       from public.registros_hotel r
       where r.id <> p_registro_id
         and r.pizarra_id = v_target_board
         and not r.cancelado
         and not r.retirado_hotel_activo
         and r.estado not in ('realizada', 'recuperado', 'reserva_liberada', 'anulado')
         and upper(btrim(r.vehiculo_reserva)) = upper(btrim(p_ficha->>'vehiculo_reserva'))
     ) then
    raise exception 'La reserva % ya esta asignada a otra ficha activa de esta Pizarra', upper(btrim(p_ficha->>'vehiculo_reserva'));
  end if;

  v_codigo := app_private.resolver_modalidad_operativa_hotel(v_ficha_out->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa', v_codigo, true);
  v_saved := app_private.guardar_ficha_hotel_edicion_alpha71(
    p_registro_id,
    p_version,
    v_ficha_out,
    v_etapas_out,
    p_request_id
  );

  update public.registros_hotel
  set modalidad_operativa = v_codigo,
      modificado_por = auth.uid()
  where id = p_registro_id
    and modalidad_operativa is distinct from v_codigo;

  perform set_config('app.request_id', left(p_request_id, 200), true);
  perform set_config('app.audit_origin', 'metrogestion-alpha72-anotaciones', true);
  v_notas := app_private.sincronizar_anotaciones_manuales_hotel(
    p_registro_id,
    coalesce(v_ficha_out->'anotaciones_manuales', '[]'::jsonb)
  );

  if v_reactivation then
    if v_board_state = 'archivada' then
      select r.id into v_reactivated_id
      from public.registros_hotel r
      join public.pizarras p on p.id = r.pizarra_id
      where p.estado = 'en_curso'
        and r.seguimiento_id = v_before.seguimiento_id
      order by p.fecha desc, r.actualizado_en desc, r.id desc
      limit 1;
    else
      v_reactivated_id := p_registro_id;
    end if;

    if v_reactivated_id is null then
      raise exception 'No se ha podido crear o localizar la ficha reactivada en la Pizarra actual';
    end if;

    update public.registros_hotel set modalidad_operativa=v_codigo,modificado_por=auth.uid() where id=v_reactivated_id and modalidad_operativa is distinct from v_codigo;
    perform set_config('app.rec001_registro_id',v_reactivated_id::text,true);
    perform app_private.reabrir_cierre_ficha_hotel(v_reactivated_id, auth.uid());
    perform app_private.consolidar_rec001(v_reactivated_id);

    if not exists (
      select 1
      from public.registros_hotel r
      where r.id = v_reactivated_id
        and not r.cancelado
        and not r.retirado_hotel_activo
        and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
    ) then
      raise exception 'La reactivacion no ha dejado una ficha operativa en la Pizarra actual';
    end if;
  end if;

  if not v_reactivation then perform app_private.consolidar_rec001(p_registro_id); end if;
  perform set_config('app.rec001_registro_id','',true);
  perform set_config('app.rec001_reactivando','0',true);
  select version into v_version
  from public.registros_hotel
  where id = p_registro_id;
  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;

  return v_saved || jsonb_build_object(
    'ok', true,
    'version', v_version,
    'modalidad_operativa', v_codigo,
    'anotaciones_guardadas', v_notas,
    'eventos_auditoria', v_audit_count,
    'reactivacion_coherente', v_reactivation,
    'ficha_activa_id', v_reactivated_id,
    'etapas_reabiertas', v_etapas_reabiertas,
    'detalle', app_private.obtener_ficha_hotel_edicion_alpha72(p_registro_id)
  );
end;
$function$;
-- Runtime function MD5: 1b8ac01c31725b78c1d132124b1c8ae7
CREATE OR REPLACE FUNCTION app_private.guardar_ficha_hotel_edicion_alpha73(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_identidad jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_actual public.registros_hotel%rowtype;
  v_etapa jsonb;
  v_trabajo jsonb;
  v_saved jsonb;
begin
  if auth.uid() is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_identidad) <> 'object'
    or octet_length(p_identidad::text) > 4000 then
    raise exception 'La identidad de la ficha no es válida'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_etapas) <> 'array' then
    raise exception 'La lista de T no es válida'
      using errcode = '22023';
  end if;

  select r.* into v_actual
  from public.registros_hotel r
  where r.id = p_registro_id
  for update;
  if not found then
    raise exception 'Ficha de Hotel no encontrada'
      using errcode = 'P0002';
  end if;

  if coalesce(p_identidad->>'registro_id', '') <> v_actual.id::text
    or coalesce(p_identidad->>'seguimiento_id', '') <> v_actual.seguimiento_id::text
    or coalesce(p_identidad->>'pizarra_id', '') <> v_actual.pizarra_id::text
    or btrim(coalesce(p_identidad->>'numero_parada', ''))
         <> btrim(coalesce(v_actual.numero_parada, ''))
    or upper(btrim(coalesce(p_identidad->>'vehiculo_sustituido', '')))
         <> upper(btrim(coalesce(v_actual.vehiculo_sustituido, '')))
    or upper(btrim(coalesce(p_identidad->>'matricula_sustituido', '')))
         <> upper(btrim(coalesce(v_actual.matricula_sustituido, ''))) then
    raise exception 'La identidad de la ficha ha cambiado. Cierra y vuelve a abrirla antes de guardar.'
      using errcode = '40001';
  end if;

  for v_etapa in select value from jsonb_array_elements(p_etapas) loop
    if nullif(v_etapa->>'id', '') is not null
      and not exists (
        select 1
        from public.etapas_hotel e
        where e.id::text = v_etapa->>'id'
          and e.registro_hotel_id = p_registro_id
      ) then
      raise exception 'Una T no pertenece a la ficha abierta. Recarga antes de guardar.'
        using errcode = '40001';
    end if;

    if jsonb_typeof(coalesce(v_etapa->'trabajos', '[]'::jsonb)) <> 'array' then
      raise exception 'La lista de trabajos de una T no es válida'
        using errcode = '22023';
    end if;
    for v_trabajo in
      select value
      from jsonb_array_elements(coalesce(v_etapa->'trabajos', '[]'::jsonb))
    loop
      if nullif(v_trabajo->>'id', '') is not null
        and not exists (
          select 1
          from public.trabajos_etapa_hotel t
          join public.etapas_hotel e on e.id = t.etapa_hotel_id
          where t.id::text = v_trabajo->>'id'
            and t.etapa_hotel_id::text = v_etapa->>'id'
            and e.registro_hotel_id = p_registro_id
        ) then
        raise exception 'Un trabajo no pertenece a la T y ficha abiertas. Recarga antes de guardar.'
          using errcode = '40001';
      end if;
    end loop;
  end loop;

  v_saved := app_private.guardar_ficha_hotel_edicion_alpha72(
    p_registro_id,
    p_version,
    p_ficha,
    p_etapas,
    p_request_id
  );
  return v_saved || jsonb_build_object('identidad_validada', true);
end;
$function$;
-- Runtime function MD5: c035ab0c47c2627f88776513550b1135
CREATE OR REPLACE FUNCTION public.guardar_ficha_hotel_edicion_alpha72(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.guardar_ficha_hotel_edicion_alpha72($1,$2,$3,$4,$5); $function$;
-- Runtime function MD5: 49d3b0c7eb4e96bfda7c36d91d298e52
CREATE OR REPLACE FUNCTION public.guardar_ficha_hotel_edicion_alpha73(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_identidad jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.guardar_ficha_hotel_edicion_alpha73($1, $2, $3, $4, $5, $6);
$function$;

-- Explicit editor persistence double: scalar notes/identity plus the original
-- fixture's creation of fresh T/work rows used by the real 24H creation path.
-- Editing existing stages/documents remains outside this fixture's boundary.
CREATE OR REPLACE FUNCTION app_private.guardar_ficha_hotel_edicion_alpha71(
 p_registro_id uuid,p_version integer,p_ficha jsonb,p_etapas jsonb,p_request_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r public.registros_hotel%rowtype; x jsonb; w jsonb; v_e uuid;
BEGIN
 SELECT * INTO STRICT r FROM public.registros_hotel WHERE id=p_registro_id FOR UPDATE;
 IF r.version<>p_version THEN RAISE EXCEPTION 'Fixture editor version conflict' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_etapas) e WHERE nullif(e->>'id','') IS NOT NULL) THEN
  RAISE EXCEPTION 'Fixture editor does not simulate edits of existing stages';
 END IF;
 UPDATE public.registros_hotel SET
   observaciones=coalesce(p_ficha->>'observaciones',observaciones),
   estado=coalesce(p_ficha->>'estado',estado),
   vehiculo_reserva=coalesce(p_ficha->>'vehiculo_reserva',vehiculo_reserva),
   matricula_reserva=coalesce(p_ficha->>'matricula_reserva',matricula_reserva),
   vehiculo_sustituido=coalesce(p_ficha->>'vehiculo_sustituido',vehiculo_sustituido),
   matricula_sustituido=coalesce(p_ficha->>'matricula_sustituido',matricula_sustituido),
   cancelado=coalesce((p_ficha->>'cancelado')::boolean,cancelado),
   retirado_hotel_activo=coalesce((p_ficha->>'retirado_hotel_activo')::boolean,retirado_hotel_activo),
   modificado_por=auth.uid()
 WHERE id=p_registro_id;
 FOR x IN SELECT value FROM jsonb_array_elements(p_etapas) LOOP
  INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,estado,estado_catalogo_codigo,tipo_etapa,lugar,observaciones,creado_por,modificado_por,
    fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real)
  VALUES(p_registro_id,x->>'nombre',(x->>'posicion')::integer,coalesce(x->>'estado','pendiente'),coalesce(x->>'estado_catalogo_codigo','pendiente'),coalesce(x->>'tipo_etapa','otro'),coalesce(x->>'lugar',''),coalesce(x->>'observaciones',''),auth.uid(),auth.uid(),
    nullif(x->>'fecha_prevista','')::timestamptz,nullif(x->>'fecha_inicio_real','')::timestamptz,nullif(x->>'fecha_fin_real','')::timestamptz,nullif(x->>'fecha_real','')::timestamptz)
  RETURNING id INTO v_e;
  FOR w IN SELECT value FROM jsonb_array_elements(coalesce(x->'trabajos','[]')) LOOP
   INSERT INTO public.trabajos_etapa_hotel(etapa_hotel_id,tipo_trabajo,categoria_tecnica,motivo_entrada,diagnostico_real,expediente,descripcion,observaciones,km_averia)
   VALUES(v_e,w->>'tipo_trabajo',w->>'categoria_tecnica',w->>'motivo_entrada',w->>'diagnostico_real',w->>'expediente',w->>'descripcion',w->>'observaciones',nullif(w->>'km_averia','')::numeric);
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'id',p_registro_id);
END $$;
-- Restore the real identity-preserving trigger. The base PARADAS fixture used
-- a fresh-number-only double, which cannot represent a rollover clone.
-- The sequence is local synthetic infrastructure, not an operational counter.
CREATE SEQUENCE public.numero_parada_seq START 92000;
CREATE OR REPLACE FUNCTION app_private.asignar_numero_parada_nuevo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_num bigint;
begin
  if current_setting('app.clonando_pizarra', true)='1' then
    return new;
  end if;

  if nullif(btrim(coalesce(new.numero_parada,'')),'') is not null then
    return new;
  end if;

  loop
    v_num := nextval('public.numero_parada_seq');
    exit when not exists (
      select 1
      from public.registros_hotel r
      where regexp_replace(coalesce(r.numero_parada,''),'\D','','g') = v_num::text
    );
  end loop;

  new.numero_parada := v_num::text;
  return new;
end;
$function$;
COMMIT;
