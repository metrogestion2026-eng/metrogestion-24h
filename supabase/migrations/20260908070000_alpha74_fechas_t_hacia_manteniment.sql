create or replace function app_private.manteniment_trabajos_asignados(p_seguimiento_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'app_private'
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'trabajo_sync_id', w.sync_id,
        'fila', nullif(source.value->>'fila', '')::integer,
        'clave_fila', coalesce(source.value->>'clave_fila', ''),
        'fecha_entrada', w.fecha_realizada,
        'fecha_salida', w.fecha_recogida
      )
      order by nullif(source.value->>'fila', '')::integer, w.sync_id
    ),
    '[]'::jsonb
  )
  from app_private.manteniment_t_trabajos w
  cross join lateral jsonb_array_elements(w.fuentes) source(value)
  where w.seguimiento_id = p_seguimiento_id;
$function$;

create or replace function app_private.manteniment_fechas_desde_etapa()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_fecha date;
  v_seguimiento_id uuid;
  v_actualizados integer := 0;
begin
  if coalesce(current_setting('app.clonando_pizarra', true), '') = '1'
     or coalesce(current_setting('app.reconciliando_etapas', true), '') = '1'
     or coalesce(current_setting('app.manteniment_importando_paradas', true), '') = '1'
  then
    return new;
  end if;

  if new.cancelado
     or new.estado <> 'realizada'
     or (
       tg_op = 'UPDATE'
       and old.estado is not distinct from new.estado
       and old.cancelado is not distinct from new.cancelado
     )
  then
    return new;
  end if;

  v_fecha := (
    coalesce(new.fecha_real, new.fecha_fin_real, new.fecha_inicio_real, clock_timestamp())
    at time zone 'Europe/Madrid'
  )::date;

  if new.tipo_etapa = 'entrada_taller' then
    update app_private.manteniment_t_trabajos w
       set fecha_realizada = v_fecha,
           actualizado_en = clock_timestamp()
      from app_private.manteniment_t_visitas v
     where v.id = w.visita_id
       and v.modalidad = 'taller'
       and v.grupo_entrada_id = new.grupo_documental_id
       and w.fecha_realizada is distinct from v_fecha;
    get diagnostics v_actualizados = row_count;
  elsif new.tipo_etapa = 'recogida_taller' then
    update app_private.manteniment_t_trabajos w
       set fecha_recogida = v_fecha,
           actualizado_en = clock_timestamp()
      from app_private.manteniment_t_visitas v
     where v.id = w.visita_id
       and v.modalidad = 'taller'
       and v.grupo_recogida_id = new.grupo_documental_id
       and w.fecha_recogida is distinct from v_fecha;
    get diagnostics v_actualizados = row_count;
  end if;

  select r.seguimiento_id
    into v_seguimiento_id
  from public.registros_hotel r
  where r.id = new.registro_hotel_id;

  if v_seguimiento_id is not null
     and (
       v_actualizados > 0
       or new.accion_sistema = 'recuperar_y_liberar'
     )
     and exists (
       select 1
       from app_private.manteniment_parada_sync s
       where s.seguimiento_id = v_seguimiento_id
     )
  then
    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;

  return new;
end;
$function$;

revoke all on function app_private.manteniment_fechas_desde_etapa() from public;

drop trigger if exists etapas_hotel_manteniment_fechas on public.etapas_hotel;
create trigger etapas_hotel_manteniment_fechas
after insert or update of estado, cancelado, fecha_real, fecha_fin_real, fecha_inicio_real
on public.etapas_hotel
for each row
execute function app_private.manteniment_fechas_desde_etapa();
