BEGIN;
-- MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001 / approved 2026-10-29.
-- Requires PARADAS-002 (SHA256 60cfff3ae8fd99818d88748080073a100ab52582eb4bc8dbcf5c02b8ce548092).
-- A separate subsequent migration installs the fail-closed MANTENIMENT barrier.
-- No backfill, historical PA rewrite, monthly snapshot rewrite or sync is run.
SET LOCAL search_path=public,pg_catalog;
CREATE TEMP TABLE continuidad_alpha75_function_security ON COMMIT DROP AS
 SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile FROM pg_proc p WHERE false;
CREATE TEMP TABLE continuidad_alpha75_view_security ON COMMIT DROP AS
 SELECT c.oid,c.relowner,c.relacl,c.reloptions FROM pg_class c WHERE false;
DO $preflight$
DECLARE x record; n oid;
BEGIN
 IF to_regclass('app_private.sustitucion_continuidades_alpha75') IS NOT NULL THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: instalación previa o parcial; revisar antes de repetir' USING ERRCODE='55000';
 END IF;
 FOR x IN SELECT * FROM(VALUES ('app_private.asegurar_recuperacion_final()','176d3a1705163ead04d0b41d07ee1fc6'),('app_private.calcular_estado_reserva_hotel(text)','da06e782cd2a2513445ec3e75e1f6025'),('app_private.cerrar_modalidad_hotel_sin_recuperacion(uuid)','cc93fdcb271889d0e4579fb5b339aa23'),('app_private.consolidar_rec001(uuid)','057aead4ac98bdd200a28ef40ea36b33'),('app_private.guardar_ficha_hotel_edicion_alpha72(uuid,integer,jsonb,jsonb,text)','b807a719cec96f77b40fe35a993bdf9f'),('app_private.liberar_sustituto_registro(uuid)','49521a172e5a8f8c4c66add7854ee1d4'),('app_private.proteger_sustitucion_paradas002()','fb29cdc9f5d6421a0f730debd64096be'),('app_private.reconciliar_etapas_hotel(uuid,text)','0d8d719c5755d270cf73c72622ef3903')) e(firma,huella) LOOP
  n:=to_regprocedure(x.firma);
  IF n IS NULL OR md5(pg_get_functiondef(n))<>x.huella THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: deriva de función %, requiere revisión',x.firma USING ERRCODE='55000';
  END IF;
  INSERT INTO continuidad_alpha75_function_security SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile FROM pg_proc p WHERE p.oid=n;
 END LOOP;
 FOR x IN SELECT * FROM(VALUES ('public.facturacion_dfm_periodos','391cc436c4bd29c65fd97c4babb62627'),('public.hotel_actual','c6c0229f836d4760307a24d96534a1df'),('public.hotel_actual_detalle','f9f5f4c579b9905dd31d58bd38171401'),('public.hotel_por_dia','75d9b2d85366dff38e45d3c8e713769d'),('public.paradas_sustitucion_resumen','799e539b5cd19c51d3faf2f5dad4deb6')) e(nombre,huella) LOOP
  n:=to_regclass(x.nombre);
  IF n IS NULL OR md5(pg_get_viewdef(n,true))<>x.huella OR NOT EXISTS(
    SELECT 1 FROM pg_class WHERE oid=n AND 'security_invoker=true'=ANY(reloptions)) THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: deriva de vista %, requiere revisión',x.nombre USING ERRCODE='55000';
  END IF;
  INSERT INTO continuidad_alpha75_view_security SELECT c.oid,c.relowner,c.relacl,c.reloptions FROM pg_class c WHERE c.oid=n;
 END LOOP;
END $preflight$;

-- MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001. Explicit links, never a physical return.
CREATE TABLE app_private.sustitucion_continuidades_alpha75 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL,
 request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 huella_prevision text NOT NULL CHECK(huella_prevision ~ '^[a-f0-9]{64}$'),
 origen_registro_id uuid NOT NULL REFERENCES public.registros_hotel(id),
 origen_seguimiento_id uuid NOT NULL UNIQUE,
 origen_numero_parada text NOT NULL,
 origen_version integer NOT NULL CHECK(origen_version>0),
 origen_identidad jsonb NOT NULL CHECK(jsonb_typeof(origen_identidad)='object'),
 destino_registro_id uuid NOT NULL REFERENCES public.registros_hotel(id),
 destino_seguimiento_id uuid NOT NULL UNIQUE,
 destino_numero_parada text NOT NULL,
 destino_version integer NOT NULL CHECK(destino_version>0),
 destino_identidad jsonb NOT NULL CHECK(jsonb_typeof(destino_identidad)='object'),
 etapa_entrada_id uuid NOT NULL REFERENCES public.etapas_hotel(id),
 etapa_entrada_seguimiento_id uuid NOT NULL UNIQUE,
 etapa_entrada_version integer NOT NULL CHECK(etapa_entrada_version>0),
 afectado_dfm text NOT NULL CHECK(btrim(afectado_dfm)<>'' AND afectado_dfm !~ '^R'),
 sustituto_dfm text NOT NULL CHECK(btrim(sustituto_dfm)<>''),
 sustituto_matricula text NOT NULL DEFAULT '',
 tipo_sustituto text NOT NULL CHECK(tipo_sustituto IN ('RESERVA','FLOTA')),
 fecha_hora_entrada timestamptz NOT NULL,
 dia_entrada date NOT NULL,
 origen_inicio_imputacion date NOT NULL,
 confirmado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(origen_seguimiento_id<>destino_seguimiento_id),
 CHECK(origen_registro_id<>destino_registro_id),
 CHECK(dia_entrada=(fecha_hora_entrada AT TIME ZONE 'Europe/Madrid')::date),
 CHECK(dia_entrada>=origen_inicio_imputacion),
 UNIQUE(actor_id,request_id)
);
CREATE INDEX sustitucion_continuidades_alpha75_sustituto_idx
 ON app_private.sustitucion_continuidades_alpha75(sustituto_dfm);
CREATE INDEX sustitucion_continuidades_alpha75_matricula_idx
 ON app_private.sustitucion_continuidades_alpha75(sustituto_matricula)
 WHERE sustituto_matricula<>'';
