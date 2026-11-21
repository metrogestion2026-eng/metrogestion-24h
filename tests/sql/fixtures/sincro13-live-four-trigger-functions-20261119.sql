-- SINCRO13 / READ-ONLY capture of 4 current trigger functions from Supabase TEST.
-- 2026-11-19. Function source only: no data rows, user identities or tokens.
-- Install ONLY in newly created isolated PostgreSQL17 test DB, never connected.
CREATE OR REPLACE FUNCTION app_private.auditar_cambio_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
  v_origen text;
  v_request_id text;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_id := new.id;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_id := new.id;
  else
    v_old := to_jsonb(old);
    v_id := old.id;
  end if;

  v_origen := coalesce(
    nullif(current_setting('app.audit_origin', true), ''),
    nullif(app_private.request_header('x-client-info'), ''),
    'sql'
  );
  v_request_id := coalesce(
    nullif(current_setting('app.request_id', true), ''),
    nullif(app_private.request_header('x-request-id'), '')
  );

  insert into public.auditoria_cambios (
    tabla, registro_id, accion, datos_anteriores, datos_nuevos,
    usuario_id, origen, request_id
  ) values (
    tg_table_name,
    v_id,
    tg_op,
    v_old,
    v_new,
    auth.uid(),
    v_origen,
    v_request_id
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.bloquear_recogida_manteniment_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if new.tipo_etapa = 'recogida_taller'
     and new.etapa_origen_id is not null
     and app_private.etapa_manteniment_sin_recogida_alpha74(new.etapa_origen_id) then
    return null;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.heredar_control_marcado_rapido_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_source public.etapas_hotel%rowtype;
begin
  if coalesce(current_setting('app.clonando_pizarra', true), '') <> '1' then
    return new;
  end if;

  select e.* into v_source
  from public.etapas_hotel e
  join public.registros_hotel r on r.id = e.registro_hotel_id
  join public.pizarras p on p.id = r.pizarra_id
  where e.seguimiento_id = new.seguimiento_id
  order by p.fecha desc, e.actualizado_en desc, e.creado_en desc, e.id desc
  limit 1;

  if found then
    new.marcado_rapido := v_source.marcado_rapido;
    new.marcado_rapido_en := v_source.marcado_rapido_en;
    new.marcado_rapido_por := v_source.marcado_rapido_por;
    new.datos_pendientes := v_source.datos_pendientes;
    new.datos_completados_en := v_source.datos_completados_en;
    new.datos_completados_por := v_source.datos_completados_por;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.preparar_grupo_documental_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_seguimiento uuid;
  v_clave text;
  v_ordinal integer;
begin
  if new.grupo_documental_id is not null then
    return new;
  end if;

  select seguimiento_id into v_seguimiento
  from public.registros_hotel
  where id = new.registro_hotel_id;

  if v_seguimiento is null then
    new.grupo_documental_id := gen_random_uuid();
    return new;
  end if;

  v_clave := app_private.clave_documental_etapa(
    new.tipo_etapa, new.accion_sistema, new.taller_id, new.centro_taller_id, new.lugar, new.nombre
  );

  select count(*) + 1 into v_ordinal
  from public.etapas_hotel e
  where e.registro_hotel_id = new.registro_hotel_id
    and app_private.clave_documental_etapa(
      e.tipo_etapa, e.accion_sistema, e.taller_id, e.centro_taller_id, e.lugar, e.nombre
    ) = v_clave;

  new.grupo_documental_id := app_private.uuid_documental_determinista(
    v_seguimiento::text || '|' || v_clave || '|' || v_ordinal::text
  );
  return new;
end;
$function$;
