-- Native recovery fixture only; not a migration or deployment script.
-- Runtime definitions inspected read-only on 2026-10-28. No operational rows.
-- Load AFTER createLocalFixture(): it replaces only recovery-critical doubles.
-- RPC and release helper are exact catalog definitions. Trigger/type helpers
-- are exact earlier runtime captures. Function hashes are checked below.
-- Local owner is metrogestion_test. The latest three RPC/release captures
-- record production owner postgres; older trigger captures contain no owner.
-- Trigger-helper EXECUTE grants below are restrictive fixture policy, not an
-- assertion about uncaptured production trigger ACLs.
-- Auth/admin/device remain controllable synthetic guards; audit, documents,
-- MANTENIMENT transport and unrelated editor services remain declared doubles.
BEGIN;
SET LOCAL check_function_bodies=on;

CREATE TABLE public.catalogo_estados_etapa_hotel(
 codigo text PRIMARY KEY,estado_operativo text NOT NULL,activo boolean NOT NULL DEFAULT true);
INSERT INTO public.catalogo_estados_etapa_hotel(codigo,estado_operativo)
 SELECT x,x FROM unnest(ARRAY['pendiente','programada','en_curso','realizada','anulada']) AS t(x);

-- Test-only role check; the RPC's actual authorization branch is unchanged.
CREATE OR REPLACE FUNCTION public.es_administrador_principal()
 RETURNS boolean LANGUAGE sql STABLE AS $fixture$
 SELECT coalesce(nullif(current_setting('test.primary_admin',true),'')::boolean,true)
$fixture$;

CREATE TABLE app_private.test_recovery_function_manifest(
 signature text PRIMARY KEY,definition_md5 text NOT NULL,
 security_definer boolean NOT NULL,configuration text[] NOT NULL,
 source_owner text);