ALTER TABLE app_private.sustitucion_continuidades_alpha75 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.sustitucion_continuidades_alpha75 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.normalizar_dfm_continuidad_alpha75(p_valor text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $function$
 SELECT regexp_replace(upper(btrim(coalesce(p_valor,''))),'[[:space:]]+','','g')
$function$;
CREATE FUNCTION app_private.normalizar_matricula_continuidad_alpha75(p_valor text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $function$
 SELECT regexp_replace(upper(btrim(coalesce(p_valor,''))),'[^A-Z0-9]+','','g')
$function$;
CREATE FUNCTION app_private.seguimiento_con_continuidad_sustitucion_alpha75(p_seguimiento_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
 SELECT EXISTS(SELECT 1 FROM app_private.sustitucion_continuidades_alpha75 c
   WHERE c.origen_seguimiento_id=p_seguimiento_id OR c.destino_seguimiento_id=p_seguimiento_id)
$function$;
CREATE FUNCTION app_private.es_titular_continuidad_alpha75(p_seguimiento_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
 SELECT NOT EXISTS(SELECT 1 FROM app_private.sustitucion_continuidades_alpha75 c
   WHERE c.origen_seguimiento_id=p_seguimiento_id)
$function$;
CREATE FUNCTION app_private.bloquear_sync_continuidad_alpha75()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('MG75-CONTINUIDAD-001:manteniment-sync',0));
END $function$;
CREATE FUNCTION app_private.bloquear_seguimientos_continuidad_alpha75(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
DECLARE v_id uuid;
BEGIN
 FOR v_id IN SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('MG75-CONTINUIDAD-001:seguimiento:'||v_id::text,0));
 END LOOP;
END $function$;
-- Replaced only by the separately reviewed MANTENIMENT barrier migration.
-- A partial installation cannot confirm continuity with the legacy protocol.
CREATE FUNCTION app_private.validar_sync_continuidad_alpha75(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
BEGIN
 RAISE EXCEPTION 'CONTINUIDAD-001: falta instalar la barrera de sincronización de continuidad; no se ha modificado ninguna PA'
  USING ERRCODE='55000';
END $function$;
CREATE FUNCTION app_private.exigir_permiso_continuidad_alpha75(p_editar boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.usuario_activo() OR NOT public.dispositivo_autorizado()
    OR (coalesce(p_editar,false) AND NOT public.puede_editar_modulo('hotel'))
    OR (NOT coalesce(p_editar,false) AND NOT(public.puede_ver_modulo('hotel') OR public.puede_ver_modulo('historico'))) THEN
  RAISE EXCEPTION 'No tienes permiso para consultar o confirmar la continuidad de sustitución' USING ERRCODE='42501';
 END IF;
END $function$;
CREATE FUNCTION app_private.identidad_continuidad_alpha75(p_registro public.registros_hotel)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'pg_catalog','public','app_private' AS $function$
 SELECT jsonb_build_object('id',p_registro.id,'seguimiento_id',p_registro.seguimiento_id,
  'numero_parada',p_registro.numero_parada,'version',p_registro.version,
  'dfm',p_registro.vehiculo_sustituido,'matricula',p_registro.matricula_sustituido,
  'sustituto',p_registro.vehiculo_reserva,'matricula_sustituto',p_registro.matricula_reserva,
  'tipo_sustituto',p_registro.tipo_sustituto)
$function$;
CREATE FUNCTION app_private.resolver_sustituto_continuidad_alpha75(p_dfm text,p_matricula text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
DECLARE d text:=app_private.normalizar_dfm_continuidad_alpha75(p_dfm);
 m text:=app_private.normalizar_matricula_continuidad_alpha75(p_matricula); x record;
BEGIN
 FOR x IN SELECT DISTINCT app_private.normalizar_dfm_continuidad_alpha75(v.dfm) AS dfm,
   app_private.normalizar_matricula_continuidad_alpha75(v.matricula) AS matricula
   FROM public.vehiculos_hotel_autocompletar v
   WHERE (d<>'' AND app_private.normalizar_dfm_continuidad_alpha75(v.dfm)=d)
      OR (m<>'' AND app_private.normalizar_matricula_continuidad_alpha75(v.matricula)=m)
 LOOP
  IF (d<>'' AND x.dfm<>'' AND d<>x.dfm) OR (m<>'' AND x.matricula<>'' AND m<>x.matricula) THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: DFM y matrícula no identifican un único sustituto' USING ERRCODE='23514';
  END IF;
  d:=coalesce(nullif(d,''),x.dfm); m:=coalesce(nullif(m,''),x.matricula);
 END LOOP;
 IF coalesce(d,'')='' THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: falta una identidad inequívoca del sustituto' USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object('dfm',d,'matricula',coalesce(m,''));
END $function$;

-- Private read primitive: no input payload and no arbitrary ledger-row output.
CREATE FUNCTION app_private.metadatos_continuidad_alpha75(p_seguimiento_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
DECLARE i app_private.sustitucion_continuidades_alpha75%rowtype;
 o app_private.sustitucion_continuidades_alpha75%rowtype;
 v_final uuid; r public.registros_hotel%rowtype; v_owner jsonb; v_recuperacion date;
 v_estado text; v_vigente boolean:=false;
BEGIN
 SELECT * INTO i FROM app_private.sustitucion_continuidades_alpha75 WHERE destino_seguimiento_id=p_seguimiento_id;
 SELECT * INTO o FROM app_private.sustitucion_continuidades_alpha75 WHERE origen_seguimiento_id=p_seguimiento_id;
 WITH RECURSIVE cadena AS (
  SELECT p_seguimiento_id AS seguimiento,ARRAY[p_seguimiento_id] AS camino
  UNION ALL
  SELECT c.destino_seguimiento_id,ca.camino||c.destino_seguimiento_id
  FROM cadena ca JOIN app_private.sustitucion_continuidades_alpha75 c ON c.origen_seguimiento_id=ca.seguimiento
  WHERE NOT c.destino_seguimiento_id=ANY(ca.camino)
 ) SELECT seguimiento INTO v_final FROM cadena ORDER BY cardinality(camino) DESC LIMIT 1;
 SELECT h.* INTO r FROM public.registros_hotel h JOIN public.pizarras p ON p.id=h.pizarra_id
  WHERE h.seguimiento_id=v_final ORDER BY (p.estado='en_curso') DESC,p.fecha DESC,h.actualizado_en DESC,h.id DESC LIMIT 1;
 SELECT p.estado INTO v_estado FROM public.pizarras p WHERE p.id=r.pizarra_id;
 IF FOUND AND v_estado='en_curso' AND NOT r.cancelado AND NOT r.retirado_hotel_activo
    AND r.estado NOT IN('recuperado','reserva_liberada','anulado')
    AND (btrim(r.vehiculo_reserva)<>'' OR btrim(r.matricula_reserva)<>'') THEN
  v_owner:=jsonb_build_object('id',r.id,'seguimiento_id',r.seguimiento_id,'numero_parada',r.numero_parada);
  v_vigente:=v_final=p_seguimiento_id;
 END IF;
 IF i.id IS NOT NULL AND o.id IS NULL THEN
  -- The final destination ends only at an accredited real recovery, never at
  -- the previous PA's handover or a monthly accounting cutoff.
  SELECT max((coalesce(e.fecha_real,e.fecha_fin_real) AT TIME ZONE 'Europe/Madrid')::date)
    INTO v_recuperacion FROM public.etapas_hotel e JOIN public.registros_hotel h ON h.id=e.registro_hotel_id
    JOIN public.pizarras p ON p.id=h.pizarra_id
    WHERE h.seguimiento_id=p_seguimiento_id AND NOT h.cancelado AND NOT e.cancelado
      AND e.estado='realizada' AND app_private.es_recuperacion_rec001(to_jsonb(e))
      AND coalesce(e.fecha_real,e.fecha_fin_real) IS NOT NULL;
 END IF;
 RETURN jsonb_build_object('continuidad_entrada_id',i.id,'continuidad_salida_id',o.id,
  'continuidad_origen_seguimiento_id',i.origen_seguimiento_id,'continuidad_origen_numero_parada',i.origen_numero_parada,
  'continuidad_destino_seguimiento_id',o.destino_seguimiento_id,'continuidad_destino_numero_parada',o.destino_numero_parada,
  'fecha_inicio_imputacion',i.dia_entrada,
  'fecha_fin_imputacion',CASE WHEN o.id IS NOT NULL THEN o.dia_entrada-1 ELSE v_recuperacion END,
  'fin_imputacion_motivo',CASE WHEN o.id IS NOT NULL THEN 'continuidad' WHEN v_recuperacion IS NOT NULL THEN 'recuperacion' ELSE '' END,
  'propietario_actual',v_owner,'propietario_sustitucion_seguimiento_id',CASE WHEN v_owner IS NOT NULL THEN v_final END,
  'sustitucion_vigente',v_vigente);
END $function$;
-- Invoker views retain their existing RLS. This small definer exposes only
-- their authorized continuity projection; direct ledger SELECT stays revoked.
CREATE FUNCTION app_private.proyectar_continuidad_sustitucion_alpha75(p_seguimiento_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
BEGIN
 IF coalesce(current_setting('role',true),'')='authenticated'
   OR (session_user<>current_user AND coalesce(current_setting('role',true),'')<>'service_role') THEN
  IF auth.uid() IS NULL OR NOT public.usuario_activo() OR NOT public.dispositivo_autorizado()
    OR NOT(public.puede_ver_modulo('hotel') OR public.puede_ver_modulo('historico')
      OR public.puede_ver_modulo('resumen') OR public.puede_ver_modulo('listados')) THEN
   RAISE EXCEPTION 'No tienes permiso para consultar la proyección de sustitución' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN app_private.metadatos_continuidad_alpha75(p_seguimiento_id);
END $function$;

CREATE FUNCTION app_private.historial_continuidad_alpha75(p_seguimiento_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object('continuidad_id',c.id,
  'origen_id',c.origen_registro_id,'origen_seguimiento_id',c.origen_seguimiento_id,'origen_numero_parada',c.origen_numero_parada,
  'destino_id',c.destino_registro_id,'destino_seguimiento_id',c.destino_seguimiento_id,'destino_numero_parada',c.destino_numero_parada,
  'etapa_entrada_id',c.etapa_entrada_id,'etapa_entrada_seguimiento_id',c.etapa_entrada_seguimiento_id,
  'fecha_hora_entrada',c.fecha_hora_entrada,'dia_entrada',c.dia_entrada,'confirmado_en',c.confirmado_en)
  ORDER BY c.confirmado_en,c.id),'[]'::jsonb)
 FROM app_private.sustitucion_continuidades_alpha75 c
 WHERE c.origen_seguimiento_id=p_seguimiento_id OR c.destino_seguimiento_id=p_seguimiento_id
$function$;

CREATE FUNCTION app_private.bloqueo_continuidad_alpha75(p_codigo text,p_mensaje text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $function$
 SELECT jsonb_build_array(jsonb_build_object('codigo',p_codigo,'mensaje',p_mensaje))
$function$;

CREATE FUNCTION app_private.previsualizar_continuidad_sustitucion_alpha75(
 p_destino_id uuid,p_origen_id uuid DEFAULT NULL,p_etapa_entrada_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
DECLARE d public.registros_hotel%rowtype; o public.registros_hotel%rowtype;
 e public.etapas_hotel%rowtype; s record; p public.cierres_facturacion%rowtype;
 b jsonb:='[]'; entradas jsonb; origenes jsonb; prevision jsonb; identidad_sustituto jsonb;
 contexto jsonb; propietario jsonb; meta jsonb; v_control jsonb; v_huella text;
 v_dia date; v_inicio date; v_hoy date:=(clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date;
 v_dfm text; v_n integer; v_estado text; v_comportamiento text;
BEGIN
 PERFORM app_private.exigir_permiso_continuidad_alpha75(false);
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 SELECT * INTO d FROM public.registros_hotel WHERE id=p_destino_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTINUIDAD-001: PA destino no encontrada' USING ERRCODE='P0002'; END IF;
 IF p_origen_id IS NOT NULL THEN SELECT * INTO o FROM public.registros_hotel WHERE id=p_origen_id; END IF;
 PERFORM app_private.bloquear_seguimientos_continuidad_alpha75(ARRAY[d.seguimiento_id,o.seguimiento_id]);
 v_dfm:=app_private.normalizar_dfm_continuidad_alpha75(d.vehiculo_sustituido);
 IF EXISTS(SELECT 1 FROM public.registros_hotel r JOIN public.pizarras pz ON pz.id=r.pizarra_id
   WHERE pz.estado='en_curso' AND r.seguimiento_id IN(d.seguimiento_id,o.seguimiento_id)
   GROUP BY r.seguimiento_id HAVING count(*)>1) THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('COPIAS_ACTUALES_AMBIGUAS','Hay más de una copia actual de la misma PA; revisa sus identidades antes de confirmar.');
 END IF;
 meta:=app_private.metadatos_continuidad_alpha75(d.seguimiento_id);
 propietario:=meta->'propietario_actual';
 SELECT pz.estado INTO v_estado FROM public.pizarras pz WHERE pz.id=d.pizarra_id;
 IF v_estado IS DISTINCT FROM 'en_curso' THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('DESTINO_NO_ACTUAL','La confirmación requiere la PA destino de la Pizarra actual. El historial se conserva para consulta.');
 END IF;
 IF d.cancelado OR d.retirado_hotel_activo OR d.estado IN('recuperado','reserva_liberada','anulado') THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('DESTINO_NO_ACTIVO','La PA destino debe estar activa y sin recuperación física realizada.');
 END IF;
 IF v_dfm='' OR v_dfm ~ '^R' THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('AFECTADO_NO_DFM','Esta operación cubre vehículos afectados DFM. La continuidad de un afectado R y su unidad de facturación requieren otro criterio.');
 END IF;
 IF upper(btrim(d.tipo_movimiento))='24H' OR EXISTS(SELECT 1 FROM public.activaciones_24h a
   WHERE a.registro_hotel_id=d.id OR a.seguimiento_hotel_id=d.seguimiento_id) THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('DESTINO_ES_24H','El taller debe tener su PA independiente de la asistencia 24H.');
 END IF;
 IF nullif(btrim(d.vehiculo_reserva),'') IS NOT NULL OR nullif(btrim(d.matricula_reserva),'') IS NOT NULL
    OR app_private.seguimiento_con_continuidad_sustitucion_alpha75(d.seguimiento_id) THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('DESTINO_CON_ASIGNACION','La PA destino ya tiene una asignación o un vínculo de continuidad. Revisa el historial antes de confirmar.');
 END IF;
 SELECT c.comportamiento INTO v_comportamiento FROM public.catalogo_modalidades_operativas_hotel c
  WHERE c.codigo=d.modalidad_operativa AND c.activo;
 IF v_comportamiento IN('sin_sustitucion','reserva_en_reparacion','reparado_en_ruta') THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('MODALIDAD_DESTINO_INCOMPATIBLE','La modalidad guardada del destino no requiere recuperación de sustituto. Corrígela expresamente en el editor antes de continuar.');
 END IF;
 IF EXISTS(SELECT 1 FROM public.registros_hotel r JOIN public.etapas_hotel x ON x.registro_hotel_id=r.id
   WHERE r.seguimiento_id=d.seguimiento_id AND NOT r.cancelado AND NOT x.cancelado
    AND app_private.es_recuperacion_rec001(to_jsonb(x))
    AND (x.estado='realizada' OR x.fecha_real IS NOT NULL OR x.fecha_fin_real IS NOT NULL OR x.marcado_rapido)) THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('DESTINO_RECUPERADO','El destino ya contiene un hecho real de recuperación; no se reabre mediante una continuidad.');
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'seguimiento_id',x.seguimiento_id,
  'registro_hotel_id',x.registro_hotel_id,'seguimiento_parada_id',d.seguimiento_id,
  'version',x.version,'nombre',x.nombre,'estado',x.estado,'fecha_inicio_real',x.fecha_inicio_real,
  'dia_entrada',(x.fecha_inicio_real AT TIME ZONE 'Europe/Madrid')::date) ORDER BY x.posicion,x.id),'[]')
  INTO entradas FROM public.etapas_hotel x WHERE x.registro_hotel_id=d.id
   AND NOT x.cancelado AND x.estado<>'anulada' AND lower(x.tipo_etapa)='entrada_taller';
 IF jsonb_array_length(entradas)=0 THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('SIN_ENTRADA_TALLER','Guarda primero una T de entrada en taller con su fecha y hora reales en esta PA.');
 END IF;
 SELECT coalesce(jsonb_agg(app_private.identidad_continuidad_alpha75(r) ORDER BY r.numero_parada,r.id),'[]')
  INTO origenes FROM public.registros_hotel r JOIN public.pizarras pz ON pz.id=r.pizarra_id
  WHERE pz.estado='en_curso' AND NOT r.cancelado AND NOT r.retirado_hotel_activo
   AND r.estado NOT IN('recuperado','reserva_liberada','anulado') AND r.seguimiento_id<>d.seguimiento_id
   AND app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_sustituido)=v_dfm
   AND (btrim(r.vehiculo_reserva)<>'' OR btrim(r.matricula_reserva)<>'')
   AND app_private.es_titular_continuidad_alpha75(r.seguimiento_id);
 IF p_origen_id IS NULL THEN
  IF jsonb_array_length(origenes)=0 THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('SIN_ORIGEN_COMPATIBLE','No hay una PA origen vigente con sustituto para este vehículo. No se deduce otra asignación.');
  END IF;
 ELSIF o.id IS NULL THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('ORIGEN_NO_ENCONTRADO','La PA origen seleccionada no existe.');
 ELSE
  SELECT pz.estado INTO v_estado FROM public.pizarras pz WHERE pz.id=o.pizarra_id;
  IF v_estado IS DISTINCT FROM 'en_curso' OR o.cancelado OR o.retirado_hotel_activo
      OR o.estado IN('recuperado','reserva_liberada','anulado') THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('ORIGEN_NO_ACTIVO','La PA origen debe conservar la asignación activa en la Pizarra actual.');
  END IF;
  IF o.seguimiento_id=d.seguimiento_id OR app_private.normalizar_dfm_continuidad_alpha75(o.vehiculo_sustituido)<>v_dfm THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('IDENTIDADES_INCOMPATIBLES','Origen y destino deben ser PA distintas del mismo vehículo afectado.');
  END IF;
  IF NOT app_private.es_titular_continuidad_alpha75(o.seguimiento_id) THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('ORIGEN_YA_CEDIDO','La asignación de esta PA ya continuó en otra PA. Consulta su propietario vigente.');
  END IF;
  IF EXISTS(SELECT 1 FROM public.registros_hotel r JOIN public.etapas_hotel x ON x.registro_hotel_id=r.id
    WHERE r.seguimiento_id=o.seguimiento_id AND NOT x.cancelado AND app_private.es_recuperacion_rec001(to_jsonb(x))
      AND (x.estado='realizada' OR x.fecha_real IS NOT NULL OR x.fecha_fin_real IS NOT NULL OR x.marcado_rapido)) THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('ORIGEN_RECUPERADO','El origen conserva un hecho de recuperación; revisa esa interrupción física antes de confirmar una continuidad.');
  END IF;
  IF nullif(btrim(o.matricula_sustituido),'') IS NOT NULL AND nullif(btrim(d.matricula_sustituido),'') IS NOT NULL
    AND app_private.normalizar_matricula_continuidad_alpha75(o.matricula_sustituido)<>app_private.normalizar_matricula_continuidad_alpha75(d.matricula_sustituido) THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('MATRICULAS_INCOMPATIBLES','Las matrículas guardadas del vehículo afectado no coinciden.');
  END IF;
  IF o.tipo_sustituto NOT IN('RESERVA','FLOTA') THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('TIPO_SUSTITUTO_NO_VALIDO','El origen debe identificar un sustituto real RESERVA o FLOTA.');
  END IF;
  BEGIN
   identidad_sustituto:=app_private.resolver_sustituto_continuidad_alpha75(o.vehiculo_reserva,o.matricula_reserva);
  EXCEPTION WHEN check_violation THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('SUSTITUTO_AMBIGUO',SQLERRM);
  END;
  IF identidad_sustituto IS NOT NULL THEN
   SELECT count(DISTINCT r.seguimiento_id) INTO v_n FROM public.registros_hotel r JOIN public.pizarras pz ON pz.id=r.pizarra_id
    WHERE pz.estado='en_curso' AND NOT r.cancelado AND NOT r.retirado_hotel_activo
     AND r.estado NOT IN('recuperado','reserva_liberada','anulado')
     AND app_private.es_titular_continuidad_alpha75(r.seguimiento_id)
     AND (app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_reserva)=identidad_sustituto->>'dfm'
       OR ((identidad_sustituto->>'matricula')<>'' AND app_private.normalizar_matricula_continuidad_alpha75(r.matricula_reserva)=identidad_sustituto->>'matricula'));
   IF v_n<>1 THEN b:=b||app_private.bloqueo_continuidad_alpha75('PROPIETARIO_AMBIGUO','El sustituto no tiene un único propietario vigente; revisa las asignaciones existentes.'); END IF;
  END IF;
  meta:=app_private.metadatos_continuidad_alpha75(o.seguimiento_id);
  propietario:=coalesce(nullif(meta->'propietario_actual','null'::jsonb),
    jsonb_build_object('id',o.id,'seguimiento_id',o.seguimiento_id,'numero_parada',o.numero_parada));
  SELECT * INTO s FROM public.paradas_sustitucion_resumen x WHERE x.seguimiento_id=o.seguimiento_id;
  IF FOUND THEN v_inicio:=s.fecha_inicio_imputacion; END IF;
  IF v_inicio IS NULL THEN b:=b||app_private.bloqueo_continuidad_alpha75('ORIGEN_SIN_INICIO','El origen no tiene un inicio de imputación acreditado. No se deduce de la fecha de guardado.'); END IF;
 END IF;
 IF p_etapa_entrada_id IS NOT NULL THEN
  SELECT * INTO e FROM public.etapas_hotel WHERE id=p_etapa_entrada_id;
  IF NOT FOUND OR e.registro_hotel_id<>d.id OR e.cancelado OR e.estado='anulada' OR lower(e.tipo_etapa)<>'entrada_taller' THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('ENTRADA_NO_VALIDA','La T elegida debe ser una entrada en taller vigente de la PA destino.');
  ELSIF e.fecha_inicio_real IS NULL THEN
   b:=b||app_private.bloqueo_continuidad_alpha75('ENTRADA_SIN_HECHO_REAL','Guarda la fecha y hora reales de entrada en taller; no se usa el cierre de asistencia ni la fecha del guardado.');
  ELSE
   v_dia:=(e.fecha_inicio_real AT TIME ZONE 'Europe/Madrid')::date;
   IF e.fecha_inicio_real>clock_timestamp() THEN b:=b||app_private.bloqueo_continuidad_alpha75('ENTRADA_FUTURA','Una entrada real confirmada no puede estar en el futuro.'); END IF;
   IF v_inicio IS NOT NULL AND v_dia<v_inicio THEN b:=b||app_private.bloqueo_continuidad_alpha75('ENTRADA_ANTERIOR_AL_ORIGEN','La entrada en taller no puede preceder al inicio imputable del sustituto.'); END IF;
   SELECT count(*) INTO v_n FROM public.cierres_facturacion c WHERE v_dia BETWEEN c.fecha_inicio AND c.fecha_cierre;
   IF v_n<>1 THEN b:=b||app_private.bloqueo_continuidad_alpha75('PERIODO_AMBIGUO','La fecha real debe pertenecer a un único periodo contable configurado.');
   ELSE
    SELECT * INTO p FROM public.cierres_facturacion c WHERE v_dia BETWEEN c.fecha_inicio AND c.fecha_cierre;
    IF p.fecha_cierre<v_hoy THEN b:=b||app_private.bloqueo_continuidad_alpha75('PERIODO_CERRADO','La entrada afecta a un periodo cerrado. Se conservan sus cifras y se requiere revisión específica.'); END IF;
   END IF;
   IF EXISTS(SELECT 1 FROM app_private.manteniment_parada_sync x WHERE x.seguimiento_id IN(o.seguimiento_id,d.seguimiento_id)
     AND (x.dias_parada_manual IS NOT NULL OR x.km_facturables_manual IS NOT NULL OR x.tancament_supervisado)
     AND (x.fecha_corte IS NULL OR x.fecha_corte>=v_dia OR x.fecha_inicio_tramo>=v_dia)) THEN
    b:=b||app_private.bloqueo_continuidad_alpha75('TOTALES_MANUALES_PROTEGIDOS','La continuidad alcanza días, km totales o un cierre supervisado manual. No se recalculan ni se sobrescriben.');
   END IF;
   IF EXISTS(SELECT 1 FROM public.facturacion_tancament_cierres f
     WHERE f.presente_en_manteniment AND f.fecha_fin_tramo>=v_dia AND
      (f.seguimiento_id IN(o.seguimiento_id,d.seguimiento_id)
       OR (app_private.normalizar_dfm_continuidad_alpha75(f.dfm)=v_dfm
         AND regexp_replace(coalesce(f.numero_parada,''),'^PA-','','i') IN(o.numero_parada,d.numero_parada)))) THEN
    b:=b||app_private.bloqueo_continuidad_alpha75('SNAPSHOT_PROTEGIDO','Hay un tramo TANCAMENT capturado alcanzado por esta continuidad. Se conserva exactamente para revisión.');
   END IF;
  END IF;
 END IF;
 BEGIN
  PERFORM app_private.validar_sync_continuidad_alpha75(array_remove(ARRAY[o.seguimiento_id,d.seguimiento_id],NULL));
 EXCEPTION WHEN SQLSTATE '55000' THEN
  b:=b||app_private.bloqueo_continuidad_alpha75('SINCRONIZACION_NO_SEGURA',SQLERRM);
 END;
 IF o.id IS NOT NULL AND e.id IS NOT NULL AND e.registro_hotel_id=d.id THEN
  SELECT jsonb_build_object(
   'manuales',(SELECT coalesce(jsonb_agg(jsonb_build_object('seguimiento_id',x.seguimiento_id,
     'dias',x.dias_parada_manual,'km',x.km_facturables_manual,'supervisado',x.tancament_supervisado,
     'tancament',x.tancament,'corte',x.fecha_corte,'inicio_tramo',x.fecha_inicio_tramo) ORDER BY x.seguimiento_id),'[]')
     FROM app_private.manteniment_parada_sync x WHERE x.seguimiento_id IN(o.seguimiento_id,d.seguimiento_id)),
   'medias',(SELECT coalesce(jsonb_agg(jsonb_build_object('seguimiento_id',x.seguimiento_id,'km_dia',x.km_dia,
     'fuente',x.km_dia_fuente) ORDER BY x.seguimiento_id),'[]') FROM public.paradas_sustitucion_resumen x
     WHERE x.seguimiento_id IN(o.seguimiento_id,d.seguimiento_id))) INTO v_control;
  prevision:=jsonb_build_object('origen',app_private.identidad_continuidad_alpha75(o),
   'destino',app_private.identidad_continuidad_alpha75(d),
   'entrada',jsonb_build_object('id',e.id,'seguimiento_id',e.seguimiento_id,'registro_hotel_id',e.registro_hotel_id,
     'seguimiento_parada_id',d.seguimiento_id,'version',e.version,'nombre',e.nombre,'estado',e.estado,
     'fecha_inicio_real',e.fecha_inicio_real,'dia_entrada',v_dia),
   'fecha_hora_entrada',e.fecha_inicio_real,'dia_entrada',v_dia,'fecha_referencia',v_hoy,
   'periodo',CASE WHEN p.periodo IS NOT NULL THEN to_jsonb(p) END,
   'tramo_origen',jsonb_build_object('fecha_inicio_imputacion',v_inicio,'fecha_fin_imputacion',v_dia-1,
     'dias_imputables',CASE WHEN v_inicio IS NULL OR v_dia IS NULL THEN NULL ELSE greatest(0,v_dia-v_inicio) END),
   'tramo_destino',jsonb_build_object('fecha_inicio_imputacion',v_dia,'fecha_fin_imputacion',NULL,
     'dias_imputables',CASE WHEN v_dia IS NULL THEN NULL ELSE greatest(0,v_hoy-v_dia+1) END));
  v_huella:=encode(sha256(convert_to((prevision||jsonb_build_object('control',v_control,'sustituto',identidad_sustituto))::text,'UTF8')),'hex');
  prevision:=prevision||jsonb_build_object('huella_prevision',v_huella,'bloqueos',b);
 END IF;
 RETURN jsonb_build_object('ok',true,'regla','MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001',
  'destino',app_private.identidad_continuidad_alpha75(d),'origenes',origenes,'entradas',entradas,
  'propietario_actual',propietario,'prevision',prevision,
  'continuidades',app_private.historial_continuidad_alpha75(d.seguimiento_id),
  'bloqueos',b,'confirmable',prevision IS NOT NULL AND jsonb_array_length(b)=0);
END $function$;

CREATE FUNCTION app_private.respuesta_continuidad_alpha75(p_id uuid,p_reutilizada boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
DECLARE c app_private.sustitucion_continuidades_alpha75%rowtype;
 o public.registros_hotel%rowtype; d public.registros_hotel%rowtype; e public.etapas_hotel%rowtype;
 m jsonb; v_fin date; v_hoy date:=(now() AT TIME ZONE 'Europe/Madrid')::date;
BEGIN
 SELECT * INTO STRICT c FROM app_private.sustitucion_continuidades_alpha75 WHERE id=p_id;
 SELECT * INTO o FROM public.registros_hotel WHERE id=c.origen_registro_id;
 SELECT * INTO d FROM public.registros_hotel WHERE id=c.destino_registro_id;
 SELECT * INTO e FROM public.etapas_hotel WHERE id=c.etapa_entrada_id;
 m:=app_private.metadatos_continuidad_alpha75(c.destino_seguimiento_id);
 v_fin:=(m->>'fecha_fin_imputacion')::date;
 RETURN jsonb_build_object('ok',true,'regla','MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001',
  'request_id',c.request_id,'reutilizada',p_reutilizada,'continuidad_id',c.id,
  'origen_id',c.origen_registro_id,'destino_id',c.destino_registro_id,'etapa_entrada_id',c.etapa_entrada_id,
  'propietario_al_confirmar',jsonb_build_object('id',c.destino_registro_id,'seguimiento_id',c.destino_seguimiento_id,
    'numero_parada',c.destino_numero_parada),
  'propietario_actual',m->'propietario_actual',
  'versiones',jsonb_build_object('origen',o.version,'destino',d.version,'entrada',e.version),
  'tramos',jsonb_build_object('origen',jsonb_build_object('fecha_inicio_imputacion',c.origen_inicio_imputacion,
    'fecha_fin_imputacion',c.dia_entrada-1,'dias_imputables',greatest(0,c.dia_entrada-c.origen_inicio_imputacion)),
   'destino',jsonb_build_object('fecha_inicio_imputacion',c.dia_entrada,'fecha_fin_imputacion',v_fin,
    'dias_imputables',greatest(0,coalesce(v_fin,v_hoy)-c.dia_entrada+1))));
END $function$;

CREATE FUNCTION app_private.confirmar_continuidad_sustitucion_alpha75(
 p_origen_id uuid,p_destino_id uuid,p_etapa_entrada_id uuid,
 p_version_origen integer,p_version_destino integer,p_version_entrada integer,
 p_huella_prevision text,p_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private' AS $function$
DECLARE o public.registros_hotel%rowtype; d public.registros_hotel%rowtype; e public.etapas_hotel%rowtype;
 c app_private.sustitucion_continuidades_alpha75%rowtype; v_actor uuid;
 v_payload text; v_pre jsonb; v_sub jsonb; v_key text; v_id uuid; v_dia date;
BEGIN
 PERFORM app_private.exigir_permiso_continuidad_alpha75(true);
 v_actor:=auth.uid();
 IF p_origen_id IS NULL OR p_destino_id IS NULL OR p_etapa_entrada_id IS NULL
   OR p_version_origen IS NULL OR p_version_destino IS NULL OR p_version_entrada IS NULL
   OR least(p_version_origen,p_version_destino,p_version_entrada)<1
   OR p_huella_prevision IS NULL OR p_huella_prevision !~ '^[a-f0-9]{64}$'
   OR p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: identificación, versiones o huella de confirmación no válidas' USING ERRCODE='22023';
 END IF;
 v_payload:=encode(sha256(convert_to(jsonb_build_object('origen',p_origen_id,'destino',p_destino_id,
  'entrada',p_etapa_entrada_id,'version_origen',p_version_origen,'version_destino',p_version_destino,
  'version_entrada',p_version_entrada,'huella',p_huella_prevision)::text,'UTF8')),'hex');
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 PERFORM pg_advisory_xact_lock(hashtextextended('MG75-CONTINUIDAD-001:request:'||v_actor::text||':'||p_request_id,0));
 -- Replay precedes versions and ownership: the first commit changed both.
 SELECT * INTO c FROM app_private.sustitucion_continuidades_alpha75 WHERE actor_id=v_actor AND request_id=p_request_id;
 IF FOUND THEN
  IF c.payload_sha256<>v_payload THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: esta petición ya confirmó otra selección; se conserva el resultado anterior' USING ERRCODE='23514';
  END IF;
  RETURN app_private.respuesta_continuidad_alpha75(c.id,true);
 END IF;
 SELECT * INTO o FROM public.registros_hotel WHERE id=p_origen_id;
 SELECT * INTO d FROM public.registros_hotel WHERE id=p_destino_id;
 IF o.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'CONTINUIDAD-001: PA no encontrada' USING ERRCODE='P0002'; END IF;
 PERFORM app_private.bloquear_seguimientos_continuidad_alpha75(ARRAY[o.seguimiento_id,d.seguimiento_id]);
 -- Existing editor/recovery paths can hold a row before reaching their
 -- trigger. NOWAIT aborts this entire confirmation instead of lock inversion.
 BEGIN
  PERFORM 1 FROM public.registros_hotel WHERE id IN(p_origen_id,p_destino_id) ORDER BY id FOR UPDATE NOWAIT;
  SELECT * INTO e FROM public.etapas_hotel WHERE id=p_etapa_entrada_id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: otra operación está modificando una PA o su entrada; recarga la previsión' USING ERRCODE='40001';
 END;
 SELECT * INTO o FROM public.registros_hotel WHERE id=p_origen_id;
 SELECT * INTO d FROM public.registros_hotel WHERE id=p_destino_id;
 IF e.id IS NULL THEN RAISE EXCEPTION 'CONTINUIDAD-001: T de entrada no encontrada' USING ERRCODE='P0002'; END IF;
 IF o.version<>p_version_origen OR d.version<>p_version_destino OR e.version<>p_version_entrada THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: la PA o la entrada ha cambiado; recarga y revisa la previsión' USING ERRCODE='40001';
 END IF;
 v_sub:=app_private.resolver_sustituto_continuidad_alpha75(o.vehiculo_reserva,o.matricula_reserva);
 FOR v_key IN SELECT k FROM unnest(ARRAY['dfm:'||(v_sub->>'dfm'),
   CASE WHEN (v_sub->>'matricula')<>'' THEN 'mat:'||(v_sub->>'matricula') END]) k WHERE k IS NOT NULL ORDER BY k LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('MG75-PARADAS-002:'||v_key,0));
 END LOOP;
 v_pre:=app_private.previsualizar_continuidad_sustitucion_alpha75(p_destino_id,p_origen_id,p_etapa_entrada_id);
 IF NOT coalesce((v_pre->>'confirmable')::boolean,false) THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: %',coalesce(v_pre#>>'{bloqueos,0,mensaje}','La previsión no permite confirmar') USING ERRCODE='23514';
 END IF;
 IF v_pre#>>'{prevision,huella_prevision}' IS DISTINCT FROM p_huella_prevision THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: han cambiado los hechos, ajustes o el corte; recarga y revisa la previsión' USING ERRCODE='40001';
 END IF;
 PERFORM app_private.validar_sync_continuidad_alpha75(ARRAY[o.seguimiento_id,d.seguimiento_id]);
 v_dia:=(e.fecha_inicio_real AT TIME ZONE 'Europe/Madrid')::date;
 INSERT INTO app_private.sustitucion_continuidades_alpha75(actor_id,request_id,payload_sha256,huella_prevision,
  origen_registro_id,origen_seguimiento_id,origen_numero_parada,origen_version,origen_identidad,
  destino_registro_id,destino_seguimiento_id,destino_numero_parada,destino_version,destino_identidad,
  etapa_entrada_id,etapa_entrada_seguimiento_id,etapa_entrada_version,
  afectado_dfm,sustituto_dfm,sustituto_matricula,tipo_sustituto,fecha_hora_entrada,dia_entrada,origen_inicio_imputacion)
 VALUES(v_actor,p_request_id,v_payload,p_huella_prevision,
  o.id,o.seguimiento_id,o.numero_parada,o.version,app_private.identidad_continuidad_alpha75(o)||jsonb_build_object(
    'fecha_parada',o.fecha_parada,'fecha_entrada',o.fecha_entrada,'tipo_movimiento',o.tipo_movimiento,'modalidad_operativa',o.modalidad_operativa),
  d.id,d.seguimiento_id,d.numero_parada,d.version,app_private.identidad_continuidad_alpha75(d)||jsonb_build_object(
    'fecha_parada',d.fecha_parada,'fecha_entrada',d.fecha_entrada,'tipo_movimiento',d.tipo_movimiento,'modalidad_operativa',d.modalidad_operativa),
  e.id,e.seguimiento_id,e.version,app_private.normalizar_dfm_continuidad_alpha75(o.vehiculo_sustituido),
  v_sub->>'dfm',v_sub->>'matricula',o.tipo_sustituto,e.fecha_inicio_real,v_dia,
  (v_pre#>>'{prevision,tramo_origen,fecha_inicio_imputacion}')::date) RETURNING id INTO v_id;
 -- The private link exists before the normal reservation/sync triggers run.
 -- Historical source fields, every T and both physical starts stay untouched.
 UPDATE public.registros_hotel SET vehiculo_reserva=v_sub->>'dfm',matricula_reserva=v_sub->>'matricula',
  etiqueta_reserva=o.etiqueta_reserva,tipo_sustituto=o.tipo_sustituto,modificado_por=v_actor WHERE id=d.id;
 RETURN app_private.respuesta_continuidad_alpha75(v_id,false);
END $function$;

CREATE FUNCTION app_private.proteger_ledger_continuidad_alpha75()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','app_private' AS $function$
BEGIN
 RAISE EXCEPTION 'CONTINUIDAD-001: los vínculos confirmados son hechos históricos inmutables' USING ERRCODE='23514';
END $function$;
CREATE TRIGGER continuidad_alpha75_inmutable BEFORE UPDATE OR DELETE ON app_private.sustitucion_continuidades_alpha75
 FOR EACH ROW EXECUTE FUNCTION app_private.proteger_ledger_continuidad_alpha75();

CREATE FUNCTION app_private.proteger_registro_continuidad_alpha75()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','app_private' AS $function$
DECLARE c app_private.sustitucion_continuidades_alpha75%rowtype; s uuid; v_fact jsonb; v_origin boolean;
 v_rec boolean; v_expect_dfm text; v_expect_mat text;
BEGIN
 -- Same first lock as confirmation/transport, including previously unlinked
 -- rows: assignment and recovery cannot cross a new link invisibly.
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 s:=CASE WHEN TG_OP='DELETE' THEN OLD.seguimiento_id ELSE NEW.seguimiento_id END;
 IF TG_OP='UPDATE' AND OLD.seguimiento_id IS DISTINCT FROM NEW.seguimiento_id
    AND app_private.seguimiento_con_continuidad_sustitucion_alpha75(OLD.seguimiento_id) THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: no se puede cambiar la identidad de una PA vinculada' USING ERRCODE='23514';
 END IF;
 SELECT * INTO c FROM app_private.sustitucion_continuidades_alpha75
  WHERE origen_seguimiento_id=s OR destino_seguimiento_id=s ORDER BY (origen_seguimiento_id=s) DESC LIMIT 1;
 IF NOT FOUND THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 PERFORM app_private.bloquear_seguimientos_continuidad_alpha75(ARRAY[s]);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CONTINUIDAD-001: no se puede borrar una PA vinculada' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.pizarra_id IS DISTINCT FROM OLD.pizarra_id) THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: la copia histórica conserva su registro y pizarra; el rollover crea una copia con la misma identidad lógica' USING ERRCODE='23514';
 END IF;
 v_origin:=c.origen_seguimiento_id=s;
 v_fact:=CASE WHEN v_origin THEN c.origen_identidad ELSE c.destino_identidad END;
 v_expect_dfm:=CASE WHEN v_origin THEN v_fact->>'sustituto' ELSE c.sustituto_dfm END;
 v_expect_mat:=CASE WHEN v_origin THEN v_fact->>'matricula_sustituto' ELSE c.sustituto_matricula END;
 IF NEW.numero_parada IS DISTINCT FROM v_fact->>'numero_parada'
  OR NEW.vehiculo_sustituido IS DISTINCT FROM v_fact->>'dfm'
  OR NEW.matricula_sustituido IS DISTINCT FROM v_fact->>'matricula'
  OR NEW.vehiculo_reserva IS DISTINCT FROM v_expect_dfm OR NEW.matricula_reserva IS DISTINCT FROM v_expect_mat
  OR NEW.tipo_sustituto IS DISTINCT FROM c.tipo_sustituto
  OR NEW.fecha_parada IS DISTINCT FROM (v_fact->>'fecha_parada')::date
  OR NEW.fecha_entrada IS DISTINCT FROM (v_fact->>'fecha_entrada')::timestamptz
  OR NEW.tipo_movimiento IS DISTINCT FROM v_fact->>'tipo_movimiento'
  OR NEW.modalidad_operativa IS DISTINCT FROM v_fact->>'modalidad_operativa' THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: identidad, fechas físicas, modalidad y sustituto de la PA vinculada requieren revisión específica; el vínculo conserva sus hechos' USING ERRCODE='23514';
 END IF;
 IF NEW.cancelado OR NEW.estado='anulado' THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: no se puede anular una PA con continuidad confirmada' USING ERRCODE='23514';
 END IF;
 IF v_origin AND (NEW.retirado_hotel_activo OR NEW.estado IN('recuperado','reserva_liberada') OR NEW.fecha_retirado_hotel IS NOT NULL) THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: el sustituto continúa en otra PA; su recuperación debe registrarse en el destino vigente' USING ERRCODE='23514';
 END IF;
 IF NOT v_origin THEN
  SELECT EXISTS(SELECT 1 FROM public.registros_hotel r JOIN public.etapas_hotel e ON e.registro_hotel_id=r.id
   WHERE r.seguimiento_id=s AND NOT e.cancelado AND e.estado='realizada'
    AND app_private.es_recuperacion_rec001(to_jsonb(e)) AND coalesce(e.fecha_real,e.fecha_fin_real) IS NOT NULL) INTO v_rec;
  IF (NEW.retirado_hotel_activo OR NEW.estado IN('recuperado','reserva_liberada')) AND NOT v_rec THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: el destino sólo termina con una recuperación real acreditada' USING ERRCODE='23514';
  END IF;
  IF v_rec AND NOT NEW.retirado_hotel_activo AND NEW.estado NOT IN('recuperado','reserva_liberada')
    AND (TG_OP='INSERT' OR EXISTS(SELECT 1 FROM public.pizarras p WHERE p.id=NEW.pizarra_id AND p.estado='en_curso')) THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: una recuperación acreditada impide crear o mover una copia activa del destino' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.retirado_hotel_activo OR OLD.estado IN('recuperado','reserva_liberada'))
     AND (NOT NEW.retirado_hotel_activo OR NEW.estado NOT IN('recuperado','reserva_liberada')) THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: reabrir una continuidad recuperada requiere revisión específica de sus tramos' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $function$;
CREATE TRIGGER aa_continuidad_registro_alpha75 BEFORE INSERT OR UPDATE OR DELETE ON public.registros_hotel
 FOR EACH ROW EXECUTE FUNCTION app_private.proteger_registro_continuidad_alpha75();
-- Validate the final row too: later BEFORE normalizers must not silently
-- replace a linked PA's number, substitute type or other accredited facts.
CREATE TRIGGER zz_continuidad_registro_alpha75 AFTER INSERT OR UPDATE ON public.registros_hotel
 FOR EACH ROW EXECUTE FUNCTION app_private.proteger_registro_continuidad_alpha75();

CREATE FUNCTION app_private.proteger_etapa_continuidad_alpha75()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','app_private' AS $function$
DECLARE c app_private.sustitucion_continuidades_alpha75%rowtype; s uuid; v_etapa uuid; v_parent uuid;
BEGIN
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 IF TG_OP='UPDATE' AND (OLD.registro_hotel_id IS DISTINCT FROM NEW.registro_hotel_id
     OR OLD.seguimiento_id IS DISTINCT FROM NEW.seguimiento_id)
   AND app_private.es_recuperacion_rec001(to_jsonb(OLD)) AND OLD.estado='realizada'
   AND EXISTS(SELECT 1 FROM public.registros_hotel r WHERE r.id=OLD.registro_hotel_id
     AND app_private.seguimiento_con_continuidad_sustitucion_alpha75(r.seguimiento_id)) THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: la recuperación real conserva su PA y su identidad de T' USING ERRCODE='23514';
 END IF;
 v_etapa:=CASE WHEN TG_OP='DELETE' THEN OLD.seguimiento_id ELSE NEW.seguimiento_id END;
 v_parent:=CASE WHEN TG_OP='DELETE' THEN OLD.registro_hotel_id ELSE NEW.registro_hotel_id END;
 SELECT seguimiento_id INTO s FROM public.registros_hotel WHERE id=v_parent;
 IF TG_OP='UPDATE' AND (OLD.seguimiento_id<>NEW.seguimiento_id OR OLD.registro_hotel_id<>NEW.registro_hotel_id)
  AND EXISTS(SELECT 1 FROM app_private.sustitucion_continuidades_alpha75 WHERE etapa_entrada_seguimiento_id=OLD.seguimiento_id) THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: no se puede cambiar la identidad de la entrada confirmada' USING ERRCODE='23514';
 END IF;
 SELECT * INTO c FROM app_private.sustitucion_continuidades_alpha75 WHERE etapa_entrada_seguimiento_id=v_etapa;
 IF FOUND THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CONTINUIDAD-001: no se puede borrar la entrada confirmada' USING ERRCODE='23514'; END IF;
  IF s IS DISTINCT FROM c.destino_seguimiento_id OR NEW.tipo_etapa<>'entrada_taller' OR NEW.cancelado OR NEW.estado='anulada'
    OR NEW.fecha_inicio_real IS DISTINCT FROM c.fecha_hora_entrada THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: la entrada real que fija los tramos no puede borrarse, anularse ni cambiar de fecha o PA' USING ERRCODE='23514';
  END IF;
 END IF;
 IF app_private.seguimiento_con_continuidad_sustitucion_alpha75(s) THEN
  PERFORM app_private.bloquear_seguimientos_continuidad_alpha75(ARRAY[s]);
  IF TG_OP<>'DELETE' AND app_private.es_recuperacion_rec001(to_jsonb(NEW)) THEN
   IF NOT app_private.es_titular_continuidad_alpha75(s) AND (NEW.estado='realizada' OR NEW.fecha_real IS NOT NULL OR NEW.fecha_fin_real IS NOT NULL) THEN
    RAISE EXCEPTION 'CONTINUIDAD-001: esta PA cedió el sustituto; recupera desde el destino vigente' USING ERRCODE='23514';
   END IF;
   IF NEW.estado='realizada' AND coalesce(NEW.fecha_real,NEW.fecha_fin_real) IS NULL THEN
    RAISE EXCEPTION 'CONTINUIDAD-001: la recuperación requiere fecha y hora reales' USING ERRCODE='23514';
   END IF;
   IF NEW.estado='realizada' AND EXISTS(SELECT 1 FROM app_private.sustitucion_continuidades_alpha75 i
     WHERE i.destino_seguimiento_id=s AND (coalesce(NEW.fecha_real,NEW.fecha_fin_real)<i.fecha_hora_entrada
       OR coalesce(NEW.fecha_real,NEW.fecha_fin_real)>clock_timestamp())) THEN
    RAISE EXCEPTION 'CONTINUIDAD-001: la recuperación debe ser real, posterior a la entrada y no futura' USING ERRCODE='23514';
   END IF;
   IF NEW.estado='realizada' AND EXISTS(SELECT 1 FROM public.etapas_hotel x JOIN public.registros_hotel r ON r.id=x.registro_hotel_id
     WHERE r.seguimiento_id=s AND x.id<>NEW.id AND NOT x.cancelado AND x.estado='realizada'
       AND app_private.es_recuperacion_rec001(to_jsonb(x))
       AND (x.seguimiento_id IS DISTINCT FROM NEW.seguimiento_id OR x.fecha_real IS DISTINCT FROM NEW.fecha_real
         OR x.fecha_fin_real IS DISTINCT FROM NEW.fecha_fin_real)) THEN
    RAISE EXCEPTION 'CONTINUIDAD-001: el tramo ya tiene una recuperación real; sólo se admite una copia histórica de la misma T y sus fechas exactas' USING ERRCODE='23514';
   END IF;
  END IF;
  IF TG_OP<>'INSERT' AND app_private.es_recuperacion_rec001(to_jsonb(OLD)) AND OLD.estado='realizada' THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CONTINUIDAD-001: no se borra una recuperación que cierra un tramo confirmado' USING ERRCODE='23514'; END IF;
   IF NEW.cancelado OR NEW.estado<>'realizada' OR NOT app_private.es_recuperacion_rec001(to_jsonb(NEW))
      OR NEW.fecha_real IS DISTINCT FROM OLD.fecha_real OR NEW.fecha_fin_real IS DISTINCT FROM OLD.fecha_fin_real THEN
    RAISE EXCEPTION 'CONTINUIDAD-001: modificar una recuperación contabilizada requiere revisión específica del tramo' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $function$;
CREATE TRIGGER aa_continuidad_etapa_alpha75 BEFORE INSERT OR UPDATE OR DELETE ON public.etapas_hotel
 FOR EACH ROW EXECUTE FUNCTION app_private.proteger_etapa_continuidad_alpha75();
CREATE TRIGGER zz_continuidad_etapa_alpha75 AFTER INSERT OR UPDATE ON public.etapas_hotel
 FOR EACH ROW EXECUTE FUNCTION app_private.proteger_etapa_continuidad_alpha75();

CREATE FUNCTION app_private.proteger_activacion_continuidad_alpha75()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','app_private' AS $function$
BEGIN
 PERFORM app_private.bloquear_sync_continuidad_alpha75();
 IF app_private.seguimiento_con_continuidad_sustitucion_alpha75(OLD.seguimiento_hotel_id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CONTINUIDAD-001: no se borra una asistencia vinculada a una continuidad' USING ERRCODE='23514'; END IF;
  IF (NEW.registro_hotel_id,NEW.seguimiento_hotel_id,NEW.dfm,NEW.matricula,NEW.vehiculo_sustituto,NEW.matricula_sustituto,
      NEW.fecha_activacion,NEW.hora_activacion) IS DISTINCT FROM
     (OLD.registro_hotel_id,OLD.seguimiento_hotel_id,OLD.dfm,OLD.matricula,OLD.vehiculo_sustituto,OLD.matricula_sustituto,
      OLD.fecha_activacion,OLD.hora_activacion) THEN
   RAISE EXCEPTION 'CONTINUIDAD-001: la asistencia conserva su PA, vehículo, sustituto y activación real; el cierre de actuación sigue siendo independiente' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $function$;
CREATE TRIGGER aa_continuidad_activacion_alpha75 BEFORE UPDATE OR DELETE ON public.activaciones_24h
 FOR EACH ROW EXECUTE FUNCTION app_private.proteger_activacion_continuidad_alpha75();

-- Preserve owner, ACL, search_path and all unrelated behavior.
CREATE OR REPLACE FUNCTION app_private.asegurar_recuperacion_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare v_actor uuid; v_last_pos integer; v_name_normalized text;
begin
  if exists(select 1 from public.registros_hotel r where r.id=new.registro_hotel_id
    and not app_private.es_titular_continuidad_alpha75(r.seguimiento_id)) then return new; end if;
  if exists(select 1 from public.registros_hotel r where r.id=new.registro_hotel_id
      and upper(btrim(coalesce(r.tipo_movimiento,'')))='24H') then return new; end if;
  if current_setting('app.clonando_pizarra',true)='1' then return new; end if;
  if current_setting('app.reconciliando_etapas',true)='1' then return new; end if;
  if current_setting('app.audit_origin',true)='metrogestion-r1-editor' then return new; end if;
  if new.cancelado then return new; end if;
  v_name_normalized:=lower(translate(coalesce(new.nombre,''),'áéíóúÁÉÍÓÚ','aeiouAEIOU'));
  if new.accion_sistema='recuperar_y_liberar' or v_name_normalized like 'recuperar ruta%' or v_name_normalized like 'recuperar vehiculo%' then return new; end if;
  if not app_private.modalidad_hotel_requiere_recuperacion(new.registro_hotel_id) then return new; end if;
  if exists(select 1 from public.etapas_hotel e where e.registro_hotel_id=new.registro_hotel_id and e.cancelado=false and e.accion_sistema='recuperar_y_liberar') then return new; end if;
  v_actor:=coalesce(auth.uid(),new.modificado_por,new.creado_por);
  select coalesce(max(e.posicion),0)+1 into v_last_pos from public.etapas_hotel e where e.registro_hotel_id=new.registro_hotel_id and e.cancelado=false;
  insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,cancelado,creado_por,modificado_por,accion_sistema)
  values(new.registro_hotel_id,gen_random_uuid(),'Recuperar ruta y liberar reserva',v_last_pos,'pendiente','otro','',null,null,null,null,'Generada automáticamente como T final de cierre.',false,v_actor,v_actor,'recuperar_y_liberar');
  return new;
end;
$function$
;

-- Preserve owner, ACL, search_path and all unrelated behavior.
CREATE OR REPLACE FUNCTION app_private.calcular_estado_reserva_hotel(p_codigo text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_pendientes text := '';
begin
  if v_codigo = '' then
    return 'libre';
  end if;

  select coalesce(r.pendientes, '')
    into v_pendientes
  from public.reservas_hotel r
  where upper(btrim(r.vehiculo_codigo)) = v_codigo
  limit 1;

  -- Si está asignada como sustituto, está ocupada aunque aún conserve una
  -- ficha propia pendiente de recuperar.
  if exists (
    select 1
    from public.registros_hotel h
    join public.pizarras p on p.id = h.pizarra_id
    where p.estado = 'en_curso'
      and not h.cancelado
      and not h.retirado_hotel_activo
      and h.estado not in ('reserva_liberada', 'recuperado', 'anulado')
      and app_private.es_titular_continuidad_alpha75(h.seguimiento_id)
      and upper(btrim(coalesce(h.vehiculo_reserva, ''))) = v_codigo
  ) then
    return 'ocupada';
  end if;

  if exists (
    select 1
    from public.registros_hotel h
    join public.pizarras p on p.id = h.pizarra_id
    where p.estado = 'en_curso'
      and not h.cancelado
      and not h.retirado_hotel_activo
      and h.estado not in ('reserva_liberada', 'recuperado', 'anulado')
      and upper(btrim(coalesce(h.vehiculo_sustituido, ''))) = v_codigo
  ) then
    return 'fuera_servicio';
  end if;

  if btrim(coalesce(v_pendientes, '')) <> '' then
    return 'disponible_con_pendientes';
  end if;

  return 'libre';
end;
$function$
;

-- Preserve owner, ACL, search_path and all unrelated behavior.
CREATE OR REPLACE FUNCTION app_private.cerrar_modalidad_hotel_sin_recuperacion(p_registro_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE v_codigo text; v_comportamiento text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.registros_hotel r WHERE r.id=p_registro_id
   AND NOT app_private.es_titular_continuidad_alpha75(r.seguimiento_id)) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.registros_hotel r WHERE r.id=p_registro_id
   AND upper(btrim(coalesce(r.tipo_movimiento,'')))='24H') THEN RETURN false; END IF;
 -- Una estancia real abierta impide cualquier cierre automático de la PA.
 IF EXISTS(SELECT 1 FROM public.etapas_hotel e WHERE e.registro_hotel_id=p_registro_id
   AND NOT e.cancelado AND e.tipo_etapa='entrada_taller'
   AND e.fecha_inicio_real IS NOT NULL AND e.fecha_real IS NULL) THEN RETURN false; END IF;
 SELECT app_private.modalidad_codigo_rec001(p_registro_id) INTO v_codigo FROM public.registros_hotel r WHERE r.id=p_registro_id AND NOT r.cancelado FOR UPDATE;
 IF NOT FOUND OR v_codigo IS NULL THEN RETURN false; END IF;
 SELECT c.comportamiento INTO v_comportamiento FROM public.catalogo_modalidades_operativas_hotel c WHERE c.codigo=v_codigo AND c.activo;
 IF v_comportamiento IS NULL OR v_comportamiento='manual' THEN RETURN false; END IF;
 IF NOT app_private.cierre_sin_recuperacion_completo_rec001(p_registro_id) THEN RETURN false; END IF;
 UPDATE public.registros_hotel SET estado='recuperado',retirado_hotel_activo=true,fecha_retirado_hotel=coalesce(fecha_retirado_hotel,clock_timestamp()),modificado_por=coalesce(auth.uid(),modificado_por) WHERE id=p_registro_id AND NOT cancelado AND (estado<>'recuperado' OR NOT retirado_hotel_activo);
 RETURN FOUND;
END $function$
;

-- Preserve owner, ACL, search_path and all unrelated behavior.
CREATE OR REPLACE FUNCTION app_private.consolidar_rec001(p_registro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE r public.registros_hotel%ROWTYPE; v_count integer:=0; v_closed boolean:=false; v_state text; v_model text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.registros_hotel x WHERE x.id=p_registro_id
   AND NOT app_private.es_titular_continuidad_alpha75(x.seguimiento_id)) THEN
  RETURN jsonb_build_object('regla','MG75-CONTINUIDAD-SUSTITUCION-ENTRE-PA-001','anuladas',0,'cerrada',false);
 END IF;
 IF EXISTS(SELECT 1 FROM public.registros_hotel x WHERE x.id=p_registro_id
   AND upper(btrim(coalesce(x.tipo_movimiento,'')))='24H') THEN
   RETURN jsonb_build_object('regla','MG75-24H-PARADAS-SEPARADAS-002','anuladas',0,'cerrada',false);
 END IF;
 SELECT * INTO r FROM public.registros_hotel WHERE id=p_registro_id FOR UPDATE;
 IF NOT FOUND OR r.cancelado OR app_private.modalidad_hotel_requiere_recuperacion(p_registro_id) THEN RETURN jsonb_build_object('regla','REC-001','anuladas',0,'cerrada',false); END IF;
 v_count:=app_private.anular_recuperacion_improcedente_rec001(p_registro_id,coalesce(auth.uid(),r.modificado_por,r.creado_por));
 IF current_setting('app.rec001_reactivando',true) IS DISTINCT FROM '1' THEN v_closed:=app_private.cerrar_modalidad_hotel_sin_recuperacion(p_registro_id); END IF;

 IF NOT v_closed
    AND current_setting('app.rec001_reactivando',true) IS DISTINCT FROM '1'
    AND NOT r.retirado_hotel_activo
    AND r.estado NOT IN ('recuperado','reserva_liberada','anulado')
    AND app_private.modalidad_codigo_rec001(p_registro_id) IS NULL
    AND EXISTS (SELECT 1 FROM public.etapas_hotel e WHERE e.registro_hotel_id=r.id
      AND NOT e.cancelado AND e.estado<>'anulada' AND NOT app_private.es_recuperacion_rec001(to_jsonb(e)))
    AND NOT EXISTS (SELECT 1 FROM public.etapas_hotel e WHERE e.registro_hotel_id=r.id
      AND NOT e.cancelado AND e.estado<>'anulada' AND NOT app_private.es_recuperacion_rec001(to_jsonb(e))
      AND lower(translate(btrim(e.tipo_etapa),'ÁÉÍÓÚáéíóú','AEIOUaeiou')) NOT IN ('gestion','tramite'))
    AND app_private.cierre_sin_recuperacion_completo_rec001(p_registro_id) THEN
   -- GESTIÓN/TRÁMITE puro: la última T cierra su flujo administrativo también
   -- cuando no se ha elegido una modalidad. La decisión completa es del núcleo,
   -- al terminar el guardado, no de un cálculo optimista en el navegador.
   UPDATE public.registros_hotel SET estado='realizada',retirado_hotel_activo=true,
     fecha_retirado_hotel=coalesce(fecha_retirado_hotel,clock_timestamp()),
     modificado_por=coalesce(auth.uid(),modificado_por)
   WHERE id=r.id AND NOT cancelado AND NOT retirado_hotel_activo;
   v_closed:=FOUND;
 END IF;
 IF NOT v_closed AND r.estado='recogido_pendiente_ruta' THEN
   SELECT modelo INTO v_model FROM app_private.hotel_flujo_modelo WHERE seguimiento_id=r.seguimiento_id;
   SELECT CASE
     WHEN v_model='entrada_hitos_v1' AND e.fecha_fin_real IS NOT NULL THEN 'terminado_pendiente_recogida'
     WHEN v_model IS DISTINCT FROM 'entrada_hitos_v1' AND EXISTS(SELECT 1 FROM public.etapas_hotel p WHERE p.registro_hotel_id=r.id AND NOT p.cancelado AND p.tipo_etapa='recogida_taller' AND p.etapa_origen_id=e.id AND p.estado IN('programada','en_curso')) THEN 'terminado_pendiente_recogida'
     ELSE 'en_taller' END
   INTO v_state FROM public.etapas_hotel e WHERE e.registro_hotel_id=r.id AND NOT e.cancelado AND e.tipo_etapa='entrada_taller'
     AND ((v_model='entrada_hitos_v1' AND e.fecha_inicio_real IS NOT NULL AND e.fecha_real IS NULL)
       OR (v_model IS DISTINCT FROM 'entrada_hitos_v1' AND e.estado IN('realizada','en_curso') AND NOT EXISTS(SELECT 1 FROM public.etapas_hotel p WHERE p.registro_hotel_id=r.id AND NOT p.cancelado AND p.tipo_etapa='recogida_taller' AND p.etapa_origen_id=e.id AND p.estado='realizada')))
   ORDER BY e.posicion DESC,e.id LIMIT 1;
   IF v_state IS NULL THEN
     SELECT CASE WHEN lower(e.tipo_etapa)='entrada_taller' THEN CASE WHEN e.fecha_prevista IS NOT NULL THEN 'entrada_taller_programada' ELSE 'pendiente_taller' END WHEN lower(e.tipo_etapa)='24h' THEN 'asistencia_24h' WHEN lower(e.tipo_etapa) IN('gestión','gestion') THEN 'gestion' WHEN lower(e.tipo_etapa) IN('trámite','tramite') THEN 'tramite' ELSE 'pendiente_taller' END
     INTO v_state FROM public.etapas_hotel e WHERE e.registro_hotel_id=r.id AND NOT e.cancelado AND e.estado NOT IN('realizada','anulada') AND NOT app_private.es_recuperacion_rec001(to_jsonb(e)) ORDER BY e.posicion,e.id LIMIT 1;
   END IF;
   IF v_state IS NULL AND EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE (a.registro_hotel_id=r.id OR a.seguimiento_hotel_id=r.seguimiento_id) AND a.estado='abierta') THEN v_state:='asistencia_24h'; END IF;
   UPDATE public.registros_hotel SET estado=coalesce(v_state,'pendiente_taller'),modificado_por=coalesce(auth.uid(),modificado_por) WHERE id=r.id AND estado='recogido_pendiente_ruta';
 END IF;
 RETURN jsonb_build_object('regla','REC-001','anuladas',v_count,'cerrada',v_closed);
END $function$
;

-- Preserve owner, ACL, search_path and all unrelated behavior.
CREATE OR REPLACE FUNCTION app_private.guardar_ficha_hotel_edicion_alpha72(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_before public.registros_hotel%rowtype;
  v_board_state text;
  v_target_board uuid;
  v_requested_state text;
  v_requested_cancelled boolean;
  v_reactivation boolean := false;
  v_reactivated_id uuid;
  v_etapas_reabiertas integer := 0;
  v_codigo text;
  v_ficha_out jsonb := p_ficha;
  v_etapas_out jsonb := p_etapas;
  v_saved jsonb;
  v_version integer;
  v_notas integer;
  v_audit_count integer;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;

  select * into v_before
  from public.registros_hotel
  where id = p_registro_id
  for update;
  if not found then raise exception 'Ficha de Hotel no encontrada'; end if;
  v_codigo := app_private.resolver_modalidad_operativa_hotel(p_ficha->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa',v_codigo,true);
  perform set_config('app.rec001_registro_id',p_registro_id::text,true);
  perform app_private.modalidad_hotel_requiere_recuperacion(p_registro_id);

  select p.estado into v_board_state
  from public.pizarras p
  where p.id = v_before.pizarra_id;
  v_target_board := v_before.pizarra_id;

  v_requested_state := lower(btrim(coalesce(p_ficha->>'estado', v_before.estado)));
  v_requested_cancelled := coalesce((p_ficha->>'cancelado')::boolean, v_before.cancelado);
  v_reactivation := (
      v_before.cancelado
      or v_before.retirado_hotel_activo
      or v_before.estado in ('recuperado', 'reserva_liberada', 'anulado')
    )
    and not v_requested_cancelled
    and v_requested_state not in ('realizada', 'recuperado', 'reserva_liberada', 'anulado');

  perform set_config('app.rec001_reactivando',case when v_reactivation then '1' else '0' end,true);
  if v_reactivation then
    select count(*) into v_etapas_reabiertas
    from public.etapas_hotel e
    where e.registro_hotel_id = p_registro_id
      and not e.cancelado
      and e.accion_sistema in ('recuperar_y_liberar', 'liberar_reserva')
      and (
        e.estado = 'realizada'
        or e.fecha_fin_real is not null
        or e.fecha_real is not null
        or e.marcado_rapido
      );

    if v_board_state = 'archivada' then
      -- El registro historico se conserva retirado. La copia de la Pizarra
      -- actual es la que vuelve a quedar operativa.
      select p.id into v_target_board
      from public.pizarras p
      where p.estado = 'en_curso'
      order by p.fecha desc
      limit 1;
      if v_target_board is null then
        raise exception 'No existe una Pizarra actual en la que reactivar la ficha';
      end if;
      v_ficha_out := jsonb_set(v_ficha_out, '{retirado_hotel_activo}', 'true'::jsonb, true);
    else
      v_ficha_out := jsonb_set(v_ficha_out, '{retirado_hotel_activo}', 'false'::jsonb, true);
      v_etapas_out := app_private.preparar_etapas_reactivacion_hotel(
        p_registro_id,
        p_etapas
      );
    end if;
  end if;

  if app_private.es_titular_continuidad_alpha75(v_before.seguimiento_id)
     and not v_requested_cancelled
     and v_requested_state not in ('realizada', 'recuperado', 'reserva_liberada', 'anulado')
     and nullif(btrim(p_ficha->>'vehiculo_reserva'), '') is not null
     and exists (
       select 1
       from public.registros_hotel r
       where r.id <> p_registro_id
         and app_private.es_titular_continuidad_alpha75(r.seguimiento_id)
         and r.pizarra_id = v_target_board
         and not r.cancelado
         and not r.retirado_hotel_activo
         and r.estado not in ('realizada', 'recuperado', 'reserva_liberada', 'anulado')
         and upper(btrim(r.vehiculo_reserva)) = upper(btrim(p_ficha->>'vehiculo_reserva'))
     ) then
    raise exception 'La reserva % ya esta asignada a otra ficha activa de esta Pizarra', upper(btrim(p_ficha->>'vehiculo_reserva'));
  end if;

  v_codigo := app_private.resolver_modalidad_operativa_hotel(v_ficha_out->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa', v_codigo, true);
  v_saved := app_private.guardar_ficha_hotel_edicion_alpha71(
    p_registro_id,
    p_version,
    v_ficha_out,
    v_etapas_out,
    p_request_id
  );

  update public.registros_hotel
  set modalidad_operativa = v_codigo,
      modificado_por = auth.uid()
  where id = p_registro_id
    and modalidad_operativa is distinct from v_codigo;

  perform set_config('app.request_id', left(p_request_id, 200), true);
  perform set_config('app.audit_origin', 'metrogestion-alpha72-anotaciones', true);
  v_notas := app_private.sincronizar_anotaciones_manuales_hotel(
    p_registro_id,
    coalesce(v_ficha_out->'anotaciones_manuales', '[]'::jsonb)
  );

  if v_reactivation then
    if v_board_state = 'archivada' then
      select r.id into v_reactivated_id
      from public.registros_hotel r
      join public.pizarras p on p.id = r.pizarra_id
      where p.estado = 'en_curso'
        and r.seguimiento_id = v_before.seguimiento_id
      order by p.fecha desc, r.actualizado_en desc, r.id desc
      limit 1;
    else
      v_reactivated_id := p_registro_id;
    end if;

    if v_reactivated_id is null then
      raise exception 'No se ha podido crear o localizar la ficha reactivada en la Pizarra actual';
    end if;

    update public.registros_hotel set modalidad_operativa=v_codigo,modificado_por=auth.uid() where id=v_reactivated_id and modalidad_operativa is distinct from v_codigo;
    perform set_config('app.rec001_registro_id',v_reactivated_id::text,true);
    perform app_private.reabrir_cierre_ficha_hotel(v_reactivated_id, auth.uid());
    perform app_private.consolidar_rec001(v_reactivated_id);

    if not exists (
      select 1
      from public.registros_hotel r
      where r.id = v_reactivated_id
        and not r.cancelado
        and not r.retirado_hotel_activo
        and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
    ) then
      raise exception 'La reactivacion no ha dejado una ficha operativa en la Pizarra actual';
    end if;
  end if;

  if not v_reactivation then perform app_private.consolidar_rec001(p_registro_id); end if;
  perform set_config('app.rec001_registro_id','',true);
  perform set_config('app.rec001_reactivando','0',true);
  select version into v_version
  from public.registros_hotel
  where id = p_registro_id;
  select count(*) into v_audit_count
  from public.auditoria_cambios
  where request_id = p_request_id;

  return v_saved || jsonb_build_object(
    'ok', true,
    'version', v_version,
    'modalidad_operativa', v_codigo,
    'anotaciones_guardadas', v_notas,
    'eventos_auditoria', v_audit_count,
    'reactivacion_coherente', v_reactivation,
    'ficha_activa_id', v_reactivated_id,
    'etapas_reabiertas', v_etapas_reabiertas,
    'detalle', app_private.obtener_ficha_hotel_edicion_alpha72(p_registro_id)
  );
end;
$function$
;

-- Preserve owner, ACL, search_path and all unrelated behavior.
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
  if not app_private.es_titular_continuidad_alpha75(v.seguimiento_id) then return; end if;

  if v.tipo_sustituto='RESERVA' and btrim(coalesce(v.vehiculo_reserva,''))<>'' then
    update public.reservas_hotel r
    set estado=case when app_private.seguimiento_con_continuidad_sustitucion_alpha75(v.seguimiento_id)
          then app_private.calcular_estado_reserva_hotel(r.vehiculo_codigo)
          when btrim(coalesce(r.pendientes,''))='' then 'libre' else 'disponible_con_pendientes' end,
        modificado_por=coalesce(auth.uid(),r.modificado_por)
    where r.vehiculo_codigo=v.vehiculo_reserva and r.activo=true;
  end if;
end;
$function$
;

-- Preserve owner, ACL, search_path and all unrelated behavior.
CREATE OR REPLACE FUNCTION app_private.proteger_sustitucion_paradas002()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE
  v_dfm text:=regexp_replace(upper(btrim(coalesce(NEW.vehiculo_reserva,''))),'[[:space:]]+','','g');
  v_mat text:=regexp_replace(upper(btrim(coalesce(NEW.matricula_reserva,''))),'[^A-Z0-9]+','','g');
  v_catalogo record; v_key text; v_otra text;
BEGIN
  IF NOT app_private.es_titular_continuidad_alpha75(NEW.seguimiento_id) THEN RETURN NEW; END IF;
  IF NEW.cancelado OR NEW.retirado_hotel_activo OR NEW.estado IN ('recuperado','reserva_liberada','anulado')
     OR (v_dfm='' AND v_mat='') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE'
     AND regexp_replace(upper(btrim(coalesce(OLD.vehiculo_reserva,''))),'[[:space:]]+','','g')=v_dfm
     AND regexp_replace(upper(btrim(coalesce(OLD.matricula_reserva,''))),'[^A-Z0-9]+','','g')=v_mat
     AND NOT OLD.cancelado AND NOT OLD.retirado_hotel_activo
     AND OLD.estado NOT IN ('recuperado','reserva_liberada','anulado')
     AND OLD.pizarra_id=NEW.pizarra_id
     AND upper(btrim(OLD.tipo_movimiento))=upper(btrim(NEW.tipo_movimiento)) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pizarras p WHERE p.id=NEW.pizarra_id AND p.estado='en_curso') THEN RETURN NEW; END IF;
  -- Resolver alias conocidos sin modificar datos manuales del formulario.
  FOR v_catalogo IN SELECT v.dfm,v.matricula FROM public.vehiculos_hotel_autocompletar v
    WHERE (v_dfm<>'' AND regexp_replace(upper(btrim(v.dfm)),'[[:space:]]+','','g')=v_dfm)
       OR (v_mat<>'' AND regexp_replace(upper(btrim(v.matricula)),'[^A-Z0-9]+','','g')=v_mat)
  LOOP
    IF v_dfm<>'' AND btrim(coalesce(v_catalogo.dfm,''))<>'' AND v_dfm<>regexp_replace(upper(btrim(v_catalogo.dfm)),'[[:space:]]+','','g')
       OR v_mat<>'' AND btrim(coalesce(v_catalogo.matricula,''))<>'' AND v_mat<>regexp_replace(upper(btrim(v_catalogo.matricula)),'[^A-Z0-9]+','','g') THEN
      RAISE EXCEPTION 'PARADAS-002: DFM y matrícula no identifican un único sustituto' USING ERRCODE='23514';
    END IF;
    v_dfm:=coalesce(nullif(v_dfm,''),regexp_replace(upper(btrim(coalesce(v_catalogo.dfm,''))),'[[:space:]]+','','g'));
    v_mat:=coalesce(nullif(v_mat,''),regexp_replace(upper(btrim(coalesce(v_catalogo.matricula,''))),'[^A-Z0-9]+','','g'));
  END LOOP;
  -- Serializar la asignación de la misma identidad, incluso por alias.
  FOR v_key IN SELECT k FROM unnest(ARRAY[
      CASE WHEN v_dfm<>'' THEN 'dfm:'||v_dfm END,
      CASE WHEN v_mat<>'' THEN 'mat:'||v_mat END]) k WHERE k IS NOT NULL ORDER BY k
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended('MG75-PARADAS-002:'||v_key,0)); END LOOP;
  SELECT r.numero_parada INTO v_otra FROM public.registros_hotel r
    JOIN public.pizarras p ON p.id=r.pizarra_id
    WHERE p.estado='en_curso' AND r.id<>NEW.id
      AND r.seguimiento_id IS DISTINCT FROM NEW.seguimiento_id
      AND app_private.es_titular_continuidad_alpha75(r.seguimiento_id)
      AND NOT r.cancelado AND NOT r.retirado_hotel_activo
      AND r.estado NOT IN ('recuperado','reserva_liberada','anulado')
      AND (app_private.seguimiento_con_continuidad_sustitucion_alpha75(NEW.seguimiento_id)
        OR app_private.seguimiento_con_continuidad_sustitucion_alpha75(r.seguimiento_id)
        OR upper(btrim(coalesce(NEW.tipo_movimiento,'')))='24H'
        OR upper(btrim(coalesce(r.tipo_movimiento,'')))='24H'
        OR EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE a.registro_hotel_id IN (NEW.id,r.id)
          OR a.seguimiento_hotel_id IN (NEW.seguimiento_id,r.seguimiento_id)))
      AND ((v_dfm<>'' AND regexp_replace(upper(btrim(coalesce(r.vehiculo_reserva,''))),'[[:space:]]+','','g')=v_dfm)
        OR (v_mat<>'' AND regexp_replace(upper(btrim(coalesce(r.matricula_reserva,''))),'[^A-Z0-9]+','','g')=v_mat))
    ORDER BY r.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'PARADAS-002: el sustituto continúa asignado en PA-%. La nueva PA no puede duplicar la imputación; registra una continuidad explícita antes de reasignarlo',v_otra USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$
;

-- Preserve owner, ACL, search_path and all unrelated behavior.
CREATE OR REPLACE FUNCTION app_private.reconciliar_etapas_hotel(p_registro_id uuid, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_actor uuid;
  v_entry record;
  v_last_pos integer;
  v_audit_count integer;
  v_active_count integer;
  v_requiere_recuperacion boolean;
  v_dependencias jsonb := '{}'::jsonb;
  v_recogidas_creadas integer := 0;
  v_recogidas_tm_anuladas integer := 0;
  v_recuperaciones_creadas integer := 0;
  v_recuperaciones_anuladas integer := 0;
  v_fechas_actualizadas integer := 0;
  v_manteniment_encolado boolean := false;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;
  perform 1 from public.registros_hotel where id=p_registro_id for update;
  if not found then raise exception 'Ficha de Hotel no encontrada'; end if;

  if exists (
    select 1 from public.registros_hotel r where r.id=p_registro_id
      and r.estado in ('recuperado','reserva_liberada')
  ) and exists (
    select 1 from public.etapas_hotel e where e.registro_hotel_id=p_registro_id
      and not e.cancelado and e.tipo_etapa='entrada_taller'
      and e.fecha_inicio_real is not null and e.fecha_real is null
  ) then
    raise exception 'La parada tiene una entrada de taller activa: no puede quedar Recuperado ni Reserva liberada';
  end if;

  if exists(select 1 from public.registros_hotel r where r.id=p_registro_id
      and upper(btrim(coalesce(r.tipo_movimiento,'')))='24H') then
    return jsonb_build_object('ok',true,'request_id',p_request_id,'eventos_auditoria',0,
      'impacto_operativo',jsonb_build_object('recogidas_anuladas',0,'recogidas_restauradas',0,
        'recogidas_creadas',0,'recuperaciones_creadas',0,'recuperaciones_anuladas',0,
        'fechas_manteniment_actualizadas',0,'manteniment_encolado',false),
      'detalle',public.obtener_ficha_hotel_edicion(p_registro_id));
  end if;
  v_actor:=auth.uid();
  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.audit_origin','metrogestion-r1-reconcile',true);
  perform set_config('app.audit_reason','Aplicación operativa de una T anulada, restaurada o modificada',true);
  perform set_config('app.reconciliando_etapas','1',true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  v_dependencias := app_private.reconciliar_dependencias_t_alpha75(p_registro_id, v_actor);

  -- Retira recogidas pendientes que contradicen la regla operativa de TM
  -- y de los trámites sin recogida.
  update public.etapas_hotel pickup
  set cancelado=true,
      estado='anulada',
      estado_catalogo_codigo='anulada',
      motivo_cancelacion='TM y los trámites LKT/EXTINTOR no generan recogida.',
      cancelado_en=clock_timestamp(),
      cancelado_por=v_actor,
      modificado_por=v_actor
  where pickup.registro_hotel_id=p_registro_id
    and not pickup.cancelado
    and pickup.tipo_etapa='recogida_taller'
    and pickup.estado<>'realizada'
    and pickup.etapa_origen_id is not null
    and app_private.etapa_manteniment_sin_recogida_alpha74(pickup.etapa_origen_id);
  get diagnostics v_recogidas_tm_anuladas = row_count;

  for v_entry in
    select e.id,e.posicion,e.taller_id,e.centro_taller_id,e.lugar
    from public.etapas_hotel e
    where e.registro_hotel_id=p_registro_id and not e.cancelado
      and e.tipo_etapa='entrada_taller' and e.etapa_origen_id is null
      and not app_private.etapa_manteniment_sin_recogida_alpha74(e.id)
      and not exists(select 1 from public.etapas_hotel r where r.etapa_origen_id=e.id and not r.cancelado and r.tipo_etapa='recogida_taller')
    order by e.posicion,e.creado_en,e.id
  loop
    insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,taller_id,centro_taller_id,lugar,observaciones,cancelado,creado_por,modificado_por,etapa_origen_id)
    values(p_registro_id,gen_random_uuid(),'Recogida taller',v_entry.posicion+1,'pendiente','recogida_taller',v_entry.taller_id,v_entry.centro_taller_id,coalesce(v_entry.lugar,''),'Generada automáticamente al crear la entrada a taller.',false,v_actor,v_actor,v_entry.id);
    v_recogidas_creadas := v_recogidas_creadas + 1;
  end loop;

  if not exists(select 1 from public.registros_hotel r where r.id=p_registro_id
    and not app_private.es_titular_continuidad_alpha75(r.seguimiento_id)) then
  v_requiere_recuperacion:=app_private.modalidad_hotel_requiere_recuperacion(p_registro_id);
  if v_requiere_recuperacion then
    if not exists(select 1 from public.etapas_hotel e where e.registro_hotel_id=p_registro_id and not e.cancelado and e.accion_sistema='recuperar_y_liberar') then
      select coalesce(max(e.posicion),0)+1 into v_last_pos from public.etapas_hotel e where e.registro_hotel_id=p_registro_id and not e.cancelado;
      insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,lugar,observaciones,cancelado,creado_por,modificado_por,accion_sistema)
      values(p_registro_id,gen_random_uuid(),'Recuperar ruta y liberar reserva',v_last_pos,'pendiente','otro','','Generada automáticamente como T final de cierre.',false,v_actor,v_actor,'recuperar_y_liberar');
      v_recuperaciones_creadas := 1;
    end if;
  else
    v_recuperaciones_anuladas := app_private.anular_recuperacion_improcedente_rec001(p_registro_id,v_actor);
  end if;

  end if; -- A ceded source preserves all existing recovery tasks unchanged.

  select count(*) into v_active_count from public.etapas_hotel e
  where e.registro_hotel_id=p_registro_id and not e.cancelado;
  if v_active_count>99 then raise exception 'La ficha supera el máximo de 99 T activas'; end if;

  create temp table if not exists tmp_hotel_reconcile_order(stage_id uuid primary key,new_pos integer not null) on commit drop;
  truncate tmp_hotel_reconcile_order;
  insert into tmp_hotel_reconcile_order(stage_id,new_pos)
  select x.id,row_number() over(order by
    case when x.accion_sistema='recuperar_y_liberar' then 1 else 0 end,
    case when x.accion_sistema='recuperar_y_liberar' then 2147483000::bigint
         when x.tipo_etapa='recogida_taller' and p.id is not null then (p.posicion::bigint*2)+1
         else (x.posicion::bigint*2) end,
    x.creado_en,x.id)::integer
  from public.etapas_hotel x left join public.etapas_hotel p on p.id=x.etapa_origen_id
  where x.registro_hotel_id=p_registro_id and not x.cancelado;
  update public.etapas_hotel e set posicion=1000+o.new_pos,modificado_por=v_actor
  from tmp_hotel_reconcile_order o where e.id=o.stage_id;
  update public.etapas_hotel e set posicion=o.new_pos,modificado_por=v_actor
  from tmp_hotel_reconcile_order o where e.id=o.stage_id;

  perform app_private.consolidar_rec001(p_registro_id);
  select exists (
    select 1
    from public.registros_hotel r
    join app_private.manteniment_parada_sync s on s.seguimiento_id = r.seguimiento_id
    where r.id = p_registro_id
  ) into v_manteniment_encolado;
  v_fechas_actualizadas := app_private.recalcular_fechas_manteniment_alpha75(p_registro_id);
  perform set_config('app.reconciliando_etapas','0',true);
  select count(*) into v_audit_count from public.auditoria_cambios where request_id=p_request_id;
  return jsonb_build_object(
    'ok',true,
    'request_id',p_request_id,
    'eventos_auditoria',v_audit_count,
    'impacto_operativo',v_dependencias || jsonb_build_object(
      'recogidas_creadas',v_recogidas_creadas,
      'recogidas_tm_anuladas',v_recogidas_tm_anuladas,
      'recuperaciones_creadas',v_recuperaciones_creadas,
      'recuperaciones_anuladas',v_recuperaciones_anuladas,
      'fechas_manteniment_actualizadas',v_fechas_actualizadas,
      'manteniment_encolado',v_manteniment_encolado
    ),
    'detalle',public.obtener_ficha_hotel_edicion(p_registro_id)
  );
end;
$function$
;

CREATE OR REPLACE VIEW public.paradas_sustitucion_resumen WITH(security_invoker=true) AS
WITH fisico AS (
WITH ranked AS (
         SELECT r.id,
            r.pizarra_id,
            r.seguimiento_id,
            r.numero_parada,
            r.vehiculo_sustituido,
            r.matricula_sustituido,
            r.vehiculo_reserva,
            r.matricula_reserva,
            r.etiqueta_reserva,
            r.tipo_unidad,
            r.marca,
            r.tipo_motor,
            r.modelo,
            r.upc,
            r.telefono,
            r.prioridad,
            r.estado,
            r.lugar,
            r.fecha_parada,
            r.fecha_entrada,
            r.tipo_movimiento,
            r.causa,
            r.trabajos_reserva,
            r.incidencia,
            r.proximo,
            r.observaciones,
            r.sustitucion_temporal,
            r.motivo_sustitucion_temporal,
            r.fecha_limite_sustitucion,
            r.orden,
            r.retirado_hotel_activo,
            r.fecha_retirado_hotel,
            r.cancelado,
            r.motivo_cancelacion,
            r.cancelado_en,
            r.cancelado_por,
            r.version,
            r.creado_por,
            r.modificado_por,
            r.creado_en,
            r.actualizado_en,
            r.tipo_sustituto,
            r.trazo_marron,
            r.modalidad_operativa,
            p.fecha AS fecha_pizarra,
            row_number() OVER (PARTITION BY r.seguimiento_id ORDER BY p.fecha DESC, r.actualizado_en DESC, r.id DESC) AS rn
           FROM registros_hotel r
             JOIN pizarras p ON p.id = r.pizarra_id
        ), latest AS (
         SELECT ranked.id,
            ranked.pizarra_id,
            ranked.seguimiento_id,
            ranked.numero_parada,
            ranked.vehiculo_sustituido,
            ranked.matricula_sustituido,
            ranked.vehiculo_reserva,
            ranked.matricula_reserva,
            ranked.etiqueta_reserva,
            ranked.tipo_unidad,
            ranked.marca,
            ranked.tipo_motor,
            ranked.modelo,
            ranked.upc,
            ranked.telefono,
            ranked.prioridad,
            ranked.estado,
            ranked.lugar,
            ranked.fecha_parada,
            ranked.fecha_entrada,
            ranked.tipo_movimiento,
            ranked.causa,
            ranked.trabajos_reserva,
            ranked.incidencia,
            ranked.proximo,
            ranked.observaciones,
            ranked.sustitucion_temporal,
            ranked.motivo_sustitucion_temporal,
            ranked.fecha_limite_sustitucion,
            ranked.orden,
            ranked.retirado_hotel_activo,
            ranked.fecha_retirado_hotel,
            ranked.cancelado,
            ranked.motivo_cancelacion,
            ranked.cancelado_en,
            ranked.cancelado_por,
            ranked.version,
            ranked.creado_por,
            ranked.modificado_por,
            ranked.creado_en,
            ranked.actualizado_en,
            ranked.tipo_sustituto,
            ranked.trazo_marron,
            ranked.modalidad_operativa,
            ranked.fecha_pizarra,
            ranked.rn
           FROM ranked
          WHERE ranked.rn = 1 AND NOT COALESCE(ranked.cancelado, false) AND ranked.estado <> 'anulado'::text
        ), starts AS (
         SELECT registros_hotel.seguimiento_id,
            min(registros_hotel.fecha_parada) AS fecha_inicio_parada
           FROM registros_hotel
          WHERE NOT COALESCE(registros_hotel.cancelado, false)
          GROUP BY registros_hotel.seguimiento_id
        ), recoveries AS (
         SELECT r.seguimiento_id,
            max((COALESCE(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) AT TIME ZONE 'Europe/Madrid'::text)::date) AS fecha_recuperacion_real
           FROM registros_hotel r
             JOIN etapas_hotel e ON e.registro_hotel_id = r.id
          WHERE NOT COALESCE(r.cancelado, false) AND NOT COALESCE(e.cancelado, false) AND e.estado = 'realizada'::text AND e.tipo_etapa = 'recuperar_ruta'::text AND COALESCE(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) IS NOT NULL
          GROUP BY r.seguimiento_id
        ), base AS (
         SELECT l.id,
            l.pizarra_id,
            l.seguimiento_id,
            l.numero_parada,
            l.vehiculo_sustituido,
            l.matricula_sustituido,
            l.vehiculo_reserva,
            l.matricula_reserva,
            l.etiqueta_reserva,
            l.tipo_unidad,
            l.marca,
            l.tipo_motor,
            l.modelo,
            l.upc,
            l.telefono,
            l.prioridad,
            l.estado,
            l.lugar,
            l.fecha_parada,
            l.fecha_entrada,
            l.tipo_movimiento,
            l.causa,
            l.trabajos_reserva,
            l.incidencia,
            l.proximo,
            l.observaciones,
            l.sustitucion_temporal,
            l.motivo_sustitucion_temporal,
            l.fecha_limite_sustitucion,
            l.orden,
            l.retirado_hotel_activo,
            l.fecha_retirado_hotel,
            l.cancelado,
            l.motivo_cancelacion,
            l.cancelado_en,
            l.cancelado_por,
            l.version,
            l.creado_por,
            l.modificado_por,
            l.creado_en,
            l.actualizado_en,
            l.tipo_sustituto,
            l.trazo_marron,
            l.modalidad_operativa,
            l.fecha_pizarra,
            l.rn,
            s.fecha_inicio_parada,
                CASE
                    WHEN rec.fecha_recuperacion_real IS NOT NULL THEN rec.fecha_recuperacion_real
                    WHEN l.retirado_hotel_activo OR (l.estado = ANY (ARRAY['recuperado'::text, 'reserva_liberada'::text])) THEN COALESCE((l.fecha_retirado_hotel AT TIME ZONE 'Europe/Madrid'::text)::date, l.fecha_pizarra)
                    ELSE NULL::date
                END AS fecha_fin_parada,
            m.km_dia AS km_dia_automatico,
            aj.km_dia_manual,
            COALESCE(aj.km_dia_manual, m.km_dia) AS km_dia,
                CASE
                    WHEN aj.km_dia_manual IS NOT NULL THEN 'MANUAL'::text
                    WHEN m.km_dia IS NOT NULL THEN 'CTM'::text
                    ELSE 'SIN_MEDIA'::text
                END AS km_dia_fuente,
            aj.observaciones AS ajuste_observaciones
           FROM latest l
             JOIN starts s USING (seguimiento_id)
             LEFT JOIN recoveries rec USING (seguimiento_id)
             LEFT JOIN medias_km_dfm m ON m.dfm = l.vehiculo_sustituido
             LEFT JOIN ajustes_sustitucion_parada aj USING (seguimiento_id)
        ), totals AS (
         SELECT b.id,
            b.pizarra_id,
            b.seguimiento_id,
            b.numero_parada,
            b.vehiculo_sustituido,
            b.matricula_sustituido,
            b.vehiculo_reserva,
            b.matricula_reserva,
            b.etiqueta_reserva,
            b.tipo_unidad,
            b.marca,
            b.tipo_motor,
            b.modelo,
            b.upc,
            b.telefono,
            b.prioridad,
            b.estado,
            b.lugar,
            b.fecha_parada,
            b.fecha_entrada,
            b.tipo_movimiento,
            b.causa,
            b.trabajos_reserva,
            b.incidencia,
            b.proximo,
            b.observaciones,
            b.sustitucion_temporal,
            b.motivo_sustitucion_temporal,
            b.fecha_limite_sustitucion,
            b.orden,
            b.retirado_hotel_activo,
            b.fecha_retirado_hotel,
            b.cancelado,
            b.motivo_cancelacion,
            b.cancelado_en,
            b.cancelado_por,
            b.version,
            b.creado_por,
            b.modificado_por,
            b.creado_en,
            b.actualizado_en,
            b.tipo_sustituto,
            b.trazo_marron,
            b.modalidad_operativa,
            b.fecha_pizarra,
            b.rn,
            b.fecha_inicio_parada,
            b.fecha_fin_parada,
            b.km_dia_automatico,
            b.km_dia_manual,
            b.km_dia,
            b.km_dia_fuente,
            b.ajuste_observaciones,
                CASE
                    WHEN b.fecha_inicio_parada IS NULL THEN 0
                    ELSE GREATEST(0, COALESCE(b.fecha_fin_parada, (now() AT TIME ZONE 'Europe/Madrid'::text)::date) - b.fecha_inicio_parada + 1)
                END AS dias_parada_total
           FROM base b
        )
 SELECT seguimiento_id,
    numero_parada,
    NULLIF(vehiculo_sustituido, ''::text) AS unidad,
    NULLIF(matricula_sustituido, ''::text) AS matricula,
    NULLIF(vehiculo_reserva, ''::text) AS sustituto,
    NULLIF(matricula_reserva, ''::text) AS matricula_sustituto,
    tipo_sustituto,
    estado,
    tipo_unidad,
    incidencia,
    causa,
    upc,
    fecha_inicio_parada,
    fecha_fin_parada,
    dias_parada_total,
        CASE
            WHEN COALESCE(vehiculo_sustituido, ''::text) ~ '^R'::text THEN 'R'::text
            ELSE 'DFM'::text
        END AS clase_facturacion,
    km_dia_automatico,
    km_dia_manual,
    km_dia,
    km_dia_fuente,
    ajuste_observaciones,
    NULL::numeric AS km_sustitucion_total
   FROM totals
), datos AS (
 SELECT f.*,app_private.proyectar_continuidad_sustitucion_alpha75(f.seguimiento_id) AS m FROM fisico f
), limites AS (
 SELECT d.*,coalesce((m->>'fecha_inicio_imputacion')::date,fecha_inicio_parada) AS desde,
  CASE WHEN m->>'continuidad_entrada_id' IS NOT NULL OR m->>'continuidad_salida_id' IS NOT NULL
    THEN (m->>'fecha_fin_imputacion')::date ELSE fecha_fin_parada END AS hasta
 FROM datos d
)
SELECT seguimiento_id,numero_parada,unidad,matricula,sustituto,matricula_sustituto,tipo_sustituto,
 estado,tipo_unidad,incidencia,causa,upc,fecha_inicio_parada,fecha_fin_parada,dias_parada_total,
 clase_facturacion,km_dia_automatico,km_dia_manual,km_dia,km_dia_fuente,ajuste_observaciones,km_sustitucion_total,
 desde AS fecha_inicio_imputacion,hasta AS fecha_fin_imputacion,
 CASE WHEN desde IS NULL THEN 0 ELSE greatest(0,coalesce(hasta,(now() AT TIME ZONE 'Europe/Madrid')::date)-desde+1) END AS dias_imputables_total,
 CASE WHEN m->>'continuidad_entrada_id' IS NOT NULL OR m->>'continuidad_salida_id' IS NOT NULL
   THEN m->>'fin_imputacion_motivo' WHEN fecha_fin_parada IS NOT NULL THEN 'recuperacion' ELSE '' END AS fin_imputacion_motivo,
 (m->>'continuidad_entrada_id')::uuid AS continuidad_entrada_id,
 (m->>'continuidad_salida_id')::uuid AS continuidad_salida_id,
 (m->>'continuidad_origen_seguimiento_id')::uuid AS continuidad_origen_seguimiento_id,
 m->>'continuidad_origen_numero_parada' AS continuidad_origen_numero_parada,
 (m->>'continuidad_destino_seguimiento_id')::uuid AS continuidad_destino_seguimiento_id,
 m->>'continuidad_destino_numero_parada' AS continuidad_destino_numero_parada,
 (m->>'propietario_sustitucion_seguimiento_id')::uuid AS propietario_sustitucion_seguimiento_id,
 coalesce((m->>'sustitucion_vigente')::boolean,false) AS sustitucion_vigente
FROM limites;


CREATE OR REPLACE VIEW public.hotel_actual WITH(security_invoker=true) AS
WITH base AS (
SELECT r.id,
    r.pizarra_id,
    p.fecha AS fecha_pizarra,
    r.seguimiento_id,
    r.numero_parada,
    NULLIF(r.vehiculo_sustituido, ''::text) AS dfm,
    NULLIF(r.matricula_sustituido, ''::text) AS matricula,
    NULLIF(r.vehiculo_reserva, ''::text) AS reserva,
    NULLIF(r.matricula_reserva, ''::text) AS matricula_reserva,
    NULLIF(r.vehiculo_reserva, ''::text) AS sustituto,
    NULLIF(r.matricula_reserva, ''::text) AS matricula_sustituto,
    r.tipo_sustituto,
    r.etiqueta_reserva,
    r.etiqueta_reserva AS etiqueta_sustituto,
    r.tipo_unidad,
    r.marca,
    r.tipo_motor,
    r.modelo,
    r.upc,
    r.telefono,
    r.prioridad,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM registros_hotel x
              WHERE x.pizarra_id = r.pizarra_id AND x.id <> r.id AND NOT x.cancelado AND NOT x.retirado_hotel_activo AND (app_private.proyectar_continuidad_sustitucion_alpha75(x.seguimiento_id)->>'sustitucion_vigente')::boolean AND x.tipo_sustituto = 'FLOTA'::text AND regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+'::text, ''::text, 'g'::text) = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+'::text, ''::text, 'g'::text))) THEN 'sustitucion_momentanea'::text
            ELSE r.estado
        END AS estado,
    r.lugar,
    r.fecha_parada,
    r.fecha_entrada,
    r.tipo_movimiento,
    r.causa,
    r.trabajos_reserva,
    r.incidencia,
    r.proximo,
    r.observaciones,
    r.trazo_marron,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM registros_hotel x
              WHERE x.pizarra_id = r.pizarra_id AND x.id <> r.id AND NOT x.cancelado AND NOT x.retirado_hotel_activo AND (app_private.proyectar_continuidad_sustitucion_alpha75(x.seguimiento_id)->>'sustitucion_vigente')::boolean AND x.tipo_sustituto = 'FLOTA'::text AND regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+'::text, ''::text, 'g'::text) = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+'::text, ''::text, 'g'::text))) THEN 'marron'::text
            WHEN r.estado = 'planificado'::text THEN 'amarillo'::text
            WHEN r.estado = 'pendiente_taller'::text THEN 'blanco'::text
            WHEN r.estado = ANY (ARRAY['en_taller'::text, 'pendiente_diagnostico'::text, 'pendiente_autorizacion'::text, 'pendiente_repuestos'::text]) THEN 'lila'::text
            WHEN r.estado = 'terminado_pendiente_recogida'::text THEN 'azul'::text
            WHEN r.estado = 'recogido_pendiente_ruta'::text THEN 'calabaza'::text
            WHEN r.estado = 'reserva_liberada'::text THEN 'verde'::text
            ELSE 'blanco'::text
        END AS fondo_visual,
    r.orden,
    r.version,
    r.modificado_por,
    r.actualizado_en,
    count(e.id) FILTER (WHERE NOT e.cancelado) AS total_t,
    count(e.id) FILTER (WHERE NOT e.cancelado AND e.estado = 'realizada'::text) AS t_realizadas,
    count(e.id) FILTER (WHERE NOT e.cancelado AND (e.estado <> ALL (ARRAY['realizada'::text, 'anulada'::text]))) AS t_pendientes,
    r.modalidad_operativa,
    ( SELECT c.nombre
           FROM catalogo_modalidades_operativas_hotel c
          WHERE c.codigo = r.modalidad_operativa) AS modalidad_operativa_nombre
   FROM registros_hotel r
     JOIN pizarras p ON p.id = r.pizarra_id
     LEFT JOIN etapas_hotel e ON e.registro_hotel_id = r.id
  WHERE p.estado = 'en_curso'::text AND NOT r.cancelado AND NOT r.retirado_hotel_activo AND r.estado <> 'reserva_liberada'::text
  GROUP BY r.id, p.fecha
)
SELECT b.*,
 (app_private.proyectar_continuidad_sustitucion_alpha75(b.seguimiento_id)->>'propietario_sustitucion_seguimiento_id')::uuid AS propietario_sustitucion_seguimiento_id,
 coalesce((app_private.proyectar_continuidad_sustitucion_alpha75(b.seguimiento_id)->>'sustitucion_vigente')::boolean,false) AS sustitucion_vigente
FROM base b;

CREATE OR REPLACE VIEW public.hotel_actual_detalle WITH(security_invoker=true) AS
WITH base AS (
SELECT id,
    pizarra_id,
    fecha_pizarra,
    seguimiento_id,
    numero_parada,
    dfm,
    matricula,
    reserva,
    matricula_reserva,
    sustituto,
    matricula_sustituto,
    tipo_sustituto,
    etiqueta_reserva,
    etiqueta_sustituto,
    tipo_unidad,
    marca,
    tipo_motor,
    modelo,
    upc,
    telefono,
    prioridad,
    estado,
    lugar,
    fecha_parada,
    fecha_entrada,
    tipo_movimiento,
    causa,
    trabajos_reserva,
    incidencia,
    proximo,
    observaciones,
    trazo_marron,
    fondo_visual,
    orden,
    version,
    modificado_por,
    actualizado_en,
    total_t,
    t_realizadas,
    t_pendientes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', e.id, 'posicion', e.posicion, 'nombre', e.nombre, 'estado', e.estado, 'tipo_etapa', e.tipo_etapa, 'taller_id', e.taller_id, 'taller', t.nombre, 'centro_taller_id', e.centro_taller_id, 'centro', c.nombre, 'lugar', e.lugar, 'fecha_prevista', e.fecha_prevista, 'fecha_inicio_real', e.fecha_inicio_real, 'fecha_fin_real', e.fecha_fin_real, 'fecha_real', e.fecha_real, 'observaciones', e.observaciones, 'cancelado', e.cancelado, 'motivo_cancelacion', e.motivo_cancelacion, 'version', e.version, 'accion_sistema', e.accion_sistema, 'trabajos', COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', w.id, 'tipo_trabajo', w.tipo_trabajo, 'categoria_tecnica', w.categoria_tecnica, 'motivo_entrada', w.motivo_entrada, 'diagnostico_real', w.diagnostico_real, 'km_averia', w.km_averia, 'expediente', w.expediente, 'descripcion', w.descripcion, 'peritaje_estado', w.peritaje_estado, 'observaciones', w.observaciones, 'cancelado', w.cancelado, 'motivo_cancelacion', w.motivo_cancelacion, 'version', w.version) ORDER BY w.creado_en, w.id) AS jsonb_agg
                   FROM trabajos_etapa_hotel w
                  WHERE w.etapa_hotel_id = e.id), '[]'::jsonb)) ORDER BY e.cancelado, e.posicion, e.creado_en, e.id) AS jsonb_agg
           FROM etapas_hotel e
             LEFT JOIN talleres t ON t.id = e.taller_id
             LEFT JOIN centros_taller c ON c.id = e.centro_taller_id
          WHERE e.registro_hotel_id = h.id), '[]'::jsonb) AS etapas_resumen,
    modalidad_operativa,
    modalidad_operativa_nombre
   FROM hotel_actual h
)
SELECT b.*,
 (app_private.proyectar_continuidad_sustitucion_alpha75(b.seguimiento_id)->>'propietario_sustitucion_seguimiento_id')::uuid AS propietario_sustitucion_seguimiento_id,
 coalesce((app_private.proyectar_continuidad_sustitucion_alpha75(b.seguimiento_id)->>'sustitucion_vigente')::boolean,false) AS sustitucion_vigente
