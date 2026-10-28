-- MG75-24H-PARADAS-SEPARADAS-002 / candidate PR90, reviewed runtime 2026-10-28.
-- Future creates and explicit saves only. No backfill, renumbering, data repair,
-- billing calculation, recovery, sync activation, ACK or external write.
-- Baseline: operational PostgreSQL17.6 with SIT-24H-001 and REC-001 runtime.
-- Historic source migrations must NOT be replayed over that runtime. This new
-- migration includes the PR90 active-workshop guards using the installed REC
-- implementations, rather than reverting those implementations to older files.
-- Deliberately fails on any unexpected function drift; review/rebase first.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE paradas002_function_security ON COMMIT DROP AS
SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile
FROM pg_proc p WHERE false;
DO $preflight$
DECLARE x record; v_oid regprocedure;
BEGIN
  FOR x IN SELECT * FROM (VALUES
    ('app_private.activacion_24h_vincular_hotel_alpha74()','49481640501f68c36642a55e1d91764b'),
    ('app_private.guardar_activacion_24h(uuid,jsonb,text)','5339d1acfa36339ad6b99bcd6e92f9f0'),
    ('app_private.guardar_activacion_24h_con_fecha_alpha74(uuid,jsonb,text)','651ec4e4b1d59706c7ecee083fb3be82'),
    ('app_private.guardar_activacion_24h_operativa_alpha74(uuid,jsonb,text)','ded08f457dc04475eb56bf50da75d583'),
    ('app_private.guardar_activacion_24h_cierre_fecha_alpha75(uuid,jsonb,text)','3e0178b1e7de98599fe615d6c065d390'),
    ('app_private.sincronizar_cierre_24h_sit001(uuid)','8140f3aec521fab64a267e88e924ee63'),
    ('app_private.asistencia_24h_finalizada_sit001(uuid)','509d70e70f66414659e4201bee8ea42f'),
    ('app_private.activacion_24h_asegurar_ficha_alpha74()','02e9c1f0fb84a4a69151ccbfa5bc86cb'),
    ('app_private.manteniment_reconciliar_asistencia_alpha74(uuid)','c4a1ff3e1303351283ad998e61cce0aa'),
    ('app_private.activacion_24h_sincronizar_fecha_alpha74()','154342592207404e0388bcf29f4843c0'),
    ('app_private.asegurar_recuperacion_final()','45ff54dc4f74c5ff2a6f409fdf92eff7'),
    ('app_private.generar_recogida_tras_entrada_taller()','18da30fd735a2533c0bf8a632078d157'),
    ('app_private.cerrar_modalidad_hotel_sin_recuperacion(uuid)','aef819273f5bdd8f948e154a4f54fdce'),
    ('app_private.consolidar_rec001(uuid)','8db9f0a7cfe460cc7123bf4f3c419b74'),
    ('app_private.aplicar_recuperacion_desde_etapa()','215428090f894813c2c9db84673c598a'),
    ('app_private.resolver_pendientes_reserva_desde_etapa_trigger()','e9f42f3db2189ae23e0ff3c4f3c1763c'),
    ('app_private.resolver_reaperturas_pendiente_reserva()','f834e0328cd976acb8b421250ec04d10'),
    ('app_private.normalizar_estado_taller_24h_alpha74()','8bab9e11ff753da5b439a8a822688de6'),
    ('app_private.sincronizar_estado_24h_desde_entrada_alpha74()','d8815a0170a1b3214d83170ee0a3d7b0'),
    ('app_private.guardar_ficha_hotel_edicion(uuid,integer,jsonb,jsonb,text)','690f99d3d9584ca98478319cc19f8e1f'),
    ('app_private.reconciliar_etapas_hotel(uuid,text)','a46fb66bcace36e8862ca5d587a213b6'),
    ('public.guardar_activacion_24h(uuid,jsonb,text)','89a144618ffd711c11a8a95c3f813b79')
  ) AS expected(signature,digest) LOOP
    v_oid:=to_regprocedure(x.signature);
    IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid))<>x.digest THEN
      RAISE EXCEPTION 'PARADAS-002: deriva de función %. No se cambia el backend; revisar y rebasar la candidata.',x.signature;
    END IF;
    INSERT INTO paradas002_function_security
      SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile FROM pg_proc p WHERE p.oid=v_oid;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM public.catalogo_estados_hotel WHERE codigo='realizada' AND activo) THEN
    RAISE EXCEPTION 'PARADAS-002: falta el estado existente Realizada en el catálogo';
  END IF;
  IF to_regprocedure('app_private.proteger_cierre_24h_paradas002()') IS NOT NULL
     OR to_regprocedure('app_private.proteger_sustitucion_paradas002()') IS NOT NULL THEN
    RAISE EXCEPTION 'PARADAS-002: ya existen objetos de esta candidata; revisar estado de migraciones';
  END IF;
END
$preflight$;

DO $triggers$
DECLARE x record; t record;
BEGIN
  FOR x IN SELECT * FROM (VALUES
    ('public.registros_hotel','auditar_registros_hotel','86a972987fd39b2a8b46092a422eb062','O'),
    ('public.registros_hotel','derivar_tipo_sustituto_hotel','6b1ec1867b3eab5e176e41fda59accb4','O'),
    ('public.registros_hotel','registros_hotel_coherencia_diferida','83fcdf980063240cdb88fa0cab4c66db','O'),
    ('public.registros_hotel','registros_hotel_liberar_recuperado','45888846a4d0c37dbaaaa76541c98031','O'),
    ('public.registros_hotel','registros_hotel_liberar_reserva_al_anular','b88d3946abcb0e42329ca24aae3d3d54','O'),
    ('public.registros_hotel','registros_hotel_manteniment_encolar','ef2bbc054a7081e15472b27ae9cc82e6','O'),
    ('public.registros_hotel','registros_hotel_normalizar_estado_taller_24h_alpha74_trg','333c6c91a85528b7c4ab5d20e121969c','O'),
    ('public.registros_hotel','registros_hotel_numero_parada_auto','ba62f4759b39bfca04ce6aa621938b9b','O'),
    ('public.registros_hotel','registros_hotel_preparar_fuera_hotel','6f1860e7f9d81556eb9635f4eb6cec6e','O'),
    ('public.registros_hotel','registros_hotel_reabrir_cierre','e0b65a0b48fc2b275ab8262aac80d54e','O'),
    ('public.registros_hotel','registros_hotel_sincronizar_reservas','4c9a5877597a82fcc0003dad9146a9bb','O'),
    ('public.registros_hotel','registros_hotel_touch','c53bc8266f48b71cb1e23ccb28f70c23','O'),
    ('public.registros_hotel','registros_hotel_validar_modalidad_operativa','c9d921b41352a2767cd78bf273bccac2','O'),
    ('public.etapas_hotel','auditar_etapas_hotel','18e6379144b78e31e161d30aa44b2000','O'),
    ('public.etapas_hotel','etapas_aa_resolver_reaperturas_reserva','84415660d5803a2028e61e73c4b149ce','O'),
    ('public.etapas_hotel','etapas_hotel_accion_sistema','9ad3cd36dfcc9c30586ad9ef03adbde0','O'),
    ('public.etapas_hotel','etapas_hotel_aplicar_recuperacion','7df94c650943c25472508104de46b8fb','O'),
    ('public.etapas_hotel','etapas_hotel_asegurar_recuperacion','706cdccf2b9ea1693fa8715c13edc1d4','O'),
    ('public.etapas_hotel','etapas_hotel_bloquear_recogida_manteniment_alpha74','81f4e322134c7cc5c0846bac823e5ce2','O'),
    ('public.etapas_hotel','etapas_hotel_capturar_estado_antes_realizar','d02404906ca329512dd8edc698a5b75a','O'),
    ('public.etapas_hotel','etapas_hotel_cerrar_modalidad','89f0c22d1591cbc0000617c3ddb2a1f9','O'),
    ('public.etapas_hotel','etapas_hotel_coherencia_diferida','5229f1ea145a971b42b708d678f53536','O'),
    ('public.etapas_hotel','etapas_hotel_generar_recogida','e2ea4407d2c4cf136eb1664109d75563','O'),
    ('public.etapas_hotel','etapas_hotel_grupo_documental','a0df2c95680e31b81ed1759ff4330b11','O'),
    ('public.etapas_hotel','etapas_hotel_heredar_marcado_rapido','f858dd1a210520061c7b29aaea2f9c59','O'),
    ('public.etapas_hotel','etapas_hotel_liberar_reserva','4a150026b447b11b76ffd24bbbaa32f8','O'),
    ('public.etapas_hotel','etapas_hotel_manteniment_fechas','806bd43a6cc2e7655de615c007396423','O'),
    ('public.etapas_hotel','etapas_hotel_normalizar_marcado_rapido','be1b31c8fe6588d18009ce03048fb9c0','O'),
    ('public.etapas_hotel','etapas_hotel_sincronizar_estado_24h_alpha74_trg','00462a06c5e3fca3298027a5fad4977a','O'),
    ('public.etapas_hotel','etapas_hotel_sync_programada','67cb49c234b883a301b66396b45783c7','O'),
    ('public.etapas_hotel','etapas_hotel_touch','3c3fa1ce592ce506dc26e01e01d0c19a','O'),
    ('public.etapas_hotel','etapas_hotel_zzz_catalogo_estado','5273eeb2f42360378c01c629ceab3c3d','O'),
    ('public.etapas_hotel','etapas_resolver_pendientes_reserva','c889e70148b289faa8b29798460f92d2','O'),
    ('public.etapas_hotel','zzzz_etapas_hotel_rec001','6d8bd17d54b29d6ea824fdcc2bbb47d0','O'),
    ('public.activaciones_24h','activaciones_24h_asegurar_ficha_alpha74_trg','89047770289c7c83f5b677a46f59aee5','O'),
    ('public.activaciones_24h','activaciones_24h_clasificar_tipo_t_alpha74_trg','331e8cbe2e67ce1aa045f7f86af828c4','O'),
    ('public.activaciones_24h','activaciones_24h_reconciliar_hotel_alpha74_trg','20ea466d225ae492f0fa028f200652ae','O'),
    ('public.activaciones_24h','activaciones_24h_sincronizar_fecha_alpha74_trg','b98c3a6c5b95fc7306d0abe4434fc113','O'),
    ('public.activaciones_24h','activaciones_24h_vincular_hotel_alpha74_trg','0f7628a623d2dea4b17f1aa8f3479dbb','O'),
    ('public.activaciones_24h','auditar_activaciones_24h','3325c368629a8a1ff8fd8d8a0a42ae8a','O')
  ) expected(table_name,trigger_name,digest,enabled) LOOP
    SELECT pg_get_triggerdef(p.oid) AS definition,p.tgenabled INTO t FROM pg_trigger p
      WHERE p.tgrelid=to_regclass(x.table_name) AND p.tgname=x.trigger_name;
    IF NOT FOUND OR md5(t.definition)<>x.digest OR t.tgenabled::text<>x.enabled THEN
      RAISE EXCEPTION 'PARADAS-002: deriva de trigger %.%; revisar barreras antes de instalar',x.table_name,x.trigger_name;
    END IF;
  END LOOP;
