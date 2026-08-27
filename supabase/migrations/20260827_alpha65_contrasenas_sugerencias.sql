begin;

alter table public.usuarios
  add column if not exists debe_cambiar_clave boolean not null default false,
  add column if not exists credenciales_actualizadas_en timestamptz not null default '1970-01-01 00:00:00+00',
  add column if not exists clave_temporal_emitida_en timestamptz,
  add column if not exists clave_temporal_emitida_por uuid,
  add column if not exists ultimo_cambio_clave_en timestamptz;

create index if not exists usuarios_cambio_clave_pendiente_idx
  on public.usuarios(debe_cambiar_clave)
  where debe_cambiar_clave = true;

create table if not exists public.historial_seguridad_claves (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  actor_id uuid references public.usuarios(id) on delete set null,
  accion text not null check (accion in ('cambio_propio','temporal_emitida','temporal_sustituida')),
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

alter table public.historial_seguridad_claves enable row level security;
drop policy if exists historial_seguridad_claves_select_primary on public.historial_seguridad_claves;
create policy historial_seguridad_claves_select_primary
on public.historial_seguridad_claves
for select
to authenticated
using (public.es_administrador_principal());

create index if not exists historial_seguridad_claves_usuario_idx
  on public.historial_seguridad_claves(usuario_id, creado_en desc);

create table if not exists public.sugerencias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete restrict,
  usuario_nombre text not null,
  usuario_correo text not null,
  categoria text not null check (categoria in ('sugerencia','mejora','incidencia','pregunta')),
  asunto text not null,
  mensaje text not null,
  modulo text not null default '',
  version_app text not null default '',
  pagina_url text not null default '',
  agente text not null default '',
  correo_destino text not null,
  estado text not null default 'nueva' check (estado in ('nueva','leida','en_estudio','resuelta','descartada')),
  correo_preparado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table public.sugerencias enable row level security;
drop policy if exists sugerencias_select_own_or_primary on public.sugerencias;
create policy sugerencias_select_own_or_primary
on public.sugerencias
for select
to authenticated
using (usuario_id = auth.uid() or public.es_administrador_principal());

create index if not exists sugerencias_estado_fecha_idx
  on public.sugerencias(estado, creado_en desc);
create index if not exists sugerencias_usuario_fecha_idx
  on public.sugerencias(usuario_id, creado_en desc);

create or replace function app_private.jwt_emitido_en()
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select case
    when nullif(auth.jwt()->>'iat', '') is null then null
    else to_timestamp((auth.jwt()->>'iat')::double precision)
  end;
$$;

create or replace function app_private.credencial_vigente()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select coalesce((
    select
      app_private.jwt_emitido_en() is not null
      and app_private.jwt_emitido_en() + interval '5 seconds'
          >= date_trunc('second', u.credenciales_actualizadas_en)
    from public.usuarios u
    where u.id = auth.uid()
  ), false);
$$;

create or replace function public.credencial_vigente()
returns boolean
language sql
stable
set search_path = pg_catalog, app_private
as $$
  select app_private.credencial_vigente();
$$;

create or replace function app_private.usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.activo = true
      and u.debe_cambiar_clave = false
      and app_private.credencial_vigente()
  );
$$;