FROM base b;

CREATE OR REPLACE VIEW public.hotel_por_dia WITH(security_invoker=true) AS
WITH base AS (
SELECT r.id,
    r.pizarra_id,
    p.fecha AS fecha_pizarra,
    p.estado AS estado_pizarra,
    r.seguimiento_id,
    r.numero_parada,
    NULLIF(r.vehiculo_sustituido, ''::text) AS dfm,
    NULLIF(r.matricula_sustituido, ''::text) AS matricula,
    NULLIF(r.vehiculo_reserva, ''::text) AS reserva,
    NULLIF(r.matricula_reserva, ''::text) AS matricula_reserva,
    NULLIF(r.vehiculo_reserva, ''::text) AS sustituto,
    NULLIF(r.matricula_reserva, ''::text) AS matricula_sustituto,
    r.tipo_sustituto,
    r.etiqueta_reserva,
    r.etiqueta_reserva AS etiqueta_sustituto,
    r.tipo_unidad,
    r.marca,
    r.tipo_motor,
    r.modelo,
    r.upc,
    r.telefono,
    r.prioridad,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM registros_hotel x
              WHERE x.pizarra_id = r.pizarra_id AND x.id <> r.id AND NOT x.cancelado AND NOT x.retirado_hotel_activo AND (p.estado<>'en_curso' OR (app_private.proyectar_continuidad_sustitucion_alpha75(x.seguimiento_id)->>'sustitucion_vigente')::boolean) AND x.tipo_sustituto = 'FLOTA'::text AND regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+'::text, ''::text, 'g'::text) = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+'::text, ''::text, 'g'::text))) THEN 'sustitucion_momentanea'::text
            ELSE r.estado
        END AS estado,
    r.lugar,
    r.fecha_parada,
    r.fecha_entrada,
    r.tipo_movimiento,
    r.causa,
    r.trabajos_reserva,
    r.incidencia,
    r.proximo,
    r.observaciones,
    r.trazo_marron,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM registros_hotel x
              WHERE x.pizarra_id = r.pizarra_id AND x.id <> r.id AND NOT x.cancelado AND NOT x.retirado_hotel_activo AND (p.estado<>'en_curso' OR (app_private.proyectar_continuidad_sustitucion_alpha75(x.seguimiento_id)->>'sustitucion_vigente')::boolean) AND x.tipo_sustituto = 'FLOTA'::text AND regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+'::text, ''::text, 'g'::text) = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+'::text, ''::text, 'g'::text))) THEN 'marron'::text
            WHEN r.estado = 'planificado'::text THEN 'amarillo'::text
            WHEN r.estado = 'pendiente_taller'::text THEN 'blanco'::text
            WHEN r.estado = ANY (ARRAY['en_taller'::text, 'pendiente_diagnostico'::text, 'pendiente_autorizacion'::text, 'pendiente_repuestos'::text]) THEN 'lila'::text
            WHEN r.estado = 'terminado_pendiente_recogida'::text THEN 'azul'::text
            WHEN r.estado = 'recogido_pendiente_ruta'::text THEN 'calabaza'::text
            WHEN r.estado = 'reserva_liberada'::text THEN 'verde'::text
            ELSE 'blanco'::text
        END AS fondo_visual,
    r.orden,
    r.retirado_hotel_activo,
    r.fecha_retirado_hotel,
    r.cancelado,
    r.motivo_cancelacion,
    r.cancelado_en,
    r.cancelado_por,
    r.version,
    r.modificado_por,
    r.actualizado_en,
    count(e.id) FILTER (WHERE NOT e.cancelado) AS total_t,
    count(e.id) FILTER (WHERE NOT e.cancelado AND e.estado = 'realizada'::text) AS t_realizadas,
    count(e.id) FILTER (WHERE NOT e.cancelado AND (e.estado <> ALL (ARRAY['realizada'::text, 'anulada'::text]))) AS t_pendientes,
    r.modalidad_operativa,
    ( SELECT c.nombre
           FROM catalogo_modalidades_operativas_hotel c
          WHERE c.codigo = r.modalidad_operativa) AS modalidad_operativa_nombre
   FROM registros_hotel r
     JOIN pizarras p ON p.id = r.pizarra_id
     LEFT JOIN etapas_hotel e ON e.registro_hotel_id = r.id
  GROUP BY r.id, p.fecha, p.estado
)
SELECT b.*,
 (app_private.proyectar_continuidad_sustitucion_alpha75(b.seguimiento_id)->>'propietario_sustitucion_seguimiento_id')::uuid AS propietario_sustitucion_seguimiento_id,
 coalesce((app_private.proyectar_continuidad_sustitucion_alpha75(b.seguimiento_id)->>'sustitucion_vigente')::boolean,false) AS sustitucion_vigente
