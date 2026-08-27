begin;

create or replace function app_private.recuperar_dispositivo_revocado(
  p_dispositivo_id uuid,
  p_motivo text default 'Recuperado por el administrador principal'
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
  v_motivo text := btrim(coalesce(p_motivo, ''));
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

  perform 1
  from public.usuarios
  where id = v_usuario_id
  for update;

  select count(*)
    into v_autorizados
  from public.dispositivos_usuario
  where usuario_id = v_usuario_id
    and estado = 'autorizado'
    and id <> p_dispositivo_id;

  if v_autorizados >= 2 then
    raise exception 'Este usuario ya tiene dos dispositivos autorizados. Revoca uno antes de recuperar otro.';
  end if;

  select count(*)
    into v_mismo_tipo
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
    'permitido', true
  );
end;
$$;

create or replace function public.recuperar_dispositivo_revocado(
  p_dispositivo_id uuid,
  p_motivo text default 'Recuperado por el administrador principal'
)
returns jsonb
language sql
set search_path = pg_catalog, app_private
as $$
  select app_private.recuperar_dispositivo_revocado(
    p_dispositivo_id,
    p_motivo
  );
$$;

revoke all on function public.recuperar_dispositivo_revocado(uuid,text) from public;
revoke all on function public.recuperar_dispositivo_revocado(uuid,text) from anon;
grant execute on function public.recuperar_dispositivo_revocado(uuid,text) to authenticated;

commit;
