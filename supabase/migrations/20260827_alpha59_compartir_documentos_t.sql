begin;

alter table public.documentos_gestion_historial
  drop constraint if exists documentos_gestion_historial_accion_check;

alter table public.documentos_gestion_historial
  add constraint documentos_gestion_historial_accion_check
  check (accion in ('creado','modificado','anulado','restaurado','compartido'));

create or replace function app_private.registrar_comparticion_documento_t(
  p_documento_id uuid,
  p_modo text,
  p_caducidad_minutos integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_doc public.documentos_gestion%rowtype;
  v_modo text := lower(btrim(coalesce(p_modo, '')));
  v_motivo text;
begin
  if auth.uid() is null
     or not public.usuario_activo()
     or not public.dispositivo_autorizado() then
    raise exception 'Sesión o dispositivo no autorizado';
  end if;

  if not (
    public.puede_ver_modulo('hotel')
    or public.puede_ver_modulo('historico')
    or public.puede_ver_modulo('documentacion')
  ) then
    raise exception 'No tienes permiso para compartir documentación';
  end if;

  select * into v_doc
  from public.documentos_gestion
  where id = p_documento_id;

  if not found then
    raise exception 'Documento no encontrado';
  end if;
  if v_doc.cancelado then
    raise exception 'Un documento anulado no se puede compartir';
  end if;
  if v_modo not in ('archivo','enlace','copiado') then
    raise exception 'Modo de compartición no válido';
  end if;
  if coalesce(p_caducidad_minutos, 0) < 0 or coalesce(p_caducidad_minutos, 0) > 1440 then
    raise exception 'Caducidad no válida';
  end if;

  v_motivo := case v_modo
    when 'archivo' then 'Archivo compartido directamente desde Documentos de esta T'
    when 'enlace' then format('Enlace temporal compartido desde Documentos de esta T; caducidad: %s minutos', p_caducidad_minutos)
    else format('Enlace temporal copiado desde Documentos de esta T; caducidad: %s minutos', p_caducidad_minutos)
  end;

  insert into public.documentos_gestion_historial(
    documento_id,
    accion,
    motivo,
    datos_anteriores,
    datos_nuevos,
    usuario_id
  ) values (
    v_doc.id,
    'compartido',
    v_motivo,
    null,
    jsonb_build_object(
      'modo', v_modo,
      'caducidad_minutos', coalesce(p_caducidad_minutos, 0),
      'nombre', coalesce(v_doc.nombre_mostrado, v_doc.nombre_original)
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'ok', true,
    'documento_id', v_doc.id,
    'modo', v_modo,
    'caducidad_minutos', coalesce(p_caducidad_minutos, 0)
  );
end;
$$;

create or replace function public.registrar_comparticion_documento_t(
  p_documento_id uuid,
  p_modo text,
  p_caducidad_minutos integer default 60
)
returns jsonb
language sql
set search_path = pg_catalog, app_private
as $$
  select app_private.registrar_comparticion_documento_t(
    p_documento_id,
    p_modo,
    p_caducidad_minutos
  );
$$;

revoke all on function public.registrar_comparticion_documento_t(uuid,text,integer) from public;
revoke all on function public.registrar_comparticion_documento_t(uuid,text,integer) from anon;
grant execute on function public.registrar_comparticion_documento_t(uuid,text,integer) to authenticated;

commit;