FROM base b;

CREATE OR REPLACE VIEW public.facturacion_dfm_periodos WITH(security_invoker=true) AS
WITH snapshot AS (
         SELECT f.seguimiento_id,
            regexp_replace(COALESCE(f.numero_parada, ''::text), '^PA-'::text, ''::text, 'i'::text) AS numero_parada,
            f.dfm,
            f.matricula,
            f.sustituto,
            NULL::text AS matricula_sustituto,
            p.incidencia,
            p.causa,
            p.upc,
            f.periodo,
            c.fecha_inicio AS periodo_inicio,
            c.fecha_cierre AS periodo_cierre,
            f.fecha_inicio_tramo AS tramo_inicio,
            f.fecha_fin_tramo AS tramo_fin,
            f.dias_facturables,
            NULL::numeric(12,3) AS km_dia_automatico,
            NULL::numeric(10,3) AS km_dia_manual,
                CASE
                    WHEN COALESCE(f.dias_facturables, 0) > 0 AND f.km_facturables IS NOT NULL THEN round(f.km_facturables / f.dias_facturables::numeric, 3)
                    ELSE NULL::numeric
                END AS km_dia,
            'TANCAMENT'::text AS km_dia_fuente,
            f.km_facturables,
            f.dias_facturables AS dias_parada_total,
            NULL::numeric AS km_sustitucion_total,
            COALESCE(p.estado, 'tancament'::text) AS estado
           FROM facturacion_tancament_cierres f
             JOIN cierres_facturacion c ON c.periodo = f.periodo
             LEFT JOIN paradas_sustitucion_resumen p USING (seguimiento_id)
          WHERE f.presente_en_manteniment AND f.dfm !~* '^R'::text AND c.fecha_cierre < (now() AT TIME ZONE 'Europe/Madrid'::text)::date
        ), live_tramos AS (
         SELECT p.seguimiento_id,
            p.numero_parada,
            p.unidad AS dfm,
            p.matricula,
            p.sustituto,
            p.matricula_sustituto,
            p.incidencia,
            p.causa,
            p.upc,
            c.periodo,
            c.fecha_inicio AS periodo_inicio,
            c.fecha_cierre AS periodo_cierre,
            GREATEST(p.fecha_inicio_imputacion, c.fecha_inicio) AS tramo_inicio,
            LEAST(COALESCE(p.fecha_fin_imputacion, CASE WHEN p.continuidad_entrada_id IS NOT NULL OR p.continuidad_salida_id IS NOT NULL THEN (now() AT TIME ZONE 'Europe/Madrid')::date ELSE CURRENT_DATE END), c.fecha_cierre, CASE WHEN p.continuidad_entrada_id IS NOT NULL OR p.continuidad_salida_id IS NOT NULL THEN (now() AT TIME ZONE 'Europe/Madrid')::date ELSE CURRENT_DATE END) AS tramo_fin,
            GREATEST(0, LEAST(COALESCE(p.fecha_fin_imputacion, CASE WHEN p.continuidad_entrada_id IS NOT NULL OR p.continuidad_salida_id IS NOT NULL THEN (now() AT TIME ZONE 'Europe/Madrid')::date ELSE CURRENT_DATE END), c.fecha_cierre, CASE WHEN p.continuidad_entrada_id IS NOT NULL OR p.continuidad_salida_id IS NOT NULL THEN (now() AT TIME ZONE 'Europe/Madrid')::date ELSE CURRENT_DATE END) - GREATEST(p.fecha_inicio_imputacion, c.fecha_inicio) + 1) AS dias_facturables,
            p.km_dia_automatico,
            p.km_dia_manual,
            p.km_dia,
            p.km_dia_fuente,
                CASE
                    WHEN p.km_dia IS NULL THEN NULL::numeric
                    ELSE round(GREATEST(0, LEAST(COALESCE(p.fecha_fin_imputacion, CASE WHEN p.continuidad_entrada_id IS NOT NULL OR p.continuidad_salida_id IS NOT NULL THEN (now() AT TIME ZONE 'Europe/Madrid')::date ELSE CURRENT_DATE END), c.fecha_cierre, CASE WHEN p.continuidad_entrada_id IS NOT NULL OR p.continuidad_salida_id IS NOT NULL THEN (now() AT TIME ZONE 'Europe/Madrid')::date ELSE CURRENT_DATE END) - GREATEST(p.fecha_inicio_imputacion, c.fecha_inicio) + 1)::numeric * p.km_dia)
                END AS km_facturables,
            p.dias_imputables_total AS dias_parada_total,
            p.km_sustitucion_total,
            p.estado
           FROM paradas_sustitucion_resumen p
             JOIN cierres_facturacion c ON p.clase_facturacion = 'DFM'::text AND p.sustituto IS NOT NULL AND p.km_dia IS NOT NULL AND p.fecha_inicio_imputacion <= c.fecha_cierre AND COALESCE(p.fecha_fin_imputacion, CASE WHEN p.continuidad_entrada_id IS NOT NULL OR p.continuidad_salida_id IS NOT NULL THEN (now() AT TIME ZONE 'Europe/Madrid')::date ELSE CURRENT_DATE END) >= c.fecha_inicio AND c.fecha_inicio <= CASE WHEN p.continuidad_entrada_id IS NOT NULL OR p.continuidad_salida_id IS NOT NULL THEN (now() AT TIME ZONE 'Europe/Madrid')::date ELSE CURRENT_DATE END
        )
 SELECT snapshot.seguimiento_id,
    snapshot.numero_parada,
    snapshot.dfm,
    snapshot.matricula,
    snapshot.sustituto,
    snapshot.matricula_sustituto,
    snapshot.incidencia,
    snapshot.causa,
    snapshot.upc,
    snapshot.periodo,
    snapshot.periodo_inicio,
    snapshot.periodo_cierre,
    snapshot.tramo_inicio,
    snapshot.tramo_fin,
    snapshot.dias_facturables,
    snapshot.km_dia_automatico,
    snapshot.km_dia_manual,
    snapshot.km_dia,
    snapshot.km_dia_fuente,
    snapshot.km_facturables,
    snapshot.dias_parada_total,
    snapshot.km_sustitucion_total,
    snapshot.estado
   FROM snapshot
