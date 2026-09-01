begin;

alter table public.vehiculos
  add column if not exists version integer not null default 1,
  add column if not exists alta_manual_en timestamptz,
  add column if not exists alta_manual_por uuid,
  add column if not exists baja_manual_en timestamptz,
  add column if not exists baja_manual_por uuid,
  add column if not exists motivo_baja text not null default '',
  add column if not exists baja_manual_bloquea_sync boolean not null default false;

update public.vehiculos
set alta_manual_en = creado_en
where fuente_manteniment_fila is null
  and alta_manual_en is null;

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehiculos_version_positiva_chk') then
    alter table public.vehiculos
      add constraint vehiculos_version_positiva_chk check (version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehiculos_motivo_baja_longitud_chk') then
    alter table public.vehiculos
      add constraint vehiculos_motivo_baja_longitud_chk check (char_length(motivo_baja) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehiculos_alta_manual_por_fkey') then
    alter table public.vehiculos
      add constraint vehiculos_alta_manual_por_fkey foreign key (alta_manual_por)
      references public.usuarios(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehiculos_baja_manual_por_fkey') then
    alter table public.vehiculos
      add constraint vehiculos_baja_manual_por_fkey foreign key (baja_manual_por)
      references public.usuarios(id) on delete set null;
  end if;
end
$constraints$;

create unique index if not exists vehiculos_bastidor_upper_uidx
  on public.vehiculos (upper(btrim(bastidor)))
  where btrim(bastidor) <> '';

create index if not exists vehiculos_alta_manual_por_idx
  on public.vehiculos (alta_manual_por)
  where alta_manual_por is not null;

create index if not exists vehiculos_baja_manual_por_idx
  on public.vehiculos (baja_manual_por)
  where baja_manual_por is not null;

create or replace function app_private.vehiculos_versionar()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.version = old.version and to_jsonb(new) is distinct from to_jsonb(old) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$function$;

drop trigger if exists vehiculos_versionar on public.vehiculos;
create trigger vehiculos_versionar
before update on public.vehiculos
for each row execute function app_private.vehiculos_versionar();

create or replace function app_private.vehiculos_proteger_control()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      raise exception using errcode = '42501', message = 'Las altas de Activos deben realizarse mediante la operación segura de Metrogestión';
    end if;
    if new.dfm is distinct from old.dfm
       or new.activo is distinct from old.activo
       or new.alta_manual_en is distinct from old.alta_manual_en
       or new.alta_manual_por is distinct from old.alta_manual_por
       or new.baja_manual_en is distinct from old.baja_manual_en
       or new.baja_manual_por is distinct from old.baja_manual_por
       or new.motivo_baja is distinct from old.motivo_baja
       or new.baja_manual_bloquea_sync is distinct from old.baja_manual_bloquea_sync then
      raise exception using errcode = '42501', message = 'El identificador, el alta y la baja del activo requieren la operación segura de Metrogestión';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists vehiculos_control_protegido on public.vehiculos;
create trigger vehiculos_control_protegido
before insert or update on public.vehiculos
for each row execute function app_private.vehiculos_proteger_control();

drop policy if exists vehiculos_select_secure on public.vehiculos;
create policy vehiculos_select_secure
on public.vehiculos
for select
to authenticated
using (
  public.dispositivo_autorizado()
  and (
    public.puede_ver_modulo('hotel')
    or public.puede_ver_modulo('activar24h')
    or public.puede_ver_modulo('predictivo')
    or public.puede_ver_modulo('activos')
  )
);

create or replace function app_private.guardar_activo(
  p_id uuid,
  p_version integer,
  p_payload jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_version integer;
  v_dfm text := regexp_replace(upper(btrim(coalesce(p_payload->>'dfm', ''))), '[[:space:]]+', '', 'g');
  v_matricula text := regexp_replace(upper(btrim(coalesce(p_payload->>'matricula', ''))), '[[:space:]]+', '', 'g');
  v_categoria text := upper(btrim(coalesce(p_payload->>'categoria', '')));
  v_clase text := lower(btrim(coalesce(p_payload->>'clase_vehiculo', '')));
  v_tipo_motor text := upper(btrim(regexp_replace(coalesce(p_payload->>'tipo_motor', ''), '[[:space:]]+', ' ', 'g')));
  v_tipo_manteniment text := upper(btrim(regexp_replace(coalesce(p_payload->>'tipo_manteniment', ''), '[[:space:]]+', ' ', 'g')));
  v_marca text := upper(btrim(regexp_replace(coalesce(p_payload->>'marca', ''), '[[:space:]]+', ' ', 'g')));
  v_modelo text := upper(btrim(regexp_replace(coalesce(p_payload->>'modelo', ''), '[[:space:]]+', ' ', 'g')));
  v_bastidor text := regexp_replace(upper(btrim(coalesce(p_payload->>'bastidor', ''))), '[[:space:]]+', '', 'g');
  v_upc text := upper(btrim(regexp_replace(coalesce(p_payload->>'upc', ''), '[[:space:]]+', ' ', 'g')));
  v_telefono text := btrim(regexp_replace(coalesce(p_payload->>'telefono', ''), '[[:space:]]+', ' ', 'g'));
  v_contrato text := upper(btrim(regexp_replace(coalesce(p_payload->>'contrato_texto', ''), '[[:space:]]+', ' ', 'g')));
  v_asignacion text := upper(btrim(regexp_replace(coalesce(p_payload->>'asignacion_manteniment', ''), '[[:space:]]+', ' ', 'g')));
  v_fecha_matriculacion date;
  v_fecha_alta date;
  v_fin_contrato_fecha date;
  v_fin_contrato_km integer;
  v_km_actual integer;
  v_reserva boolean := coalesce((p_payload->>'reserva')::boolean, false);
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activos') then
    raise exception using errcode = '42501', message = 'No tienes permiso para modificar Activos';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Los datos del activo no son válidos'; end if;
  if v_dfm = '' or v_dfm !~ '^[A-Z0-9-]{1,20}$' then raise exception 'Indica un DFM o código de activo válido'; end if;
  if v_matricula = '' or v_matricula !~ '^[A-Z0-9-]{3,20}$' then raise exception 'Indica una matrícula válida'; end if;
  if v_categoria not in ('DFM', 'R') then raise exception 'La categoría debe ser DFM o R'; end if;
  if (v_categoria = 'R') is distinct from (v_dfm like 'R%') then
    raise exception 'La categoría no coincide con el código: los R deben comenzar por R';
  end if;
  if v_clase not in ('tractora', 'rigido', 'semirremolque') then raise exception 'Indica la clase de vehículo'; end if;
  if v_categoria = 'R' and v_clase <> 'semirremolque' then raise exception 'Un activo R debe ser semirremolque'; end if;
  if v_categoria = 'DFM' and v_clase = 'semirremolque' then raise exception 'Un DFM no puede clasificarse como semirremolque'; end if;
  if v_tipo_manteniment = '' then raise exception 'Indica el tipo de MANTENIMENT'; end if;
  if v_marca = '' then raise exception 'Indica la marca'; end if;
  if char_length(v_bastidor) < 5 or char_length(v_bastidor) > 40 then raise exception 'Indica un bastidor válido'; end if;
  if v_categoria = 'DFM' and v_upc = '' then raise exception 'Indica el UPC del DFM'; end if;
  if char_length(v_telefono) > 40 then raise exception 'El teléfono es demasiado largo'; end if;

  begin
    v_fecha_matriculacion := nullif(p_payload->>'fecha_matriculacion', '')::date;
    v_fecha_alta := nullif(p_payload->>'fecha_alta_manteniment', '')::date;
    v_fin_contrato_fecha := nullif(p_payload->>'fin_contrato_fecha', '')::date;
    v_fin_contrato_km := nullif(p_payload->>'fin_contrato_km', '')::integer;
    v_km_actual := nullif(p_payload->>'km_actual', '')::integer;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'Revisa las fechas y los kilómetros indicados';
  end;
  if v_fecha_alta is null then raise exception 'Indica la fecha de alta'; end if;
  if coalesce(v_fin_contrato_km, 0) < 0 or coalesce(v_km_actual, 0) < 0 then raise exception 'Los kilómetros no pueden ser negativos'; end if;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-alpha70-activos', true);
  perform set_config('app.audit_reason', case when p_id is null then 'Alta manual de activo' else 'Edición de activo' end, true);

  if p_id is null then
    insert into public.vehiculos(
      dfm, matricula, categoria, clase_vehiculo, tipo_motor, tipo_manteniment,
      marca, modelo, bastidor, upc, telefono, fecha_matriculacion,
      fecha_alta_manteniment, fin_contrato_fecha, fin_contrato_km, km_actual,
      contrato_texto, asignacion_manteniment, reserva, activo,
      alta_manual_en, alta_manual_por, version
    ) values (
      v_dfm, v_matricula, v_categoria, v_clase, v_tipo_motor, v_tipo_manteniment,
      v_marca, v_modelo, v_bastidor, v_upc, v_telefono, v_fecha_matriculacion,
      v_fecha_alta, v_fin_contrato_fecha, v_fin_contrato_km, v_km_actual,
      v_contrato, v_asignacion, v_reserva, true,
      clock_timestamp(), v_actor, 1
    ) returning id, version into v_id, v_version;
  else
    if p_version is null or p_version < 1 then raise exception 'Versión de activo no válida'; end if;
    if exists (select 1 from public.vehiculos where id = p_id and dfm <> v_dfm) then
      raise exception 'El DFM o código del activo no se puede modificar; conserva su histórico e identificador';
    end if;
    update public.vehiculos v
    set dfm = v_dfm,
        matricula = v_matricula,
        categoria = v_categoria,
        clase_vehiculo = v_clase,
        tipo_motor = v_tipo_motor,
        tipo_manteniment = v_tipo_manteniment,
        marca = v_marca,
        modelo = v_modelo,
        bastidor = v_bastidor,
        upc = v_upc,
        telefono = v_telefono,
        fecha_matriculacion = v_fecha_matriculacion,
        fecha_alta_manteniment = v_fecha_alta,
        fin_contrato_fecha = v_fin_contrato_fecha,
        fin_contrato_km = v_fin_contrato_km,
        km_actual = v_km_actual,
        contrato_texto = v_contrato,
        asignacion_manteniment = v_asignacion,
        reserva = v_reserva,
        version = v.version + 1
    where v.id = p_id and v.version = p_version
    returning v.id, v.version into v_id, v_version;

    if v_id is null then
      if exists (select 1 from public.vehiculos where id = p_id) then
        raise exception 'El activo ha cambiado mientras estaba abierto. Actualiza la lista y vuelve a intentarlo';
      end if;
      raise exception 'Activo no encontrado';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version);
exception
  when unique_violation then
    if sqlerrm ilike '%bastidor%' then raise exception 'Ya existe un activo con ese bastidor'; end if;
    if sqlerrm ilike '%matricula%' then raise exception 'Ya existe un activo con esa matrícula'; end if;
    raise exception 'Ya existe un activo con ese DFM o código';
end;
$function$;

create or replace function app_private.cambiar_estado_activo(
  p_id uuid,
  p_version integer,
  p_activo boolean,
  p_motivo text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actor uuid := auth.uid();
  v_actual public.vehiculos%rowtype;
  v_version integer;
  v_motivo text := btrim(regexp_replace(coalesce(p_motivo, ''), '[[:space:]]+', ' ', 'g'));
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activos') then
    raise exception using errcode = '42501', message = 'No tienes permiso para cambiar el estado de Activos';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de operación no válido';
  end if;
  if p_version is null or p_version < 1 then raise exception 'Versión de activo no válida'; end if;

  select * into v_actual from public.vehiculos where id = p_id for update;
  if v_actual.id is null then raise exception 'Activo no encontrado'; end if;
  if v_actual.version <> p_version then
    raise exception 'El activo ha cambiado mientras estaba abierto. Actualiza la lista y vuelve a intentarlo';
  end if;
  if v_actual.activo = p_activo then
    return jsonb_build_object('ok', true, 'id', v_actual.id, 'version', v_actual.version, 'sin_cambios', true);
  end if;

  if not p_activo then
    if char_length(v_motivo) < 5 or char_length(v_motivo) > 500 then
      raise exception 'Indica un motivo de baja de al menos 5 caracteres';
    end if;
    if exists (select 1 from public.hotel_actual_detalle h where upper(btrim(h.dfm)) = v_actual.dfm) then
      raise exception 'No se puede dar de baja: el activo todavía tiene una ficha abierta en el Hotel';
    end if;
    if exists (
      select 1 from public.activaciones_24h a
      where upper(btrim(a.dfm)) = v_actual.dfm
        and a.estado not in ('cerrada', 'anulada')
    ) then
      raise exception 'No se puede dar de baja: existe una asistencia 24H abierta';
    end if;
    if exists (
      select 1 from public.reservas_hotel r
      where upper(btrim(r.vehiculo_codigo)) = v_actual.dfm
        and r.activo = true and r.estado = 'ocupada'
    ) then
      raise exception 'No se puede dar de baja: la reserva está ocupada';
    end if;
  end if;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-alpha70-activos', true);
  perform set_config('app.audit_reason', case when p_activo then 'Reactivación manual de activo' else 'Baja manual de activo' end, true);

  if p_activo then
    update public.vehiculos v
    set activo = true,
        baja_manual_en = null,
        baja_manual_por = null,
        motivo_baja = '',
        baja_manual_bloquea_sync = false,
        version = v.version + 1
    where v.id = p_id
    returning v.version into v_version;
  else
    update public.vehiculos v
    set activo = false,
        baja_manual_en = clock_timestamp(),
        baja_manual_por = v_actor,
        motivo_baja = v_motivo,
        baja_manual_bloquea_sync = true,
        version = v.version + 1
    where v.id = p_id
    returning v.version into v_version;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'version', v_version, 'activo', p_activo);
end;
$function$;

create or replace function public.guardar_activo(
  p_id uuid,
  p_version integer,
  p_payload jsonb,
  p_request_id text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_activo(p_id, p_version, p_payload, p_request_id);
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
security definer
set search_path = pg_catalog, app_private
as $function$
  select app_private.cambiar_estado_activo(p_id, p_version, p_activo, p_motivo, p_request_id);
$function$;

revoke all on function app_private.guardar_activo(uuid, integer, jsonb, text) from public, anon;
revoke all on function app_private.cambiar_estado_activo(uuid, integer, boolean, text, text) from public, anon;
revoke all on function app_private.guardar_activo(uuid, integer, jsonb, text) from authenticated;
revoke all on function app_private.cambiar_estado_activo(uuid, integer, boolean, text, text) from authenticated;
grant execute on function app_private.guardar_activo(uuid, integer, jsonb, text) to service_role;
grant execute on function app_private.cambiar_estado_activo(uuid, integer, boolean, text, text) to service_role;

revoke all on function public.guardar_activo(uuid, integer, jsonb, text) from public, anon;
revoke all on function public.cambiar_estado_activo(uuid, integer, boolean, text, text) from public, anon;
grant execute on function public.guardar_activo(uuid, integer, jsonb, text) to authenticated, service_role;
grant execute on function public.cambiar_estado_activo(uuid, integer, boolean, text, text) to authenticated, service_role;
grant select on public.vehiculos to authenticated;

do $sync_wrapper$
begin
  if to_regprocedure('app_private.aplicar_snapshot_manteniment_base(jsonb,text,uuid,text)') is null then
    alter function app_private.aplicar_snapshot_manteniment(jsonb, text, uuid, text)
      rename to aplicar_snapshot_manteniment_base;
  end if;
end
$sync_wrapper$;

revoke all on function app_private.aplicar_snapshot_manteniment_base(jsonb, text, uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.aplicar_snapshot_manteniment_base(jsonb, text, uuid, text)
  to service_role;

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

  if v_bloqueadas > 0 and coalesce((v_result->>'ok')::boolean, false) then
    update public.manteniment_sync_ejecuciones
    set detalle = jsonb_set(coalesce(detalle, '{}'::jsonb), '{bajas_manuales_protegidas}', to_jsonb(v_bloqueadas), true),
        mensaje = concat_ws(' ', mensaje, format('%s baja(s) manual(es) protegida(s).', v_bloqueadas))
    where id = (v_result->>'ejecucion_id')::uuid;
    v_result := v_result || jsonb_build_object('bajas_manuales_protegidas', v_bloqueadas);
  end if;

  return v_result;
end;
$function$;

revoke all on function app_private.aplicar_snapshot_manteniment(jsonb, text, uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.aplicar_snapshot_manteniment(jsonb, text, uuid, text)
  to service_role;

commit;
