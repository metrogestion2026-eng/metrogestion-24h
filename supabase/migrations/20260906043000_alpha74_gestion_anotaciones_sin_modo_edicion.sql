-- Alpha74: modificar y retirar anotaciones desde Hotel sin desbloquear la
-- edición completa. Se conserva la identidad de la ficha, el control de
-- concurrencia y la auditoría; retirar nunca borra físicamente la anotación.

create or replace function app_private.actualizar_anotacion_hotel_alpha74(
  p_registro_id uuid,
  p_anotacion_id uuid,
  p_version integer,
  p_texto text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_nombre text;
  v_seguimiento_id uuid;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_request_id text := btrim(coalesce(p_request_id, ''));
  v_nota public.anotaciones_manuales_hotel%rowtype;
begin
  if v_actor is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar anotaciones de Hotel'
      using errcode = '42501';
  end if;

  if p_registro_id is null or p_anotacion_id is null or coalesce(p_version, 0) < 1 then
    raise exception 'La identidad de la anotación no es válida'
      using errcode = '22023';
  end if;
  if length(v_texto) not between 1 and 4000 then
    raise exception 'La anotación debe contener entre 1 y 4.000 caracteres'
      using errcode = '22023';
  end if;
  if length(v_request_id) not between 1 and 200 then
    raise exception 'El identificador de la operación no es válido'
      using errcode = '22023';
  end if;

  select r.seguimiento_id
    into v_seguimiento_id
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.id = p_registro_id
    and p.estado = 'en_curso'
    and not r.cancelado
    and not r.retirado_hotel_activo
    and r.estado <> 'reserva_liberada'
  for update of r;
  if v_seguimiento_id is null then
    raise exception 'La ficha ya no está activa en la pizarra actual'
      using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellidos)), ''), 'Usuario')
    into v_actor_nombre
  from public.usuarios u
  where u.id = v_actor and u.activo;
  if v_actor_nombre is null then
    raise exception 'El usuario no está activo' using errcode = '42501';
  end if;

  select n.*
    into v_nota
  from public.anotaciones_manuales_hotel n
  where n.id = p_anotacion_id
    and n.seguimiento_id = v_seguimiento_id
    and not n.cancelada
  for update;
  if v_nota.id is null then
    raise exception 'La anotación no pertenece a esta ficha o ya fue retirada'
      using errcode = 'P0002';
  end if;
  if v_nota.version <> p_version then
    raise exception 'La anotación cambió desde que se abrió; actualiza la ficha y vuelve a intentarlo'
      using errcode = '40001';
  end if;

  perform set_config('app.request_id', v_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-alpha74-anotacion-directa', true);
  perform set_config(
    'app.audit_reason',
    'Anotación modificada desde Hotel sin abrir la edición completa',
    true
  );

  update public.anotaciones_manuales_hotel n
  set texto = v_texto,
      modificado_por = v_actor,
      modificador_nombre = v_actor_nombre,
      version = n.version + 1,
      actualizado_en = clock_timestamp()
  where n.id = v_nota.id
    and n.version = p_version
    and not n.cancelada
  returning n.* into v_nota;
  if v_nota.id is null then
    raise exception 'La anotación cambió durante el guardado; actualiza la ficha y vuelve a intentarlo'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_nota.id,
    'seguimiento_id', v_nota.seguimiento_id,
    'texto', v_nota.texto,
    'version', v_nota.version,
    'actualizado_en', v_nota.actualizado_en,
    'modificador_nombre', v_nota.modificador_nombre
  );
end;
$function$;