UNION ALL
 SELECT l.seguimiento_id,
    l.numero_parada,
    l.dfm,
    l.matricula,
    l.sustituto,
    l.matricula_sustituto,
    l.incidencia,
    l.causa,
    l.upc,
    l.periodo,
    l.periodo_inicio,
    l.periodo_cierre,
    l.tramo_inicio,
    l.tramo_fin,
    l.dias_facturables,
    l.km_dia_automatico,
    l.km_dia_manual,
    l.km_dia,
    l.km_dia_fuente,
    l.km_facturables,
    l.dias_parada_total,
    l.km_sustitucion_total,
    l.estado
   FROM live_tramos l
  WHERE l.periodo_cierre >= (now() AT TIME ZONE 'Europe/Madrid'::text)::date OR NOT (EXISTS ( SELECT 1
           FROM snapshot s
          WHERE s.periodo = l.periodo));
CREATE FUNCTION public.previsualizar_continuidad_sustitucion_alpha75(
 p_destino_id uuid,p_origen_id uuid DEFAULT NULL,p_etapa_entrada_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SET search_path TO 'pg_catalog','app_private' AS $function$
 SELECT app_private.previsualizar_continuidad_sustitucion_alpha75($1,$2,$3)
$function$;
CREATE FUNCTION public.confirmar_continuidad_sustitucion_alpha75(
 p_origen_id uuid,p_destino_id uuid,p_etapa_entrada_id uuid,
 p_version_origen integer,p_version_destino integer,p_version_entrada integer,p_huella_prevision text,p_request_id text)
RETURNS jsonb LANGUAGE sql SET search_path TO 'pg_catalog','app_private' AS $function$
 SELECT app_private.confirmar_continuidad_sustitucion_alpha75($1,$2,$3,$4,$5,$6,$7,$8)
$function$;
DO $grants$
DECLARE x record;
BEGIN
 FOR x IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='app_private' AND p.proname IN (
'normalizar_dfm_continuidad_alpha75','normalizar_matricula_continuidad_alpha75','seguimiento_con_continuidad_sustitucion_alpha75','es_titular_continuidad_alpha75','bloquear_sync_continuidad_alpha75','bloquear_seguimientos_continuidad_alpha75','validar_sync_continuidad_alpha75','exigir_permiso_continuidad_alpha75','identidad_continuidad_alpha75','resolver_sustituto_continuidad_alpha75','metadatos_continuidad_alpha75','proyectar_continuidad_sustitucion_alpha75','historial_continuidad_alpha75','bloqueo_continuidad_alpha75','previsualizar_continuidad_sustitucion_alpha75','respuesta_continuidad_alpha75','confirmar_continuidad_sustitucion_alpha75','proteger_ledger_continuidad_alpha75','proteger_registro_continuidad_alpha75','proteger_etapa_continuidad_alpha75','proteger_activacion_continuidad_alpha75') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',x.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',x.sig);
 END LOOP;
