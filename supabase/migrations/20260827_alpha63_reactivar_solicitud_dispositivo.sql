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
      estado = case
        when public.dispositivos_usuario.estado in ('revocado', 'bloqueado') then 'pendiente'
        else public.dispositivos_usuario.estado
      end,
      solicitado_en = case
        when public.dispositivos_usuario.estado in ('revocado', 'bloqueado') then now()
        else public.dispositivos_usuario.solicitado_en
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
$$;
