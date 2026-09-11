begin;

create or replace function app_private.manteniment_ajuste_24h(
  p_seguimiento_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_ficha record;
  v_activacion public.activaciones_24h%rowtype;
  v_fecha_salida date;
begin
  select r.*, p.fecha as fecha_pizarra
    into v_ficha
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.seguimiento_id = p_seguimiento_id
  order by (p.estado = 'en_curso') desc, p.fecha desc,
           r.actualizado_en desc, r.id desc
  limit 1;

  if not found
     or upper(btrim(coalesce(v_ficha.tipo_movimiento, ''))) <> '24H'
     or btrim(coalesce(v_ficha.numero_parada, '')) = ''
  then
    return null;
  end if;

  select a.* into v_activacion
  from public.activaciones_24h a
  where coalesce(a.estado, '') <> 'anulada'
    and (a.registro_hotel_id = v_ficha.id
         or a.seguimiento_hotel_id = p_seguimiento_id)
  order by (a.registro_hotel_id = v_ficha.id) desc,
           a.actualizado_en desc, a.creado_en desc
  limit 1;

  if not found then return null; end if;

  select (
    coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
    at time zone 'Europe/Madrid'
  )::date
    into v_fecha_salida
  from public.etapas_hotel e
  where e.registro_hotel_id = v_ficha.id
    and not e.cancelado
    and e.accion_sistema = 'recuperar_y_liberar'
    and e.estado = 'realizada'
  order by coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) desc nulls last
  limit 1;

  return jsonb_build_object(
    'seguimiento_id', p_seguimiento_id,
    'dfm', coalesce(v_ficha.vehiculo_sustituido, v_activacion.dfm, ''),
    'matricula', coalesce(v_ficha.matricula_sustituido, v_activacion.matricula, ''),
    'tipo', coalesce(v_ficha.tipo_unidad, ''),
    'upc', coalesce(v_ficha.upc, v_activacion.upc, ''),
    'numero_parada', 'PA-' || btrim(v_ficha.numero_parada),
    'tipo_trabajo', 'AVERÍA',
    'designacion', 'AV24H',
    'fecha_necesidad', coalesce(v_activacion.fecha_activacion,
                                v_ficha.fecha_parada, v_ficha.fecha_pizarra),
    'fecha_entrada', coalesce(v_activacion.fecha_activacion,
                              v_ficha.fecha_parada, v_ficha.fecha_pizarra),
    'fecha_salida', v_fecha_salida,
    'marca', coalesce(v_ficha.marca, v_activacion.marca, ''),
    'numero_caso', coalesce(v_activacion.numero_caso, ''),
    'averia', coalesce(v_activacion.averia, ''),
    'diagnostico', coalesce(v_activacion.diagnostico, '')
  );
end;
$function$;

revoke all on function app_private.manteniment_ajuste_24h(uuid)
  from public, anon, authenticated;

create or replace function app_private.manteniment_encolar_parada(p_seguimiento_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_payload jsonb;
  v_trabajos jsonb;
  v_ajuste_24h jsonb;
  v_sync_id uuid;
  v_numero_parada text;
begin
  v_trabajos := app_private.manteniment_trabajos_asignados(p_seguimiento_id);
  v_ajuste_24h := app_private.manteniment_ajuste_24h(p_seguimiento_id);
  v_payload := app_private.manteniment_construir_payload_parada(p_seguimiento_id);

  if v_payload is null then
    if jsonb_array_length(v_trabajos) = 0 and v_ajuste_24h is null then
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

  if v_ajuste_24h is not null then
    v_payload := jsonb_set(v_payload, '{ajuste_24h}', v_ajuste_24h, true);
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

do $do$
declare
  v_seguimiento_id uuid;
begin
  select r.seguimiento_id into v_seguimiento_id
  from public.activaciones_24h a
  join public.registros_hotel r on r.id = a.registro_hotel_id
  where regexp_replace(upper(btrim(a.dfm)), '[[:space:]]+', '', 'g') = '2625'
    and upper(btrim(coalesce(r.tipo_movimiento, ''))) = '24H'
    and coalesce(a.estado, '') <> 'anulada'
  order by a.actualizado_en desc, a.creado_en desc
  limit 1;

  if v_seguimiento_id is not null then
    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;
end;
$do$;

comment on function app_private.manteniment_ajuste_24h(uuid) is
  'Genera la fila AV24H y permite desvincular de esa parada las necesidades ordinarias de MANTENIMENT.';

commit;
