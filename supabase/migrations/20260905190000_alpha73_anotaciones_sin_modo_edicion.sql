-- Alpha73: alta independiente de anotaciones desde Hotel sin desbloquear la
-- edición completa de la ficha. La operación es auditada e idempotente.

alter table public.anotaciones_manuales_hotel
  add column if not exists request_id text;

create unique index if not exists anotaciones_manuales_hotel_request_uq
  on public.anotaciones_manuales_hotel (request_id)
  where request_id is not null;

create or replace function app_private.crear_anotacion_hotel_alpha73(
  p_registro_id uuid,
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
    raise exception 'No tienes permiso para añadir anotaciones de Hotel'
      using errcode = '42501';
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
    and r.estado <> 'reserva_liberada';
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

  select n.* into v_nota
  from public.anotaciones_manuales_hotel n
  where n.request_id = v_request_id;
  if found then
    if v_nota.registro_origen_id is distinct from p_registro_id
      or v_nota.autor_id is distinct from v_actor
      or v_nota.texto is distinct from v_texto then
      raise exception 'El identificador de la operación ya se utilizó para otra anotación'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true,
      'idempotente', true,
      'id', v_nota.id,
      'seguimiento_id', v_nota.seguimiento_id,
      'texto', v_nota.texto,
      'fecha_evento', v_nota.fecha_evento,
      'autor_nombre', v_nota.autor_nombre,
      'version', v_nota.version
    );
  end if;

  perform set_config('app.request_id', v_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-alpha73-anotacion-directa', true);
  perform set_config(
    'app.audit_reason',
    'Anotación añadida desde Hotel sin abrir la edición completa',
    true
  );

  insert into public.anotaciones_manuales_hotel (
    seguimiento_id,
    registro_origen_id,
    texto,
    origen,
    autor_id,
    autor_nombre,
    modificado_por,
    modificador_nombre,
    request_id
  ) values (
    v_seguimiento_id,
    p_registro_id,
    v_texto,
    'manual',
    v_actor,
    v_actor_nombre,
    v_actor,
    v_actor_nombre,
    v_request_id
  )
  on conflict (request_id) where request_id is not null do nothing
  returning * into v_nota;

  if v_nota.id is null then
    select n.* into v_nota
    from public.anotaciones_manuales_hotel n
    where n.request_id = v_request_id;
    if v_nota.id is null
      or v_nota.registro_origen_id is distinct from p_registro_id
      or v_nota.autor_id is distinct from v_actor
      or v_nota.texto is distinct from v_texto then
      raise exception 'No se pudo confirmar la anotación'
        using errcode = '40001';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotente', false,
    'id', v_nota.id,
    'seguimiento_id', v_nota.seguimiento_id,
    'texto', v_nota.texto,
    'fecha_evento', v_nota.fecha_evento,
    'autor_nombre', v_nota.autor_nombre,
    'version', v_nota.version
  );
end;
$function$;

create or replace function public.crear_anotacion_hotel_alpha73(
  p_registro_id uuid,
  p_texto text,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.crear_anotacion_hotel_alpha73($1, $2, $3);
$function$;

revoke all on function app_private.crear_anotacion_hotel_alpha73(uuid, text, text)
  from public, anon, authenticated;
grant execute on function app_private.crear_anotacion_hotel_alpha73(uuid, text, text)
  to authenticated, service_role;

revoke all on function public.crear_anotacion_hotel_alpha73(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.crear_anotacion_hotel_alpha73(uuid, text, text)
  to authenticated, service_role;
