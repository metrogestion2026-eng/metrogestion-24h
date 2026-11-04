-- MG75-SITUACION-OPERATIVA-001 · definición canónica de la proyección.
-- El estado y el lugar de la ficha se obtienen de las T vigentes.

create or replace function app_private.lugares_hotel_equivalentes_alpha75(
  p_actual text,
  p_proyectado text
)
returns boolean
language plpgsql
immutable
set search_path to 'pg_catalog'
as $function$
declare
  v_actual text;
  v_proyectado text;
begin
  if nullif(btrim(coalesce(p_proyectado, '')), '') is null then
    return true;
  end if;
  if nullif(btrim(coalesce(p_actual, '')), '') is null then
    return false;
  end if;

  v_actual := regexp_replace(
    upper(translate(btrim(p_actual), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇáéíóúàèìòùäëïöüñç', 'AEIOUAEIOUAEIOUNCaeiouaeiouaeiounc')),
    '[^A-Z0-9]+',
    '',
    'g'
  );
  v_proyectado := regexp_replace(
    upper(translate(btrim(p_proyectado), 'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇáéíóúàèìòùäëïöüñç', 'AEIOUAEIOUAEIOUNCaeiouaeiouaeiounc')),
    '[^A-Z0-9]+',
    '',
    'g'
  );

  if v_actual = v_proyectado then
    return true;
  end if;

  if least(length(v_actual), length(v_proyectado)) >= 5
     and (
       position(v_actual in v_proyectado) > 0
       or position(v_proyectado in v_actual) > 0
     ) then
    return true;
  end if;

  return false;
end;
$function$;

create or replace function app_private.proyectar_situacion_operativa_hotel_alpha75(
  p_registro_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_r public.registros_hotel%rowtype;
  v_total integer := 0;
  v_abiertas integer := 0;
  v_sustitucion_vigente boolean := false;
  v_estado text;
  v_lugar text;
  v_motivo text := 'cabecera';
  v_activa boolean := true;
  v_stage record;
begin
  select *
  into v_r
  from public.registros_hotel
  where id = p_registro_id;

  if not found then
    return jsonb_build_object(
      'existe', false,
      'registro_id', p_registro_id,
      'activa_recomendada', false
    );
  end if;

  select
    count(*) filter (where not e.cancelado),
    count(*) filter (
      where not e.cancelado
        and e.estado in ('pendiente', 'programada', 'en_curso')
    )
  into v_total, v_abiertas
  from public.etapas_hotel e
  where e.registro_hotel_id = p_registro_id;

  v_sustitucion_vigente := coalesce(
    (
      app_private.proyectar_continuidad_sustitucion_alpha75(v_r.seguimiento_id)
      ->> 'sustitucion_vigente'
    )::boolean,
    false
  );

  v_estado := v_r.estado;
  v_lugar := v_r.lugar;

  select
    e.id,
    e.posicion,
    e.lugar,
    t.nombre as taller,
    ct.nombre as centro
  into v_stage
  from public.etapas_hotel e
  left join public.talleres t on t.id = e.taller_id
  left join public.centros_taller ct on ct.id = e.centro_taller_id
  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.tipo_etapa = 'entrada_taller'
    and e.estado = 'en_curso'
    and e.fecha_inicio_real is not null
    and coalesce(e.fecha_fin_real, e.fecha_real) is null
  order by e.fecha_inicio_real desc, e.posicion desc, e.id desc
  limit 1;

  if found then
    if v_r.estado in (
      'pendiente_diagnostico',
      'pendiente_autorizacion',
      'pendiente_repuestos'
    ) then
      v_estado := v_r.estado;
    else
      v_estado := 'en_taller';
    end if;
    v_lugar := coalesce(
      nullif(btrim(v_stage.lugar), ''),
      nullif(btrim(v_stage.taller), ''),
      nullif(btrim(v_stage.centro), ''),
      v_r.lugar
    );
    v_motivo := 'entrada_taller_en_curso';

  else
    select e.id, e.lugar
    into v_stage
    from public.etapas_hotel e
    where e.registro_hotel_id = p_registro_id
      and not e.cancelado
      and lower(e.tipo_etapa) = '24h'
      and e.estado = 'en_curso'
    order by e.fecha_inicio_real desc nulls last, e.posicion desc, e.id desc
    limit 1;

    if found then
      v_estado := 'asistencia_24h';
      v_lugar := coalesce(nullif(btrim(v_stage.lugar), ''), v_r.lugar);
      v_motivo := 'asistencia_24h_en_curso';

    else
      select e.id, e.tipo_etapa
      into v_stage
      from public.etapas_hotel e
      where e.registro_hotel_id = p_registro_id
        and not e.cancelado
        and e.estado = 'en_curso'
        and lower(
          translate(
            btrim(e.tipo_etapa),
            'ÁÉÍÓÚáéíóú',
            'AEIOUaeiou'
          )
        ) in ('tramite', 'gestion')
      order by e.posicion, e.id
      limit 1;

      if found then
        if lower(
          translate(
            btrim(v_stage.tipo_etapa),
            'ÁÉÍÓÚáéíóú',
            'AEIOUaeiou'
          )
        ) = 'tramite' then
          v_estado := 'tramite';
          v_motivo := 'tramite_en_curso';
        else
          v_estado := 'gestion';
          v_motivo := 'gestion_en_curso';
        end if;

      else
        select
          p.id,
          coalesce(
            nullif(btrim(p.lugar), ''),
            nullif(btrim(orig.lugar), ''),
            nullif(btrim(prev.lugar), '')
          ) as lugar
        into v_stage
        from public.etapas_hotel p
        left join public.etapas_hotel orig on orig.id = p.etapa_origen_id
        left join lateral (
          select x.id, x.lugar
          from public.etapas_hotel x
          where x.registro_hotel_id = p_registro_id
            and not x.cancelado
            and x.tipo_etapa = 'entrada_taller'
            and x.posicion < p.posicion
            and (
              x.estado = 'realizada'
              or x.fecha_fin_real is not null
              or x.fecha_real is not null
            )
          order by x.posicion desc, x.id desc
          limit 1
        ) prev on true
        where p.registro_hotel_id = p_registro_id
          and not p.cancelado
          and p.tipo_etapa = 'recogida_taller'
          and p.estado in ('pendiente', 'programada', 'en_curso')
          and (
            (
              orig.id is not null
              and not orig.cancelado
              and orig.tipo_etapa = 'entrada_taller'
              and (
                orig.estado = 'realizada'
                or orig.fecha_fin_real is not null
                or orig.fecha_real is not null
              )
            )
            or (
              orig.id is null
              and prev.id is not null
            )
          )
        order by p.posicion, p.id
        limit 1;

        if found then
          v_estado := 'terminado_pendiente_recogida';
          v_lugar := coalesce(nullif(btrim(v_stage.lugar), ''), v_r.lugar);
          v_motivo := 'recogida_taller_pendiente';

        else
          select e.id, e.estado, e.fecha_prevista
          into v_stage
          from public.etapas_hotel e
          where e.registro_hotel_id = p_registro_id
            and not e.cancelado
            and e.tipo_etapa = 'entrada_taller'
            and e.estado in ('pendiente', 'programada')
            and e.fecha_inicio_real is null
          order by e.posicion, e.id
          limit 1;

          if found then
            if v_r.estado = 'planificado' then
              v_estado := 'planificado';
            elsif v_stage.estado = 'programada'
                  or v_stage.fecha_prevista is not null then
              v_estado := 'entrada_taller_programada';
            else
              v_estado := 'pendiente_taller';
            end if;
            v_motivo := 'entrada_taller_pendiente';

          else
            select e.id, e.lugar
            into v_stage
            from public.etapas_hotel e
            where e.registro_hotel_id = p_registro_id
              and not e.cancelado
              and (
                e.accion_sistema = 'recuperar_y_liberar'
                or e.tipo_etapa = 'recuperar_ruta'
              )
              and e.estado in ('pendiente', 'programada', 'en_curso')
              and (
                exists (
                  select 1
                  from public.etapas_hotel p
                  where p.registro_hotel_id = p_registro_id
                    and not p.cancelado
                    and p.tipo_etapa = 'recogida_taller'
                    and p.estado = 'realizada'
                )
                or v_r.estado = 'recogido_pendiente_ruta'
              )
            order by e.posicion, e.id
            limit 1;

            if found then
              v_estado := 'recogido_pendiente_ruta';
              v_lugar := coalesce(nullif(btrim(v_stage.lugar), ''), v_r.lugar);
              v_motivo := 'recuperacion_pendiente';

            elsif v_abiertas > 0 then
              v_estado := 't_pendientes';
              v_motivo := 'otras_t_pendientes';

            elsif v_total > 0 then
              if v_r.estado not in (
                'recuperado',
                'reserva_liberada',
                'anulado'
              ) then
                v_estado := 'realizada';
              end if;
              v_motivo := case
                when v_sustitucion_vigente
                  then 't_finalizadas_sustitucion_vigente'
                else 't_finalizadas'
              end;

            else
              v_motivo := 'sin_t';
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  if v_r.cancelado
     or v_r.estado = 'anulado' then
    v_activa := false;
  elsif v_abiertas > 0 then
    v_activa := true;
  elsif v_sustitucion_vigente then
    v_activa := true;
  elsif v_total > 0 then
    v_activa := false;
  else
    v_activa := v_r.estado not in (
      'realizada',
      'recuperado',
      'reserva_liberada',
      'anulado'
    );
  end if;

  return jsonb_build_object(
    'existe', true,
    'registro_id', p_registro_id,
    'estado_actual', v_r.estado,
    'estado_proyectado', v_estado,
    'lugar_actual', v_r.lugar,
    'lugar_proyectado', v_lugar,
    'motivo', v_motivo,
    'total_t', v_total,
    't_abiertas', v_abiertas,
    'sustitucion_vigente', v_sustitucion_vigente,
    'activa_recomendada', v_activa
  );
end;
$function$;
