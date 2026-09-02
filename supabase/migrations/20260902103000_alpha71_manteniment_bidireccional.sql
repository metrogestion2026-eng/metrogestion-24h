begin;

alter table public.vehiculos
  add column if not exists proxima_itv_fecha date;

create or replace function app_private.vehiculos_sync_fin_contrato_fecha()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $function$
begin
  new.fin_contrato_fecha := app_private.calcular_fin_contrato_fecha(
    new.dfm,
    new.categoria,
    new.clase_vehiculo,
    new.marca,
    new.fecha_matriculacion
  );
  new.proxima_itv_fecha := case
    when new.fecha_matriculacion is null then null
    else (new.fecha_matriculacion + interval '1 year')::date
  end;
  return new;
end;
$function$;

drop trigger if exists vehiculos_sync_fin_contrato_fecha on public.vehiculos;
create trigger vehiculos_sync_fin_contrato_fecha
before insert or update of fecha_matriculacion, categoria, clase_vehiculo, marca, dfm
on public.vehiculos
for each row execute function app_private.vehiculos_sync_fin_contrato_fecha();

update public.vehiculos
set fecha_matriculacion = fecha_matriculacion
where fecha_matriculacion is not null;

create table if not exists app_private.manteniment_parada_sync (
  seguimiento_id uuid primary key,
  sync_id uuid not null default gen_random_uuid() unique,
  fecha_programada_parada date,
  fecha_corte date,
  tancament text not null default '',
  tancament_supervisado boolean not null default false,
  tancament_supervisado_por uuid,
  tancament_supervisado_en timestamptz,
  dias_parada_manual integer,
  km_facturables_manual numeric(14,2),
  fila_manteniment integer,
  ultimo_payload_confirmado jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp(),
  constraint manteniment_parada_sync_tancament_check
    check (tancament = '' or tancament ~ '^TANCAMENT [0-9]{1,3}$'),
  constraint manteniment_parada_sync_dias_check
    check (dias_parada_manual is null or dias_parada_manual >= 0),
  constraint manteniment_parada_sync_km_check
    check (km_facturables_manual is null or km_facturables_manual >= 0)
);

create table if not exists app_private.manteniment_parada_outbox (
  seguimiento_id uuid primary key,
  sync_id uuid not null,
  revision integer not null default 1,
  estado text not null default 'pendiente',
  payload jsonb not null,
  intentos integer not null default 0,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp(),
  confirmado_en timestamptz,
  ultimo_error text not null default '',
  constraint manteniment_parada_outbox_estado_check
    check (estado in ('pendiente', 'confirmado'))
);

alter table app_private.manteniment_parada_sync enable row level security;
alter table app_private.manteniment_parada_outbox enable row level security;
revoke all on table app_private.manteniment_parada_sync from public, anon, authenticated;
revoke all on table app_private.manteniment_parada_outbox from public, anon, authenticated;

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
begin
  select * into v_sync
  from app_private.manteniment_parada_sync
  where seguimiento_id = p_seguimiento_id;
  if not found then return null; end if;

  select r.*, p.fecha as fecha_pizarra
    into v_ficha
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.seguimiento_id = p_seguimiento_id
    and not r.cancelado
  order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
  limit 1;
  if not found then return null; end if;

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
    'sustituto', coalesce(v_ficha.vehiculo_reserva, ''),
    'estado', 'PARADA',
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

