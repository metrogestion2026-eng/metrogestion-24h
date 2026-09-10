begin;

-- Una T administrativa representa por si sola el inicio y el fin del trabajo.
-- Al realizarla, J y K reciben la misma fecha y MANTENIMENT puede cerrar la fila.
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
  else
    update app_private.manteniment_t_trabajos w
       set fecha_realizada = v_fecha,
           fecha_recogida = v_fecha,
           actualizado_en = clock_timestamp()
      from public.trabajos_etapa_hotel th
     where th.id = w.trabajo_hotel_id
       and th.etapa_hotel_id = new.id
       and (w.fecha_realizada is distinct from v_fecha
            or w.fecha_recogida is distinct from v_fecha);
    get diagnostics v_actualizados = row_count;
  end if;

  select coalesce(new.seguimiento_id, r.seguimiento_id)
    into v_seguimiento_id
  from public.registros_hotel r
  where r.id = new.registro_hotel_id;

  if v_seguimiento_id is not null
     and (v_actualizados > 0 or new.accion_sistema = 'recuperar_y_liberar')
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

revoke all on function app_private.manteniment_fechas_desde_etapa()
  from public, anon, authenticated;

-- Los trabajos viajan aunque no exista sustituto. El indicador solo_trabajos
-- permite al Apps Script actualizar las necesidades sin insertar una PARADA.
create or replace function app_private.manteniment_encolar_parada(p_seguimiento_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_payload jsonb;
  v_trabajos jsonb;
  v_sync_id uuid;
  v_numero_parada text;
begin
  v_trabajos := app_private.manteniment_trabajos_asignados(p_seguimiento_id);
  v_payload := app_private.manteniment_construir_payload_parada(p_seguimiento_id);

  if v_payload is null then
    if jsonb_array_length(v_trabajos) = 0 then
      delete from app_private.manteniment_parada_outbox
      where seguimiento_id = p_seguimiento_id;
      return;
    end if;

    select s.sync_id,
           nullif(btrim(coalesce(r.numero_parada, '')), '')
      into v_sync_id, v_numero_parada
    from app_private.manteniment_parada_sync s
    join lateral (
      select h.numero_parada
      from public.registros_hotel h
      join public.pizarras p on p.id = h.pizarra_id
      where h.seguimiento_id = p_seguimiento_id
      order by (p.estado = 'en_curso') desc, p.fecha desc,
               h.actualizado_en desc, h.id desc
      limit 1
    ) r on true
    where s.seguimiento_id = p_seguimiento_id;

    if v_sync_id is null or v_numero_parada is null then return; end if;
    v_payload := jsonb_build_object(
      'sync_id', v_sync_id,
      'seguimiento_id', p_seguimiento_id,
      'numero_parada', 'PA-' || v_numero_parada,
      'solo_trabajos', true,
      'trabajos_asignados', v_trabajos
    );
  else
    v_payload := jsonb_set(v_payload, '{solo_trabajos}', 'false'::jsonb, true);
    v_payload := jsonb_set(v_payload, '{trabajos_asignados}', v_trabajos, true);
    v_sync_id := (v_payload->>'sync_id')::uuid;
  end if;

  insert into app_private.manteniment_parada_outbox(
    seguimiento_id, sync_id, revision, estado, payload,
    actualizado_en, confirmado_en, ultimo_error
  ) values (
    p_seguimiento_id, v_sync_id, 1, 'pendiente', v_payload,
    clock_timestamp(), null, ''
  )
  on conflict (seguimiento_id) do update
  set sync_id = excluded.sync_id,
      revision = app_private.manteniment_parada_outbox.revision + 1,
      estado = 'pendiente',
      payload = excluded.payload,
      actualizado_en = clock_timestamp(),
      confirmado_en = null,
      ultimo_error = '';
end;
$function$;

revoke all on function app_private.manteniment_encolar_parada(uuid)
  from public, anon, authenticated;

-- Corrige trabajos administrativos realizados antes de esta regla.
update app_private.manteniment_t_trabajos w
set fecha_realizada = x.fecha,
    fecha_recogida = x.fecha,
    actualizado_en = clock_timestamp()
from (
  select th.id as trabajo_hotel_id,
         (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
          at time zone 'Europe/Madrid')::date as fecha
  from public.trabajos_etapa_hotel th
  join public.etapas_hotel e on e.id = th.etapa_hotel_id
  where e.estado = 'realizada'
    and not e.cancelado
    and e.tipo_etapa not in ('entrada_taller', 'recogida_taller')
    and coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) is not null
) x
where w.trabajo_hotel_id = x.trabajo_hotel_id
  and (w.fecha_realizada is distinct from x.fecha
       or w.fecha_recogida is distinct from x.fecha);

do $block$
declare
  v_seguimiento_id uuid;
begin
  for v_seguimiento_id in
    select distinct w.seguimiento_id
    from app_private.manteniment_t_trabajos w
    join public.trabajos_etapa_hotel th on th.id = w.trabajo_hotel_id
    join public.etapas_hotel e on e.id = th.etapa_hotel_id
    where e.estado = 'realizada'
      and not e.cancelado
      and e.tipo_etapa not in ('entrada_taller', 'recogida_taller')
      and exists (
        select 1 from app_private.manteniment_parada_sync s
        where s.seguimiento_id = w.seguimiento_id
      )
  loop
    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end loop;
end;
$block$;

commit;
