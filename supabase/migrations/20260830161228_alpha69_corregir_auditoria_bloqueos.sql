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
    'sesiones_presencia', v_presencia.id, 'UPDATE',
    jsonb_build_object('usuario_id', v_presencia.usuario_id,
      'dispositivo_id', v_presencia.dispositivo_id, 'estado', v_presencia.estado),
    jsonb_build_object('evento', 'bloquear_acceso_en_vivo', 'alcance', v_alcance, 'motivo', v_motivo, 'estado', 'bloqueado'),
    auth.uid(), 'alpha69_presencia', app_private.request_header('x-request-id')
  );

  return jsonb_build_object('ok', true, 'alcance', v_alcance,
    'usuario_id', v_presencia.usuario_id,
    'dispositivo_id', v_presencia.dispositivo_id, 'estado', 'bloqueado');
end;
$function$
;

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
    'UPDATE',
    jsonb_build_object('bloqueado', v_anterior.bloqueado),
    jsonb_build_object('evento', case when coalesce(p_bloquear, false) then 'bloquear_huella' else 'desbloquear_huella' end, 'bloqueado', coalesce(p_bloquear, false), 'motivo', v_motivo),
    auth.uid(), 'alpha69_presencia', app_private.request_header('x-request-id')
  );

  return jsonb_build_object('ok', true, 'intento_id', p_intento_id,
    'bloqueado', coalesce(p_bloquear, false));
end;
$function$
;