create or replace function app_private.puede_ver_modulo(p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select coalesce((
    select u.activo = true
      and u.debe_cambiar_clave = false
      and app_private.credencial_vigente()
      and (
        u.tipo_usuario = 'administrador_principal'
        or u.permisos #>> array[p_modulo, 'editar'] = 'true'
        or u.permisos #>> array[p_modulo, 'ver'] = 'true'
        or u.permisos #>> array[p_modulo, 'leer'] = 'true'
      )
    from public.usuarios u
    where u.id = auth.uid()
  ), false);
$$;

create or replace function app_private.puede_editar_modulo(p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select coalesce((
    select u.activo = true
      and u.debe_cambiar_clave = false
      and app_private.credencial_vigente()
      and (
        u.tipo_usuario = 'administrador_principal'
        or u.permisos #>> array[p_modulo, 'editar'] = 'true'
      )
    from public.usuarios u
    where u.id = auth.uid()
  ), false);
$$;

create or replace function app_private.dispositivo_autorizado()
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private, extensions
as $$
declare
  v_token text;
  v_hash text;
begin
  if auth.uid() is null or not app_private.usuario_activo() then
    return false;
  end if;

  if app_private.es_administrador_principal() then
    return true;
  end if;

  v_token := app_private.request_header('x-device-token');
  if length(v_token) < 32 then
    return false;
  end if;

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  return exists (
    select 1
    from public.dispositivos_usuario d
    where d.usuario_id = auth.uid()
      and d.token_hash = v_hash
      and d.estado = 'autorizado'
  );
end;
$$;

create or replace function app_private.comprobar_dispositivo(token_recibido text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions
as $$
declare
  v_row public.dispositivos_usuario%rowtype;
  v_profile public.usuarios%rowtype;
  v_hash text;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'dispositivo_id', null,
      'estado', 'sin_sesion',
      'permitido', false,
      'es_administrador_principal', false
    );
  end if;

  select * into v_profile
  from public.usuarios
  where id = auth.uid();

  if not found or v_profile.activo is not true then
    return jsonb_build_object(
      'dispositivo_id', null,
      'estado', 'usuario_bloqueado',
      'permitido', false,
      'es_administrador_principal', false
    );
  end if;

  if not app_private.credencial_vigente() then
    return jsonb_build_object(
      'dispositivo_id', null,
      'estado', 'sesion_antigua',
      'permitido', false,
      'es_administrador_principal', v_profile.tipo_usuario = 'administrador_principal'
    );
  end if;

  if v_profile.debe_cambiar_clave then
    return jsonb_build_object(
      'dispositivo_id', null,
      'estado', 'cambio_clave_obligatorio',
      'permitido', false,
      'es_administrador_principal', v_profile.tipo_usuario = 'administrador_principal'
    );
  end if;

  if v_profile.tipo_usuario = 'administrador_principal' then
    return jsonb_build_object(
      'dispositivo_id', null,
      'estado', 'administrador_principal',
      'permitido', true,
      'es_administrador_principal', true
    );
  end if;

  if length(coalesce(token_recibido, '')) < 32 then
    return jsonb_build_object(
      'dispositivo_id', null,
      'estado', 'sin_token',
      'permitido', false,
      'es_administrador_principal', false
    );
  end if;

  v_hash := encode(extensions.digest(token_recibido, 'sha256'), 'hex');

  select * into v_row
  from public.dispositivos_usuario d
  where d.usuario_id = auth.uid()
    and d.token_hash = v_hash
  limit 1;

  if not found then
    return jsonb_build_object(
      'dispositivo_id', null,
      'estado', 'no_registrado',
      'permitido', false,
      'es_administrador_principal', false
    );
  end if;

  if v_row.estado = 'autorizado' then
    update public.dispositivos_usuario
    set ultimo_acceso_en = now(), actualizado_en = now()
    where id = v_row.id;
  end if;

  return jsonb_build_object(
    'dispositivo_id', v_row.id,
    'estado', v_row.estado,
    'permitido', v_row.estado = 'autorizado',
    'es_administrador_principal', false,
    'tipo_dispositivo', v_row.tipo_dispositivo
  );
end;
$$;

create or replace function app_private.registrar_sugerencia(
  p_categoria text,
  p_asunto text,
  p_mensaje text,
  p_modulo text default '',
  p_version_app text default '',
  p_pagina_url text default '',
  p_agente text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_profile public.usuarios%rowtype;
  v_destino text;
  v_id uuid;
  v_categoria text := lower(btrim(coalesce(p_categoria, '')));
  v_asunto text := btrim(coalesce(p_asunto, ''));
  v_mensaje text := btrim(coalesce(p_mensaje, ''));
begin
  if auth.uid() is null
     or not app_private.usuario_activo()
     or not app_private.dispositivo_autorizado() then
    raise exception 'Sesión o dispositivo no autorizado';
  end if;

  if v_categoria not in ('sugerencia','mejora','incidencia','pregunta') then
    raise exception 'Categoría no válida';
  end if;
  if length(v_asunto) < 3 or length(v_asunto) > 140 then
    raise exception 'El asunto debe tener entre 3 y 140 caracteres';
  end if;
  if length(v_mensaje) < 10 or length(v_mensaje) > 4000 then
    raise exception 'El mensaje debe tener entre 10 y 4000 caracteres';
  end if;

  select * into v_profile
  from public.usuarios
  where id = auth.uid();

  select correo into v_destino
  from public.usuarios
  where tipo_usuario = 'administrador_principal'
    and activo = true
  order by creado_en
  limit 1;

  v_destino := coalesce(nullif(v_destino, ''), 'metrogestion2026@gmail.com');

  insert into public.sugerencias(
    usuario_id,
    usuario_nombre,
    usuario_correo,
    categoria,
    asunto,
    mensaje,
    modulo,
    version_app,
    pagina_url,
    agente,
    correo_destino
  ) values (
    v_profile.id,
    btrim(concat_ws(' ', v_profile.nombre, v_profile.apellidos)),
    v_profile.correo,
    v_categoria,
    v_asunto,
    v_mensaje,
    left(btrim(coalesce(p_modulo, '')), 120),
    left(btrim(coalesce(p_version_app, '')), 80),
    left(btrim(coalesce(p_pagina_url, '')), 500),
    left(btrim(coalesce(p_agente, '')), 500),
    v_destino
  ) returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'correo_destino', v_destino
  );
end;
$$;

create or replace function public.registrar_sugerencia(
  p_categoria text,
  p_asunto text,
  p_mensaje text,
  p_modulo text default '',
  p_version_app text default '',
  p_pagina_url text default '',
  p_agente text default ''
)
returns jsonb
language sql
set search_path = pg_catalog, app_private
as $$
  select app_private.registrar_sugerencia(
    p_categoria,
    p_asunto,
    p_mensaje,
    p_modulo,
    p_version_app,
    p_pagina_url,
    p_agente
  );
$$;

create or replace function app_private.marcar_sugerencia_correo_preparado(p_sugerencia_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;

  update public.sugerencias
  set correo_preparado_en = now(),
      actualizado_en = now()
  where id = p_sugerencia_id
    and usuario_id = auth.uid();

  if not found then
    raise exception 'Sugerencia no encontrada';
  end if;
end;
$$;

create or replace function public.marcar_sugerencia_correo_preparado(p_sugerencia_id uuid)
returns void
language sql
set search_path = pg_catalog, app_private
as $$
  select app_private.marcar_sugerencia_correo_preparado(p_sugerencia_id);
$$;

revoke all on function public.registrar_sugerencia(text,text,text,text,text,text,text) from public;
revoke all on function public.registrar_sugerencia(text,text,text,text,text,text,text) from anon;
grant execute on function public.registrar_sugerencia(text,text,text,text,text,text,text) to authenticated;

revoke all on function public.marcar_sugerencia_correo_preparado(uuid) from public;
revoke all on function public.marcar_sugerencia_correo_preparado(uuid) from anon;
grant execute on function public.marcar_sugerencia_correo_preparado(uuid) to authenticated;

commit;
