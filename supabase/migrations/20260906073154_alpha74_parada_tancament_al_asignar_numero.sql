begin;

-- La fila de MANTENIMENT nace en cuanto Metrogestión asigna el número de parada,
-- aunque J siga vacía porque la inmovilización todavía sea una propuesta.
-- Si el seguimiento se anula, se conserva la misma fila y pasa a ANULADA.

create or replace function app_private.manteniment_construir_payload_parada(p_seguimiento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_sync app_private.manteniment_parada_sync%rowtype;
  v_ficha record;
  v_resumen record;
  v_periodo record;
  v_fecha_k date;
  v_dias integer;
  v_km numeric;
  v_anulada boolean;
begin
  select * into v_sync
  from app_private.manteniment_parada_sync
  where seguimiento_id = p_seguimiento_id;
  if not found then return null; end if;

  -- La última copia de la pizarra es la autoridad del estado. No se excluyen las
  -- canceladas porque precisamente deben producir el comando ANULADA.
  select r.*, p.fecha as fecha_pizarra
    into v_ficha
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.seguimiento_id = p_seguimiento_id
  order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
  limit 1;
  if not found then return null; end if;

  v_anulada := coalesce(v_ficha.cancelado, false) or v_ficha.estado = 'anulado';

  select * into v_resumen
  from public.paradas_sustitucion_resumen
  where seguimiento_id = p_seguimiento_id;

  v_fecha_k := case
    when v_sync.tancament <> '' then v_sync.fecha_corte
    when v_ficha.retirado_hotel_activo
         or v_ficha.estado in ('recuperado', 'reserva_liberada')
      then coalesce(v_ficha.fecha_retirado_hotel::date, v_ficha.fecha_pizarra)
    else null
  end;

  if v_sync.dias_parada_manual is not null then
    v_dias := v_sync.dias_parada_manual;
  elsif v_sync.tancament <> '' and v_fecha_k is not null then
    select c.* into v_periodo
    from public.cierres_facturacion c
    where v_fecha_k between c.fecha_inicio and c.fecha_cierre
    order by c.fecha_inicio desc
    limit 1;
    v_dias := greatest(
      0,
      v_fecha_k - greatest(
        coalesce(v_resumen.fecha_inicio_parada, v_ficha.fecha_parada, v_ficha.fecha_pizarra),
        coalesce(v_periodo.fecha_inicio, coalesce(v_resumen.fecha_inicio_parada, v_ficha.fecha_parada, v_ficha.fecha_pizarra))
      ) + 1
    );
  else
    v_dias := coalesce(v_resumen.dias_parada_total, 0);
  end if;

  v_km := coalesce(
    v_sync.km_facturables_manual,
    case when v_resumen.km_dia is not null then round(v_dias::numeric * v_resumen.km_dia, 2) end
  );

  return jsonb_build_object(
    'sync_id', v_sync.sync_id,
    'seguimiento_id', p_seguimiento_id,
    'dfm', coalesce(v_ficha.vehiculo_sustituido, ''),
    'matricula', coalesce(v_ficha.matricula_sustituido, ''),
    'tipo', coalesce(v_ficha.tipo_unidad, ''),
    'upc', coalesce(v_ficha.upc, ''),
    'numero_parada', case
      when btrim(coalesce(v_ficha.numero_parada, '')) = '' then ''
      else 'PA-' || btrim(v_ficha.numero_parada)
    end,
    'sustituto', coalesce(v_ficha.vehiculo_reserva, ''),
    'estado', case when v_anulada then 'ANULADA' else 'PARADA' end,
    'fecha_programada', v_sync.fecha_programada_parada,
    'fecha_parada', v_ficha.fecha_parada,
    'fecha_k', v_fecha_k,
    'dias_parada', v_dias,
    'marca', coalesce(v_ficha.marca, ''),
    'km_facturables', v_km,
    'tancament', v_sync.tancament,
    'tancament_supervisado', v_sync.tancament_supervisado
  );
end;
$function$;

create or replace function app_private.manteniment_encolar_parada(p_seguimiento_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_payload jsonb;
  v_sync_id uuid;
begin
  v_payload := app_private.manteniment_construir_payload_parada(p_seguimiento_id);
  if v_payload is null then return; end if;
  if btrim(coalesce(v_payload->>'numero_parada', '')) = '' then return; end if;
  v_sync_id := (v_payload->>'sync_id')::uuid;

  insert into app_private.manteniment_parada_outbox(
    seguimiento_id, sync_id, revision, estado, payload, actualizado_en, confirmado_en, ultimo_error
  ) values (
    p_seguimiento_id, v_sync_id, 1, 'pendiente', v_payload, clock_timestamp(), null, ''
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

create or replace function app_private.manteniment_importar_paradas(p_paradas jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_item jsonb;
  v_sync app_private.manteniment_parada_sync%rowtype;
  v_ficha public.registros_hotel%rowtype;
  v_registro_id uuid;
  v_k date;
  v_q text;
  v_fecha_parada date;
  v_estado text;
  v_cancelada boolean;
  v_count integer := 0;
begin
  if p_paradas is null then return 0; end if;
  if jsonb_typeof(p_paradas) <> 'array' or jsonb_array_length(p_paradas) > 500 then
    raise exception 'El bloque PARADA no tiene un formato válido';
  end if;

  perform set_config('app.manteniment_importando_paradas', '1', true);
  for v_item in select value from jsonb_array_elements(p_paradas)
  loop
    if coalesce(v_item->>'sync_id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'Una fila PARADA no contiene un identificador válido';
    end if;

    select * into v_sync
    from app_private.manteniment_parada_sync
    where sync_id = (v_item->>'sync_id')::uuid
    for update;
    if not found then
      raise exception 'Una fila PARADA no pertenece a Metrogestión';
    end if;

    v_estado := upper(btrim(coalesce(v_item->>'estado', '')));
    if v_estado not in ('PARADA', 'ANULADA') then
      raise exception 'Una fila vinculada debe conservar MANTENIMENT = PARADA o ANULADA';
    end if;

    select r.* into v_ficha
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = v_sync.seguimiento_id
    order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
    for update of r;
    if not found then
      raise exception 'La PARADA vinculada ya no tiene ficha en Metrogestión';
    end if;

    v_cancelada := coalesce(v_ficha.cancelado, false) or v_ficha.estado = 'anulado';
    if v_cancelada then
      -- La anulación nace en Metrogestión. No se importa ningún dato operativo de
      -- una línea anulada; solo se conserva su posición y se reenvía su estado.
      update app_private.manteniment_parada_sync
      set fila_manteniment = nullif(v_item->>'fila', '')::integer
      where seguimiento_id = v_sync.seguimiento_id;

      perform set_config('app.manteniment_importando_paradas', '0', true);
      perform app_private.manteniment_encolar_parada(v_sync.seguimiento_id);
      perform set_config('app.manteniment_importando_paradas', '1', true);
      v_count := v_count + 1;
      continue;
    end if;

    if v_estado <> 'PARADA' then
      raise exception 'Metrogestión mantiene activa esta fila; MANTENIMENT debe conservar PARADA';
    end if;

    -- J puede estar vacía mientras la sustitución sea solo una propuesta pendiente
    -- de parar. La fila ya existe porque el número de parada sí está asignado.
    v_fecha_parada := nullif(v_item->>'fecha_parada', '')::date;
    v_q := upper(btrim(coalesce(v_item->>'tancament', '')));
    if v_q <> '' and v_q !~ '^TANCAMENT [0-9]{1,3}$' then
      raise exception 'TANCAMENT debe ir seguido del número de periodo';
    end if;
    v_k := nullif(v_item->>'fecha_k', '')::date;
    if v_q = '' and v_k is not null and v_fecha_parada is null then
      raise exception 'Antes de recuperar en K debe indicarse la fecha real de parada en J';
    end if;

    update app_private.manteniment_parada_sync
    set fecha_programada_parada = nullif(v_item->>'fecha_programada', '')::date,
        fecha_corte = case when v_q <> '' then v_k else null end,
        tancament = v_q,
        tancament_supervisado = case
          when v_q is distinct from v_sync.tancament or v_k is distinct from v_sync.fecha_corte then false
          else v_sync.tancament_supervisado
        end,
        tancament_supervisado_por = case
          when v_q is distinct from v_sync.tancament or v_k is distinct from v_sync.fecha_corte then null
          else v_sync.tancament_supervisado_por
        end,
        tancament_supervisado_en = case
          when v_q is distinct from v_sync.tancament or v_k is distinct from v_sync.fecha_corte then null
          else v_sync.tancament_supervisado_en
        end,
        dias_parada_manual = case
          when v_item ? 'dias_parada' then nullif(v_item->>'dias_parada', '')::integer
          else v_sync.dias_parada_manual
        end,
        km_facturables_manual = case
          when v_item ? 'km_facturables' then nullif(v_item->>'km_facturables', '')::numeric
          else v_sync.km_facturables_manual
        end,
        fila_manteniment = nullif(v_item->>'fila', '')::integer
    where seguimiento_id = v_sync.seguimiento_id;

    update public.registros_hotel r
    set fecha_parada = v_fecha_parada,
        version = coalesce(r.version, 0) + 1,
        actualizado_en = clock_timestamp(),
        modificado_por = coalesce(r.modificado_por, r.creado_por)
    where r.seguimiento_id = v_sync.seguimiento_id
      and not r.cancelado
      and r.fecha_parada is distinct from v_fecha_parada;

    v_registro_id := v_ficha.id;
    if v_q = '' and v_k is not null then
      update public.registros_hotel
      set retirado_hotel_activo = true,
          fecha_retirado_hotel = v_k::timestamp at time zone 'Europe/Madrid',
          estado = case
            when estado not in ('reserva_liberada', 'recuperado') then 'recuperado'
            else estado
          end,
          version = coalesce(version, 0) + 1,
          actualizado_en = clock_timestamp(),
          modificado_por = coalesce(modificado_por, creado_por)
      where id = v_registro_id
        and (
          not retirado_hotel_activo
          or fecha_retirado_hotel::date is distinct from v_k
          or estado not in ('reserva_liberada', 'recuperado')
        );
    end if;

    perform set_config('app.manteniment_importando_paradas', '0', true);
    perform app_private.manteniment_encolar_parada(v_sync.seguimiento_id);
    perform set_config('app.manteniment_importando_paradas', '1', true);
    v_count := v_count + 1;
  end loop;
  perform set_config('app.manteniment_importando_paradas', '0', true);
  return v_count;
end;
$function$;

revoke all on function app_private.manteniment_construir_payload_parada(uuid)
  from public, anon, authenticated;
revoke all on function app_private.manteniment_encolar_parada(uuid)
  from public, anon, authenticated;
revoke all on function app_private.manteniment_importar_paradas(jsonb)
  from public, anon, authenticated;
grant execute on function app_private.manteniment_construir_payload_parada(uuid)
  to service_role;
grant execute on function app_private.manteniment_encolar_parada(uuid)
  to service_role;
grant execute on function app_private.manteniment_importar_paradas(jsonb)
  to service_role;

comment on function app_private.manteniment_construir_payload_parada(uuid) is
  'Genera PARADA al asignar número y conserva la misma fila como ANULADA al cancelar el seguimiento.';
comment on function app_private.manteniment_importar_paradas(jsonb) is
  'Importa I, J, K, L, P y Q; admite J vacía en propuestas y no importa datos de filas anuladas.';

commit;
