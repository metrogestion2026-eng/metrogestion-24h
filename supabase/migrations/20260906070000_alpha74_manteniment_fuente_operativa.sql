begin;

-- MANTENIMENT gobierna únicamente los datos operativos de una PARADA vinculada:
-- I, J, K, L, P y Q. Metrogestión conserva y restaura A-E, G y O.

create or replace function app_private.manteniment_encolar_parada(p_seguimiento_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_payload jsonb;
  v_sync_id uuid;
  v_numero_parada text;
begin
  v_payload := app_private.manteniment_construir_payload_parada(p_seguimiento_id);
  if v_payload is null then return; end if;

  select r.numero_parada
    into v_numero_parada
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.seguimiento_id = p_seguimiento_id
    and not r.cancelado
  order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
  limit 1;

  v_payload := v_payload || jsonb_build_object(
    'numero_parada', case
      when btrim(coalesce(v_numero_parada, '')) = '' then ''
      else 'PA-' || btrim(v_numero_parada)
    end
  );
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
    if upper(btrim(coalesce(v_item->>'estado', ''))) <> 'PARADA' then
      raise exception 'Una fila vinculada ha dejado de ser PARADA';
    end if;

    select r.* into v_ficha
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = v_sync.seguimiento_id and not r.cancelado
    order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
    for update of r;
    if not found then
      raise exception 'La PARADA vinculada ya no tiene una ficha activa en Metrogestión';
    end if;

    v_fecha_parada := nullif(v_item->>'fecha_parada', '')::date;

    if v_fecha_parada is null then
      raise exception 'La fecha de parada de la columna J es obligatoria en una fila PARADA';
    end if;

    v_q := upper(btrim(coalesce(v_item->>'tancament', '')));
    if v_q <> '' and v_q !~ '^TANCAMENT [0-9]{1,3}$' then
      raise exception 'TANCAMENT debe ir seguido del número de periodo';
    end if;
    v_k := nullif(v_item->>'fecha_k', '')::date;

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

    -- J es una fecha operativa: se mantiene igual en todas las copias diarias
    -- del mismo seguimiento, sin modificar ningún dato de identidad.
    update public.registros_hotel r
    set fecha_parada = v_fecha_parada,
        version = coalesce(r.version, 0) + 1,
        actualizado_en = clock_timestamp(),
        modificado_por = coalesce(r.modificado_por, r.creado_por)
    where r.seguimiento_id = v_sync.seguimiento_id
      and not r.cancelado
      and r.fecha_parada is distinct from v_fecha_parada;

    v_registro_id := v_ficha.id;

    if v_registro_id is not null and v_q = '' and v_k is not null then
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

create or replace function app_private.manteniment_confirmar_comandos(p_token text, p_confirmaciones jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions
as $function$
declare
  v_config app_private.manteniment_sync_config%rowtype;
  v_hash text;
  v_item jsonb;
  v_seguimiento_id uuid;
  v_payload jsonb;
  v_count integer := 0;
begin
  select * into v_config from app_private.manteniment_sync_config where id = 1;
  if not found or not v_config.token_activo or v_config.token_hash = '' then
    raise exception 'La actualización automática de MANTENIMENT no está activada';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_hash is distinct from v_config.token_hash then raise exception 'Clave de conexión no válida'; end if;
  if jsonb_typeof(p_confirmaciones) <> 'array' or jsonb_array_length(p_confirmaciones) > 500 then
    raise exception 'Las confirmaciones no tienen un formato válido';
  end if;

  perform set_config('app.manteniment_importando_altas', '1', true);
  perform set_config('app.manteniment_importando_paradas', '1', true);
  for v_item in select value from jsonb_array_elements(p_confirmaciones)
  loop
    if coalesce(v_item->>'estado', '') <> 'aplicado' then continue; end if;

    if coalesce(v_item->>'tipo', 'parada') = 'alta' then
      update app_private.manteniment_activo_outbox o
      set estado = 'confirmado', confirmado_en = clock_timestamp(), intentos = intentos + 1
      where o.vehiculo_id = (v_item->>'vehiculo_id')::uuid
        and o.revision = (v_item->>'revision')::integer
        and o.estado = 'pendiente';
      if found then
        update public.vehiculos
        set fuente_manteniment_fila = nullif(v_item->>'fila', '')::integer,
            fuente_manteniment_actualizado_en = clock_timestamp()
        where id = (v_item->>'vehiculo_id')::uuid;
        v_count := v_count + 1;
      end if;
    else
      v_seguimiento_id := null;
      v_payload := null;
      update app_private.manteniment_parada_outbox o
      set estado = 'confirmado', confirmado_en = clock_timestamp(), intentos = intentos + 1
      where o.sync_id = (v_item->>'sync_id')::uuid
        and o.revision = (v_item->>'revision')::integer
        and o.estado = 'pendiente'
      returning o.seguimiento_id, o.payload into v_seguimiento_id, v_payload;

      if v_seguimiento_id is not null then
        update app_private.manteniment_parada_sync s
        set ultimo_payload_confirmado = v_payload,
            fila_manteniment = nullif(v_item->>'fila', '')::integer
        where s.seguimiento_id = v_seguimiento_id;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  perform set_config('app.manteniment_importando_paradas', '0', true);
  perform set_config('app.manteniment_importando_altas', '0', true);
  return jsonb_build_object('ok', true, 'confirmados', v_count);
end;
$function$;

comment on function app_private.manteniment_importar_paradas(jsonb) is
  'Importa solo I, J, K, L, P y Q de filas PARADA vinculadas; ignora A-E, G y O porque su identidad pertenece a Metrogestión.';
comment on function app_private.manteniment_confirmar_comandos(text, jsonb) is
  'Confirma exactamente una revisión sin volver a encolarla por los triggers de sincronización.';

commit;
