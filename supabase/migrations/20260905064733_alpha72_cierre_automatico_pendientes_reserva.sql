-- Alpha72: cerrar pendientes propios de una reserva cuando una T con el mismo
-- código de trabajo queda realizada, conservando un histórico inmutable.

create table if not exists public.reservas_pendientes_resueltos (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas_hotel(id) on delete restrict,
  reserva_codigo text not null,
  pendiente_codigo text not null,
  pendiente_texto text not null default '',
  registro_hotel_id uuid not null references public.registros_hotel(id) on delete restrict,
  etapa_hotel_id uuid not null references public.etapas_hotel(id) on delete restrict,
  numero_parada text,
  etapa_posicion integer not null check (etapa_posicion > 0),
  etapa_nombre text not null,
  resuelto_en timestamptz not null,
  resuelto_por uuid references public.usuarios(id) on delete restrict,
  origen text not null check (origen in ('automatico', 'correccion_validada')),
  creado_en timestamptz not null default now(),
  constraint reservas_pendientes_resueltos_etapa_codigo_uq
    unique (reserva_id, etapa_hotel_id, pendiente_codigo)
);

create index if not exists reservas_pendientes_resueltos_reserva_idx
  on public.reservas_pendientes_resueltos (reserva_id, resuelto_en desc);

create index if not exists reservas_pendientes_resueltos_registro_idx
  on public.reservas_pendientes_resueltos (registro_hotel_id);

create index if not exists reservas_pendientes_resueltos_etapa_idx
  on public.reservas_pendientes_resueltos (etapa_hotel_id);

create index if not exists reservas_pendientes_resueltos_usuario_idx
  on public.reservas_pendientes_resueltos (resuelto_por);

alter table public.reservas_pendientes_resueltos enable row level security;

drop policy if exists reservas_pendientes_resueltos_select_secure
  on public.reservas_pendientes_resueltos;
create policy reservas_pendientes_resueltos_select_secure
  on public.reservas_pendientes_resueltos
  for select
  to authenticated
  using (
    public.dispositivo_autorizado()
    and (
      public.puede_ver_modulo('reservas')
      or public.puede_ver_modulo('hotel')
    )
  );

revoke all on table public.reservas_pendientes_resueltos from public, anon, authenticated;
grant select on table public.reservas_pendientes_resueltos to authenticated;
grant all on table public.reservas_pendientes_resueltos to service_role;