-- Runtime pg_get_functiondef MD5: 49521a172e5a8f8c4c66add7854ee1d4
CREATE OR REPLACE FUNCTION app_private.liberar_sustituto_registro(p_registro_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v public.registros_hotel%rowtype;
begin
  select * into v from public.registros_hotel where id=p_registro_id;
  if not found then return; end if;

  if v.tipo_sustituto='RESERVA' and btrim(coalesce(v.vehiculo_reserva,''))<>'' then
    update public.reservas_hotel r
    set estado=case when btrim(coalesce(r.pendientes,''))='' then 'libre' else 'disponible_con_pendientes' end,
        modificado_por=coalesce(auth.uid(),r.modificado_por)
    where r.vehiculo_codigo=v.vehiculo_reserva and r.activo=true;
  end if;
end;
$function$;
REVOKE ALL ON FUNCTION app_private.liberar_sustituto_registro(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.liberar_sustituto_registro(uuid) TO authenticated,service_role;
INSERT INTO app_private.test_recovery_function_manifest VALUES ('app_private.liberar_sustituto_registro(uuid)','49521a172e5a8f8c4c66add7854ee1d4',true,ARRAY['search_path=pg_catalog, public, app_private'],'postgres');

-- Runtime pg_get_functiondef MD5: 21fa71dfc7b1278696c2b14ee8e7f3b5
CREATE OR REPLACE FUNCTION app_private.marcar_t_realizada_rapida(p_etapa_id uuid, p_version integer, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_stage public.etapas_hotel%rowtype;
  v_saved public.etapas_hotel%rowtype;
  v_board_state text;
  v_record_state text;
  v_now timestamptz := clock_timestamp();
  v_effect text;
  v_audit_count integer := 0;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede marcar rápidamente una T como realizada';
  end if;

  if p_etapa_id is null or p_version is null then
    raise exception 'No se ha identificado la T o su versión';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de operación no válido';
  end if;

  select e.* into v_stage
  from public.etapas_hotel e
  where e.id = p_etapa_id
  for update;

  if not found then
    raise exception 'La T indicada no existe';
  end if;

  select p.estado into v_board_state
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.id = v_stage.registro_hotel_id;

  if v_board_state <> 'en_curso' then
    raise exception 'El marcado rápido solo está disponible en la Pizarra actual';
  end if;
  if v_stage.version <> p_version then
    raise exception 'La T ha cambiado desde que se cargó. Recarga la Pizarra antes de confirmarla.';
  end if;
  if v_stage.cancelado or v_stage.estado = 'anulada' then
    raise exception 'Una T anulada no puede marcarse como realizada';
  end if;
  if v_stage.estado = 'realizada' then
    raise exception 'Esta T ya está marcada como realizada';
  end if;

  perform 1
  from public.registros_hotel
  where id = v_stage.registro_hotel_id
  for update;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-stage-quick-complete', true);
  perform set_config(
    'app.audit_reason',
    format('Marcado rápido de la T %s como realizada', v_stage.posicion),
    true
  );

  update public.etapas_hotel
  set estado = 'realizada',
      fecha_fin_real = v_now,
      fecha_real = v_now,
      marcado_rapido = true,
      marcado_rapido_en = v_now,
      marcado_rapido_por = auth.uid(),
      datos_pendientes = true,
      datos_completados_en = null,
      datos_completados_por = null,
      modificado_por = auth.uid()
  where id = p_etapa_id
    and version = p_version
  returning * into v_saved;

  if not found then
    raise exception 'La T cambió antes de confirmarse. Recarga la Pizarra.';
  end if;

  select estado into v_record_state
  from public.registros_hotel
  where id = v_saved.registro_hotel_id;

  v_effect := case
    when v_saved.accion_sistema = 'recuperar_y_liberar'
      then 'T realizada; ruta recuperada y sustituto liberado'
    when v_saved.accion_sistema = 'liberar_reserva'
      then 'T realizada y reserva liberada'
    when v_saved.tipo_etapa = 'recogida_taller'
      then 'Recogida realizada con fecha y hora de salida registradas'
    else 'T marcada como realizada'
  end;

  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'efecto', v_effect,
    'registro_estado', v_record_state,
    'datos_pendientes', true,
    'etapa', to_jsonb(v_saved),
    'eventos_auditoria', v_audit_count
  );
end;
$function$;
REVOKE ALL ON FUNCTION app_private.marcar_t_realizada_rapida(uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.marcar_t_realizada_rapida(uuid,integer,text) TO authenticated,service_role;
INSERT INTO app_private.test_recovery_function_manifest VALUES ('app_private.marcar_t_realizada_rapida(uuid,integer,text)','21fa71dfc7b1278696c2b14ee8e7f3b5',true,ARRAY['search_path=pg_catalog, public, app_private'],'postgres');

-- Runtime pg_get_functiondef MD5: ce0192619de18a93d1d8742e70c717fd
CREATE OR REPLACE FUNCTION app_private.capturar_estado_registro_antes_realizar_t()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_registro public.registros_hotel%rowtype;
begin
  if coalesce(current_setting('app.clonando_pizarra', true), '') = '1' then
    return new;
  end if;

  if new.cancelado
     or new.estado <> 'realizada'
     or (tg_op = 'UPDATE' and old.estado = 'realizada' and not old.cancelado)
  then
    return new;
  end if;

  select r.* into v_registro
  from public.registros_hotel r
  where r.id = new.registro_hotel_id;

  if found then
    new.estado_registro_antes_realizar := v_registro.estado;
    new.retirado_hotel_antes_realizar := v_registro.retirado_hotel_activo;
    new.fecha_retirado_hotel_antes_realizar := v_registro.fecha_retirado_hotel;
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION app_private.capturar_estado_registro_antes_realizar_t() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.capturar_estado_registro_antes_realizar_t() TO service_role;
INSERT INTO app_private.test_recovery_function_manifest VALUES ('app_private.capturar_estado_registro_antes_realizar_t()','ce0192619de18a93d1d8742e70c717fd',true,ARRAY['search_path=pg_catalog, public'],NULL);

-- Runtime pg_get_functiondef MD5: 460e02de322ec403a628175f3eb13b94
CREATE OR REPLACE FUNCTION app_private.normalizar_control_marcado_rapido_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.cancelado = true or new.estado <> 'realizada' then
    new.datos_pendientes := false;
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION app_private.normalizar_control_marcado_rapido_etapa() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.normalizar_control_marcado_rapido_etapa() TO service_role;
INSERT INTO app_private.test_recovery_function_manifest VALUES ('app_private.normalizar_control_marcado_rapido_etapa()','460e02de322ec403a628175f3eb13b94',false,ARRAY['search_path=pg_catalog, public'],NULL);

-- Runtime pg_get_functiondef MD5: 98d6aa8c281a8bc6ca6ea32d719163d6
CREATE OR REPLACE FUNCTION app_private.sincronizar_catalogo_estado_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_context_id uuid;
  v_payload jsonb;
  v_codigo text;
  v_operativo text;
  v_editor_save boolean;
  v_reconciliacion_automatica boolean;
begin
  begin
    v_context_id := nullif(
      current_setting('app.hotel_catalogos_registro_id', true),
      ''
    )::uuid;
    v_payload := coalesce(
      nullif(current_setting('app.hotel_catalogos_etapas', true), '')::jsonb,
      '[]'::jsonb
    );
    v_editor_save := current_setting('app.audit_origin', true) = 'metrogestion-r1-editor';
    v_reconciliacion_automatica :=
      coalesce(current_setting('app.reconciliando_etapas', true), '') = '1'
      or coalesce(current_setting('app.audit_origin', true), '') like 'manteniment-alpha74-%';
  exception when others then
    v_context_id := null;
    v_payload := '[]'::jsonb;
    v_editor_save := false;
    v_reconciliacion_automatica := false;
  end;

  if coalesce(v_editor_save, false) and not v_reconciliacion_automatica
    and pg_trigger_depth() = 1 and v_context_id = new.registro_hotel_id then
    select nullif(btrim(value->>'estado_catalogo_codigo'), '')
      into v_codigo
    from jsonb_array_elements(v_payload)
    where nullif(value->>'id', '') = new.id::text
    limit 1;

    if v_codigo is null and v_editor_save then
      select nullif(btrim(value->>'estado_catalogo_codigo'), '')
        into v_codigo
      from jsonb_array_elements(v_payload)
      where nullif(value->>'id', '') is null
        and nullif(value->>'posicion', '')::integer = new.posicion
      limit 1;
    end if;
  end if;

  if v_codigo is not null then
    select c.estado_operativo
      into v_operativo
    from public.catalogo_estados_etapa_hotel c
    where c.codigo = v_codigo
      and c.activo = true;

    if v_operativo is null or v_operativo <> new.estado then
      raise exception 'El estado personalizado de la T no corresponde con su estado operativo';
    end if;
    new.estado_catalogo_codigo := v_codigo;
  elsif tg_op = 'INSERT' then
    new.estado_catalogo_codigo := new.estado;
  elsif new.estado is distinct from old.estado
    and new.estado_catalogo_codigo is not distinct from old.estado_catalogo_codigo then
    new.estado_catalogo_codigo := new.estado;
  end if;

  select c.estado_operativo
    into v_operativo
  from public.catalogo_estados_etapa_hotel c
  where c.codigo = new.estado_catalogo_codigo
    and c.activo = true;

  if (v_operativo is null or v_operativo <> new.estado)
    and v_reconciliacion_automatica
    and v_codigo is null then
    new.estado_catalogo_codigo := new.estado;
    select c.estado_operativo
      into v_operativo
    from public.catalogo_estados_etapa_hotel c
    where c.codigo = new.estado_catalogo_codigo
      and c.activo = true;
  end if;

  if v_operativo is null or v_operativo <> new.estado then
    raise exception 'El estado visible de la T no es válido';
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION app_private.sincronizar_catalogo_estado_etapa() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.sincronizar_catalogo_estado_etapa() TO service_role;
INSERT INTO app_private.test_recovery_function_manifest VALUES ('app_private.sincronizar_catalogo_estado_etapa()','98d6aa8c281a8bc6ca6ea32d719163d6',false,ARRAY['search_path=pg_catalog, public'],NULL);

-- Runtime pg_get_functiondef MD5: 735fb56feeeb5499b92df573cb676640
CREATE OR REPLACE FUNCTION app_private.modalidad_codigo_rec001(p_registro_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE v_codigo text; v_target text:=current_setting('app.rec001_registro_id',true);
BEGIN
 SELECT r.modalidad_operativa INTO v_codigo FROM public.registros_hotel r WHERE r.id=p_registro_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_target=p_registro_id::text THEN RETURN nullif(btrim(coalesce(current_setting('app.hotel_modalidad_operativa',true),'')),''); END IF;
 RETURN nullif(btrim(v_codigo),'');
END $function$;
REVOKE ALL ON FUNCTION app_private.modalidad_codigo_rec001(uuid) FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO app_private.test_recovery_function_manifest VALUES ('app_private.modalidad_codigo_rec001(uuid)','735fb56feeeb5499b92df573cb676640',true,ARRAY['search_path=pg_catalog, public, app_private'],NULL);

-- Runtime pg_get_functiondef MD5: 6f055a0b468add80130122f2e37492a8
CREATE OR REPLACE FUNCTION public.marcar_t_realizada_rapida(p_etapa_id uuid, p_version integer, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.marcar_t_realizada_rapida(
    p_etapa_id,
    p_version,
    p_request_id
  );
$function$;
REVOKE ALL ON FUNCTION public.marcar_t_realizada_rapida(uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.marcar_t_realizada_rapida(uuid,integer,text) TO authenticated,service_role;
INSERT INTO app_private.test_recovery_function_manifest VALUES ('public.marcar_t_realizada_rapida(uuid,integer,text)','6f055a0b468add80130122f2e37492a8',false,ARRAY['search_path=pg_catalog, app_private'],'postgres');

DO $fixture_check$
DECLARE f record; p record;
BEGIN
 FOR f IN SELECT * FROM app_private.test_recovery_function_manifest LOOP
  SELECT md5(pg_get_functiondef(x.oid)) AS digest,x.prosecdef,x.proconfig
    INTO STRICT p FROM pg_proc x WHERE x.oid=f.signature::regprocedure;
  IF p.digest<>f.definition_md5 OR p.prosecdef IS DISTINCT FROM f.security_definer
     OR p.proconfig IS DISTINCT FROM f.configuration THEN
   RAISE EXCEPTION 'Recovery fixture runtime drift: %',f.signature;
  END IF;
 END LOOP;
END $fixture_check$;
COMMIT;
