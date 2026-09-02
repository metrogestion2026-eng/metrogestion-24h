begin;

create table if not exists app_private.manteniment_activo_outbox (
  vehiculo_id uuid primary key references public.vehiculos(id) on delete cascade,
  revision integer not null default 1,
  estado text not null default 'pendiente',
  payload jsonb not null,
  intentos integer not null default 0,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp(),
  confirmado_en timestamptz,
  ultimo_error text not null default '',
  constraint manteniment_activo_outbox_estado_check
    check (estado in ('pendiente', 'confirmado'))
);

alter table app_private.manteniment_activo_outbox enable row level security;
revoke all on table app_private.manteniment_activo_outbox from public, anon, authenticated;
drop policy if exists manteniment_activo_outbox_explicit_deny
  on app_private.manteniment_activo_outbox;
create policy manteniment_activo_outbox_explicit_deny
on app_private.manteniment_activo_outbox
for all
to anon, authenticated
using (false)
with check (false);

create or replace function app_private.manteniment_encolar_activo(p_vehiculo_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_payload jsonb;
begin
  select jsonb_build_object(
    'vehiculo_id', v.id,
    'fila', v.fuente_manteniment_fila,
    'dfm', v.dfm,
    'matricula', coalesce(v.matricula, ''),
    'tipo', coalesce(v.tipo_manteniment, ''),
    'upc', coalesce(v.upc, ''),
    'telefono', coalesce(v.telefono, ''),
    'contrato', coalesce(v.contrato_texto, ''),
    'estado', case when v.activo then 'ALTA' else 'BAJA' end,
    'fecha_matriculacion', v.fecha_matriculacion,
    'fecha_alta', v.fecha_alta_manteniment,
    'asignacion', coalesce(v.asignacion_manteniment, ''),
    'marca', coalesce(v.marca, ''),
    'bastidor', coalesce(v.bastidor, '')
  ) into v_payload
  from public.vehiculos v
  where v.id = p_vehiculo_id;
  if v_payload is null then return; end if;

  insert into app_private.manteniment_activo_outbox(
    vehiculo_id, revision, estado, payload, actualizado_en, confirmado_en, ultimo_error
  ) values (
    p_vehiculo_id, 1, 'pendiente', v_payload, clock_timestamp(), null, ''
  )
  on conflict (vehiculo_id) do update
  set revision = app_private.manteniment_activo_outbox.revision + 1,
      estado = 'pendiente',
      payload = excluded.payload,
      actualizado_en = clock_timestamp(),
      confirmado_en = null,
      ultimo_error = '';
end;
$function$;

create or replace function app_private.manteniment_activo_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $function$
begin
  if coalesce(current_setting('app.manteniment_importando_altas', true), '') <> '1' then
    perform app_private.manteniment_encolar_activo(new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists vehiculos_manteniment_encolar on public.vehiculos;
create trigger vehiculos_manteniment_encolar
after insert or update of dfm, matricula, categoria, clase_vehiculo, tipo_manteniment,
  upc, telefono, contrato_texto, fecha_matriculacion, fecha_alta_manteniment,
  asignacion_manteniment, marca, bastidor, activo
on public.vehiculos
for each row execute function app_private.manteniment_activo_trigger();

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

  perform set_config('app.manteniment_importando_altas', '1', true);
  for v_item in select value from jsonb_array_elements(p_confirmaciones)
  loop
    if coalesce(v_item->>'estado', '') <> 'aplicado' then continue; end if;
    if coalesce(v_item->>'tipo', 'parada') = 'alta' then
      update app_private.manteniment_activo_outbox o
      set estado = 'confirmado', confirmado_en = clock_timestamp(), intentos = intentos + 1
      where o.vehiculo_id = (v_item->>'vehiculo_id')::uuid
        and o.revision = (v_item->>'revision')::integer;
      if found then
        update public.vehiculos
        set fuente_manteniment_fila = nullif(v_item->>'fila', '')::integer,
            fuente_manteniment_actualizado_en = clock_timestamp()
        where id = (v_item->>'vehiculo_id')::uuid;
        v_count := v_count + 1;
      end if;
    else
      update app_private.manteniment_parada_outbox o
      set estado = 'confirmado', confirmado_en = clock_timestamp(), intentos = intentos + 1
      where o.sync_id = (v_item->>'sync_id')::uuid
        and o.revision = (v_item->>'revision')::integer;
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
    end if;
  end loop;
  perform set_config('app.manteniment_importando_altas', '0', true);
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

  perform set_config('app.manteniment_importando_altas', '1', true);
  v_result := app_private.aplicar_snapshot_manteniment_base(v_payload, p_modo, p_actor, p_origen);
  if not coalesce((v_result->>'ok')::boolean, false) then
    perform set_config('app.manteniment_importando_altas', '0', true);
    return v_result;
  end if;

  update public.vehiculos v
  set fecha_matriculacion = x.fecha_matriculacion::date
  from jsonb_to_recordset(v_filas) as x(dfm text, fecha_matriculacion text)
  where v.dfm = regexp_replace(upper(btrim(coalesce(x.dfm, ''))), '[[:space:]]+', '', 'g')
    and btrim(coalesce(x.fecha_matriculacion, '')) ~ '^\d{4}-\d{2}-\d{2}$'
    and v.fecha_matriculacion is distinct from x.fecha_matriculacion::date;
  perform set_config('app.manteniment_importando_altas', '0', true);

  v_paradas := app_private.manteniment_importar_paradas(p_payload->'paradas');

  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo', c.tipo,
    'vehiculo_id', c.vehiculo_id,
    'sync_id', c.sync_id,
    'revision', c.revision,
    'payload', c.payload
  ) order by c.actualizado_en, c.tipo, c.clave), '[]'::jsonb)
  into v_comandos
  from (
    select 'alta'::text as tipo, o.vehiculo_id, null::uuid as sync_id,
           o.revision, o.payload, o.actualizado_en, o.vehiculo_id::text as clave
    from app_private.manteniment_activo_outbox o
    where o.estado = 'pendiente'
    union all
    select 'parada'::text, null::uuid, o.sync_id,
           o.revision, o.payload, o.actualizado_en, o.sync_id::text
    from app_private.manteniment_parada_outbox o
    where o.estado = 'pendiente'
    order by actualizado_en, tipo, clave
    limit 200
  ) c;

  if v_bloqueadas > 0 then
    update public.manteniment_sync_ejecuciones
    set detalle = jsonb_set(coalesce(detalle, '{}'::jsonb), '{bajas_manuales_protegidas}', to_jsonb(v_bloqueadas), true),
        mensaje = concat_ws(' ', mensaje, format('%s baja(s) manual(es) protegida(s).', v_bloqueadas))
    where id = (v_result->>'ejecucion_id')::uuid;
  end if;

  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,
    'comandos_manteniment_pendientes', jsonb_array_length(v_comandos)
  )
  where id = (v_result->>'ejecucion_id')::uuid;

  return v_result || jsonb_build_object(
    'bajas_manuales_protegidas', v_bloqueadas,
    'paradas_recibidas', v_paradas,
    'comandos_manteniment', v_comandos
  );
end;
$function$;

revoke all on function app_private.manteniment_encolar_activo(uuid) from public, anon, authenticated;
revoke all on function app_private.manteniment_confirmar_comandos(text, jsonb) from public, anon, authenticated;
grant execute on function app_private.manteniment_confirmar_comandos(text, jsonb) to service_role;

commit;