create or replace function app_private.eliminar_anotacion_hotel_alpha74(
  p_registro_id uuid,
  p_anotacion_id uuid,
  p_version integer,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_nombre text;
  v_seguimiento_id uuid;
  v_request_id text := btrim(coalesce(p_request_id, ''));
  v_nota public.anotaciones_manuales_hotel%rowtype;
begin
  if v_actor is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para eliminar anotaciones de Hotel'
      using errcode = '42501';
  end if;

  if p_registro_id is null or p_anotacion_id is null or coalesce(p_version, 0) < 1 then
    raise exception 'La identidad de la anotación no es válida'
      using errcode = '22023';
  end if;
  if length(v_request_id) not between 1 and 200 then
    raise exception 'El identificador de la operación no es válido'
      using errcode = '22023';
  end if;

  select r.seguimiento_id
    into v_seguimiento_id
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.id = p_registro_id
    and p.estado = 'en_curso'
    and not r.cancelado
    and not r.retirado_hotel_activo
    and r.estado <> 'reserva_liberada'
  for update of r;
  if v_seguimiento_id is null then
    raise exception 'La ficha ya no está activa en la pizarra actual'
      using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellidos)), ''), 'Usuario')
    into v_actor_nombre
  from public.usuarios u
  where u.id = v_actor and u.activo;
  if v_actor_nombre is null then
    raise exception 'El usuario no está activo' using errcode = '42501';
  end if;

  select n.*
    into v_nota
  from public.anotaciones_manuales_hotel n
  where n.id = p_anotacion_id
    and n.seguimiento_id = v_seguimiento_id
    and not n.cancelada
  for update;
  if v_nota.id is null then
    raise exception 'La anotación no pertenece a esta ficha o ya fue retirada'
      using errcode = 'P0002';
  end if;
  if v_nota.version <> p_version then
    raise exception 'La anotación cambió desde que se abrió; actualiza la ficha y vuelve a intentarlo'
      using errcode = '40001';
  end if;

  perform set_config('app.request_id', v_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-alpha74-anotacion-directa', true);
  perform set_config(
    'app.audit_reason',
    'Anotación retirada desde Hotel sin abrir la edición completa',
    true
  );

  update public.anotaciones_manuales_hotel n
  set cancelada = true,
      motivo_cancelacion = 'Eliminada desde Hotel por un usuario autorizado',
      cancelada_en = clock_timestamp(),
      cancelada_por = v_actor,
      modificado_por = v_actor,
      modificador_nombre = v_actor_nombre,
      version = n.version + 1,
      actualizado_en = clock_timestamp()
  where n.id = v_nota.id
    and n.version = p_version
    and not n.cancelada
  returning n.* into v_nota;
  if v_nota.id is null then
    raise exception 'La anotación cambió durante el guardado; actualiza la ficha y vuelve a intentarlo'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_nota.id,
    'seguimiento_id', v_nota.seguimiento_id,
    'cancelada', v_nota.cancelada,
    'version', v_nota.version,
    'cancelada_en', v_nota.cancelada_en
  );
end;
$function$;

create or replace function public.actualizar_anotacion_hotel_alpha74(
  p_registro_id uuid,
  p_anotacion_id uuid,
  p_version integer,
  p_texto text,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.actualizar_anotacion_hotel_alpha74($1, $2, $3, $4, $5);
$function$;

create or replace function public.eliminar_anotacion_hotel_alpha74(
  p_registro_id uuid,
  p_anotacion_id uuid,
  p_version integer,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.eliminar_anotacion_hotel_alpha74($1, $2, $3, $4);
$function$;

revoke all on function app_private.actualizar_anotacion_hotel_alpha74(uuid, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function app_private.actualizar_anotacion_hotel_alpha74(uuid, uuid, integer, text, text)
  to authenticated, service_role;

revoke all on function app_private.eliminar_anotacion_hotel_alpha74(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function app_private.eliminar_anotacion_hotel_alpha74(uuid, uuid, integer, text)
  to authenticated, service_role;

revoke all on function public.actualizar_anotacion_hotel_alpha74(uuid, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.actualizar_anotacion_hotel_alpha74(uuid, uuid, integer, text, text)
  to authenticated, service_role;

revoke all on function public.eliminar_anotacion_hotel_alpha74(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.eliminar_anotacion_hotel_alpha74(uuid, uuid, integer, text)
  to authenticated, service_role;
