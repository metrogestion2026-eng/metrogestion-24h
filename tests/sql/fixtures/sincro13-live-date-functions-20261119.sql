-- SINCRO 13 / REAL RUNTIME CAPTURE FOR ISOLATED CI, ONLY FUNCTION DEFINITIONS.

-- Source: connected Supabase *testing* project on 2026-11-19, read-only pg_get_functiondef.

-- No rows, user records or credentials were transferred. DO NOT APPLY TO OPERATIONS.

-- manteniment_etapa_actual md5(pg_get_functiondef)=56c386d5c8f2a186ba10bea5c82d9cf4
CREATE OR REPLACE FUNCTION app_private.manteniment_etapa_actual(p_seguimiento_id uuid, p_etapa_origen_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select actual.id
  from public.etapas_hotel origen
  join public.registros_hotel original on original.id = origen.registro_hotel_id
  cross join lateral (
    select r.id from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = p_seguimiento_id
    order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
  ) ficha
  join public.etapas_hotel actual
    on actual.registro_hotel_id = ficha.id
   and (actual.seguimiento_id = origen.seguimiento_id
     or (actual.grupo_documental_id = origen.grupo_documental_id
       and not exists (
         select 1 from public.etapas_hotel identidad
         where identidad.registro_hotel_id = ficha.id
           and identidad.seguimiento_id = origen.seguimiento_id
       )))
  where origen.id = p_etapa_origen_id
    and original.seguimiento_id = p_seguimiento_id
  order by actual.cancelado, actual.creado_en, actual.id
  limit 1;
$function$;

-- manteniment_fechas_desde_etapa md5(pg_get_functiondef)=2f6e56c1c1b7b5251ea1e32f03ce1c2b
CREATE OR REPLACE FUNCTION app_private.manteniment_fechas_desde_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_fecha date;
  v_fecha_acabado date;
  v_fecha_recogido date;
  v_seguimiento_id uuid;
  v_actualizados integer := 0;
  v_nuevo boolean := false;
begin
  if coalesce(current_setting('app.clonando_pizarra', true), '') = '1'
     or coalesce(current_setting('app.reconciliando_etapas', true), '') = '1'
     or coalesce(current_setting('app.manteniment_importando_paradas', true), '') = '1'
  then
    return new;
  end if;

  v_nuevo := app_private.usa_flujo_taller_hitos(new.registro_hotel_id);

  if v_nuevo and app_private.es_tipo_entrada_taller_alpha75(new.tipo_etapa)
     and coalesce(new.accion_sistema,'') not in ('recuperar_y_liberar','liberar_reserva')
     and not new.cancelado then
    if tg_op='UPDATE'
       and old.fecha_inicio_real is not distinct from new.fecha_inicio_real
       and old.fecha_fin_real is not distinct from new.fecha_fin_real
       and old.fecha_real is not distinct from new.fecha_real
       and old.cancelado is not distinct from new.cancelado
    then
      return new;
    end if;

    select r.seguimiento_id into v_seguimiento_id
    from public.registros_hotel r where r.id=new.registro_hotel_id;

    v_fecha_acabado := case when new.fecha_fin_real is null then null
      else (new.fecha_fin_real at time zone 'Europe/Madrid')::date end;
    v_fecha_recogido := case when new.fecha_real is null then null
      else (new.fecha_real at time zone 'Europe/Madrid')::date end;

    update app_private.manteniment_t_trabajos w
       set fecha_realizada = v_fecha_acabado,
           fecha_recogida = v_fecha_recogido,
           actualizado_en = clock_timestamp()
      from public.trabajos_etapa_hotel th, app_private.manteniment_t_visitas v
     where th.id=w.trabajo_hotel_id and not th.cancelado
       and v.id=w.visita_id
       and v.modalidad='taller'
       and w.seguimiento_id=v_seguimiento_id
       and app_private.manteniment_etapa_actual(w.seguimiento_id,th.etapa_hotel_id)=new.id
       and (w.fecha_realizada is distinct from v_fecha_acabado
            or w.fecha_recogida is distinct from v_fecha_recogido);
    get diagnostics v_actualizados=row_count;

    if v_seguimiento_id is not null
       and exists(select 1 from app_private.manteniment_parada_sync s where s.seguimiento_id=v_seguimiento_id)
    then
      perform app_private.manteniment_encolar_parada(v_seguimiento_id);
    end if;
    return new;
  end if;

  if new.cancelado
     or new.estado <> 'realizada'
     or (
       tg_op = 'UPDATE'
       and old.estado is not distinct from new.estado
       and old.cancelado is not distinct from new.cancelado
       and old.fecha_real is not distinct from new.fecha_real
       and old.fecha_fin_real is not distinct from new.fecha_fin_real
       and old.fecha_inicio_real is not distinct from new.fecha_inicio_real
     )
  then
    return new;
  end if;

  v_fecha := (
    coalesce(new.fecha_real, new.fecha_fin_real, new.fecha_inicio_real, clock_timestamp())
    at time zone 'Europe/Madrid'
  )::date;

  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r where r.id = new.registro_hotel_id;

  if new.tipo_etapa = 'entrada_taller' then
    update app_private.manteniment_t_trabajos w
       set fecha_realizada = v_fecha,
           fecha_recogida = case when v.modalidad in ('gestion', 'tramite', 'entrada_sin_recogida')
             then v_fecha else w.fecha_recogida end,
           actualizado_en = clock_timestamp()
      from public.trabajos_etapa_hotel th, app_private.manteniment_t_visitas v
     where th.id = w.trabajo_hotel_id and not th.cancelado
       and v.id = w.visita_id
       and w.seguimiento_id = v_seguimiento_id
       and app_private.manteniment_etapa_actual(w.seguimiento_id, th.etapa_hotel_id) = new.id
       and (w.fecha_realizada is distinct from v_fecha
         or (v.modalidad in ('gestion', 'tramite', 'entrada_sin_recogida')
             and w.fecha_recogida is distinct from v_fecha));
    get diagnostics v_actualizados = row_count;
  elsif new.tipo_etapa = 'recogida_taller' then
    update app_private.manteniment_t_trabajos w
       set fecha_recogida = v_fecha,
           actualizado_en = clock_timestamp()
      from app_private.manteniment_t_visitas v
     where v.id = w.visita_id
       and w.seguimiento_id = v_seguimiento_id
       and v.modalidad = 'taller'
       and v.grupo_recogida_id = new.grupo_documental_id
       and w.fecha_recogida is distinct from v_fecha;
    get diagnostics v_actualizados = row_count;
  else
    update app_private.manteniment_t_trabajos w
       set fecha_realizada = case
             when upper(btrim(w.designacion)) in ('REPUESTOS', 'ACT', 'CV', 'LINDEP')
               then w.fecha_realizada
             else v_fecha
           end,
           fecha_recogida = v_fecha,
           actualizado_en = clock_timestamp()
      from public.trabajos_etapa_hotel th
     where th.id = w.trabajo_hotel_id and not th.cancelado
       and w.seguimiento_id = v_seguimiento_id
       and app_private.manteniment_etapa_actual(w.seguimiento_id, th.etapa_hotel_id) = new.id
       and (w.fecha_realizada is distinct from v_fecha
            or w.fecha_recogida is distinct from v_fecha);
    get diagnostics v_actualizados = row_count;
  end if;

  if v_seguimiento_id is not null
     and (v_actualizados > 0 or new.accion_sistema = 'recuperar_y_liberar')
     and exists (
       select 1 from app_private.manteniment_parada_sync s
       where s.seguimiento_id = v_seguimiento_id
     )
  then
    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;

  return new;
end;
$function$;