create or replace function app_private.manteniment_parada_sync_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $function$
begin
  new.actualizado_en := clock_timestamp();
  if coalesce(current_setting('app.manteniment_importando_paradas', true), '') <> '1' then
    perform app_private.manteniment_encolar_parada(new.seguimiento_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists manteniment_parada_sync_encolar on app_private.manteniment_parada_sync;
create trigger manteniment_parada_sync_encolar
after insert or update on app_private.manteniment_parada_sync
for each row execute function app_private.manteniment_parada_sync_trigger();

create or replace function app_private.manteniment_registro_hotel_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $function$
begin
  if coalesce(current_setting('app.manteniment_importando_paradas', true), '') = '1' then return new; end if;
  if exists (
    select 1 from app_private.manteniment_parada_sync s
    where s.seguimiento_id = new.seguimiento_id
  ) then
    perform app_private.manteniment_encolar_parada(new.seguimiento_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists registros_hotel_manteniment_encolar on public.registros_hotel;
create trigger registros_hotel_manteniment_encolar
after insert or update of vehiculo_sustituido, matricula_sustituido, vehiculo_reserva,
  tipo_unidad, upc, marca, fecha_parada, retirado_hotel_activo, fecha_retirado_hotel,
  estado, cancelado
on public.registros_hotel
for each row execute function app_private.manteniment_registro_hotel_trigger();

create or replace function app_private.obtener_ficha_hotel_edicion_alpha71(p_registro_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_detail jsonb;
  v_tracking uuid;
  v_sync app_private.manteniment_parada_sync%rowtype;
begin
  v_detail := public.obtener_ficha_hotel_edicion(p_registro_id);
  select seguimiento_id into v_tracking from public.registros_hotel where id = p_registro_id;
  select * into v_sync from app_private.manteniment_parada_sync where seguimiento_id = v_tracking;

  v_detail := jsonb_set(
    v_detail,
    '{ficha}',
    coalesce(v_detail->'ficha', '{}'::jsonb) || jsonb_build_object(
      'fecha_programada_parada', v_sync.fecha_programada_parada,
      'manteniment_fecha_corte', v_sync.fecha_corte,
      'manteniment_tancament', coalesce(v_sync.tancament, ''),
      'manteniment_tancament_supervisado', coalesce(v_sync.tancament_supervisado, false),
      'manteniment_dias_parada_manual', v_sync.dias_parada_manual,
      'manteniment_km_facturables_manual', v_sync.km_facturables_manual,
      'manteniment_sync_id', v_sync.sync_id
    ),
    true
  );
  return v_detail;
end;
$function$;

create or replace function app_private.crear_ficha_hotel_alpha71(p_ficha jsonb, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_result jsonb;
  v_registro_id uuid;
  v_tracking uuid;
begin
  v_result := public.crear_ficha_hotel(p_ficha, p_request_id);
  v_registro_id := (v_result->>'id')::uuid;
  select seguimiento_id into v_tracking from public.registros_hotel where id = v_registro_id;

  insert into app_private.manteniment_parada_sync(
    seguimiento_id, fecha_programada_parada, fecha_corte, tancament
  ) values (
    v_tracking,
    nullif(p_ficha->>'fecha_programada_parada', '')::date,
    nullif(p_ficha->>'manteniment_fecha_corte', '')::date,
    upper(btrim(coalesce(p_ficha->>'manteniment_tancament', '')))
  )
  on conflict (seguimiento_id) do update
  set fecha_programada_parada = excluded.fecha_programada_parada,
      fecha_corte = excluded.fecha_corte,
      tancament = excluded.tancament;

  return v_result || jsonb_build_object(
    'manteniment_sync_id', (select sync_id from app_private.manteniment_parada_sync where seguimiento_id = v_tracking)
  );
end;
$function$;

create or replace function app_private.guardar_ficha_hotel_edicion_alpha71(
  p_registro_id uuid,
  p_version integer,
  p_ficha jsonb,
  p_etapas jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_saved jsonb;
  v_tracking uuid;
  v_tancament text;
  v_supervisado boolean;
  v_sync app_private.manteniment_parada_sync%rowtype;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;
  select seguimiento_id into v_tracking
  from public.registros_hotel
  where id = p_registro_id;
  if v_tracking is null then raise exception 'Ficha de Hotel no encontrada'; end if;

  v_saved := app_private.guardar_ficha_hotel_edicion_catalogos(
    p_registro_id, p_version, p_ficha, p_etapas, p_request_id
  );
  v_tancament := upper(btrim(coalesce(p_ficha->>'manteniment_tancament', '')));
  if v_tancament <> '' and v_tancament !~ '^TANCAMENT [0-9]{1,3}$' then
    raise exception 'TANCAMENT debe escribirse seguido del número de periodo, por ejemplo TANCAMENT 8';
  end if;

  select * into v_sync
  from app_private.manteniment_parada_sync
  where seguimiento_id = v_tracking
  for update;

  v_supervisado := coalesce((p_ficha->>'manteniment_tancament_supervisado')::boolean, false);
  if v_supervisado and not public.es_administrador_principal() then
    v_supervisado := coalesce(v_sync.tancament_supervisado, false);
  end if;

  insert into app_private.manteniment_parada_sync(
    seguimiento_id, fecha_programada_parada, fecha_corte, tancament,
    tancament_supervisado, tancament_supervisado_por, tancament_supervisado_en,
    dias_parada_manual, km_facturables_manual
  ) values (
    v_tracking,
    nullif(p_ficha->>'fecha_programada_parada', '')::date,
    nullif(p_ficha->>'manteniment_fecha_corte', '')::date,
    v_tancament,
    v_supervisado,
    case when v_supervisado then auth.uid() end,
    case when v_supervisado then clock_timestamp() end,
    nullif(p_ficha->>'manteniment_dias_parada_manual', '')::integer,
    nullif(p_ficha->>'manteniment_km_facturables_manual', '')::numeric
  )
  on conflict (seguimiento_id) do update
  set fecha_programada_parada = excluded.fecha_programada_parada,
      fecha_corte = excluded.fecha_corte,
      tancament = excluded.tancament,
      tancament_supervisado = case
        when excluded.tancament is distinct from app_private.manteniment_parada_sync.tancament
          or excluded.fecha_corte is distinct from app_private.manteniment_parada_sync.fecha_corte
        then false
        else excluded.tancament_supervisado
      end,
      tancament_supervisado_por = case
        when excluded.tancament_supervisado then auth.uid()
        else null
      end,
      tancament_supervisado_en = case
        when excluded.tancament_supervisado then clock_timestamp()
        else null
      end,
      dias_parada_manual = excluded.dias_parada_manual,
      km_facturables_manual = excluded.km_facturables_manual;

  v_saved := v_saved || jsonb_build_object(
    'detalle', app_private.obtener_ficha_hotel_edicion_alpha71(p_registro_id)
  );
  return v_saved;
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
  v_registro_id uuid;
  v_k date;
  v_q text;
  v_confirmed jsonb;
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

    v_q := upper(btrim(coalesce(v_item->>'tancament', '')));
    if v_q <> '' and v_q !~ '^TANCAMENT [0-9]{1,3}$' then
      raise exception 'TANCAMENT debe ir seguido del número de periodo';
    end if;
    v_k := nullif(v_item->>'fecha_k', '')::date;
    v_confirmed := coalesce(v_sync.ultimo_payload_confirmado, '{}'::jsonb);

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
          when v_item ? 'dias_parada'
               and (v_confirmed->>'dias_parada') is distinct from (v_item->>'dias_parada')
            then nullif(v_item->>'dias_parada', '')::integer
          else v_sync.dias_parada_manual
        end,
        km_facturables_manual = case
          when v_item ? 'km_facturables'
               and (v_confirmed->>'km_facturables') is distinct from (v_item->>'km_facturables')
            then nullif(v_item->>'km_facturables', '')::numeric
          else v_sync.km_facturables_manual
        end,
        fila_manteniment = nullif(v_item->>'fila', '')::integer
    where seguimiento_id = v_sync.seguimiento_id;

    select r.id into v_registro_id
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = v_sync.seguimiento_id and not r.cancelado
    order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
    for update of r;

    if v_registro_id is not null then
      update public.registros_hotel
      set vehiculo_sustituido = upper(btrim(coalesce(v_item->>'dfm', ''))),
          matricula_sustituido = upper(btrim(coalesce(v_item->>'matricula', ''))),
          tipo_unidad = upper(btrim(coalesce(v_item->>'tipo', ''))),
          upc = upper(btrim(coalesce(v_item->>'upc', ''))),
          vehiculo_reserva = upper(btrim(coalesce(v_item->>'sustituto', ''))),
          marca = btrim(coalesce(v_item->>'marca', '')),
          fecha_parada = nullif(v_item->>'fecha_parada', '')::date,
          retirado_hotel_activo = case when v_q = '' and v_k is not null then true else retirado_hotel_activo end,
          fecha_retirado_hotel = case
            when v_q = '' and v_k is not null then v_k::timestamp at time zone 'Europe/Madrid'
            else fecha_retirado_hotel
          end,
          estado = case
            when v_q = '' and v_k is not null and estado not in ('reserva_liberada', 'recuperado') then 'recuperado'
            else estado
          end,
          modificado_por = coalesce(modificado_por, creado_por)
      where id = v_registro_id;
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

  for v_item in select value from jsonb_array_elements(p_confirmaciones)
  loop
    update app_private.manteniment_parada_outbox o
    set estado = 'confirmado', confirmado_en = clock_timestamp(), intentos = intentos + 1
    where o.sync_id = (v_item->>'sync_id')::uuid
      and o.revision = (v_item->>'revision')::integer
      and coalesce(v_item->>'estado', '') = 'aplicado';
    if found then
      update app_private.manteniment_parada_sync s
      set ultimo_payload_confirmado = o.payload,
          fila_manteniment = nullif(v_item->>'fila', '')::integer
      from app_private.manteniment_parada_outbox o
      where o.seguimiento_id = s.seguimiento_id
        and o.sync_id = (v_item->>'sync_id')::uuid
        and o.revision = (v_item->>'revision')::integer;
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'confirmados', v_count);
end;
$function$;

create or replace function app_private.aplicar_snapshot_manteniment(
  p_payload jsonb,
  p_modo text default 'programada',
  p_actor uuid default null,
  p_origen text default 'google_apps_script'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_payload jsonb := p_payload;
  v_filas jsonb := '[]'::jsonb;
  v_result jsonb;
  v_bloqueadas integer := 0;
  v_paradas integer := 0;
  v_comandos jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_payload) = 'object' and jsonb_typeof(p_payload->'filas') = 'array' then
    select coalesce(jsonb_agg(f.value order by f.ordinality) filter (where not f.bloqueada), '[]'::jsonb),
           count(*) filter (where f.bloqueada)
      into v_filas, v_bloqueadas
    from (
      select e.value, e.ordinality,
             exists (
               select 1 from public.vehiculos v
               where v.baja_manual_bloquea_sync = true
                 and v.dfm = regexp_replace(upper(btrim(coalesce(e.value->>'dfm', ''))), '[[:space:]]+', '', 'g')
             ) as bloqueada
      from jsonb_array_elements(p_payload->'filas') with ordinality e(value, ordinality)
    ) f;
    v_payload := jsonb_set(p_payload, '{filas}', v_filas, true);
  end if;

  v_result := app_private.aplicar_snapshot_manteniment_base(v_payload, p_modo, p_actor, p_origen);
  if not coalesce((v_result->>'ok')::boolean, false) then return v_result; end if;

  update public.vehiculos v
  set fecha_matriculacion = x.fecha_matriculacion::date
  from jsonb_to_recordset(v_filas) as x(dfm text, fecha_matriculacion text)
  where v.dfm = regexp_replace(upper(btrim(coalesce(x.dfm, ''))), '[[:space:]]+', '', 'g')
    and btrim(coalesce(x.fecha_matriculacion, '')) ~ '^\d{4}-\d{2}-\d{2}$'
    and v.fecha_matriculacion is distinct from x.fecha_matriculacion::date;

  v_paradas := app_private.manteniment_importar_paradas(p_payload->'paradas');

  select coalesce(jsonb_agg(jsonb_build_object(
    'sync_id', o.sync_id,
    'revision', o.revision,
    'payload', o.payload
  ) order by o.actualizado_en, o.sync_id), '[]'::jsonb)
  into v_comandos
  from (
    select * from app_private.manteniment_parada_outbox
    where estado = 'pendiente'
    order by actualizado_en, sync_id
    limit 200
  ) o;

  if v_bloqueadas > 0 then
    update public.manteniment_sync_ejecuciones
    set detalle = jsonb_set(coalesce(detalle, '{}'::jsonb), '{bajas_manuales_protegidas}', to_jsonb(v_bloqueadas), true),
        mensaje = concat_ws(' ', mensaje, format('%s baja(s) manual(es) protegida(s).', v_bloqueadas))
    where id = (v_result->>'ejecucion_id')::uuid;
  end if;

  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,
    'comandos_parada_pendientes', jsonb_array_length(v_comandos)
  )
  where id = (v_result->>'ejecucion_id')::uuid;

  return v_result || jsonb_build_object(
    'bajas_manuales_protegidas', v_bloqueadas,
    'paradas_recibidas', v_paradas,
    'comandos_manteniment', v_comandos
  );
end;
$function$;

create or replace function public.obtener_ficha_hotel_edicion_alpha71(p_registro_id uuid)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.obtener_ficha_hotel_edicion_alpha71($1);
$function$;

create or replace function public.crear_ficha_hotel_alpha71(p_ficha jsonb, p_request_id text)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.crear_ficha_hotel_alpha71($1, $2);
$function$;

create or replace function public.guardar_ficha_hotel_edicion_alpha71(
  p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_ficha_hotel_edicion_alpha71($1, $2, $3, $4, $5);
$function$;

create or replace function public.confirmar_comandos_manteniment(p_token text, p_confirmaciones jsonb)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.manteniment_confirmar_comandos($1, $2);
$function$;

revoke all on function app_private.manteniment_construir_payload_parada(uuid) from public, anon, authenticated;
revoke all on function app_private.manteniment_encolar_parada(uuid) from public, anon, authenticated;
revoke all on function app_private.obtener_ficha_hotel_edicion_alpha71(uuid) from public, anon;
revoke all on function app_private.crear_ficha_hotel_alpha71(jsonb, text) from public, anon;
revoke all on function app_private.guardar_ficha_hotel_edicion_alpha71(uuid, integer, jsonb, jsonb, text) from public, anon;
revoke all on function app_private.manteniment_importar_paradas(jsonb) from public, anon, authenticated;
revoke all on function app_private.manteniment_confirmar_comandos(text, jsonb) from public, anon, authenticated;
grant execute on function app_private.obtener_ficha_hotel_edicion_alpha71(uuid) to authenticated, service_role;
grant execute on function app_private.crear_ficha_hotel_alpha71(jsonb, text) to authenticated, service_role;
grant execute on function app_private.guardar_ficha_hotel_edicion_alpha71(uuid, integer, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function app_private.manteniment_importar_paradas(jsonb) to service_role;
grant execute on function app_private.manteniment_confirmar_comandos(text, jsonb) to service_role;

revoke all on function public.obtener_ficha_hotel_edicion_alpha71(uuid) from public, anon;
revoke all on function public.crear_ficha_hotel_alpha71(jsonb, text) from public, anon;
revoke all on function public.guardar_ficha_hotel_edicion_alpha71(uuid, integer, jsonb, jsonb, text) from public, anon;
revoke all on function public.confirmar_comandos_manteniment(text, jsonb) from public, anon, authenticated;
grant execute on function public.obtener_ficha_hotel_edicion_alpha71(uuid) to authenticated, service_role;
grant execute on function public.crear_ficha_hotel_alpha71(jsonb, text) to authenticated, service_role;
grant execute on function public.guardar_ficha_hotel_edicion_alpha71(uuid, integer, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function public.confirmar_comandos_manteniment(text, jsonb) to service_role;

-- Los wrappers públicos de Activos dejan de ser SECURITY DEFINER. La función privada
-- conserva todos los controles de usuario, dispositivo, permisos y versión.
create or replace function public.guardar_activo(
  p_id uuid,
  p_version integer,
  p_payload jsonb,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_activo($1, $2, $3, $4);
$function$;

create or replace function public.cambiar_estado_activo(
  p_id uuid,
  p_version integer,
  p_activo boolean,
  p_motivo text,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.cambiar_estado_activo($1, $2, $3, $4, $5);
$function$;

grant execute on function app_private.guardar_activo(uuid, integer, jsonb, text) to authenticated;
grant execute on function app_private.cambiar_estado_activo(uuid, integer, boolean, text, text) to authenticated;

commit;