END $grants$;
REVOKE ALL ON FUNCTION public.previsualizar_continuidad_sustitucion_alpha75(uuid,uuid,uuid),
 public.confirmar_continuidad_sustitucion_alpha75(uuid,uuid,uuid,integer,integer,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.previsualizar_continuidad_sustitucion_alpha75(uuid,uuid,uuid),
 public.confirmar_continuidad_sustitucion_alpha75(uuid,uuid,uuid,integer,integer,integer,text,text),
 app_private.previsualizar_continuidad_sustitucion_alpha75(uuid,uuid,uuid),
 app_private.confirmar_continuidad_sustitucion_alpha75(uuid,uuid,uuid,integer,integer,integer,text,text),
 app_private.proyectar_continuidad_sustitucion_alpha75(uuid) TO authenticated,service_role;
DO $security_preserved$
BEGIN
 IF EXISTS(SELECT 1 FROM continuidad_alpha75_function_security s JOIN pg_proc p USING(oid)
  WHERE (s.proowner,s.proacl,s.prosecdef,s.proconfig,s.provolatile) IS DISTINCT FROM
        (p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile))
 OR EXISTS(SELECT 1 FROM continuidad_alpha75_view_security s JOIN pg_class c USING(oid)
  WHERE (s.relowner,s.relacl,s.reloptions) IS DISTINCT FROM (c.relowner,c.relacl,c.reloptions)) THEN
  RAISE EXCEPTION 'CONTINUIDAD-001: se alteraron permisos o propiedades de objetos existentes' USING ERRCODE='55000';
 END IF;
END $security_preserved$;
COMMIT;
