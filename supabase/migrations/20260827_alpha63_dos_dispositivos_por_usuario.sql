begin;

-- Sustituye la limitación histórica de un único dispositivo por dos plazas:
-- un móvil y un ordenador por usuario.
drop index if exists public.dispositivos_un_autorizado_por_usuario_uidx;

alter table public.dispositivos_usuario
  add column if not exists tipo_dispositivo text;

create or replace function app_private.detectar_tipo_dispositivo(
  p_nombre text,
  p_agente text
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when lower(coalesce(p_nombre, '') || ' ' || coalesce(p_agente, ''))
         ~ '(móvil|movil|mobile|android|iphone|ipad|ipod|tablet)'
      then 'movil'
    else 'ordenador'
  end;
$$;

update public.dispositivos_usuario
set tipo_dispositivo = app_private.detectar_tipo_dispositivo(nombre, agente)
where tipo_dispositivo is null
   or tipo_dispositivo not in ('movil', 'ordenador');

alter table public.dispositivos_usuario
  alter column tipo_dispositivo set default 'ordenador',
  alter column tipo_dispositivo set not null;

alter table public.dispositivos_usuario
  drop constraint if exists dispositivos_usuario_tipo_dispositivo_check;
alter table public.dispositivos_usuario
  add constraint dispositivos_usuario_tipo_dispositivo_check
  check (tipo_dispositivo in ('movil', 'ordenador'));

create index if not exists dispositivos_autorizados_por_usuario_idx
  on public.dispositivos_usuario(usuario_id, autorizado_en desc)
  where estado = 'autorizado';

create unique index if not exists dispositivos_un_tipo_autorizado_por_usuario_uidx
  on public.dispositivos_usuario(usuario_id, tipo_dispositivo)
  where estado = 'autorizado';

create or replace function app_private.limitar_dos_dispositivos_autorizados()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_autorizados integer;
  v_mismo_tipo integer;
begin
  if new.estado <> 'autorizado' then
    return new;
  end if;

  perform 1
  from public.usuarios
  where id = new.usuario_id
  for update;

  select count(*) into v_autorizados
  from public.dispositivos_usuario d
  where d.usuario_id = new.usuario_id
    and d.estado = 'autorizado'
    and d.id is distinct from new.id;

  if v_autorizados >= 2 then
    raise exception 'Este usuario ya tiene dos dispositivos autorizados. Revoca uno antes de autorizar otro.';
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
$$;

drop trigger if exists dispositivos_limite_dos_autorizados on public.dispositivos_usuario;
create trigger dispositivos_limite_dos_autorizados
before insert or update of usuario_id, estado, tipo_dispositivo
on public.dispositivos_usuario
for each row execute function app_private.limitar_dos_dispositivos_autorizados();

create or replace function app_private.solicitar_dispositivo(
  token_recibido text,
  nombre_recibido text,
  agente_recibido text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions
as $$
declare
  v_hash text;
  v_row public.dispositivos_usuario%rowtype;
  v_tipo text;
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

  insert into public.dispositivos_usuario(
    usuario_id,
    token_hash,
    nombre,
    agente,
    tipo_dispositivo,
    estado
  ) values (
    auth.uid(),
    v_hash,
    left(coalesce(nullif(btrim(nombre_recibido), ''), 'Dispositivo'), 120),
    left(coalesce(agente_recibido, ''), 500),
    v_tipo,
    'pendiente'
  )
  on conflict(usuario_id, token_hash) do update
  set nombre = excluded.nombre,
      agente = excluded.agente,
      tipo_dispositivo = excluded.tipo_dispositivo,
      actualizado_en = now()
  returning * into v_row;

  return jsonb_build_object(
    'dispositivo_id', v_row.id,
    'estado', v_row.estado,
    'permitido', v_row.estado = 'autorizado',
    'tipo_dispositivo', v_row.tipo_dispositivo
  );
end;
$$;

create or replace function app_private.autorizar_dispositivo(
  p_dispositivo_id uuid,
  p_autorizar boolean,
  p_observaciones text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_usuario_id uuid;
  v_tipo text;
  v_estado text;
  v_autorizados integer;
  v_mismo_tipo integer;
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

  perform 1
  from public.usuarios
  where id = v_usuario_id
  for update;

  if p_autorizar then
    select count(*) into v_autorizados
    from public.dispositivos_usuario
    where usuario_id = v_usuario_id
      and estado = 'autorizado'
      and id <> p_dispositivo_id;

    if v_autorizados >= 2 then
      raise exception 'Este usuario ya tiene dos dispositivos autorizados. Revoca uno antes de autorizar otro.';
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
    'limite', 2
  );
end;
$$;

commit;