END
$triggers$;

CREATE TABLE app_private.activacion_24h_peticion_paradas002 (
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  activacion_id uuid NOT NULL UNIQUE REFERENCES public.activaciones_24h(id),
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE app_private.activacion_24h_peticion_paradas002 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.activacion_24h_peticion_paradas002 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION app_private.activacion_24h_vincular_hotel_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE v_registro public.registros_hotel%ROWTYPE;
BEGIN
  -- MG75-24H-PARADAS-SEPARADAS-002: una activación nueva nunca busca una PA
  -- por DFM, matrícula, fecha, incidencia ni posición. La fábrica crea su PA.
  IF TG_OP='INSERT' THEN
    IF NEW.registro_hotel_id IS NOT NULL OR NEW.seguimiento_hotel_id IS NOT NULL THEN
      RAISE EXCEPTION 'PARADAS-002: una nueva asistencia 24H necesita una PA propia; no se puede reutilizar otra ficha' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.registro_hotel_id IS NOT DISTINCT FROM OLD.registro_hotel_id
     AND NEW.seguimiento_hotel_id IS NOT DISTINCT FROM OLD.seguimiento_hotel_id THEN
    RETURN NEW;
  END IF;
  IF OLD.registro_hotel_id IS NOT NULL OR OLD.seguimiento_hotel_id IS NOT NULL
     OR current_setting('app.paradas002_creando_activacion',true) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'PARADAS-002: se conserva el vínculo original de la asistencia; no se reasigna una PA existente' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_registro FROM public.registros_hotel WHERE id=NEW.registro_hotel_id;
  IF NOT FOUND OR v_registro.seguimiento_id IS DISTINCT FROM NEW.seguimiento_hotel_id
     OR upper(btrim(v_registro.tipo_movimiento))<>'24H'
     OR upper(btrim(v_registro.vehiculo_sustituido))<>upper(btrim(NEW.dfm))
     OR EXISTS (SELECT 1 FROM public.activaciones_24h a WHERE a.id<>NEW.id
       AND (a.registro_hotel_id=NEW.registro_hotel_id OR a.seguimiento_hotel_id=NEW.seguimiento_hotel_id)) THEN
    RAISE EXCEPTION 'PARADAS-002: el vínculo nuevo de asistencia y PA no es inequívoco' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION app_private.guardar_activacion_24h(p_id uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_version integer;
  v_dfm text := btrim(coalesce(p_payload->>'dfm',''));
  v_matricula text := upper(btrim(coalesce(p_payload->>'matricula','')));
  v_vehicle uuid;
  v_existing public.activaciones_24h%rowtype;
  v_primary boolean := public.es_administrador_principal();
  v_resultado text := coalesce(nullif(btrim(p_payload->>'resultado'),''),'seguimiento_abierto');
  v_operativo boolean := coalesce((p_payload->>'estado_operativo_confirmado')::boolean,false);
  v_fecha_activacion date := coalesce(
    nullif(p_payload->>'fecha_activacion','')::date,
    (clock_timestamp() at time zone 'Europe/Madrid')::date
  );
  v_fecha_fin_reparacion date := nullif(p_payload->>'fecha_fin_reparacion','')::date;
  v_hora_fin_reparacion time := nullif(p_payload->>'hora_fin_reparacion','')::time;
  v_estado text;
  v_completada boolean := v_resultado='operativo_reparado'
    or coalesce(p_payload->>'estado_seguimiento','')='realizada';
  v_hora_activacion time := nullif(p_payload->>'hora_activacion','')::time;
  v_peticion app_private.activacion_24h_peticion_paradas002%rowtype;
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtextextended('MG75-PARADAS-002:request:'||v_actor::text||':'||p_request_id,0));
    select * into v_peticion from app_private.activacion_24h_peticion_paradas002
      where actor_id=v_actor and request_id=p_request_id;
    if found then
      if v_peticion.payload_sha256<>encode(sha256(convert_to(p_payload::text,'UTF8')),'hex') then
        raise exception 'PARADAS-002: la petición de alta ya existe con otros datos; revisa la asistencia creada';
      end if;
      select * into strict v_existing from public.activaciones_24h where id=v_peticion.activacion_id;
      return jsonb_build_object('ok',true,'id',v_existing.id,'version',v_existing.version,
        'estado',v_existing.estado,'estado_seguimiento',v_existing.estado_seguimiento,
        'resultado',v_existing.resultado,'reutilizada',true);
    end if;
  end if;
  if v_dfm = '' then raise exception 'Debes indicar el DFM'; end if;
  if btrim(coalesce(p_payload->>'averia','')) = '' then raise exception 'Debes describir la avería'; end if;

  if v_completada then
    if v_resultado not in ('operativo_reparado','trasladado_taller','necesita_sustitucion') then
      raise exception 'PARADAS-002: indica el resultado real antes de finalizar la asistencia';
    end if;
    if nullif(p_payload->>'fecha_activacion','') is null or v_hora_activacion is null
       or v_fecha_fin_reparacion is null or v_hora_fin_reparacion is null then
      raise exception 'PARADAS-002: indica las fechas y horas reales de activación y fin de asistencia';
    end if;
    if ((v_fecha_fin_reparacion+v_hora_fin_reparacion) at time zone 'Europe/Madrid')
       < ((v_fecha_activacion+v_hora_activacion) at time zone 'Europe/Madrid') then
      raise exception 'PARADAS-002: el fin real no puede preceder a la activación';
    end if;
    if v_resultado='trasladado_taller' and btrim(coalesce(p_payload->>'taller_traslado',''))='' then
      raise exception 'PARADAS-002: indica el taller del traslado realizado';
    end if;
  end if;

  if v_resultado = 'operativo_reparado' then
    if not v_operativo then
      raise exception 'Debes confirmar que el vehículo está operativo y reparado';
    end if;
    if v_fecha_fin_reparacion is null then
      raise exception 'Debes indicar la fecha de fin de reparación';
    end if;
    if v_hora_fin_reparacion is null then
      raise exception 'Debes indicar la hora de fin de reparación';
    end if;
    v_estado := 'cerrada';
  else
    v_estado := case when v_completada then 'cerrada' else 'abierta' end;
  end if;

  select id into v_vehicle
  from public.vehiculos
  where dfm = v_dfm
  limit 1;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-activar-24h', true);

  if p_id is null then
    if v_fecha_fin_reparacion is not null and v_fecha_fin_reparacion < v_fecha_activacion then
      raise exception 'La fecha de fin no puede ser anterior a la activación';
    end if;

    insert into public.activaciones_24h(
      dfm,matricula,vehiculo_id,marca,modelo,bastidor,upc,km_actual,contrato_km,fin_contrato_fecha,cobertura_ok,
      conductor,telefono_conductor,ubicacion_tipo,ubicacion_referencia,carretera,punto_km,sentido,averia,codigo_alarma,color_alarma,semirremolque,carga,
      numero_caso,fecha_activacion,hora_activacion,eta_tecnico,proveedor,tecnico_llegado,hora_llegada,diagnostico_confirmado,diagnostico,reparado_carretera,trasladado_taller,taller_traslado,estado_operativo_confirmado,fecha_fin_reparacion,hora_fin_reparacion,resultado,estado,
      creado_por,modificado_por
    ) values(
      v_dfm,v_matricula,v_vehicle,upper(btrim(coalesce(p_payload->>'marca',''))),btrim(coalesce(p_payload->>'modelo','')),upper(btrim(coalesce(p_payload->>'bastidor',''))),upper(btrim(coalesce(p_payload->>'upc',''))),
      nullif(p_payload->>'km_actual','')::integer,nullif(p_payload->>'contrato_km','')::integer,nullif(p_payload->>'fin_contrato_fecha','')::date,coalesce((p_payload->>'cobertura_ok')::boolean,false),
      btrim(coalesce(p_payload->>'conductor','')),btrim(coalesce(p_payload->>'telefono_conductor','')),btrim(coalesce(p_payload->>'ubicacion_tipo','')),btrim(coalesce(p_payload->>'ubicacion_referencia','')),btrim(coalesce(p_payload->>'carretera','')),btrim(coalesce(p_payload->>'punto_km','')),btrim(coalesce(p_payload->>'sentido','')),btrim(coalesce(p_payload->>'averia','')),btrim(coalesce(p_payload->>'codigo_alarma','')),btrim(coalesce(p_payload->>'color_alarma','')),upper(btrim(coalesce(p_payload->>'semirremolque',''))),btrim(coalesce(p_payload->>'carga','')),
      btrim(coalesce(p_payload->>'numero_caso','')),v_fecha_activacion,nullif(p_payload->>'hora_activacion','')::time,nullif(p_payload->>'eta_tecnico','')::time,btrim(coalesce(p_payload->>'proveedor','')),coalesce((p_payload->>'tecnico_llegado')::boolean,false),nullif(p_payload->>'hora_llegada','')::time,coalesce((p_payload->>'diagnostico_confirmado')::boolean,false),btrim(coalesce(p_payload->>'diagnostico','')),v_resultado='operativo_reparado',coalesce((p_payload->>'trasladado_taller')::boolean,false),btrim(coalesce(p_payload->>'taller_traslado','')),v_operativo,v_fecha_fin_reparacion,v_hora_fin_reparacion,v_resultado,v_estado,
      v_actor,v_actor
    ) returning id,version into v_id,v_version;
    insert into app_private.activacion_24h_peticion_paradas002(actor_id,request_id,payload_sha256,activacion_id)
      values(v_actor,p_request_id,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),v_id);
  else
    select * into v_existing
    from public.activaciones_24h
    where id = p_id
    for update;

    if v_existing.id is null then
      raise exception 'Activación 24H no encontrada';
    end if;
    if not v_primary and v_existing.creado_por is distinct from v_actor then
      raise exception 'Solo puedes modificar tus propias incidencias';
    end if;
    if v_existing.estado = 'anulada' then
      raise exception 'La incidencia está anulada. Restáurala antes de modificarla';
    end if;
    if v_fecha_fin_reparacion is not null
       and v_fecha_fin_reparacion < (case when p_payload ? 'fecha_activacion'
         then v_fecha_activacion else v_existing.fecha_activacion end) then
      raise exception 'La fecha de fin no puede ser anterior a la activación';
    end if;

    update public.activaciones_24h a
    set numero_caso=btrim(coalesce(p_payload->>'numero_caso',a.numero_caso)),
        fecha_activacion=case when p_payload ? 'fecha_activacion' then v_fecha_activacion else a.fecha_activacion end,
        hora_activacion=case when p_payload ? 'hora_activacion' then v_hora_activacion else a.hora_activacion end,
        eta_tecnico=case when p_payload ? 'eta_tecnico' then nullif(p_payload->>'eta_tecnico','')::time else a.eta_tecnico end,
        proveedor=btrim(coalesce(p_payload->>'proveedor',a.proveedor)),
        tecnico_llegado=coalesce((p_payload->>'tecnico_llegado')::boolean,a.tecnico_llegado),
        hora_llegada=case when p_payload ? 'hora_llegada' then nullif(p_payload->>'hora_llegada','')::time else a.hora_llegada end,
        diagnostico_confirmado=coalesce((p_payload->>'diagnostico_confirmado')::boolean,a.diagnostico_confirmado),
        diagnostico=btrim(coalesce(p_payload->>'diagnostico',a.diagnostico)),
        reparado_carretera=(v_resultado='operativo_reparado'),
        trasladado_taller=coalesce((p_payload->>'trasladado_taller')::boolean,a.trasladado_taller),
        taller_traslado=btrim(coalesce(p_payload->>'taller_traslado',a.taller_traslado)),
        estado_operativo_confirmado=v_operativo,
        fecha_fin_reparacion=v_fecha_fin_reparacion,
        hora_fin_reparacion=v_hora_fin_reparacion,
        resultado=v_resultado,
        estado=v_estado,
        modificado_por=v_actor,
        actualizado_en=now(),
        version=a.version+1
    where a.id=p_id
    returning id,version into v_id,v_version;
  end if;

  return jsonb_build_object('ok',true,'id',v_id,'version',v_version,'estado',v_estado,'resultado',v_resultado);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.guardar_activacion_24h_con_fecha_alpha74(p_id uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_result jsonb;
  v_id uuid;
  v_fecha date;
  v_version integer;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;

  if p_id is null or p_payload ? 'fecha_activacion' then
    v_fecha := coalesce(
      nullif(p_payload->>'fecha_activacion', '')::date,
      (clock_timestamp() at time zone 'Europe/Madrid')::date
    );
  end if;

  v_result := app_private.guardar_activacion_24h(p_id, p_payload, p_request_id);
  v_id := (v_result->>'id')::uuid;

  if v_fecha is not null and coalesce((v_result->>'reutilizada')::boolean,false)=false then
    update public.activaciones_24h a
    set fecha_activacion = v_fecha,
        modificado_por = auth.uid(),
        actualizado_en = clock_timestamp(),
        version = a.version + 1
    where a.id = v_id
      and a.fecha_activacion is distinct from v_fecha
    returning a.version into v_version;
  end if;

  return v_result || jsonb_build_object(
    'fecha_activacion', (select a.fecha_activacion from public.activaciones_24h a where a.id = v_id),
    'version', coalesce(v_version, (v_result->>'version')::integer)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.guardar_activacion_24h_operativa_alpha74(p_id uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_result jsonb;
  v_id uuid;
  v_registro_id uuid;
  v_seguimiento_id uuid;
  v_version integer;
  v_resultado text := coalesce(nullif(btrim(p_payload->>'resultado'), ''), 'seguimiento_abierto');
  v_situacion text := coalesce(nullif(btrim(p_payload->>'estado_seguimiento'), ''), 'en_curso');
  v_sustituto text := btrim(coalesce(p_payload->>'vehiculo_sustituto', ''));
  v_matricula text := upper(btrim(coalesce(p_payload->>'matricula_sustituto', '')));
  v_tipo_sustituto text := '';
  v_etiqueta text := '';
  v_sustituto_catalogo text;
  v_matricula_catalogo text;
  v_estado_hotel text;
  v_asignar_en_cierre boolean:=false;
  v_previous_scope text:=current_setting('app.sit24h_cierre_controlado',true);
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;
  if v_situacion not in (
    'en_curso', 'pendiente_diagnostico', 'pendiente_presupuesto',
    'pendiente_autorizacion', 'pendiente_repuestos', 'en_reparacion', 'realizada'
  ) then
    raise exception 'La situación actual de la asistencia no es válida';
  end if;
  if v_resultado = 'necesita_sustitucion' and v_sustituto = '' and v_matricula = '' then
    raise exception 'Debes indicar el DFM o la matrícula del vehículo sustituto';
  end if;

  v_result := app_private.guardar_activacion_24h_con_fecha_alpha74(p_id, p_payload, p_request_id);
  if coalesce((v_result->>'reutilizada')::boolean,false) then return v_result; end if;
  v_id := (v_result->>'id')::uuid;
  perform set_config('app.sit24h_cierre_controlado','1',true);

  update public.activaciones_24h a
  set estado_seguimiento = v_situacion,
      vehiculo_sustituto = case when v_resultado = 'necesita_sustitucion' then v_sustituto else a.vehiculo_sustituto end,
      matricula_sustituto = case when v_resultado = 'necesita_sustitucion' then v_matricula else a.matricula_sustituto end,
      modificado_por = auth.uid(),
      actualizado_en = clock_timestamp(),
      version = a.version + 1
  where a.id = v_id
  returning a.registro_hotel_id, a.seguimiento_hotel_id, a.version
    into v_registro_id, v_seguimiento_id, v_version;

  if v_resultado = 'necesita_sustitucion' then
    select coalesce(v.tipo_sustituto_catalogo, ''), coalesce(v.etiqueta_reserva, ''),
           v.dfm, v.matricula
      into v_tipo_sustituto, v_etiqueta, v_sustituto_catalogo, v_matricula_catalogo
    from public.vehiculos_hotel_autocompletar v
    where (v_sustituto <> '' and upper(btrim(v.dfm)) = upper(v_sustituto))
       or (v_matricula <> '' and upper(btrim(v.matricula)) = v_matricula)
    order by case when v_sustituto <> '' and upper(btrim(v.dfm)) = upper(v_sustituto) then 0 else 1 end
    limit 1;

    v_sustituto := coalesce(nullif(v_sustituto, ''), v_sustituto_catalogo, '');
    v_matricula := coalesce(nullif(v_matricula, ''), v_matricula_catalogo, '');
    v_tipo_sustituto := coalesce(nullif(v_tipo_sustituto, ''), 'FLOTA');

    update public.activaciones_24h a
    set vehiculo_sustituto = v_sustituto,
        matricula_sustituto = v_matricula,
        modificado_por = auth.uid(),
        actualizado_en = clock_timestamp(),
        version = a.version + 1
    where a.id = v_id
    returning a.version into v_version;
  end if;

  perform set_config('app.sit24h_cierre_controlado',coalesce(v_previous_scope,''),true);
  if v_situacion='realizada' and v_resultado='necesita_sustitucion' then
    if exists(select 1 from public.registros_hotel r where r.id=v_registro_id
      and (btrim(coalesce(r.vehiculo_reserva,''))<>'' or btrim(coalesce(r.matricula_reserva,''))<>'')
      and (upper(btrim(coalesce(r.vehiculo_reserva,'')))<>upper(v_sustituto)
        or upper(btrim(coalesce(r.matricula_reserva,'')))<>v_matricula)) then
      raise exception 'PARADAS-002: finalizar la asistencia no cambia el sustituto existente; utiliza el cambio explícito de sustitución';
    end if;
    select exists(select 1 from public.registros_hotel r where r.id=v_registro_id
      and btrim(coalesce(r.vehiculo_reserva,''))='' and btrim(coalesce(r.matricula_reserva,''))='') into v_asignar_en_cierre;
  end if;

  v_estado_hotel := case v_situacion
    when 'pendiente_diagnostico' then 'pendiente_diagnostico'
    when 'pendiente_presupuesto' then 'pendiente_autorizacion'
    when 'pendiente_autorizacion' then 'pendiente_autorizacion'
    when 'pendiente_repuestos' then 'pendiente_repuestos'
    when 'en_reparacion' then 'en_taller'
    else 'asistencia_24h'
  end;

  if v_registro_id is not null and v_resultado <> 'operativo_reparado'
     and (v_situacion <> 'realizada' or v_asignar_en_cierre) then
    update public.registros_hotel r
    set estado = case when v_situacion='realizada' then r.estado when exists (
          select 1 from public.etapas_hotel e
          where e.registro_hotel_id=r.id and not e.cancelado
            and e.tipo_etapa='entrada_taller' and e.fecha_inicio_real is not null
            and e.fecha_real is null
        ) then r.estado else v_estado_hotel end,
        vehiculo_reserva = case when v_resultado = 'necesita_sustitucion' then v_sustituto else r.vehiculo_reserva end,
        matricula_reserva = case when v_resultado = 'necesita_sustitucion' then v_matricula else r.matricula_reserva end,
        etiqueta_reserva = case when v_resultado = 'necesita_sustitucion' then v_etiqueta else r.etiqueta_reserva end,
        tipo_sustituto = case when v_resultado = 'necesita_sustitucion' then v_tipo_sustituto else r.tipo_sustituto end,
        modalidad_operativa = case when v_resultado = 'necesita_sustitucion'
          then 'reserva_en_reparacion' else r.modalidad_operativa end,
        modificado_por = auth.uid(),
        actualizado_en = clock_timestamp(),
        version = r.version + 1
    where r.id = v_registro_id;

    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;

  return v_result || jsonb_build_object(
    'version', v_version,
    'estado_seguimiento', v_situacion,
    'vehiculo_sustituto', v_sustituto,
    'matricula_sustituto', v_matricula,
    'estado_hotel', v_estado_hotel
  );
exception when others then
  perform set_config('app.sit24h_cierre_controlado',coalesce(v_previous_scope,''),true);
  raise;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.guardar_activacion_24h_cierre_fecha_alpha75(p_id uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE
  v_result jsonb; v_id uuid; v_registro uuid; cierre jsonb:='{}';
  v_done boolean:=coalesce(p_payload->>'resultado','')='operativo_reparado'
    OR coalesce(p_payload->>'estado_seguimiento','')='realizada';
  v_payload jsonb:=p_payload;
  prev_scope text:=current_setting('app.sit24h_cierre_controlado',true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.dispositivo_autorizado() OR NOT public.puede_editar_modulo('activar24h') THEN
    RAISE EXCEPTION 'No tienes permiso para activar 24H';
  END IF;
  IF v_done THEN
    PERFORM set_config('app.sit24h_cierre_controlado','1',true);
    v_payload:=jsonb_set(v_payload,'{estado_seguimiento}','"realizada"');
  END IF;
  v_result:=app_private.guardar_activacion_24h_operativa_alpha74(p_id,v_payload,p_request_id);
  v_id:=(v_result->>'id')::uuid;
  SELECT x.registro_hotel_id INTO v_registro FROM public.activaciones_24h x WHERE x.id=v_id;
  IF v_done THEN cierre:=app_private.sincronizar_cierre_24h_sit001(v_id); END IF;
  PERFORM set_config('app.sit24h_cierre_controlado',coalesce(prev_scope,''),true);
  RETURN v_result || cierre || jsonb_build_object(
    'estado',(SELECT x.estado FROM public.activaciones_24h x WHERE x.id=v_id),
    'estado_seguimiento',(SELECT x.estado_seguimiento FROM public.activaciones_24h x WHERE x.id=v_id),
    'resultado',(SELECT x.resultado FROM public.activaciones_24h x WHERE x.id=v_id),
    'fecha_fin_reparacion',(SELECT x.fecha_fin_reparacion FROM public.activaciones_24h x WHERE x.id=v_id),
    'estado_hotel',(SELECT x.estado FROM public.registros_hotel x WHERE x.id=v_registro));
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.sit24h_cierre_controlado',coalesce(prev_scope,''),true);
  RAISE;
END
$function$;

CREATE OR REPLACE FUNCTION app_private.sincronizar_cierre_24h_sit001(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE
  a public.activaciones_24h%ROWTYPE; r public.registros_hotel%ROWTYPE;
  e public.etapas_hotel%ROWTYPE; ids uuid[]; t0 timestamptz; t1 timestamptz;
  prev_scope text:=current_setting('app.sit24h_cierre_controlado',true);
  prev_recon text:=current_setting('app.reconciliando_etapas',true);
  others_before jsonb; others_after jsonb; r_before jsonb; r_after jsonb;
BEGIN
  SELECT x.* INTO a FROM public.activaciones_24h x WHERE x.id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARADAS-002: no existe la asistencia solicitada'; END IF;
  IF a.estado<>'cerrada' OR a.resultado NOT IN ('operativo_reparado','trasladado_taller','necesita_sustitucion') THEN
    RAISE EXCEPTION 'PARADAS-002: finalizar requiere un resultado real de la asistencia';
  END IF;
  IF a.resultado='operativo_reparado' AND (NOT coalesce(a.estado_operativo_confirmado,false) OR NOT coalesce(a.reparado_carretera,false)) THEN
    RAISE EXCEPTION 'PARADAS-002: el resultado reparado requiere operatividad confirmada';
  END IF;
  IF a.resultado='trasladado_taller' AND btrim(coalesce(a.taller_traslado,''))='' THEN
    RAISE EXCEPTION 'PARADAS-002: indica el taller del traslado realizado';
  END IF;
  IF a.fecha_activacion IS NULL OR a.hora_activacion IS NULL OR a.fecha_fin_reparacion IS NULL OR a.hora_fin_reparacion IS NULL THEN
    RAISE EXCEPTION 'PARADAS-002: indica las fechas y horas reales de activación y fin de asistencia';
  END IF;
  t0:=(a.fecha_activacion+a.hora_activacion) AT TIME ZONE 'Europe/Madrid';
  t1:=(a.fecha_fin_reparacion+a.hora_fin_reparacion) AT TIME ZONE 'Europe/Madrid';
  IF t1<t0 THEN RAISE EXCEPTION 'PARADAS-002: el fin real no puede preceder a la activación'; END IF;
  SELECT x.* INTO r FROM public.registros_hotel x WHERE x.id=a.registro_hotel_id AND NOT x.cancelado FOR UPDATE;
  IF NOT FOUND OR r.seguimiento_id IS DISTINCT FROM a.seguimiento_hotel_id
     OR upper(btrim(coalesce(r.vehiculo_sustituido,'')))<>upper(btrim(coalesce(a.dfm,''))) THEN
    RAISE EXCEPTION 'PARADAS-002: el vínculo asistencia/ficha no es inequívoco; no se modifica ninguna T';
  END IF;
  IF (SELECT count(*) FROM public.activaciones_24h x WHERE x.estado<>'anulada'
      AND (x.registro_hotel_id=r.id OR x.seguimiento_hotel_id=r.seguimiento_id))<>1 THEN
    RAISE EXCEPTION 'PARADAS-002: hay varias asistencias vinculadas; se requiere revisar la T exacta';
  END IF;
  PERFORM 1 FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id FOR UPDATE;
  SELECT array_agg(x.id ORDER BY x.id) INTO ids FROM public.etapas_hotel x
  WHERE x.registro_hotel_id=r.id AND NOT x.cancelado AND x.estado<>'anulada'
    AND NOT app_private.es_recuperacion_rec001(to_jsonb(x))
    AND (lower(btrim(coalesce(x.tipo_etapa,'')))='24h' OR
      (lower(btrim(coalesce(x.tipo_etapa,'')))='otro' AND
       regexp_replace(upper(translate(coalesce(x.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^A-Z0-9]+','','g')
       IN ('24H','24HAVERIA','AVERIA24H','ASISTENCIA24H')));
  IF coalesce(cardinality(ids),0)<>1 THEN
    RAISE EXCEPTION 'PARADAS-002: no se identifica una única T de asistencia (encontradas: %); no se elige por posición',coalesce(cardinality(ids),0);
  END IF;
  SELECT x.* INTO STRICT e FROM public.etapas_hotel x WHERE x.id=ids[1];
  IF (e.fecha_inicio_real IS NOT NULL AND e.fecha_inicio_real<>t0)
     OR (e.fecha_fin_real IS NOT NULL AND e.fecha_fin_real<>t1)
     OR (e.fecha_real IS NOT NULL AND e.fecha_real<>t1) THEN
    RAISE EXCEPTION 'PARADAS-002: la T ya contiene fechas distintas; se conservan para revisión';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO others_before
    FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id AND x.id<>e.id;
  r_before:=to_jsonb(r)-ARRAY['estado','modificado_por','actualizado_en','version'];
  PERFORM set_config('app.sit24h_cierre_controlado','1',true);
  PERFORM set_config('app.reconciliando_etapas','1',true);
  UPDATE public.activaciones_24h x SET estado_seguimiento='realizada',modificado_por=coalesce(auth.uid(),x.modificado_por)
    WHERE x.id=a.id AND x.estado_seguimiento IS DISTINCT FROM 'realizada';
  UPDATE public.etapas_hotel x SET estado='realizada',
    estado_catalogo_codigo=CASE WHEN x.estado='realizada' THEN x.estado_catalogo_codigo ELSE 'realizada' END,
    fecha_inicio_real=t0,fecha_fin_real=t1,fecha_real=t1,modificado_por=coalesce(auth.uid(),x.modificado_por)
    WHERE x.id=e.id AND (x.estado<>'realizada' OR x.fecha_inicio_real IS DISTINCT FROM t0
      OR x.fecha_fin_real IS DISTINCT FROM t1 OR x.fecha_real IS DISTINCT FROM t1);
  -- Realizada describe la asistencia. No equivale a Recuperado ni a retirada
  -- de la PA y no certifica el fin de una sustitución que continúa.
  IF NOT r.retirado_hotel_activo AND r.estado NOT IN ('recuperado','reserva_liberada','anulado')
     AND NOT EXISTS (SELECT 1 FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id
       AND x.id<>e.id AND NOT x.cancelado AND x.estado<>'anulada'
       AND (x.estado<>'realizada' OR (x.tipo_etapa='entrada_taller'
         AND (x.fecha_inicio_real IS NULL OR x.fecha_fin_real IS NULL OR x.fecha_real IS NULL)))) THEN
    UPDATE public.registros_hotel x SET estado='realizada',modificado_por=coalesce(auth.uid(),x.modificado_por)
      WHERE x.id=r.id AND x.estado IS DISTINCT FROM 'realizada';
  ELSIF NOT r.retirado_hotel_activo AND r.estado='asistencia_24h' THEN
    -- La asistencia acabó; una T distinta pendiente conserva sus hechos y pasa
    -- a ser el motivo visible. Solo se sustituye el estado derivado 24H activa.
    UPDATE public.registros_hotel x SET estado=CASE
      WHEN EXISTS(SELECT 1 FROM public.etapas_hotel p WHERE p.registro_hotel_id=r.id
        AND NOT p.cancelado AND p.estado<>'anulada' AND p.tipo_etapa='entrada_taller' AND p.fecha_inicio_real IS NOT NULL
        AND p.fecha_real IS NULL AND p.fecha_fin_real IS NULL) THEN 'en_taller'
      WHEN EXISTS(SELECT 1 FROM public.etapas_hotel p WHERE p.registro_hotel_id=r.id
        AND NOT p.cancelado AND p.estado<>'anulada' AND p.tipo_etapa='entrada_taller' AND p.fecha_inicio_real IS NOT NULL
        AND p.fecha_real IS NULL AND p.fecha_fin_real IS NOT NULL) THEN 'terminado_pendiente_recogida'
      WHEN EXISTS(SELECT 1 FROM public.etapas_hotel p WHERE p.registro_hotel_id=r.id
        AND NOT p.cancelado AND p.estado NOT IN ('realizada','anulada') AND p.tipo_etapa='entrada_taller') THEN 'pendiente_taller'
      ELSE 't_pendientes' END,modificado_por=coalesce(auth.uid(),x.modificado_por)
      WHERE x.id=r.id AND x.estado='asistencia_24h';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO others_after
    FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id AND x.id<>e.id;
  SELECT to_jsonb(x)-ARRAY['estado','modificado_por','actualizado_en','version'] INTO r_after
    FROM public.registros_hotel x WHERE x.id=r.id;
  IF others_after IS DISTINCT FROM others_before OR r_after IS DISTINCT FROM r_before THEN
    RAISE EXCEPTION 'PARADAS-002: una cascada alteró otra T, la identidad o la sustitución; guardado revertido';
  END IF;
  PERFORM set_config('app.reconciliando_etapas',coalesce(prev_recon,''),true);
  PERFORM set_config('app.sit24h_cierre_controlado',coalesce(prev_scope,''),true);
  RETURN jsonb_build_object('regla','MG75-24H-PARADAS-SEPARADAS-002','etapa_id',e.id,
    'estado','cerrada','resultado',a.resultado,'estado_t','realizada','fecha_inicio_real',t0,'fecha_fin_real',t1,
    'estado_seguimiento','realizada','estado_hotel',(SELECT x.estado FROM public.registros_hotel x WHERE x.id=r.id),
    'retirado_hotel',(SELECT x.retirado_hotel_activo FROM public.registros_hotel x WHERE x.id=r.id),
    'version',(SELECT x.version FROM public.activaciones_24h x WHERE x.id=a.id));
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.reconciliando_etapas',coalesce(prev_recon,''),true);
  PERFORM set_config('app.sit24h_cierre_controlado',coalesce(prev_scope,''),true);
  RAISE;
END
$function$;

CREATE OR REPLACE FUNCTION app_private.asistencia_24h_finalizada_sit001(p_registro_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
SELECT EXISTS(SELECT 1 FROM public.activaciones_24h a
  WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=(SELECT r.seguimiento_id FROM public.registros_hotel r WHERE r.id=p_registro_id))
    AND a.estado='cerrada' AND a.estado_seguimiento='realizada'
    AND a.resultado IN ('operativo_reparado','trasladado_taller','necesita_sustitucion')
    AND a.fecha_activacion IS NOT NULL AND a.hora_activacion IS NOT NULL
    AND a.fecha_fin_reparacion IS NOT NULL AND a.hora_fin_reparacion IS NOT NULL)
AND NOT EXISTS(SELECT 1 FROM public.activaciones_24h a
  WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=(SELECT r.seguimiento_id FROM public.registros_hotel r WHERE r.id=p_registro_id))
    AND a.estado='abierta');
$function$;

CREATE OR REPLACE FUNCTION app_private.activacion_24h_asegurar_ficha_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_created jsonb;
  v_registro_id uuid := new.registro_hotel_id;
  v_seguimiento_id uuid := new.seguimiento_hotel_id;
  v_etapa_24h_id uuid;
  v_fecha_base date := new.fecha_activacion;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_lugar text;
  v_cronologia text;
  v_ids uuid[];
  v_prev_link text:=current_setting('app.paradas002_creando_activacion',true);
begin
  -- La actualización interna que guarda el vínculo vuelve a pasar por este
  -- trigger. Al recibir ya los identificadores solo sincroniza el contenido.
  if v_registro_id is null and TG_OP<>'INSERT' then return new; end if;
  if v_registro_id is null then
    v_lugar := coalesce(
      nullif(btrim(new.ubicacion_referencia), ''),
      nullif(btrim(concat_ws(' ', nullif(btrim(new.carretera), ''), nullif(btrim(new.punto_km), ''))), ''),
      ''
    );
    v_cronologia := app_private.cronologia_activacion_24h_alpha74(new);

    v_created := app_private.crear_ficha_hotel_con_etapas_alpha72(
      jsonb_build_object(
        'numero_parada', '',
        'vehiculo_sustituido', new.dfm,
        'matricula_sustituido', new.matricula,
        'vehiculo_reserva', '',
        'matricula_reserva', '',
        'etiqueta_reserva', '',
        'modalidad_operativa', 'sin_sustitucion',
        'tipo_unidad', '',
        'marca', new.marca,
        'tipo_motor', '',
        'modelo', new.modelo,
        'upc', new.upc,
        'telefono', new.telefono_conductor,
        'prioridad', 5,
        'estado', 'asistencia_24h',
        'lugar', v_lugar,
        'fecha_programada_parada', v_fecha_base,
        'fecha_parada', v_fecha_base,
        'fecha_entrada', '',
        'tipo_movimiento', '24H',
        'causa', new.averia,
        'trabajos_reserva', '',
        'incidencia', new.numero_caso,
        'proximo', '',
        'observaciones', 'Ficha creada automáticamente desde Activar 24H.',
        'sustitucion_temporal', false,
        'motivo_sustitucion_temporal', '',
        'fecha_limite_sustitucion', '',
        'orden', 0,
        'retirado_hotel_activo', false,
        'cancelado', false,
        'motivo_cancelacion', '',
        'manteniment_fecha_corte', '',
        'manteniment_tancament', '',
        'anotaciones_manuales', '[]'::jsonb
      ),
      jsonb_build_array(
        jsonb_build_object(
          'id', '', 'version', '', 'nombre', '24H · Avería', 'posicion', 1,
          'estado', 'en_curso', 'estado_catalogo_codigo', 'en_curso',
          'tipo_etapa', 'otro', 'taller_id', '', 'centro_taller_id', '',
          'taller_nombre', '', 'centro_nombre', '', 'lugar', v_lugar,
          'fecha_prevista', '', 'fecha_inicio_real', '', 'fecha_fin_real', '', 'fecha_real', '',
          'observaciones', v_cronologia, 'cancelado', false, 'motivo_cancelacion', '',
          'trabajos', jsonb_build_array(jsonb_build_object(
            'id', '', 'version', '', 'tipo_trabajo', 'AV', 'categoria_tecnica', '24H',
            'motivo_entrada', new.averia, 'diagnostico_real', new.diagnostico,
            'km_averia', coalesce(new.km_actual::text, ''), 'expediente', new.numero_caso,
            'descripcion', new.averia, 'peritaje_estado', '', 'observaciones', v_cronologia,
            'cancelado', false, 'motivo_cancelacion', ''
          ))
        )
      ),
      'activar24h_' || replace(new.id::text, '-', '')
    );

    v_registro_id := (v_created->>'id')::uuid;
    select r.seguimiento_id into v_seguimiento_id
    from public.registros_hotel r where r.id = v_registro_id;

    perform set_config('app.paradas002_creando_activacion',new.id::text,true);
    update public.activaciones_24h
    set registro_hotel_id = v_registro_id,
        seguimiento_hotel_id = v_seguimiento_id,
        modificado_por = coalesce(auth.uid(), modificado_por)
    where id = new.id
      and registro_hotel_id is null;
    perform set_config('app.paradas002_creando_activacion',coalesce(v_prev_link,''),true);
  end if;

  if v_registro_id is null or current_setting('app.sit24h_cierre_controlado',true)='1' then return new; end if;
  if new.estado='cerrada' and TG_OP='UPDATE'
     and new.registro_hotel_id is not distinct from old.registro_hotel_id
     and row(new.estado,new.resultado,new.fecha_activacion,new.hora_activacion,new.fecha_fin_reparacion,new.hora_fin_reparacion,new.estado_operativo_confirmado)
       is not distinct from row(old.estado,old.resultado,old.fecha_activacion,old.hora_activacion,old.fecha_fin_reparacion,old.hora_fin_reparacion,old.estado_operativo_confirmado) then return new; end if;
  if new.estado='cerrada' then
    perform app_private.sincronizar_cierre_24h_sit001(new.id);
    return new;
  end if;
  -- Un histórico ambiguo se conserva; las altas nuevas tienen vínculo único.
  if (select count(*) from public.activaciones_24h a where a.estado<>'anulada'
      and (a.registro_hotel_id=v_registro_id or a.seguimiento_hotel_id=v_seguimiento_id))<>1 then return new; end if;

  v_cronologia := app_private.cronologia_activacion_24h_alpha74(new);
  v_lugar := coalesce(
    nullif(btrim(new.ubicacion_referencia), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(new.carretera), ''), nullif(btrim(new.punto_km), ''))), ''),
    ''
  );
  v_inicio := case when new.hora_activacion is null then null else
    (v_fecha_base + new.hora_activacion) at time zone 'Europe/Madrid' end;
  select array_agg(e.id order by e.id) into v_ids
  from public.etapas_hotel e
  where e.registro_hotel_id=v_registro_id and not e.cancelado and e.estado<>'anulada'
    and not app_private.es_recuperacion_rec001(to_jsonb(e))
    and (lower(btrim(e.tipo_etapa))='24h' or (lower(btrim(e.tipo_etapa))='otro'
      and regexp_replace(upper(translate(e.nombre,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^A-Z0-9]+','','g')
        in ('24H','24HAVERIA','AVERIA24H','ASISTENCIA24H')));
  if coalesce(cardinality(v_ids),0)<>1 then return new; end if;
  v_etapa_24h_id:=v_ids[1];

  if v_etapa_24h_id is not null and current_setting('app.sit24h_cierre_controlado',true) IS DISTINCT FROM '1' then
    update public.etapas_hotel
    set tipo_etapa = '24H',
        lugar = v_lugar,
        observaciones = v_cronologia,
        fecha_inicio_real = coalesce(fecha_inicio_real, v_inicio),
        modificado_por = coalesce(auth.uid(), modificado_por),
        version = version + 1,
        actualizado_en = clock_timestamp()
    where id = v_etapa_24h_id;

    update public.trabajos_etapa_hotel
    set motivo_entrada = new.averia,
        diagnostico_real = new.diagnostico,
        expediente = new.numero_caso,
        descripcion = new.averia,
        observaciones = v_cronologia,
        km_averia = coalesce(new.km_actual, km_averia),
        modificado_por = coalesce(auth.uid(), modificado_por),
        version = version + 1,
        actualizado_en = clock_timestamp()
    where etapa_hotel_id = v_etapa_24h_id
      and not cancelado
      and upper(btrim(tipo_trabajo)) in ('AV', 'AVERÍA', 'AVERIA');
  end if;

  update public.registros_hotel r
  set causa = new.averia,
      incidencia = new.numero_caso,
      lugar = case when exists(select 1 from public.etapas_hotel e
        where e.registro_hotel_id=r.id and not e.cancelado and e.tipo_etapa='entrada_taller'
          and e.fecha_inicio_real is not null and e.fecha_real is null)
        then r.lugar else v_lugar end,
      modificado_por = coalesce(auth.uid(), modificado_por),
      version = version + 1,
      actualizado_en = clock_timestamp()
  where id = v_registro_id;

  return new;
exception when others then
  perform set_config('app.paradas002_creando_activacion',coalesce(v_prev_link,''),true);
  raise;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_reconciliar_asistencia_alpha74(p_registro_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
BEGIN
  -- MG75-24H-PARADAS-SEPARADAS-002: la fábrica crea exclusivamente su T24H.
  -- El taller requiere otra PA. Ningún reconciliado deduce T, recuperación,
  -- traslado, reordenación ni cambios retrospectivos a partir del resultado.
  RETURN;
END
$function$;

CREATE OR REPLACE FUNCTION app_private.activacion_24h_sincronizar_fecha_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_registro_id uuid := new.registro_hotel_id;
  v_seguimiento_id uuid;
  v_etapa_id uuid;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_cronologia text;
  v_ids uuid[];
begin
  if current_setting('app.sit24h_cierre_controlado',true)='1' then return new; end if;
  if v_registro_id is null then
    select a.registro_hotel_id into v_registro_id
    from public.activaciones_24h a
    where a.id = new.id;
  end if;
  if v_registro_id is null then return new; end if;

  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r
  where r.id = v_registro_id;

  if (select count(*) from public.activaciones_24h a where a.estado<>'anulada'
      and (a.registro_hotel_id=v_registro_id or a.seguimiento_hotel_id=v_seguimiento_id))<>1 then return new; end if;
  if new.estado='cerrada' then return new; end if;
  v_cronologia := app_private.cronologia_activacion_24h_alpha74(new);
  v_inicio := case when new.hora_activacion is null then null else
    (new.fecha_activacion + new.hora_activacion) at time zone 'Europe/Madrid' end;
  v_fin := case
    when new.fecha_fin_reparacion is null or new.hora_fin_reparacion is null then null
    else (new.fecha_fin_reparacion + new.hora_fin_reparacion) at time zone 'Europe/Madrid'
  end;

  select array_agg(e.id order by e.id) into v_ids
  from public.etapas_hotel e where e.registro_hotel_id=v_registro_id
    and not e.cancelado and e.estado<>'anulada'
    and not app_private.es_recuperacion_rec001(to_jsonb(e))
    and (lower(btrim(e.tipo_etapa))='24h' or (lower(btrim(e.tipo_etapa))='otro'
      and regexp_replace(upper(translate(e.nombre,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^A-Z0-9]+','','g')
        in ('24H','24HAVERIA','AVERIA24H','ASISTENCIA24H')));
  if coalesce(cardinality(v_ids),0)<>1 then return new; end if;
  v_etapa_id:=v_ids[1];
  if exists(select 1 from public.etapas_hotel e where e.id=v_etapa_id and e.estado='realizada') then return new; end if;

  update public.registros_hotel
  set fecha_parada = new.fecha_activacion,
      modificado_por = coalesce(auth.uid(), modificado_por),
      version = version + 1,
      actualizado_en = clock_timestamp()
  where id = v_registro_id
    and not exists(select 1 from public.etapas_hotel e where e.registro_hotel_id=v_registro_id
      and not e.cancelado and e.tipo_etapa='entrada_taller' and e.fecha_inicio_real is not null and e.fecha_real is null);

  update app_private.manteniment_parada_sync
  set fecha_programada_parada = new.fecha_activacion
  where seguimiento_id = v_seguimiento_id
    and not exists(select 1 from public.etapas_hotel e where e.registro_hotel_id=v_registro_id
      and not e.cancelado and e.tipo_etapa='entrada_taller' and e.fecha_inicio_real is not null and e.fecha_real is null);

  if v_etapa_id is not null and current_setting('app.sit24h_cierre_controlado',true) IS DISTINCT FROM '1' then
    update public.etapas_hotel
    set observaciones = v_cronologia,
        fecha_inicio_real = coalesce(v_inicio, fecha_inicio_real),
        fecha_fin_real = case when estado = 'realizada' then coalesce(v_fin, fecha_fin_real) else fecha_fin_real end,
        fecha_real = case when estado = 'realizada' then coalesce(v_fin, fecha_real) else fecha_real end,
        modificado_por = coalesce(auth.uid(), modificado_por),
        version = version + 1,
        actualizado_en = clock_timestamp()
    where id = v_etapa_id;

    update public.trabajos_etapa_hotel
    set observaciones = v_cronologia,
        modificado_por = coalesce(auth.uid(), modificado_por),
        version = version + 1,
        actualizado_en = clock_timestamp()
    where etapa_hotel_id = v_etapa_id
      and not cancelado
      and upper(btrim(tipo_trabajo)) in ('AV', 'AVERÍA', 'AVERIA');
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.asegurar_recuperacion_final()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare v_actor uuid; v_last_pos integer; v_name_normalized text;
begin
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
$function$;

CREATE OR REPLACE FUNCTION app_private.generar_recogida_tras_entrada_taller()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare v_actor uuid;
begin
  if exists(select 1 from public.registros_hotel r where r.id=new.registro_hotel_id
      and upper(btrim(coalesce(r.tipo_movimiento,'')))='24H') then return new; end if;
  if current_setting('app.clonando_pizarra',true)='1' then return new; end if;
  if current_setting('app.reconciliando_etapas',true)='1' then return new; end if;
  if current_setting('app.audit_origin',true)='metrogestion-r1-editor' then return new; end if;
  if app_private.usa_flujo_taller_hitos(new.registro_hotel_id) then return new; end if;
  if new.cancelado or new.tipo_etapa<>'entrada_taller' or new.etapa_origen_id is not null then return new; end if;
  if tg_op='UPDATE' and old.tipo_etapa='entrada_taller' and old.cancelado=false then return new; end if;
  if exists(select 1 from public.etapas_hotel r where r.etapa_origen_id=new.id and r.cancelado=false) then return new; end if;
  v_actor:=coalesce(auth.uid(),new.modificado_por,new.creado_por);
  set constraints etapas_hotel_posicion_activa_uq deferred;
  update public.etapas_hotel e set posicion=e.posicion+1,modificado_por=coalesce(v_actor,e.modificado_por)
  where e.registro_hotel_id=new.registro_hotel_id and e.cancelado=false and e.id<>new.id and e.posicion>new.posicion;
  insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,taller_id,centro_taller_id,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,cancelado,creado_por,modificado_por,etapa_origen_id)
  values(new.registro_hotel_id,gen_random_uuid(),'Recogida taller',new.posicion+1,'pendiente','recogida_taller',new.taller_id,new.centro_taller_id,new.lugar,null,null,null,null,'Generada automáticamente al crear la entrada a taller.',false,v_actor,v_actor,new.id);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.cerrar_modalidad_hotel_sin_recuperacion(p_registro_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE v_codigo text; v_comportamiento text;
BEGIN
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
END $function$;

CREATE OR REPLACE FUNCTION app_private.consolidar_rec001(p_registro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE r public.registros_hotel%ROWTYPE; v_count integer:=0; v_closed boolean:=false; v_state text; v_model text;
BEGIN
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
END $function$;

CREATE OR REPLACE FUNCTION app_private.aplicar_recuperacion_desde_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if current_setting('app.clonando_pizarra',true)='1' then return new; end if;

  if not app_private.modalidad_hotel_requiere_recuperacion(new.registro_hotel_id) then return new; end if;
  if new.cancelado=false
     and new.estado='realizada'
     and new.accion_sistema='recuperar_y_liberar'
     and (
       tg_op='INSERT'
       or old.estado is distinct from new.estado
       or old.cancelado is distinct from new.cancelado
     )
  then
    update public.registros_hotel
    set estado='recuperado',
        modificado_por=coalesce(auth.uid(),modificado_por),
        actualizado_en=clock_timestamp(),
        version=version+1
    where id=new.registro_hotel_id
      and not cancelado
      and estado is distinct from 'recuperado';

    perform app_private.liberar_sustituto_registro(new.registro_hotel_id);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.resolver_pendientes_reserva_desde_etapa_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if (lower(btrim(coalesce(new.tipo_etapa,'')))='24h' or
      (lower(btrim(coalesce(new.tipo_etapa,'')))='otro' and
       regexp_replace(upper(translate(coalesce(new.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^A-Z0-9]+','','g')
       in ('24H','24HAVERIA','AVERIA24H','ASISTENCIA24H')))
     and not exists (
       select 1 from public.registros_hotel r join public.activaciones_24h a
         on (a.registro_hotel_id=r.id or a.seguimiento_hotel_id=r.seguimiento_id)
       where r.id=new.registro_hotel_id and a.estado<>'anulada'
       group by r.id having count(*)=1 and bool_and(a.estado='cerrada'
         and a.resultado='operativo_reparado' and a.estado_operativo_confirmado and a.reparado_carretera)
     ) then return new; end if;
  if new.estado = 'realizada' and not new.cancelado then
    perform app_private.resolver_pendientes_reserva_por_etapa(new.id, 'automatico');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.resolver_reaperturas_pendiente_reserva()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_item record;
  v_token text;
  v_restantes text[];
begin
  if (lower(btrim(coalesce(new.tipo_etapa,'')))='24h' or
      (lower(btrim(coalesce(new.tipo_etapa,'')))='otro' and
       regexp_replace(upper(translate(coalesce(new.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^A-Z0-9]+','','g')
       in ('24H','24HAVERIA','AVERIA24H','ASISTENCIA24H')))
     and not exists (
       select 1 from public.registros_hotel r join public.activaciones_24h a
         on (a.registro_hotel_id=r.id or a.seguimiento_hotel_id=r.seguimiento_id)
       where r.id=new.registro_hotel_id and a.estado<>'anulada'
       group by r.id having count(*)=1 and bool_and(a.estado='cerrada'
         and a.resultado='operativo_reparado' and a.estado_operativo_confirmado and a.reparado_carretera)
     ) then return new; end if;
  if new.cancelado
     or new.estado <> 'realizada'
     or (tg_op = 'UPDATE' and old.estado = 'realizada' and not old.cancelado)
  then
    return new;
  end if;

  for v_item in
    select rp.id as reapertura_id,
           rr.reserva_id,
           rr.pendiente_codigo
    from app_private.reservas_pendientes_reaperturas rp
    join public.reservas_pendientes_resueltos rr on rr.id = rp.resolucion_id
    where rp.etapa_hotel_id = new.id
      and rp.resuelto_nuevamente_en is null
    for update of rp
  loop
    v_restantes := array[]::text[];
    for v_token in
      select btrim(p.parte)
      from public.reservas_hotel r
      cross join lateral regexp_split_to_table(
        r.pendientes,
        E'\\s*[+,;|\\n]+\\s*'
      ) with ordinality as p(parte, orden)
      where r.id = v_item.reserva_id
      order by p.orden
    loop
      if v_token <> ''
         and app_private.normalizar_codigo_pendiente(v_token) <> v_item.pendiente_codigo
      then
        v_restantes := array_append(v_restantes, v_token);
      end if;
    end loop;

    update public.reservas_hotel
       set pendientes = array_to_string(v_restantes, ' + '),
           modificado_por = coalesce(auth.uid(), new.modificado_por)
     where id = v_item.reserva_id;

    update app_private.reservas_pendientes_reaperturas
       set resuelto_nuevamente_en = clock_timestamp(),
           resuelto_nuevamente_por = coalesce(auth.uid(), new.modificado_por)
     where id = v_item.reapertura_id;
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.normalizar_estado_taller_24h_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if upper(btrim(coalesce(new.tipo_movimiento, ''))) = '24H'
     and NOT app_private.asistencia_24h_finalizada_sit001(new.id)
     and new.estado in (
       'en_taller',
       'pendiente_diagnostico',
       'pendiente_autorizacion',
       'pendiente_repuestos'
     )
     and not exists (
       select 1
       from public.etapas_hotel e
       where e.registro_hotel_id = new.id
         and not e.cancelado
         and e.tipo_etapa = 'entrada_taller'
         and e.estado <> 'anulada' and (e.estado = 'realizada' or (e.fecha_inicio_real is not null and e.fecha_real is null))
     )
  then
    new.estado := 'asistencia_24h';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.sincronizar_estado_24h_desde_entrada_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_registro_id uuid;
  v_registro public.registros_hotel%rowtype;
  v_tiene_entrada_realizada boolean;
  v_estado_taller text;
begin
  v_registro_id := case
    when tg_op = 'DELETE' then old.registro_hotel_id
    else new.registro_hotel_id
  end;

  select r.* into v_registro
  from public.registros_hotel r
  where r.id = v_registro_id
  for update;

  if not found
     or upper(btrim(coalesce(v_registro.tipo_movimiento, ''))) <> '24H'
  then
    return coalesce(new, old);
  end if;

  select exists (
    select 1
    from public.etapas_hotel e
    where e.registro_hotel_id = v_registro_id
      and not e.cancelado
      and e.tipo_etapa = 'entrada_taller'
      and e.estado <> 'anulada' and (e.estado = 'realizada' or (e.fecha_inicio_real is not null and e.fecha_real is null))
  ) into v_tiene_entrada_realizada;

  if v_tiene_entrada_realizada and v_registro.estado = 'asistencia_24h' then
    select case a.estado_seguimiento
      when 'pendiente_diagnostico' then 'pendiente_diagnostico'
      when 'pendiente_autorizacion' then 'pendiente_autorizacion'
      when 'pendiente_repuestos' then 'pendiente_repuestos'
      else 'en_taller'
    end
      into v_estado_taller
    from public.activaciones_24h a
    where coalesce(a.estado, '') <> 'anulada'
      and (a.registro_hotel_id = v_registro_id
           or a.seguimiento_hotel_id = v_registro.seguimiento_id)
    order by (a.registro_hotel_id = v_registro_id) desc,
             a.actualizado_en desc, a.creado_en desc
    limit 1;

    update public.registros_hotel
    set estado = coalesce(v_estado_taller, 'en_taller')
    where id = v_registro_id;
  elsif not v_tiene_entrada_realizada
        and NOT app_private.asistencia_24h_finalizada_sit001(v_registro_id)
        and v_registro.estado in (
          'en_taller',
          'pendiente_diagnostico',
          'pendiente_autorizacion',
          'pendiente_repuestos'
        )
  then
    update public.registros_hotel
    set estado = 'asistencia_24h'
    where id = v_registro_id;
  end if;

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.guardar_ficha_hotel_edicion(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_saved jsonb;
  v_reconciled jsonb;
  v_audit_count integer;
  v_board_state text;
  v_before public.registros_hotel%rowtype;
  v_prop_rows integer:=0;
  v_prop_stages integer:=0;
  v_norm integer:=0;
begin
  select * into v_before
  from public.registros_hotel
  where id=p_registro_id;
  if not found then raise exception 'Ficha de Hotel no encontrada'; end if;

  v_saved:=public.guardar_ficha_hotel_edicion_core(p_registro_id,p_version,p_ficha,p_etapas,p_request_id);

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

  v_prop_rows:=app_private.propagar_correcciones_globales_parada(p_registro_id,to_jsonb(v_before));
  v_prop_stages:=app_private.propagar_detalles_t_parada(p_registro_id);
  v_norm:=app_private.normalizar_orden_t_parada(p_registro_id);

  select p.estado into v_board_state
  from public.registros_hotel r
  join public.pizarras p on p.id=r.pizarra_id
  where r.id=p_registro_id;

  if v_board_state='en_curso' then
    v_reconciled:=public.reconciliar_etapas_hotel(p_registro_id,p_request_id);
    select count(*) into v_audit_count from public.auditoria_cambios where request_id=p_request_id;
    return v_saved || jsonb_build_object(
      'detalle',v_reconciled->'detalle',
      'eventos_auditoria',v_audit_count,
      'reconciliado',true,
      'impacto_operativo',coalesce(v_reconciled->'impacto_operativo','{}'::jsonb),
      'dias_propagados',v_prop_rows,
      't_propagadas',v_prop_stages,
      't_reordenadas',v_norm
    );
  end if;

  if v_board_state='archivada' then
    perform app_private.asegurar_reactivacion_historica(p_registro_id);
  end if;

  select count(*) into v_audit_count from public.auditoria_cambios where request_id=p_request_id;
  return v_saved || jsonb_build_object(
    'eventos_auditoria',v_audit_count,
    'reconciliado',false,
    'impacto_operativo',jsonb_build_object(
      'recogidas_anuladas',0,
      'recogidas_restauradas',0,
      'recogidas_creadas',0,
      'recuperaciones_creadas',0,
      'recuperaciones_anuladas',0,
      'fechas_manteniment_actualizadas',0,
      'manteniment_encolado',false
    ),
    'dias_propagados',v_prop_rows,
    't_propagadas',v_prop_stages,
    't_reordenadas',v_norm
  );
end;
$function$;

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
$function$;

CREATE FUNCTION app_private.proteger_cierre_24h_paradas002()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private'
AS $function$
BEGIN
  IF NEW.estado<>'cerrada' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.estado,NEW.resultado,NEW.fecha_activacion,NEW.hora_activacion,
      NEW.fecha_fin_reparacion,NEW.hora_fin_reparacion,NEW.estado_operativo_confirmado)
      IS NOT DISTINCT FROM ROW(OLD.estado,OLD.resultado,OLD.fecha_activacion,OLD.hora_activacion,
      OLD.fecha_fin_reparacion,OLD.hora_fin_reparacion,OLD.estado_operativo_confirmado) THEN RETURN NEW; END IF;
  IF NEW.resultado NOT IN ('operativo_reparado','trasladado_taller','necesita_sustitucion')
     OR NEW.fecha_activacion IS NULL OR NEW.hora_activacion IS NULL
     OR NEW.fecha_fin_reparacion IS NULL OR NEW.hora_fin_reparacion IS NULL THEN
    RAISE EXCEPTION 'PARADAS-002: un cierre 24H necesita resultado y fechas reales completos' USING ERRCODE='23514';
  END IF;
  IF ((NEW.fecha_fin_reparacion+NEW.hora_fin_reparacion) AT TIME ZONE 'Europe/Madrid')
      < ((NEW.fecha_activacion+NEW.hora_activacion) AT TIME ZONE 'Europe/Madrid') THEN
    RAISE EXCEPTION 'PARADAS-002: el fin real no puede preceder a la activación' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION app_private.proteger_cierre_24h_paradas002() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER activaciones_24h_proteger_cierre_paradas002
BEFORE INSERT OR UPDATE ON public.activaciones_24h
FOR EACH ROW EXECUTE FUNCTION app_private.proteger_cierre_24h_paradas002();

CREATE FUNCTION app_private.proteger_sustitucion_paradas002()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','app_private'
AS $function$
DECLARE
  v_dfm text:=regexp_replace(upper(btrim(coalesce(NEW.vehiculo_reserva,''))),'[[:space:]]+','','g');
  v_mat text:=regexp_replace(upper(btrim(coalesce(NEW.matricula_reserva,''))),'[^A-Z0-9]+','','g');
  v_catalogo record; v_key text; v_otra text;
BEGIN
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
      AND NOT r.cancelado AND NOT r.retirado_hotel_activo
      AND r.estado NOT IN ('recuperado','reserva_liberada','anulado')
      AND (upper(btrim(coalesce(NEW.tipo_movimiento,'')))='24H'
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
$function$;
REVOKE ALL ON FUNCTION app_private.proteger_sustitucion_paradas002() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER registros_hotel_proteger_sustitucion_paradas002
BEFORE INSERT OR UPDATE OF vehiculo_reserva,matricula_reserva,estado,cancelado,retirado_hotel_activo,pizarra_id,tipo_movimiento ON public.registros_hotel
FOR EACH ROW EXECUTE FUNCTION app_private.proteger_sustitucion_paradas002();

DO $security$
BEGIN
  IF EXISTS(SELECT 1 FROM paradas002_function_security b
    LEFT JOIN pg_proc p ON p.oid=b.oid
    WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner
      OR p.proacl IS DISTINCT FROM b.proacl OR p.prosecdef IS DISTINCT FROM b.prosecdef
      OR p.proconfig IS DISTINCT FROM b.proconfig OR p.provolatile IS DISTINCT FROM b.provolatile) THEN
    RAISE EXCEPTION 'PARADAS-002: una definición alteró permisos o barreras; migración revertida';
  END IF;
END
$security$;
COMMIT;