create or replace function app_private.normalizar_codigo_pendiente(p_valor text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(upper(coalesce(p_valor, '')), '[^A-Z0-9]+', '', 'g');
$$;

create or replace function app_private.proteger_historial_pendientes_reserva()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  raise exception 'El histórico de pendientes resueltos es inmutable.'
    using errcode = '42501';
end;
$$;

drop trigger if exists reservas_pendientes_resueltos_inmutables
  on public.reservas_pendientes_resueltos;
create trigger reservas_pendientes_resueltos_inmutables
before update or delete on public.reservas_pendientes_resueltos
for each row execute function app_private.proteger_historial_pendientes_reserva();

drop trigger if exists auditar_reservas_pendientes_resueltos
  on public.reservas_pendientes_resueltos;
create trigger auditar_reservas_pendientes_resueltos
after insert on public.reservas_pendientes_resueltos
for each row execute function app_private.auditar_cambio_fila();

create or replace function app_private.resolver_pendientes_reserva_por_etapa(
  p_etapa_id uuid,
  p_origen text default 'automatico'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_etapa public.etapas_hotel%rowtype;
  v_registro public.registros_hotel%rowtype;
  v_reserva public.reservas_hotel%rowtype;
  v_token text;
  v_codigo text;
  v_restantes text[] := array[]::text[];
  v_coincide boolean;
  v_insertados integer := 0;
  v_actor uuid;
  v_resuelto_en timestamptz;
begin
  if p_origen not in ('automatico', 'correccion_validada') then
    raise exception 'Origen de resolución no válido.' using errcode = '22023';
  end if;

  select e.*
    into v_etapa
  from public.etapas_hotel e
  where e.id = p_etapa_id;

  if not found or v_etapa.cancelado or v_etapa.estado <> 'realizada' then
    return 0;
  end if;

  select r.*
    into v_registro
  from public.registros_hotel r
  where r.id = v_etapa.registro_hotel_id
    and not r.cancelado;

  if not found then
    return 0;
  end if;

  select r.*
    into v_reserva
  from public.reservas_hotel r
  where r.activo
    and (
      app_private.normalizar_codigo_pendiente(r.vehiculo_codigo)
        = app_private.normalizar_codigo_pendiente(v_registro.vehiculo_sustituido)
      or (
        app_private.normalizar_codigo_pendiente(v_registro.matricula_sustituido) <> ''
        and app_private.normalizar_codigo_pendiente(r.matricula)
          = app_private.normalizar_codigo_pendiente(v_registro.matricula_sustituido)
      )
    )
  order by
    case when app_private.normalizar_codigo_pendiente(r.vehiculo_codigo)
      = app_private.normalizar_codigo_pendiente(v_registro.vehiculo_sustituido)
      then 0 else 1 end,
    r.vehiculo_codigo
  limit 1
  for update;

  if not found or btrim(v_reserva.pendientes) = '' then
    return 0;
  end if;

  v_actor := coalesce(
    v_etapa.modificado_por,
    v_etapa.marcado_rapido_por,
    v_etapa.creado_por,
    auth.uid()
  );
  v_resuelto_en := coalesce(
    v_etapa.fecha_fin_real,
    v_etapa.fecha_real,
    v_etapa.actualizado_en,
    now()
  );

  for v_token in
    select btrim(p.parte)
    from regexp_split_to_table(
      v_reserva.pendientes,
      E'\\s*[+,;|\\n]+\\s*'
    ) with ordinality as p(parte, orden)
    order by p.orden
  loop
    if v_token = '' then
      continue;
    end if;

    v_codigo := app_private.normalizar_codigo_pendiente(v_token);
    select exists (
      select 1
      from public.trabajos_etapa_hotel t
      where t.etapa_hotel_id = v_etapa.id
        and not t.cancelado
        and app_private.normalizar_codigo_pendiente(t.tipo_trabajo) = v_codigo
        and v_codigo <> ''
    ) into v_coincide;

    if v_coincide then
      insert into public.reservas_pendientes_resueltos (
        reserva_id,
        reserva_codigo,
        pendiente_codigo,
        pendiente_texto,
        registro_hotel_id,
        etapa_hotel_id,
        numero_parada,
        etapa_posicion,
        etapa_nombre,
        resuelto_en,
        resuelto_por,
        origen
      ) values (
        v_reserva.id,
        v_reserva.vehiculo_codigo,
        v_codigo,
        v_token,
        v_registro.id,
        v_etapa.id,
        v_registro.numero_parada,
        v_etapa.posicion,
        v_etapa.nombre,
        v_resuelto_en,
        v_actor,
        p_origen
      )
      on conflict (reserva_id, etapa_hotel_id, pendiente_codigo) do nothing;

      if found then
        v_insertados := v_insertados + 1;
      end if;
    else
      v_restantes := array_append(v_restantes, v_token);
    end if;
  end loop;

  if v_insertados > 0 then
    perform set_config('app.audit_origin', 'alpha72:cierre_automatico_pendiente', true);
    perform set_config('app.request_id', 'etapa:' || v_etapa.id::text, true);

    update public.reservas_hotel
    set pendientes = array_to_string(v_restantes, ' + '),
        modificado_por = v_actor
    where id = v_reserva.id;
  end if;

  return v_insertados;
end;
$$;

create or replace function app_private.resolver_pendientes_reserva_desde_etapa_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.estado = 'realizada' and not new.cancelado then
    perform app_private.resolver_pendientes_reserva_por_etapa(new.id, 'automatico');
  end if;
  return new;
end;
$$;

create or replace function app_private.resolver_pendientes_reserva_desde_trabajo_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if not new.cancelado then
    perform app_private.resolver_pendientes_reserva_por_etapa(new.etapa_hotel_id, 'automatico');
  end if;
  return new;
end;
$$;

drop trigger if exists etapas_resolver_pendientes_reserva
  on public.etapas_hotel;
create trigger etapas_resolver_pendientes_reserva
after insert or update of estado, cancelado on public.etapas_hotel
for each row execute function app_private.resolver_pendientes_reserva_desde_etapa_trigger();

drop trigger if exists trabajos_resolver_pendientes_reserva
  on public.trabajos_etapa_hotel;
create trigger trabajos_resolver_pendientes_reserva
after insert or update of tipo_trabajo, cancelado on public.trabajos_etapa_hotel
for each row execute function app_private.resolver_pendientes_reserva_desde_trabajo_trigger();

revoke all on function app_private.normalizar_codigo_pendiente(text)
  from public, anon, authenticated;
revoke all on function app_private.proteger_historial_pendientes_reserva()
  from public, anon, authenticated;
revoke all on function app_private.resolver_pendientes_reserva_por_etapa(uuid, text)
  from public, anon, authenticated;
revoke all on function app_private.resolver_pendientes_reserva_desde_etapa_trigger()
  from public, anon, authenticated;
revoke all on function app_private.resolver_pendientes_reserva_desde_trabajo_trigger()
  from public, anon, authenticated;

-- Corrección validada del caso histórico R1187. La T realizada no tenía MB
-- codificado como trabajo, por eso se registra explícitamente sin inventar IDs.
do $$
declare
  v_reserva public.reservas_hotel%rowtype;
  v_etapa public.etapas_hotel%rowtype;
  v_registro public.registros_hotel%rowtype;
  v_etapa_id uuid;
  v_registro_id uuid;
  v_actor uuid;
begin
  select r.*
    into v_reserva
  from public.reservas_hotel r
  where app_private.normalizar_codigo_pendiente(r.vehiculo_codigo) = 'R1187'
    and app_private.normalizar_codigo_pendiente(r.pendientes) = 'MB'
  limit 1
  for update;

  if not found then
    return;
  end if;

  select e.id, h.id
    into v_etapa_id, v_registro_id
  from public.registros_hotel h
  join public.etapas_hotel e on e.registro_hotel_id = h.id
  where app_private.normalizar_codigo_pendiente(h.vehiculo_sustituido) = 'R1187'
    and h.numero_parada = '2600142'
    and e.estado = 'realizada'
    and not e.cancelado
  order by
    case when lower(e.nombre) like 'entrada%' then 0 else 1 end,
    coalesce(e.fecha_fin_real, e.fecha_real, e.actualizado_en) desc
  limit 1;

  if not found then
    return;
  end if;

  select e.* into v_etapa
  from public.etapas_hotel e
  where e.id = v_etapa_id;

  select h.* into v_registro
  from public.registros_hotel h
  where h.id = v_registro_id;

  v_actor := coalesce(
    v_etapa.modificado_por,
    v_etapa.marcado_rapido_por,
    v_etapa.creado_por
  );

  perform set_config('app.audit_origin', 'alpha72:correccion_validada_r1187', true);
  perform set_config('app.request_id', 'r1187:mb:2600142', true);

  insert into public.reservas_pendientes_resueltos (
    reserva_id,
    reserva_codigo,
    pendiente_codigo,
    pendiente_texto,
    registro_hotel_id,
    etapa_hotel_id,
    numero_parada,
    etapa_posicion,
    etapa_nombre,
    resuelto_en,
    resuelto_por,
    origen
  ) values (
    v_reserva.id,
    v_reserva.vehiculo_codigo,
    'MB',
    'MB',
    v_registro.id,
    v_etapa.id,
    v_registro.numero_parada,
    v_etapa.posicion,
    v_etapa.nombre,
    coalesce(v_etapa.fecha_fin_real, v_etapa.fecha_real, v_etapa.actualizado_en),
    v_actor,
    'correccion_validada'
  )
  on conflict (reserva_id, etapa_hotel_id, pendiente_codigo) do nothing;

  update public.reservas_hotel
  set pendientes = '',
      modificado_por = v_actor
  where id = v_reserva.id
    and app_private.normalizar_codigo_pendiente(pendientes) = 'MB';
end;
$$;
