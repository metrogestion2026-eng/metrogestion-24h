begin;

create table if not exists public.sesiones_presencia (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  dispositivo_id uuid references public.dispositivos_usuario(id) on delete set null,
  instancia_id uuid not null,
  auth_session_id text,
  pagina text not null default 'Aplicación',
  version_cliente text not null default '',
  visible boolean not null default true,
  estado text not null default 'activo' check (estado in ('activo','bloqueado','desconectado')),
  conectada_en timestamptz not null default now(),
  ultima_actividad_en timestamptz not null default now(),
  agente text not null default '',
  bloqueada_en timestamptz,
  bloqueada_por uuid references public.usuarios(id) on delete set null,
  motivo_bloqueo text not null default '',
  constraint sesiones_presencia_usuario_instancia_uq unique (usuario_id, instancia_id)
);
create index if not exists sesiones_presencia_actividad_idx on public.sesiones_presencia (ultima_actividad_en desc);
create index if not exists sesiones_presencia_usuario_estado_idx on public.sesiones_presencia (usuario_id, estado, ultima_actividad_en desc);
create index if not exists sesiones_presencia_dispositivo_idx on public.sesiones_presencia (dispositivo_id) where dispositivo_id is not null;

create table if not exists public.intentos_acceso_no_reconocido (
  id uuid primary key default gen_random_uuid(),
  huella_hash text not null unique check (huella_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text not null default '' check (ip_hash = '' or ip_hash ~ '^[0-9a-f]{64}$'),
  correo_indicado text not null default '',
  ultimo_evento text not null default 'vista_login'
    check (ultimo_evento in ('vista_login','credenciales_rechazadas','comprobar_bloqueo')),
  agente text not null default '',
  ruta text not null default '',
  primero_en timestamptz not null default now(),
  ultimo_en timestamptz not null default now(),
  repeticiones integer not null default 1 check (repeticiones >= 1),
  bloqueado boolean not null default false,
  bloqueado_en timestamptz,
  bloqueado_por uuid references public.usuarios(id) on delete set null,
  motivo_bloqueo text not null default ''
);
create index if not exists intentos_acceso_ultimo_idx on public.intentos_acceso_no_reconocido (ultimo_en desc);
create index if not exists intentos_acceso_bloqueado_idx on public.intentos_acceso_no_reconocido (bloqueado, ultimo_en desc);
create index if not exists intentos_acceso_ip_idx on public.intentos_acceso_no_reconocido (ip_hash, ultimo_en desc) where ip_hash <> '';

alter table public.sesiones_presencia enable row level security;
alter table public.intentos_acceso_no_reconocido enable row level security;
drop policy if exists sesiones_presencia_select_own_or_primary on public.sesiones_presencia;
create policy sesiones_presencia_select_own_or_primary
  on public.sesiones_presencia for select to authenticated
  using (
    usuario_id = (select auth.uid())
    or ((select public.dispositivo_autorizado()) and (select public.es_administrador_principal()))
  );
drop policy if exists intentos_acceso_select_primary on public.intentos_acceso_no_reconocido;
create policy intentos_acceso_select_primary
  on public.intentos_acceso_no_reconocido for select to authenticated
  using ((select public.dispositivo_autorizado()) and (select public.es_administrador_principal()));

revoke all on table public.sesiones_presencia from public, anon, authenticated;
revoke all on table public.intentos_acceso_no_reconocido from public, anon, authenticated;
grant select on table public.sesiones_presencia to authenticated;
grant select on table public.intentos_acceso_no_reconocido to authenticated;
grant select,insert,update,delete on table public.sesiones_presencia to service_role;
grant select,insert,update,delete on table public.intentos_acceso_no_reconocido to service_role;

CREATE OR REPLACE FUNCTION app_private.actualizar_presencia(p_instancia_id uuid, p_pagina text DEFAULT 'Aplicación'::text, p_version text DEFAULT ''::text, p_visible boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_usuario public.usuarios%rowtype;
  v_dispositivo jsonb;
  v_permitido boolean := false;
  v_estado text := 'sin_sesion';
  v_dispositivo_id uuid;
  v_presencia_id uuid;
  v_session_id text;
  v_agente text;
begin
  if auth.uid() is null or p_instancia_id is null then
    return jsonb_build_object('permitido', false, 'estado', 'sin_sesion');
  end if;

  select * into v_usuario from public.usuarios where id = auth.uid();
  if not found then
    return jsonb_build_object('permitido', false, 'estado', 'usuario_no_reconocido');
  end if;

  v_dispositivo := app_private.comprobar_dispositivo(
    app_private.request_header('x-device-token')
  );
  v_permitido := coalesce((v_dispositivo ->> 'permitido')::boolean, false);
  v_estado := coalesce(v_dispositivo ->> 'estado', 'desconocido');

  if not v_permitido then
    update public.sesiones_presencia
    set estado = 'bloqueado',
        visible = false,
        ultima_actividad_en = now(),
        bloqueada_en = coalesce(bloqueada_en, now()),
        motivo_bloqueo = case when motivo_bloqueo = '' then left(v_estado, 300) else motivo_bloqueo end
    where usuario_id = auth.uid() and instancia_id = p_instancia_id;

    return jsonb_build_object(
      'permitido', false,
      'estado', v_estado,
      'tipo_usuario', v_usuario.tipo_usuario
    );
  end if;

  begin
    v_dispositivo_id := nullif(v_dispositivo ->> 'dispositivo_id', '')::uuid;
  exception when others then
    v_dispositivo_id := null;
  end;

  v_session_id := coalesce(auth.jwt() ->> 'session_id', '');
  v_agente := left(coalesce(app_private.request_header('user-agent'), ''), 500);

  insert into public.sesiones_presencia (
    usuario_id, dispositivo_id, instancia_id, auth_session_id,
    pagina, version_cliente, visible, estado, conectada_en,
    ultima_actividad_en, agente, bloqueada_en, bloqueada_por, motivo_bloqueo
  ) values (
    auth.uid(), v_dispositivo_id, p_instancia_id, nullif(v_session_id, ''),
    left(coalesce(nullif(btrim(p_pagina), ''), 'Aplicación'), 160),
    left(coalesce(p_version, ''), 80), coalesce(p_visible, true),
    'activo', now(), now(), v_agente, null, null, ''
  )
  on conflict (usuario_id, instancia_id) do update
  set dispositivo_id = excluded.dispositivo_id,
      auth_session_id = excluded.auth_session_id,
      pagina = excluded.pagina,
      version_cliente = excluded.version_cliente,
      visible = excluded.visible,
      estado = 'activo',
      ultima_actividad_en = now(),
      agente = excluded.agente,
      bloqueada_en = null,
      bloqueada_por = null,
      motivo_bloqueo = ''
  returning id into v_presencia_id;

  return jsonb_build_object(
    'permitido', true,
    'estado', 'activo',
    'presencia_id', v_presencia_id,
    'usuario_id', v_usuario.id,
    'nombre', btrim(concat_ws(' ', v_usuario.nombre, v_usuario.apellidos)),
    'tipo_usuario', v_usuario.tipo_usuario,
    'dispositivo_id', v_dispositivo_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.bloquear_acceso_presencia(p_presencia_id uuid, p_alcance text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_presencia public.sesiones_presencia%rowtype;
  v_rol text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_alcance text := lower(btrim(coalesce(p_alcance, '')));
begin
  if not app_private.es_administrador_principal()
     or not app_private.dispositivo_autorizado() then
    raise exception 'Solo el administrador principal puede bloquear accesos';
  end if;
  if length(v_motivo) < 3 then raise exception 'Indica el motivo del bloqueo'; end if;
  if v_alcance not in ('dispositivo','usuario') then raise exception 'Alcance de bloqueo no válido'; end if;

  select s.* into v_presencia
  from public.sesiones_presencia s
  where s.id = p_presencia_id
  for update;
  if not found then raise exception 'La conexión ya no existe'; end if;

  select u.tipo_usuario into v_rol
  from public.usuarios u
  where u.id = v_presencia.usuario_id;

  if v_presencia.usuario_id = auth.uid() or v_rol = 'administrador_principal' then
    raise exception 'El administrador principal no puede bloquearse a sí mismo';
  end if;

  if v_alcance = 'dispositivo' then
    if v_presencia.dispositivo_id is null then raise exception 'Esta conexión no tiene un dispositivo identificable'; end if;
    update public.dispositivos_usuario
    set estado = 'revocado', observaciones = left(v_motivo, 500), actualizado_en = now()
    where id = v_presencia.dispositivo_id;
    update public.sesiones_presencia
    set estado = 'bloqueado', visible = false, bloqueada_en = now(),
        bloqueada_por = auth.uid(), motivo_bloqueo = left(v_motivo, 500),
        ultima_actividad_en = now()
    where dispositivo_id = v_presencia.dispositivo_id and estado = 'activo';
  else
    update public.usuarios set activo = false, actualizado_en = now()
    where id = v_presencia.usuario_id;
    update public.dispositivos_usuario
    set estado = 'revocado', observaciones = left('Cuenta bloqueada: ' || v_motivo, 500),
        actualizado_en = now()
    where usuario_id = v_presencia.usuario_id and estado = 'autorizado';
    update public.sesiones_presencia
    set estado = 'bloqueado', visible = false, bloqueada_en = now(),
        bloqueada_por = auth.uid(), motivo_bloqueo = left(v_motivo, 500),
        ultima_actividad_en = now()
    where usuario_id = v_presencia.usuario_id and estado = 'activo';
  end if;

  insert into public.auditoria_cambios (
    tabla, registro_id, accion, datos_anteriores, datos_nuevos,
    usuario_id, origen, request_id
  ) values (
    'sesiones_presencia', v_presencia.id, 'bloquear_acceso_en_vivo',
    jsonb_build_object('usuario_id', v_presencia.usuario_id,
      'dispositivo_id', v_presencia.dispositivo_id, 'estado', v_presencia.estado),
    jsonb_build_object('alcance', v_alcance, 'motivo', v_motivo, 'estado', 'bloqueado'),
    auth.uid(), 'alpha69_presencia', app_private.request_header('x-request-id')
  );

  return jsonb_build_object('ok', true, 'alcance', v_alcance,
    'usuario_id', v_presencia.usuario_id,
    'dispositivo_id', v_presencia.dispositivo_id, 'estado', 'bloqueado');
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.bloquear_intento_acceso(p_intento_id uuid, p_bloquear boolean, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_anterior public.intentos_acceso_no_reconocido%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if not app_private.es_administrador_principal()
     or not app_private.dispositivo_autorizado() then
    raise exception 'Solo el administrador principal puede bloquear intentos';
  end if;
  if coalesce(p_bloquear, false) and length(v_motivo) < 3 then
    raise exception 'Indica el motivo del bloqueo';
  end if;

  select * into v_anterior from public.intentos_acceso_no_reconocido
  where id = p_intento_id for update;
  if not found then raise exception 'Intento no encontrado'; end if;

  update public.intentos_acceso_no_reconocido
  set bloqueado = coalesce(p_bloquear, false),
      bloqueado_en = case when coalesce(p_bloquear, false) then now() else null end,
      bloqueado_por = case when coalesce(p_bloquear, false) then auth.uid() else null end,
      motivo_bloqueo = case when coalesce(p_bloquear, false) then left(v_motivo, 500) else '' end
  where id = p_intento_id;

  insert into public.auditoria_cambios (
    tabla, registro_id, accion, datos_anteriores, datos_nuevos,
    usuario_id, origen, request_id
  ) values (
    'intentos_acceso_no_reconocido', p_intento_id,
    case when coalesce(p_bloquear, false) then 'bloquear_huella' else 'desbloquear_huella' end,
    jsonb_build_object('bloqueado', v_anterior.bloqueado),
    jsonb_build_object('bloqueado', coalesce(p_bloquear, false), 'motivo', v_motivo),
    auth.uid(), 'alpha69_presencia', app_private.request_header('x-request-id')
  );

  return jsonb_build_object('ok', true, 'intento_id', p_intento_id,
    'bloqueado', coalesce(p_bloquear, false));
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.estado_presencia_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_en_linea jsonb;
  v_intentos jsonb;
  v_ahora timestamptz := now();
begin
  if not app_private.es_administrador_principal()
     or not app_private.dispositivo_autorizado() then
    raise exception 'Solo el administrador principal puede consultar la presencia';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.ultima_actividad_en desc), '[]'::jsonb)
  into v_en_linea
  from (
    select
      s.id as presencia_id, s.usuario_id,
      btrim(concat_ws(' ', u.nombre, u.apellidos)) as nombre,
      u.correo, u.tipo_usuario, u.activo as usuario_activo,
      s.dispositivo_id,
      coalesce(d.nombre, case when u.tipo_usuario = 'administrador_principal'
        then 'Dispositivo del administrador principal' else 'Dispositivo no localizado' end) as dispositivo,
      d.tipo_dispositivo, d.estado as estado_dispositivo,
      s.pagina, s.version_cliente, s.visible,
      s.conectada_en, s.ultima_actividad_en, s.estado, s.agente
    from public.sesiones_presencia s
    join public.usuarios u on u.id = s.usuario_id
    left join public.dispositivos_usuario d on d.id = s.dispositivo_id
    where s.estado = 'activo'
      and s.ultima_actividad_en >= v_ahora - interval '45 seconds'
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.ultimo_en desc), '[]'::jsonb)
  into v_intentos
  from (
    select
      i.id as intento_id, i.correo_indicado, i.ultimo_evento,
      i.agente, i.ruta, i.primero_en, i.ultimo_en,
      i.repeticiones, i.bloqueado, i.bloqueado_en,
      i.motivo_bloqueo,
      (i.ultimo_en >= v_ahora - interval '45 seconds') as en_linea
    from public.intentos_acceso_no_reconocido i
    where i.ultimo_en >= v_ahora - interval '24 hours' or i.bloqueado = true
    order by i.ultimo_en desc
    limit 100
  ) q;

  return jsonb_build_object(
    'consultado_en', v_ahora,
    'umbral_segundos', 45,
    'en_linea', v_en_linea,
    'intentos_no_reconocidos', v_intentos,
    'total_en_linea', jsonb_array_length(v_en_linea),
    'no_reconocidos_en_linea', (
      select count(*) from public.intentos_acceso_no_reconocido
      where ultimo_en >= v_ahora - interval '45 seconds'
    ),
    'bloqueados', (
      select count(*) from public.intentos_acceso_no_reconocido where bloqueado = true
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.marcar_presencia_desconectada(p_instancia_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if auth.uid() is null or p_instancia_id is null then return false; end if;
  update public.sesiones_presencia
  set estado = 'desconectado', visible = false, ultima_actividad_en = now()
  where usuario_id = auth.uid()
    and instancia_id = p_instancia_id
    and estado = 'activo';
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.registrar_intento_acceso_anonimo(p_huella_hash text, p_ip_hash text, p_correo text, p_evento text, p_agente text, p_ruta text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_id uuid;
  v_bloqueado boolean;
  v_evento text := lower(btrim(coalesce(p_evento, '')));
  v_incremento integer;
begin
  if coalesce(p_huella_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Huella no válida'; end if;
  if coalesce(p_ip_hash, '') <> '' and p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Red no válida'; end if;
  if v_evento not in ('vista_login','credenciales_rechazadas','comprobar_bloqueo') then
    raise exception 'Evento no válido';
  end if;

  v_incremento := case when v_evento = 'comprobar_bloqueo' then 0 else 1 end;

  insert into public.intentos_acceso_no_reconocido (
    huella_hash, ip_hash, correo_indicado, ultimo_evento,
    agente, ruta, primero_en, ultimo_en, repeticiones
  ) values (
    p_huella_hash, coalesce(p_ip_hash, ''),
    left(lower(btrim(coalesce(p_correo, ''))), 160), v_evento,
    left(coalesce(p_agente, ''), 500), left(coalesce(p_ruta, ''), 160),
    now(), now(), greatest(v_incremento, 1)
  )
  on conflict (huella_hash) do update
  set ip_hash = case when excluded.ip_hash <> '' then excluded.ip_hash
                     else public.intentos_acceso_no_reconocido.ip_hash end,
      correo_indicado = case when excluded.correo_indicado <> '' then excluded.correo_indicado
                             else public.intentos_acceso_no_reconocido.correo_indicado end,
      ultimo_evento = case when excluded.ultimo_evento = 'comprobar_bloqueo'
                           then public.intentos_acceso_no_reconocido.ultimo_evento
                           else excluded.ultimo_evento end,
      agente = excluded.agente,
      ruta = excluded.ruta,
      ultimo_en = now(),
      repeticiones = public.intentos_acceso_no_reconocido.repeticiones + v_incremento
  returning id, bloqueado into v_id, v_bloqueado;

  return jsonb_build_object('ok', true, 'intento_id', v_id, 'bloqueado', v_bloqueado);
end;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_presencia(p_instancia_id uuid, p_pagina text DEFAULT 'Aplicación'::text, p_version text DEFAULT ''::text, p_visible boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.actualizar_presencia(p_instancia_id,p_pagina,p_version,p_visible); $function$;

CREATE OR REPLACE FUNCTION public.bloquear_acceso_presencia(p_presencia_id uuid, p_alcance text, p_motivo text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.bloquear_acceso_presencia(p_presencia_id,p_alcance,p_motivo); $function$;

CREATE OR REPLACE FUNCTION public.bloquear_intento_acceso(p_intento_id uuid, p_bloquear boolean, p_motivo text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.bloquear_intento_acceso(p_intento_id,p_bloquear,p_motivo); $function$;

CREATE OR REPLACE FUNCTION public.estado_presencia_admin()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.estado_presencia_admin(); $function$;

CREATE OR REPLACE FUNCTION public.marcar_presencia_desconectada(p_instancia_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.marcar_presencia_desconectada(p_instancia_id); $function$;

CREATE OR REPLACE FUNCTION public.registrar_intento_acceso_anonimo(p_huella_hash text, p_ip_hash text, p_correo text, p_evento text, p_agente text, p_ruta text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.registrar_intento_acceso_anonimo(
  p_huella_hash,p_ip_hash,p_correo,p_evento,p_agente,p_ruta
); $function$;

revoke all on function app_private.actualizar_presencia(uuid,text,text,boolean) from public;
revoke all on function app_private.marcar_presencia_desconectada(uuid) from public;
revoke all on function app_private.estado_presencia_admin() from public;
revoke all on function app_private.bloquear_acceso_presencia(uuid,text,text) from public;
revoke all on function app_private.bloquear_intento_acceso(uuid,boolean,text) from public;
revoke all on function app_private.registrar_intento_acceso_anonimo(text,text,text,text,text,text) from public;

revoke all on function public.actualizar_presencia(uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.marcar_presencia_desconectada(uuid) from public,anon,authenticated;
revoke all on function public.estado_presencia_admin() from public,anon,authenticated;
revoke all on function public.bloquear_acceso_presencia(uuid,text,text) from public,anon,authenticated;
revoke all on function public.bloquear_intento_acceso(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.registrar_intento_acceso_anonimo(text,text,text,text,text,text) from public,anon,authenticated;

grant execute on function app_private.actualizar_presencia(uuid,text,text,boolean) to authenticated,service_role;
grant execute on function app_private.marcar_presencia_desconectada(uuid) to authenticated,service_role;
grant execute on function app_private.estado_presencia_admin() to authenticated,service_role;
grant execute on function app_private.bloquear_acceso_presencia(uuid,text,text) to authenticated,service_role;
grant execute on function app_private.bloquear_intento_acceso(uuid,boolean,text) to authenticated,service_role;
grant execute on function app_private.registrar_intento_acceso_anonimo(text,text,text,text,text,text) to service_role;

grant execute on function public.actualizar_presencia(uuid,text,text,boolean) to authenticated,service_role;
grant execute on function public.marcar_presencia_desconectada(uuid) to authenticated,service_role;
grant execute on function public.estado_presencia_admin() to authenticated,service_role;
grant execute on function public.bloquear_acceso_presencia(uuid,text,text) to authenticated,service_role;
grant execute on function public.bloquear_intento_acceso(uuid,boolean,text) to authenticated,service_role;
grant execute on function public.registrar_intento_acceso_anonimo(text,text,text,text,text,text) to service_role;

comment on table public.sesiones_presencia is 'Presencia en vivo server-authoritative de Alpha69; no concede acceso por sí misma.';
comment on table public.intentos_acceso_no_reconocido is 'Intentos detenidos en la pantalla de acceso. No representa usuarios que hayan entrado en la aplicación.';
comment on function public.actualizar_presencia(uuid,text,text,boolean) is 'Heartbeat autenticado que vuelve a validar usuario, credencial y dispositivo.';
comment on function public.bloquear_acceso_presencia(uuid,text,text) is 'Bloquea un dispositivo o una cuenta en vivo; exclusivo del administrador principal.';

do $publication$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    if not exists (select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sesiones_presencia') then
      alter publication supabase_realtime add table public.sesiones_presencia;
    end if;
    if not exists (select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='intentos_acceso_no_reconocido') then
      alter publication supabase_realtime add table public.intentos_acceso_no_reconocido;
    end if;
  end if;
end;
$publication$;

commit;
