begin;

alter table public.usuarios
  add column if not exists max_dispositivos_autorizados smallint not null default 2,
  add column if not exists tipo_dispositivo_permitido text;

alter table public.usuarios
  drop constraint if exists usuarios_max_dispositivos_autorizados_check;
alter table public.usuarios
  add constraint usuarios_max_dispositivos_autorizados_check
  check (max_dispositivos_autorizados between 1 and 2);

alter table public.usuarios
  drop constraint if exists usuarios_tipo_dispositivo_permitido_check;
alter table public.usuarios
  add constraint usuarios_tipo_dispositivo_permitido_check
  check (tipo_dispositivo_permitido is null or tipo_dispositivo_permitido in ('movil','ordenador'));

comment on column public.usuarios.max_dispositivos_autorizados
  is 'Límite de dispositivos autorizados para el usuario. Por defecto conserva el máximo histórico de dos.';
comment on column public.usuarios.tipo_dispositivo_permitido
  is 'Si se informa, restringe la autorización a un único tipo de dispositivo: movil u ordenador.';

create or replace function app_private.limitar_dos_dispositivos_autorizados()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_autorizados integer;
  v_mismo_tipo integer;
  v_limite integer;
  v_tipo_permitido text;
begin
  if new.estado <> 'autorizado' then
    return new;
  end if;

  select u.max_dispositivos_autorizados, u.tipo_dispositivo_permitido
    into v_limite, v_tipo_permitido
  from public.usuarios u
  where u.id = new.usuario_id
  for update;

  if not found then
    raise exception 'Usuario del dispositivo no encontrado';
  end if;

  if v_tipo_permitido is not null and new.tipo_dispositivo is distinct from v_tipo_permitido then
    raise exception 'Este usuario solo admite dispositivos de tipo %.', v_tipo_permitido;
  end if;

  select count(*) into v_autorizados
  from public.dispositivos_usuario d
  where d.usuario_id = new.usuario_id
    and d.estado = 'autorizado'
    and d.id is distinct from new.id;

  if v_autorizados >= v_limite then
    raise exception 'Este usuario ya ha alcanzado su límite de % dispositivo(s) autorizado(s).', v_limite;
  end if;

  select count(*) into v_mismo_tipo
  from public.dispositivos_usuario d
  where d.usuario_id = new.usuario_id
    and d.estado = 'autorizado'
    and d.tipo_dispositivo = new.tipo_dispositivo
    and d.id is distinct from new.id;

  if v_mismo_tipo > 0 then
    if new.tipo_dispositivo = 'movil' then
      raise exception 'Este usuario ya tiene un móvil autorizado. Revócalo antes de autorizar otro móvil.';
    else
      raise exception 'Este usuario ya tiene un ordenador autorizado. Revócalo antes de autorizar otro ordenador.';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function app_private.solicitar_dispositivo(
  token_recibido text,
  nombre_recibido text,
  agente_recibido text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions
as $function$
declare
  v_hash text;
  v_row public.dispositivos_usuario%rowtype;
  v_tipo text;
  v_tipo_permitido text;
  v_estado_objetivo text;
begin
  if auth.uid() is null or not app_private.usuario_activo() then
    raise exception 'Sesión no autorizada';
  end if;

  if app_private.es_administrador_principal() then
    return jsonb_build_object(
      'dispositivo_id', null,
      'estado', 'administrador_principal',
      'permitido', true,
      'tipo_dispositivo', 'ordenador'
    );
  end if;

  if length(coalesce(token_recibido, '')) < 32 then
    raise exception 'Token de dispositivo no válido';
  end if;

  v_hash := encode(extensions.digest(token_recibido, 'sha256'), 'hex');
  v_tipo := app_private.detectar_tipo_dispositivo(nombre_recibido, agente_recibido);

  select tipo_dispositivo_permitido into v_tipo_permitido
  from public.usuarios
  where id = auth.uid();

  v_estado_objetivo := case
    when v_tipo_permitido is not null and v_tipo is distinct from v_tipo_permitido then 'bloqueado'
    else 'pendiente'
  end;

  insert into public.dispositivos_usuario(
    usuario_id,
    token_hash,
    nombre,
    agente,
    tipo_dispositivo,
    estado,
    observaciones
  ) values (
    auth.uid(),
    v_hash,
    left(coalesce(nullif(btrim(nombre_recibido), ''), 'Dispositivo'), 120),
    left(coalesce(agente_recibido, ''), 500),
    v_tipo,
    v_estado_objetivo,
    case when v_estado_objetivo='bloqueado'
      then 'Bloqueado automáticamente por política de tipo de dispositivo'
      else '' end
  )
  on conflict(usuario_id, token_hash) do update
  set nombre = excluded.nombre,
      agente = excluded.agente,
      tipo_dispositivo = excluded.tipo_dispositivo,
      estado = case
        when v_estado_objetivo='bloqueado' then 'bloqueado'
        when public.dispositivos_usuario.estado in ('revocado','bloqueado') then 'pendiente'
        else public.dispositivos_usuario.estado
      end,
      solicitado_en = case
        when v_estado_objetivo='bloqueado'
          or public.dispositivos_usuario.estado in ('revocado','bloqueado') then now()
        else public.dispositivos_usuario.solicitado_en
      end,
      observaciones = case
        when v_estado_objetivo='bloqueado'
          then 'Bloqueado automáticamente por política de tipo de dispositivo'
        else public.dispositivos_usuario.observaciones
      end,
      actualizado_en = now()
  returning * into v_row;

  return jsonb_build_object(
    'dispositivo_id', v_row.id,
    'estado', v_row.estado,
    'permitido', v_row.estado = 'autorizado',
    'tipo_dispositivo', v_row.tipo_dispositivo
  );
end;
$function$;

create or replace function app_private.autorizar_dispositivo(
  p_dispositivo_id uuid,
  p_autorizar boolean,
  p_observaciones text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_usuario_id uuid;
  v_tipo text;
  v_estado text;
  v_autorizados integer;
  v_mismo_tipo integer;
  v_limite integer;
  v_tipo_permitido text;
begin
  if not app_private.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede autorizar dispositivos';
  end if;

  select usuario_id, tipo_dispositivo
    into v_usuario_id, v_tipo
  from public.dispositivos_usuario
  where id = p_dispositivo_id
  for update;

  if v_usuario_id is null then
    raise exception 'Dispositivo no encontrado';
  end if;

  select u.max_dispositivos_autorizados, u.tipo_dispositivo_permitido
    into v_limite, v_tipo_permitido
  from public.usuarios u
  where u.id = v_usuario_id
  for update;

  if p_autorizar then
    if v_tipo_permitido is not null and v_tipo is distinct from v_tipo_permitido then
      raise exception 'Este usuario solo admite dispositivos de tipo %.', v_tipo_permitido;
    end if;

    select count(*) into v_autorizados
    from public.dispositivos_usuario
    where usuario_id = v_usuario_id
      and estado = 'autorizado'
      and id <> p_dispositivo_id;

    if v_autorizados >= v_limite then
      raise exception 'Este usuario ya ha alcanzado su límite de % dispositivo(s) autorizado(s).', v_limite;
    end if;

    select count(*) into v_mismo_tipo
    from public.dispositivos_usuario
    where usuario_id = v_usuario_id
      and estado = 'autorizado'
      and tipo_dispositivo = v_tipo
      and id <> p_dispositivo_id;

    if v_mismo_tipo > 0 then
      if v_tipo = 'movil' then
        raise exception 'Este usuario ya tiene un móvil autorizado. Revócalo antes de autorizar otro móvil.';
      else
        raise exception 'Este usuario ya tiene un ordenador autorizado. Revócalo antes de autorizar otro ordenador.';
      end if;
    end if;

    update public.dispositivos_usuario
    set estado = 'autorizado',
        autorizado_en = coalesce(autorizado_en, now()),
        autorizado_por = auth.uid(),
        observaciones = coalesce(p_observaciones, ''),
        actualizado_en = now()
    where id = p_dispositivo_id;

    v_estado := 'autorizado';
  else
    update public.dispositivos_usuario
    set estado = case when estado = 'pendiente' then 'bloqueado' else 'revocado' end,
        observaciones = coalesce(p_observaciones, ''),
        actualizado_en = now()
    where id = p_dispositivo_id
    returning estado into v_estado;
  end if;

  select count(*) into v_autorizados
  from public.dispositivos_usuario
  where usuario_id = v_usuario_id
    and estado = 'autorizado';

  return jsonb_build_object(
    'dispositivo_id', p_dispositivo_id,
    'usuario_id', v_usuario_id,
    'tipo_dispositivo', v_tipo,
    'estado', v_estado,
    'permitido', v_estado = 'autorizado',
    'autorizados', v_autorizados,
    'limite', v_limite,
    'tipo_permitido', v_tipo_permitido
  );
end;
$function$;

create or replace function app_private.recuperar_dispositivo_revocado(
  p_dispositivo_id uuid,
  p_motivo text default 'Recuperado por el administrador principal'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_usuario_id uuid;
  v_tipo text;
  v_estado text;
  v_autorizados integer;
  v_mismo_tipo integer;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_limite integer;
  v_tipo_permitido text;
begin
  if not app_private.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede recuperar dispositivos revocados';
  end if;

  if length(v_motivo) < 3 then
    raise exception 'Indica el motivo de la recuperación';
  end if;

  select usuario_id, tipo_dispositivo, estado
    into v_usuario_id, v_tipo, v_estado
  from public.dispositivos_usuario
  where id = p_dispositivo_id
  for update;

  if v_usuario_id is null then
    raise exception 'Dispositivo no encontrado';
  end if;

  if v_estado <> 'revocado' then
    raise exception 'Solo puede recuperarse un dispositivo revocado';
  end if;

  select u.max_dispositivos_autorizados, u.tipo_dispositivo_permitido
    into v_limite, v_tipo_permitido
  from public.usuarios u
  where u.id = v_usuario_id
  for update;

  if v_tipo_permitido is not null and v_tipo is distinct from v_tipo_permitido then
    raise exception 'Este usuario solo admite dispositivos de tipo %.', v_tipo_permitido;
  end if;

  select count(*) into v_autorizados
  from public.dispositivos_usuario
  where usuario_id = v_usuario_id
    and estado = 'autorizado'
    and id <> p_dispositivo_id;

  if v_autorizados >= v_limite then
    raise exception 'Este usuario ya ha alcanzado su límite de % dispositivo(s) autorizado(s).', v_limite;
  end if;

  select count(*) into v_mismo_tipo
  from public.dispositivos_usuario
  where usuario_id = v_usuario_id
    and estado = 'autorizado'
    and tipo_dispositivo = v_tipo
    and id <> p_dispositivo_id;

  if v_mismo_tipo > 0 then
    if v_tipo = 'movil' then
      raise exception 'Este usuario ya tiene un móvil autorizado. Revócalo antes de recuperar otro móvil.';
    else
      raise exception 'Este usuario ya tiene un ordenador autorizado. Revócalo antes de recuperar otro ordenador.';
    end if;
  end if;

  update public.dispositivos_usuario
  set estado = 'autorizado',
      autorizado_en = now(),
      autorizado_por = auth.uid(),
      observaciones = v_motivo,
      actualizado_en = now()
  where id = p_dispositivo_id;

  return jsonb_build_object(
    'ok', true,
    'dispositivo_id', p_dispositivo_id,
    'usuario_id', v_usuario_id,
    'tipo_dispositivo', v_tipo,
    'estado', 'autorizado',
    'permitido', true,
    'limite', v_limite,
    'tipo_permitido', v_tipo_permitido
  );
end;
$function$;

create or replace function app_private.comprobar_dispositivo(token_recibido text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions
as $function$
declare
  v_row public.dispositivos_usuario%rowtype;
  v_profile public.usuarios%rowtype;
  v_hash text;
  v_autorizados integer;
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

  if v_profile.tipo_dispositivo_permitido is not null
     and v_row.tipo_dispositivo is distinct from v_profile.tipo_dispositivo_permitido then
    return jsonb_build_object(
      'dispositivo_id', v_row.id,
      'estado', 'bloqueado_politica',
      'permitido', false,
      'es_administrador_principal', false,
      'tipo_dispositivo', v_row.tipo_dispositivo
    );
  end if;

  select count(*) into v_autorizados
  from public.dispositivos_usuario d
  where d.usuario_id = auth.uid()
    and d.estado = 'autorizado';

  if v_row.estado = 'autorizado' and v_autorizados > v_profile.max_dispositivos_autorizados then
    return jsonb_build_object(
      'dispositivo_id', v_row.id,
      'estado', 'limite_incoherente',
      'permitido', false,
      'es_administrador_principal', false,
      'tipo_dispositivo', v_row.tipo_dispositivo
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
$function$;

create or replace function app_private.dispositivo_autorizado()
returns boolean
language plpgsql
stable security definer
set search_path = pg_catalog, public, app_private, extensions
as $function$
declare
  v_token text;
  v_hash text;
  v_limite integer;
  v_tipo_permitido text;
  v_autorizados integer;
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

  select u.max_dispositivos_autorizados, u.tipo_dispositivo_permitido
    into v_limite, v_tipo_permitido
  from public.usuarios u
  where u.id = auth.uid();

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  select count(*) into v_autorizados
  from public.dispositivos_usuario d
  where d.usuario_id = auth.uid()
    and d.estado = 'autorizado';

  if v_autorizados > v_limite then
    return false;
  end if;

  return exists (
    select 1
    from public.dispositivos_usuario d
    where d.usuario_id = auth.uid()
      and d.token_hash = v_hash
      and d.estado = 'autorizado'
      and (v_tipo_permitido is null or d.tipo_dispositivo = v_tipo_permitido)
  );
end;
$function$;

commit;
