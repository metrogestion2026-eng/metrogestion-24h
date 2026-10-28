-- Schema-only runtime baseline, captured by authorized read 2026-10-28.
-- No operational rows, credentials or personal data. FOR LOCAL TESTS ONLY.
SET check_function_bodies=off;
CREATE OR REPLACE FUNCTION app_private.activacion_24h_vincular_hotel_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_match record;
begin
  if new.registro_hotel_id is not null or new.seguimiento_hotel_id is not null then
    return new;
  end if;

  select r.id, r.seguimiento_id
  into v_match
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where not r.cancelado
    and not r.retirado_hotel_activo
    and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
    and regexp_replace(upper(btrim(coalesce(r.vehiculo_sustituido, ''))), '[[:space:]]+', '', 'g')
      = regexp_replace(upper(btrim(coalesce(new.dfm, ''))), '[[:space:]]+', '', 'g')
    and (
      btrim(coalesce(new.matricula, '')) = ''
      or btrim(coalesce(r.matricula_sustituido, '')) = ''
      or regexp_replace(upper(btrim(new.matricula)), '[^A-Z0-9]+', '', 'g')
         = regexp_replace(upper(btrim(r.matricula_sustituido)), '[^A-Z0-9]+', '', 'g')
    )
    and exists (
      select 1
      from public.etapas_hotel e
      where e.registro_hotel_id = r.id
        and not e.cancelado
        and regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[^A-Z0-9]+', '', 'g')
          in ('24H', 'ASISTENCIA24H')
    )
  order by (p.estado = 'en_curso') desc, p.fecha desc,
           r.actualizado_en desc, r.id desc
  limit 1;

  if v_match.id is not null then
    new.registro_hotel_id := v_match.id;
    new.seguimiento_hotel_id := v_match.seguimiento_id;
  end if;
  return new;
end;
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
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;
  if v_dfm = '' then raise exception 'Debes indicar el DFM'; end if;
  if btrim(coalesce(p_payload->>'averia','')) = '' then raise exception 'Debes describir la avería'; end if;

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
    v_estado := 'abierta';
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

  return jsonb_build_object('ok',true,'id',v_id,'version',v_version);
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

  if v_fecha is not null then
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
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;
  if v_situacion not in (
    'en_curso', 'pendiente_diagnostico', 'pendiente_presupuesto',
    'pendiente_autorizacion', 'pendiente_repuestos', 'en_reparacion'
  ) then
    raise exception 'La situación actual de la asistencia no es válida';
  end if;
  if v_resultado = 'necesita_sustitucion' and v_sustituto = '' and v_matricula = '' then
    raise exception 'Debes indicar el DFM o la matrícula del vehículo sustituto';
  end if;

  v_result := app_private.guardar_activacion_24h_con_fecha_alpha74(p_id, p_payload, p_request_id);
  v_id := (v_result->>'id')::uuid;

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

  v_estado_hotel := case v_situacion
    when 'pendiente_diagnostico' then 'pendiente_diagnostico'
    when 'pendiente_presupuesto' then 'pendiente_autorizacion'
    when 'pendiente_autorizacion' then 'pendiente_autorizacion'
    when 'pendiente_repuestos' then 'pendiente_repuestos'
    when 'en_reparacion' then 'en_taller'
    else 'asistencia_24h'
  end;

  if v_registro_id is not null and v_resultado <> 'operativo_reparado' then
    update public.registros_hotel r
    set estado = v_estado_hotel,
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
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.guardar_activacion_24h_cierre_fecha_alpha75(p_id uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE v_result jsonb; v_id uuid; v_registro uuid; cierre jsonb; v_done boolean:=coalesce(p_payload->>'resultado','')='operativo_reparado'; v_payload jsonb:=p_payload; prev_scope text:=current_setting('app.sit24h_cierre_controlado',true);
BEGIN
 IF auth.uid() IS NULL OR NOT public.dispositivo_autorizado() OR NOT public.puede_editar_modulo('activar24h') THEN RAISE EXCEPTION 'No tienes permiso para activar 24H'; END IF;
 IF coalesce(p_payload->>'estado_seguimiento','')='realizada' AND NOT v_done THEN RAISE EXCEPTION 'SIT-24H-001: Realizada requiere el resultado reparado/operativo y sus fechas reales'; END IF;
 IF v_done THEN PERFORM set_config('app.sit24h_cierre_controlado','1',true); v_payload:=jsonb_set(v_payload,'{estado_seguimiento}','"en_curso"'); END IF;
 v_result:=app_private.guardar_activacion_24h_operativa_alpha74(p_id,v_payload,p_request_id); v_id:=(v_result->>'id')::uuid;
 SELECT x.registro_hotel_id INTO v_registro FROM public.activaciones_24h x WHERE x.id=v_id;
 IF v_done THEN cierre:=app_private.sincronizar_cierre_24h_sit001(v_id); ELSE cierre:='{}'; END IF;
 PERFORM set_config('app.sit24h_cierre_controlado',coalesce(prev_scope,''),true);
 RETURN v_result || cierre || jsonb_build_object('fecha_fin_reparacion',(SELECT x.fecha_fin_reparacion FROM public.activaciones_24h x WHERE x.id=v_id),'estado_hotel',(SELECT x.estado FROM public.registros_hotel x WHERE x.id=v_registro));
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.sit24h_cierre_controlado',coalesce(prev_scope,''),true); RAISE;
END $function$;

CREATE OR REPLACE FUNCTION app_private.sincronizar_cierre_24h_sit001(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE a public.activaciones_24h%ROWTYPE; r public.registros_hotel%ROWTYPE; e public.etapas_hotel%ROWTYPE; pendiente public.etapas_hotel%ROWTYPE;
 ids uuid[]; t0 timestamptz; t1 timestamptz; v_estado text; v_modelo boolean; v_requires boolean;
 prev_scope text:=current_setting('app.sit24h_cierre_controlado',true); prev_recon text:=current_setting('app.reconciliando_etapas',true);
 others_before jsonb; others_after jsonb;
BEGIN
 SELECT x.* INTO a FROM public.activaciones_24h x WHERE x.id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SIT-24H-001: no existe la asistencia solicitada'; END IF;
 IF a.estado<>'cerrada' OR a.resultado<>'operativo_reparado' OR NOT coalesce(a.estado_operativo_confirmado,false) OR NOT coalesce(a.reparado_carretera,false) THEN RAISE EXCEPTION 'SIT-24H-001: realizada exige reparación y operatividad confirmadas'; END IF;
 IF a.fecha_activacion IS NULL OR a.hora_activacion IS NULL OR a.fecha_fin_reparacion IS NULL OR a.hora_fin_reparacion IS NULL THEN RAISE EXCEPTION 'SIT-24H-001: indica las fechas y horas reales de activación y fin'; END IF;
 t0:=(a.fecha_activacion+a.hora_activacion) AT TIME ZONE 'Europe/Madrid';
 t1:=(a.fecha_fin_reparacion+a.hora_fin_reparacion) AT TIME ZONE 'Europe/Madrid';
 IF t1<t0 THEN RAISE EXCEPTION 'SIT-24H-001: el fin real no puede preceder a la activación'; END IF;
 SELECT x.* INTO r FROM public.registros_hotel x WHERE x.id=a.registro_hotel_id AND NOT x.cancelado FOR UPDATE;
 IF NOT FOUND OR r.seguimiento_id IS DISTINCT FROM a.seguimiento_hotel_id OR upper(btrim(coalesce(r.vehiculo_sustituido,'')))<>upper(btrim(coalesce(a.dfm,''))) THEN RAISE EXCEPTION 'SIT-24H-001: el vínculo asistencia/ficha no es inequívoco; no se modifica ninguna T'; END IF;
 IF (SELECT count(*) FROM public.activaciones_24h x WHERE x.estado<>'anulada' AND (x.registro_hotel_id=r.id OR x.seguimiento_hotel_id=r.seguimiento_id))<>1 THEN RAISE EXCEPTION 'SIT-24H-001: hay varias asistencias vinculadas; se requiere revisar la T exacta'; END IF;
 PERFORM 1 FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id FOR UPDATE;
 SELECT array_agg(x.id ORDER BY x.id) INTO ids FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id AND NOT x.cancelado AND x.estado<>'anulada' AND NOT app_private.es_recuperacion_rec001(to_jsonb(x))
 AND (lower(btrim(coalesce(x.tipo_etapa,'')))='24h' OR (lower(btrim(coalesce(x.tipo_etapa,'')))='otro' AND regexp_replace(upper(translate(coalesce(x.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^A-Z0-9]+','','g') IN ('24H','24HAVERIA','AVERIA24H','ASISTENCIA24H')));
 IF coalesce(cardinality(ids),0)<>1 THEN RAISE EXCEPTION 'SIT-24H-001: no se identifica una única T de asistencia (encontradas: %); no se elige por posición',coalesce(cardinality(ids),0); END IF;
 SELECT x.* INTO STRICT e FROM public.etapas_hotel x WHERE x.id=ids[1];
 IF (e.fecha_inicio_real IS NOT NULL AND e.fecha_inicio_real<>t0) OR (e.fecha_fin_real IS NOT NULL AND e.fecha_fin_real<>t1) OR (e.fecha_real IS NOT NULL AND e.fecha_real<>t1) THEN RAISE EXCEPTION 'SIT-24H-001: la T ya contiene fechas distintas; se conservan para revisión'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO others_before FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id AND x.id<>e.id;
 v_requires:=app_private.modalidad_hotel_requiere_recuperacion(r.id);
 PERFORM set_config('app.sit24h_cierre_controlado','1',true); PERFORM set_config('app.reconciliando_etapas','1',true);
 UPDATE public.activaciones_24h x SET estado_seguimiento='realizada',modificado_por=coalesce(auth.uid(),x.modificado_por),actualizado_en=clock_timestamp(),version=x.version+1 WHERE x.id=a.id AND x.estado_seguimiento IS DISTINCT FROM 'realizada';
 UPDATE public.etapas_hotel x SET estado='realizada',estado_catalogo_codigo=CASE WHEN x.estado='realizada' THEN x.estado_catalogo_codigo ELSE 'realizada' END,fecha_inicio_real=t0,fecha_fin_real=t1,fecha_real=t1,modificado_por=coalesce(auth.uid(),x.modificado_por)
 WHERE x.id=e.id AND (x.estado<>'realizada' OR x.fecha_inicio_real IS DISTINCT FROM t0 OR x.fecha_fin_real IS DISTINCT FROM t1 OR x.fecha_real IS DISTINCT FROM t1);
 PERFORM app_private.consolidar_rec001(r.id);
 SELECT x.* INTO STRICT r FROM public.registros_hotel x WHERE x.id=a.registro_hotel_id;
 IF NOT r.retirado_hotel_activo THEN
  v_modelo:=app_private.usa_flujo_taller_hitos(r.id);
  SELECT x.* INTO pendiente FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id AND NOT x.cancelado AND x.estado<>'anulada' AND NOT app_private.es_recuperacion_rec001(to_jsonb(x)) AND ((x.tipo_etapa='entrada_taller' AND v_modelo AND (x.fecha_inicio_real IS NULL OR x.fecha_fin_real IS NULL OR x.fecha_real IS NULL)) OR x.estado<>'realizada')
  ORDER BY CASE WHEN x.tipo_etapa IN ('entrada_taller','recogida_taller') THEN 0 ELSE 1 END,x.posicion,x.id LIMIT 1;
  IF FOUND THEN v_estado:=CASE WHEN pendiente.tipo_etapa='entrada_taller' AND v_modelo THEN CASE WHEN pendiente.fecha_inicio_real IS NULL THEN CASE WHEN pendiente.fecha_prevista IS NOT NULL THEN 'entrada_taller_programada' ELSE 'pendiente_taller' END WHEN pendiente.fecha_fin_real IS NULL THEN 'en_taller' ELSE 'terminado_pendiente_recogida' END WHEN pendiente.tipo_etapa='entrada_taller' THEN CASE WHEN pendiente.fecha_prevista IS NOT NULL THEN 'entrada_taller_programada' ELSE 'pendiente_taller' END WHEN pendiente.tipo_etapa='recogida_taller' THEN 'terminado_pendiente_recogida' ELSE 't_pendientes' END;
  ELSIF v_requires AND EXISTS(SELECT 1 FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id AND NOT x.cancelado AND x.estado IN ('pendiente','programada','en_curso') AND app_private.es_recuperacion_rec001(to_jsonb(x))) THEN v_estado:='recogido_pendiente_ruta';
  ELSE v_estado:='t_pendientes'; END IF;
  UPDATE public.registros_hotel x SET estado=v_estado,modificado_por=coalesce(auth.uid(),x.modificado_por) WHERE x.id=r.id AND x.estado IS DISTINCT FROM v_estado;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO others_after FROM public.etapas_hotel x WHERE x.registro_hotel_id=r.id AND x.id<>e.id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(others_before) b WHERE NOT app_private.es_recuperacion_rec001(b) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(others_after) z WHERE z=b)) THEN RAISE EXCEPTION 'SIT-24H-001: una cascada alteró otra T; guardado revertido para conservarla'; END IF;
 PERFORM set_config('app.reconciliando_etapas',coalesce(prev_recon,''),true); PERFORM set_config('app.sit24h_cierre_controlado',coalesce(prev_scope,''),true);
 RETURN jsonb_build_object('regla','sit24h-2026.10.20.1','etapa_id',e.id,'estado_t','realizada','fecha_inicio_real',t0,'fecha_fin_real',t1,'estado_seguimiento','realizada','estado_hotel',(SELECT x.estado FROM public.registros_hotel x WHERE x.id=r.id),'retirado_hotel',(SELECT x.retirado_hotel_activo FROM public.registros_hotel x WHERE x.id=r.id),'version',(SELECT x.version FROM public.activaciones_24h x WHERE x.id=a.id));
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.reconciliando_etapas',coalesce(prev_recon,''),true); PERFORM set_config('app.sit24h_cierre_controlado',coalesce(prev_scope,''),true); RAISE;
END $function$;

CREATE OR REPLACE FUNCTION app_private.asistencia_24h_finalizada_sit001(p_registro_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
SELECT EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=(SELECT r.seguimiento_id FROM public.registros_hotel r WHERE r.id=p_registro_id)) AND a.estado='cerrada' AND a.resultado='operativo_reparado' AND a.estado_operativo_confirmado AND a.reparado_carretera)
AND NOT EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=(SELECT r.seguimiento_id FROM public.registros_hotel r WHERE r.id=p_registro_id)) AND a.estado='abierta');
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
  v_fecha_base date := (new.creado_en at time zone 'Europe/Madrid')::date;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_lugar text;
  v_cronologia text;
  v_cerrada boolean;
begin
  -- La actualización interna que guarda el vínculo vuelve a pasar por este
  -- trigger. Al recibir ya los identificadores solo sincroniza el contenido.
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

    update public.activaciones_24h
    set registro_hotel_id = v_registro_id,
        seguimiento_hotel_id = v_seguimiento_id,
        modificado_por = coalesce(auth.uid(), modificado_por)
    where id = new.id
      and registro_hotel_id is null;
  end if;

  if v_registro_id is null then
    return new;
  end if;

  v_cronologia := app_private.cronologia_activacion_24h_alpha74(new);
  v_lugar := coalesce(
    nullif(btrim(new.ubicacion_referencia), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(new.carretera), ''), nullif(btrim(new.punto_km), ''))), ''),
    ''
  );
  v_inicio := case when new.hora_activacion is null then null else
    (v_fecha_base + new.hora_activacion) at time zone 'Europe/Madrid' end;
  v_fin := case when new.hora_fin_reparacion is null then null else
    (v_fecha_base + case when new.hora_activacion is not null and new.hora_fin_reparacion < new.hora_activacion then 1 else 0 end + new.hora_fin_reparacion)
      at time zone 'Europe/Madrid' end;
  v_cerrada := new.estado = 'cerrada'
    or new.resultado in ('operativo_reparado', 'trasladado_taller');

  select e.id into v_etapa_24h_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_registro_id
    and not e.cancelado
    and regexp_replace(upper(e.nombre), '[^A-Z0-9]+', '', 'g') in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H')
  order by e.posicion, e.creado_en
  limit 1;

  if v_etapa_24h_id is not null and current_setting('app.sit24h_cierre_controlado',true) IS DISTINCT FROM '1' then
    update public.etapas_hotel
    set nombre = '24H · Avería',
        lugar = v_lugar,
        observaciones = v_cronologia,
        fecha_inicio_real = coalesce(fecha_inicio_real, v_inicio),
        fecha_fin_real = case when v_cerrada then coalesce(v_fin, fecha_fin_real, clock_timestamp()) else fecha_fin_real end,
        fecha_real = case when v_cerrada then coalesce(v_fin, fecha_real, clock_timestamp()) else fecha_real end,
        estado = case when v_cerrada then 'realizada' else estado end,
        estado_catalogo_codigo = case when v_cerrada then 'realizada' else estado_catalogo_codigo end,
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

  update public.registros_hotel
  set causa = new.averia,
      incidencia = new.numero_caso,
      lugar = v_lugar,
      modificado_por = coalesce(auth.uid(), modificado_por),
      version = version + 1,
      actualizado_en = clock_timestamp()
  where id = v_registro_id;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_reconciliar_asistencia_alpha74(p_registro_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_ficha public.registros_hotel%rowtype;
  v_activacion public.activaciones_24h%rowtype;
  v_asistencia_id uuid;
  v_recovery_id uuid;
  v_entry_id uuid;
  v_pickup_id uuid;
  v_job_id uuid;
  v_taller text := '';
  v_traslado boolean := false;
  v_pos integer;
  v_actor uuid;
begin
  select * into v_ficha
  from public.registros_hotel
  where id = p_registro_id
  for update;

  if v_ficha.id is null or upper(btrim(coalesce(v_ficha.tipo_movimiento, ''))) <> '24H' then
    return;
  end if;

  select * into v_activacion
  from public.activaciones_24h a
  where coalesce(a.estado, '') <> 'anulada'
    and (a.registro_hotel_id = v_ficha.id or a.seguimiento_hotel_id = v_ficha.seguimiento_id)
  order by (a.registro_hotel_id = v_ficha.id) desc,
           (a.estado = 'abierta') desc, a.actualizado_en desc, a.creado_en desc
  limit 1;

  select e.id into v_asistencia_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_ficha.id
    and not e.cancelado
    and regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[^A-Z0-9]+', '', 'g')
      in ('24H', '24HAVERIA', '24HAVERA', 'AVERIA24H', 'ASISTENCIA24H')
  order by (e.estado = 'en_curso') desc, e.posicion, e.creado_en
  limit 1;

  if v_asistencia_id is null then
    return;
  end if;

  v_actor := coalesce(v_ficha.modificado_por, v_ficha.creado_por);
  v_traslado := coalesce(v_activacion.trasladado_taller, false)
    or lower(btrim(coalesce(v_activacion.resultado, ''))) = 'trasladado_taller';
  v_taller := btrim(coalesce(v_activacion.taller_traslado, ''));

  perform set_config('app.reconciliando_etapas', '1', true);
  perform set_config('app.audit_origin', 'alpha74-24h-aislada-manteniment', true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  -- La primera T siempre es la avería de asistencia 24H.
  update public.etapas_hotel
  set nombre = '24H · Avería',
      tipo_etapa = '24H',
      modificado_por = coalesce(v_actor, modificado_por),
      actualizado_en = clock_timestamp(),
      version = version + 1
  where id = v_asistencia_id;

  select t.id into v_job_id
  from public.trabajos_etapa_hotel t
  where t.etapa_hotel_id = v_asistencia_id
    and not t.cancelado
    and upper(btrim(coalesce(t.tipo_trabajo, ''))) in ('AV', 'AVERÍA', 'AVERIA')
    and upper(btrim(coalesce(t.categoria_tecnica, ''))) = '24H'
  order by t.creado_en, t.id
  limit 1;

  if v_job_id is null then
    insert into public.trabajos_etapa_hotel(
      etapa_hotel_id, tipo_trabajo, categoria_tecnica, motivo_entrada,
      diagnostico_real, km_averia, expediente, descripcion, observaciones,
      cancelado, creado_por, modificado_por
    ) values (
      v_asistencia_id, 'AV', '24H', v_activacion.averia,
      v_activacion.diagnostico, v_activacion.km_actual,
      v_activacion.numero_caso, v_activacion.averia,
      app_private.cronologia_activacion_24h_alpha74(v_activacion),
      false, v_actor, v_actor
    );
  end if;

  -- Libera posiciones antes de restaurar o crear T operativas.
  update public.etapas_hotel e
  set posicion = e.posicion + 10000,
      modificado_por = coalesce(v_actor, e.modificado_por)
  where e.registro_hotel_id = v_ficha.id
    and not e.cancelado;

  if app_private.modalidad_hotel_requiere_recuperacion(v_ficha.id) then
  select e.id into v_recovery_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_ficha.id
    and e.accion_sistema = 'recuperar_y_liberar'
  order by e.cancelado, e.creado_en, e.id
  limit 1;

  if v_recovery_id is null then
    insert into public.etapas_hotel(
      registro_hotel_id, seguimiento_id, nombre, posicion, estado,
      estado_catalogo_codigo, tipo_etapa, lugar, observaciones, cancelado,
      creado_por, modificado_por, accion_sistema
    ) values (
      v_ficha.id, gen_random_uuid(), 'Recuperar ruta y liberar reserva',
      20000, 'pendiente', 'pendiente', 'recuperar_ruta', '',
      'Generada automáticamente como T final de cierre.', false,
      v_actor, v_actor, 'recuperar_y_liberar'
    ) returning id into v_recovery_id;
  else
    update public.etapas_hotel
    set cancelado = false,
        estado = 'pendiente',
        estado_catalogo_codigo = 'pendiente',
        tipo_etapa = 'recuperar_ruta',
        motivo_cancelacion = '',
        cancelado_en = null,
        cancelado_por = null,
        modificado_por = coalesce(v_actor, modificado_por),
        actualizado_en = clock_timestamp(),
        version = version + 1
    where id = v_recovery_id
      and cancelado;
  end if;

  else
    perform app_private.anular_recuperacion_improcedente_rec001(v_ficha.id,v_actor);
  end if;

  -- Solo una grúa confirmada con taller crea las T de Entrada y Recogida.
  if v_traslado and v_taller <> '' then
    select e.id into v_entry_id
    from public.etapas_hotel e
    where e.registro_hotel_id = v_ficha.id
      and not e.cancelado
      and e.tipo_etapa = 'entrada_taller'
      and (
        regexp_replace(upper(btrim(coalesce(e.lugar, ''))), '[[:space:]]+', ' ', 'g')
          = regexp_replace(upper(v_taller), '[[:space:]]+', ' ', 'g')
        or regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[^A-Z0-9]+', '', 'g')
          = 'ENTRADA' || regexp_replace(upper(v_taller), '[^A-Z0-9]+', '', 'g')
      )
    order by e.posicion, e.creado_en, e.id
    limit 1;

    if v_entry_id is null then
      insert into public.etapas_hotel(
        registro_hotel_id, seguimiento_id, nombre, posicion, estado,
        estado_catalogo_codigo, tipo_etapa, lugar, observaciones, cancelado,
        creado_por, modificado_por
      ) values (
        v_ficha.id, gen_random_uuid(), 'Entrada ' || v_taller, 15000,
        'pendiente', 'pendiente', 'entrada_taller', v_taller,
        'Generada al confirmar traslado en grúa desde la asistencia 24H.',
        false, v_actor, v_actor
      ) returning id into v_entry_id;
    end if;

    select e.id into v_pickup_id
    from public.etapas_hotel e
    where e.registro_hotel_id = v_ficha.id
      and not e.cancelado
      and e.tipo_etapa = 'recogida_taller'
      and e.etapa_origen_id = v_entry_id
    order by e.posicion, e.creado_en, e.id
    limit 1;

    if v_pickup_id is null then
      insert into public.etapas_hotel(
        registro_hotel_id, seguimiento_id, nombre, posicion, estado,
        estado_catalogo_codigo, tipo_etapa, lugar, observaciones, cancelado,
        creado_por, modificado_por, etapa_origen_id
      ) values (
        v_ficha.id, gen_random_uuid(), 'Recogida ' || v_taller, 16000,
        'pendiente', 'pendiente', 'recogida_taller', v_taller,
        'Generada al confirmar traslado en grúa desde la asistencia 24H.',
        false, v_actor, v_actor, v_entry_id
      );
    end if;
  end if;

  -- Orden final: Avería 24H, Entrada/Recogida si existen y Recuperar ruta.
  with ordenadas as (
    select e.id,
           row_number() over (
             order by case
               when e.id = v_asistencia_id then 0
               when e.tipo_etapa = 'entrada_taller' then 10
               when e.tipo_etapa = 'recogida_taller' then 20
               when e.accion_sistema = 'recuperar_y_liberar' then 99
               else 50
             end,
             e.posicion, e.creado_en, e.id
           )::integer as posicion
    from public.etapas_hotel e
    where e.registro_hotel_id = v_ficha.id
      and not e.cancelado
  )
  update public.etapas_hotel e
  set posicion = o.posicion,
      modificado_por = coalesce(v_actor, e.modificado_por)
  from ordenadas o
  where e.id = o.id;

  if v_traslado and v_taller <> '' then
    update public.registros_hotel
    set estado = 'en_taller',
        lugar = v_taller,
        modificado_por = coalesce(v_actor, modificado_por),
        actualizado_en = clock_timestamp(),
        version = version + 1
    where id = v_ficha.id;
  end if;

  perform set_config('app.reconciliando_etapas', '0', true);
  perform app_private.consolidar_rec001(v_ficha.id);
  perform app_private.manteniment_encolar_parada(v_ficha.seguimiento_id);
exception when others then
  perform set_config('app.reconciliando_etapas', '0', true);
  raise;
end;
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
begin
  if v_registro_id is null then
    select a.registro_hotel_id into v_registro_id
    from public.activaciones_24h a
    where a.id = new.id;
  end if;
  if v_registro_id is null then return new; end if;

  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r
  where r.id = v_registro_id;

  v_cronologia := app_private.cronologia_activacion_24h_alpha74(new);
  v_inicio := case when new.hora_activacion is null then null else
    (new.fecha_activacion + new.hora_activacion) at time zone 'Europe/Madrid' end;
  v_fin := case
    when new.fecha_fin_reparacion is null or new.hora_fin_reparacion is null then null
    else (new.fecha_fin_reparacion + new.hora_fin_reparacion) at time zone 'Europe/Madrid'
  end;

  update public.registros_hotel
  set fecha_parada = new.fecha_activacion,
      modificado_por = coalesce(auth.uid(), modificado_por),
      version = version + 1,
      actualizado_en = clock_timestamp()
  where id = v_registro_id;

  update app_private.manteniment_parada_sync
  set fecha_programada_parada = new.fecha_activacion
  where seguimiento_id = v_seguimiento_id;

  select e.id into v_etapa_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_registro_id
    and not e.cancelado
    and regexp_replace(upper(e.nombre), '[^A-Z0-9]+', '', 'g') in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H')
  order by e.posicion, e.creado_en
  limit 1;

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

    update public.activaciones_24h a
    set estado='cerrada',
        actualizado_en=clock_timestamp(),
        version=a.version+1,
        modificado_por=coalesce(auth.uid(),a.modificado_por)
    from public.registros_hotel r
    where r.id=new.registro_hotel_id
      and upper(btrim(coalesce(r.tipo_movimiento,'')))='24H'
      and a.estado='abierta'
      and (
        a.registro_hotel_id=r.id
        or a.seguimiento_hotel_id=r.seguimiento_id
      );

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
         and e.estado = 'realizada'
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
      and e.estado = 'realizada'
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

CREATE OR REPLACE FUNCTION app_private.resolver_pendientes_reserva_por_etapa(p_etapa_id uuid, p_origen text DEFAULT 'automatico'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_etapa public.etapas_hotel%rowtype;
  v_registro public.registros_hotel%rowtype;
  v_reserva public.reservas_hotel%rowtype;
  v_token text;
  v_codigo text;
  v_restantes text[] := array[]::text[];
  v_coincide boolean;
  v_insertados integer := 0;
  v_actor uuid;
  v_resuelto_en timestamptz;
begin
  if p_origen not in ('automatico', 'correccion_validada') then
    raise exception 'Origen de resolución no válido.' using errcode = '22023';
  end if;

  select e.*
    into v_etapa
  from public.etapas_hotel e
  where e.id = p_etapa_id;

  if not found or v_etapa.cancelado or v_etapa.estado <> 'realizada' then
    return 0;
  end if;

  select r.*
    into v_registro
  from public.registros_hotel r
  where r.id = v_etapa.registro_hotel_id
    and not r.cancelado;

  if not found then
    return 0;
  end if;

  select r.*
    into v_reserva
  from public.reservas_hotel r
  where r.activo
    and (
      app_private.normalizar_codigo_pendiente(r.vehiculo_codigo)
        = app_private.normalizar_codigo_pendiente(v_registro.vehiculo_sustituido)
      or (
        app_private.normalizar_codigo_pendiente(v_registro.matricula_sustituido) <> ''
        and app_private.normalizar_codigo_pendiente(r.matricula)
          = app_private.normalizar_codigo_pendiente(v_registro.matricula_sustituido)
      )
    )
  order by
    case when app_private.normalizar_codigo_pendiente(r.vehiculo_codigo)
      = app_private.normalizar_codigo_pendiente(v_registro.vehiculo_sustituido)
      then 0 else 1 end,
    r.vehiculo_codigo
  limit 1
  for update;

  if not found or btrim(v_reserva.pendientes) = '' then
    return 0;
  end if;

  v_actor := coalesce(
    v_etapa.modificado_por,
    v_etapa.marcado_rapido_por,
    v_etapa.creado_por,
    auth.uid()
  );
  v_resuelto_en := coalesce(
    v_etapa.fecha_fin_real,
    v_etapa.fecha_real,
    v_etapa.actualizado_en,
    now()
  );

  for v_token in
    select btrim(p.parte)
    from regexp_split_to_table(
      v_reserva.pendientes,
      E'\\s*[+,;|\\n]+\\s*'
    ) with ordinality as p(parte, orden)
    order by p.orden
  loop
    if v_token = '' then
      continue;
    end if;

    v_codigo := app_private.normalizar_codigo_pendiente(v_token);
    select exists (
      select 1
      from public.trabajos_etapa_hotel t
      where t.etapa_hotel_id = v_etapa.id
        and not t.cancelado
        and app_private.normalizar_codigo_pendiente(t.tipo_trabajo) = v_codigo
        and v_codigo <> ''
    ) into v_coincide;

    if v_coincide then
      insert into public.reservas_pendientes_resueltos (
        reserva_id,
        reserva_codigo,
        pendiente_codigo,
        pendiente_texto,
        registro_hotel_id,
        etapa_hotel_id,
        numero_parada,
        etapa_posicion,
        etapa_nombre,
        resuelto_en,
        resuelto_por,
        origen
      ) values (
        v_reserva.id,
        v_reserva.vehiculo_codigo,
        v_codigo,
        v_token,
        v_registro.id,
        v_etapa.id,
        v_registro.numero_parada,
        v_etapa.posicion,
        v_etapa.nombre,
        v_resuelto_en,
        v_actor,
        p_origen
      )
      on conflict (reserva_id, etapa_hotel_id, pendiente_codigo) do nothing;

      if found then
        v_insertados := v_insertados + 1;
      end if;
    else
      v_restantes := array_append(v_restantes, v_token);
    end if;
  end loop;

  if v_insertados > 0 then
    perform set_config('app.audit_origin', 'alpha72:cierre_automatico_pendiente', true);
    perform set_config('app.request_id', 'etapa:' || v_etapa.id::text, true);

    update public.reservas_hotel
    set pendientes = array_to_string(v_restantes, ' + '),
        modificado_por = v_actor
    where id = v_reserva.id;
  end if;

  return v_insertados;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.normalizar_codigo_pendiente(p_valor text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select regexp_replace(upper(coalesce(p_valor, '')), '[^A-Z0-9]+', '', 'g');
$function$;

CREATE OR REPLACE FUNCTION app_private.crear_ficha_hotel(p_ficha jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_pizarra_id uuid;
  v_pizarra_count integer;
  v_prioridad integer;
  v_estado text;
  v_registro_id uuid;
  v_numero_parada text;
  v_orden integer;
  v_audit_count integer := 0;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para añadir fichas al Hotel';
  end if;

  if p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;

  if jsonb_typeof(p_ficha) <> 'object'
     or octet_length(p_ficha::text) > 120000 then
    raise exception 'Formato de ficha no válido';
  end if;

  if btrim(coalesce(p_ficha->>'vehiculo_sustituido','')) = ''
     and btrim(coalesce(p_ficha->>'vehiculo_reserva','')) = '' then
    raise exception 'La ficha debe identificar un vehículo o una reserva';
  end if;

  v_prioridad := coalesce(nullif(p_ficha->>'prioridad','')::integer,5);
  if v_prioridad < 0 or v_prioridad > 5 then
    raise exception 'La prioridad debe estar entre 0 y 5';
  end if;

  v_estado := coalesce(nullif(btrim(p_ficha->>'estado'),''),'pendiente_taller');
  if not exists (
    select 1
    from public.catalogo_estados_hotel c
    where c.codigo = v_estado
      and c.activo = true
      and c.codigo not in ('anulado','reserva_liberada','recuperado')
  ) then
    raise exception 'El estado seleccionado no es válido para una ficha nueva';
  end if;

  select count(*) into v_pizarra_count
  from public.pizarras
  where estado='en_curso';

  if v_pizarra_count <> 1 then
    raise exception 'Debe existir una única pizarra en curso para añadir una ficha';
  end if;

  select id into v_pizarra_id
  from public.pizarras
  where estado='en_curso'
  limit 1;

  select coalesce(max(r.orden),0)+1
    into v_orden
  from public.registros_hotel r
  where r.pizarra_id=v_pizarra_id
    and not r.cancelado
    and not r.retirado_hotel_activo;

  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.audit_origin','metrogestion-r1-create-card',true);

  insert into public.registros_hotel(
    pizarra_id,
    vehiculo_sustituido,matricula_sustituido,
    vehiculo_reserva,matricula_reserva,etiqueta_reserva,
    tipo_unidad,marca,tipo_motor,modelo,upc,telefono,
    prioridad,estado,lugar,fecha_parada,fecha_entrada,tipo_movimiento,
    causa,trabajos_reserva,incidencia,proximo,observaciones,
    sustitucion_temporal,motivo_sustitucion_temporal,fecha_limite_sustitucion,
    orden,creado_por,modificado_por
  ) values (
    v_pizarra_id,
    btrim(coalesce(p_ficha->>'vehiculo_sustituido','')),
    upper(btrim(coalesce(p_ficha->>'matricula_sustituido',''))),
    btrim(coalesce(p_ficha->>'vehiculo_reserva','')),
    upper(btrim(coalesce(p_ficha->>'matricula_reserva',''))),
    btrim(coalesce(p_ficha->>'etiqueta_reserva','')),
    btrim(coalesce(p_ficha->>'tipo_unidad','')),
    upper(btrim(coalesce(p_ficha->>'marca',''))),
    btrim(coalesce(p_ficha->>'tipo_motor','')),
    btrim(coalesce(p_ficha->>'modelo','')),
    upper(btrim(coalesce(p_ficha->>'upc',''))),
    btrim(coalesce(p_ficha->>'telefono','')),
    v_prioridad,
    v_estado,
    btrim(coalesce(p_ficha->>'lugar','')),
    nullif(p_ficha->>'fecha_parada','')::date,
    case when nullif(p_ficha->>'fecha_entrada','') is null then null
         else (p_ficha->>'fecha_entrada')::timestamp at time zone 'Europe/Madrid' end,
    btrim(coalesce(p_ficha->>'tipo_movimiento','')),
    btrim(coalesce(p_ficha->>'causa','')),
    btrim(coalesce(p_ficha->>'trabajos_reserva','')),
    upper(btrim(coalesce(p_ficha->>'incidencia',''))),
    btrim(coalesce(p_ficha->>'proximo','')),
    btrim(coalesce(p_ficha->>'observaciones','')),
    coalesce((p_ficha->>'sustitucion_temporal')::boolean,false),
    btrim(coalesce(p_ficha->>'motivo_sustitucion_temporal','')),
    case when nullif(p_ficha->>'fecha_limite_sustitucion','') is null then null
         else (p_ficha->>'fecha_limite_sustitucion')::timestamp at time zone 'Europe/Madrid' end,
    v_orden,
    auth.uid(),auth.uid()
  )
  returning id,numero_parada into v_registro_id,v_numero_parada;

  insert into public.hotel_edicion_piloto(registro_hotel_id,activo,observaciones)
  values (v_registro_id,true,'Ficha creada desde Hotel')
  on conflict (registro_hotel_id)
  do update set activo=true,observaciones='Ficha creada desde Hotel';

  select count(*) into v_audit_count
  from public.auditoria_cambios a
  where a.request_id=p_request_id;

  return jsonb_build_object(
    'ok',true,
    'id',v_registro_id,
    'numero_parada',v_numero_parada,
    'request_id',p_request_id,
    'eventos_auditoria',v_audit_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.crear_ficha_hotel_alpha71(p_ficha jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_result jsonb;
  v_registro_id uuid;
  v_tracking uuid;
  v_fecha_propuesta date;
begin
  v_result := public.crear_ficha_hotel(p_ficha, p_request_id);
  v_registro_id := (v_result->>'id')::uuid;
  select seguimiento_id into v_tracking from public.registros_hotel where id = v_registro_id;

  v_fecha_propuesta := coalesce(
    nullif(p_ficha->>'fecha_programada_parada', '')::date,
    (clock_timestamp() at time zone 'Europe/Madrid')::date
  );

  insert into app_private.manteniment_parada_sync(
    seguimiento_id, fecha_programada_parada, fecha_corte, tancament
  ) values (
    v_tracking,
    v_fecha_propuesta,
    nullif(p_ficha->>'manteniment_fecha_corte', '')::date,
    upper(btrim(coalesce(p_ficha->>'manteniment_tancament', '')))
  )
  on conflict (seguimiento_id) do update
  set fecha_programada_parada = coalesce(
        app_private.manteniment_parada_sync.fecha_programada_parada,
        excluded.fecha_programada_parada
      ),
      fecha_corte = excluded.fecha_corte,
      tancament = excluded.tancament;

  return v_result || jsonb_build_object(
    'manteniment_sync_id', (
      select sync_id
      from app_private.manteniment_parada_sync
      where seguimiento_id = v_tracking
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.crear_ficha_hotel_con_etapas_alpha71(p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_created jsonb;
  v_saved jsonb;
  v_ficha_guardar jsonb;
  v_registro_id uuid;
  v_version integer;
  v_numero_parada text;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para añadir fichas y T al Hotel';
  end if;

  if jsonb_typeof(p_ficha) <> 'object'
     or jsonb_typeof(p_etapas) <> 'array'
     or octet_length(p_etapas::text) > 500000
     or jsonb_array_length(p_etapas) > 50 then
    raise exception 'Formato de ficha o T no válido';
  end if;

  v_created := app_private.crear_ficha_hotel_alpha71(p_ficha, p_request_id);
  v_registro_id := (v_created->>'id')::uuid;
  perform set_config('app.rec001_registro_id',v_registro_id::text,true);
  v_numero_parada := nullif(btrim(v_created->>'numero_parada'), '');

  if v_numero_parada is null then
    raise exception 'La ficha recién creada no tiene número de parada';
  end if;

  if jsonb_array_length(p_etapas) = 0 then
    return v_created || jsonb_build_object(
      'etapas_guardadas', 0,
      'trabajos_guardados', 0
    );
  end if;

  select r.version
    into v_version
  from public.registros_hotel r
  where r.id = v_registro_id
  for update;

  if v_version is null then
    raise exception 'La ficha recién creada no está disponible para añadir sus T';
  end if;

  -- El alta genera el número de parada. El segundo guardado debe reutilizarlo
  -- aunque la pantalla de creación enviara originalmente ese campo vacío.
  v_ficha_guardar := p_ficha || jsonb_build_object(
    'numero_parada', v_numero_parada
  );

  v_saved := app_private.guardar_ficha_hotel_edicion_alpha71(
    v_registro_id,
    v_version,
    v_ficha_guardar,
    p_etapas,
    p_request_id
  );

  return v_created || v_saved || jsonb_build_object(
    'id', v_registro_id,
    'numero_parada', v_numero_parada,
    'request_id', p_request_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.crear_ficha_hotel_con_etapas_alpha72(p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_codigo text;
  v_created jsonb;
  v_registro_id uuid;
  v_numero_parada text;
  v_version integer;
  v_notas integer;
  v_audit_count integer;
  v_seguimiento_id uuid;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para añadir fichas y T al Hotel';
  end if;
  v_codigo := app_private.resolver_modalidad_operativa_hotel(p_ficha->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa', v_codigo, true);
  perform set_config('app.hotel_flujo_taller_hitos', '1', true);
  v_created := app_private.crear_ficha_hotel_con_etapas_alpha71(p_ficha, p_etapas, p_request_id);
  v_registro_id := (v_created->>'id')::uuid;
  v_numero_parada := nullif(btrim(v_created->>'numero_parada'), '');
  if v_numero_parada is null then raise exception 'La ficha recién creada no tiene número de parada'; end if;
  select seguimiento_id into v_seguimiento_id from public.registros_hotel where id=v_registro_id;
  insert into app_private.hotel_flujo_modelo(seguimiento_id,modelo,creado_por)
  values(v_seguimiento_id,'entrada_hitos_v1',auth.uid())
  on conflict (seguimiento_id) do nothing;
  update public.registros_hotel
  set modalidad_operativa = v_codigo, modificado_por = auth.uid()
  where id = v_registro_id;

  perform set_config('app.request_id', left(p_request_id, 200), true);
  perform set_config('app.audit_origin', 'metrogestion-alpha72-anotaciones', true);
  v_notas := app_private.sincronizar_anotaciones_manuales_hotel(
    v_registro_id,
    coalesce(p_ficha->'anotaciones_manuales', '[]'::jsonb)
  );

  perform app_private.consolidar_rec001(v_registro_id);
  perform set_config('app.rec001_registro_id','',true);
  select version into v_version from public.registros_hotel where id = v_registro_id;
  select count(*) into v_audit_count from public.auditoria_cambios where request_id = p_request_id;
  return v_created || jsonb_build_object(
    'ok', true,
    'id', v_registro_id,
    'numero_parada', v_numero_parada,
    'version', v_version,
    'modalidad_operativa', v_codigo,
    'anotaciones_guardadas', v_notas,
    'eventos_auditoria', v_audit_count,
    'detalle', app_private.obtener_ficha_hotel_edicion_alpha72(v_registro_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.cronologia_activacion_24h_alpha74(p_activacion activaciones_24h)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_fecha date := coalesce(
    p_activacion.fecha_activacion,
    (p_activacion.creado_en at time zone 'Europe/Madrid')::date
  );
  v_ubicacion text;
  v_resultado text;
begin
  v_ubicacion := concat_ws(' · ',
    nullif(btrim(p_activacion.ubicacion_referencia), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(p_activacion.carretera), ''), nullif(btrim(p_activacion.punto_km), ''))), ''),
    nullif(btrim(p_activacion.sentido), '')
  );

  v_resultado := case p_activacion.resultado
    when 'operativo_reparado' then 'Reparación finalizada'
    when 'trasladado_taller' then 'Trasladado en grúa a taller'
    when 'seguimiento_abierto' then 'Seguimiento abierto'
    else nullif(btrim(replace(p_activacion.resultado, '_', ' ')), '')
  end;

  return concat_ws(E'\n',
    nullif('AVERÍA: ' || btrim(p_activacion.averia), 'AVERÍA: '),
    case when p_activacion.hora_activacion is not null
      then 'ACTIVACIÓN 24H: ' || to_char(v_fecha, 'DD/MM/YYYY') || ' ' || to_char(p_activacion.hora_activacion, 'HH24:MI') end,
    case when nullif(btrim(p_activacion.numero_caso), '') is not null
      then 'CASO: ' || btrim(p_activacion.numero_caso) end,
    case when v_ubicacion <> '' then 'UBICACIÓN: ' || v_ubicacion end,
    case when nullif(btrim(p_activacion.proveedor), '') is not null
      then 'PROVEEDOR: ' || btrim(p_activacion.proveedor) end,
    case when p_activacion.eta_tecnico is not null
      then 'LLEGADA PREVISTA DEL MECÁNICO: ' || to_char(p_activacion.eta_tecnico, 'HH24:MI') end,
    case when p_activacion.hora_llegada is not null
      then 'LLEGADA REAL DEL MECÁNICO: ' || to_char(p_activacion.hora_llegada, 'HH24:MI') end,
    case when nullif(btrim(p_activacion.diagnostico), '') is not null
      then 'DIAGNÓSTICO: ' || btrim(p_activacion.diagnostico) end,
    case when p_activacion.fecha_fin_reparacion is not null and p_activacion.hora_fin_reparacion is not null
      then 'FIN REAL DE REPARACIÓN: ' || to_char(p_activacion.fecha_fin_reparacion, 'DD/MM/YYYY')
        || ' ' || to_char(p_activacion.hora_fin_reparacion, 'HH24:MI') end,
    case when p_activacion.trasladado_taller and nullif(btrim(p_activacion.taller_traslado), '') is not null
      then 'TALLER DE TRASLADO: ' || btrim(p_activacion.taller_traslado) end,
    case when v_resultado is not null then 'RESULTADO: ' || v_resultado end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.modalidad_hotel_requiere_recuperacion(p_registro_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE v_codigo text; v_comportamiento text; v_seguimiento uuid; v_movimiento text; v_sustituto text; v_total integer; v_fisicas integer;
BEGIN
 SELECT app_private.modalidad_codigo_rec001(p_registro_id),r.seguimiento_id,upper(btrim(coalesce(r.tipo_movimiento,''))),case when nullif(btrim(r.vehiculo_sustituido),'') is not null then nullif(btrim(r.vehiculo_reserva),'') end INTO v_codigo,v_seguimiento,v_movimiento,v_sustituto FROM public.registros_hotel r WHERE r.id=p_registro_id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT c.comportamiento INTO v_comportamiento FROM public.catalogo_modalidades_operativas_hotel c WHERE c.codigo=v_codigo AND c.activo;
 IF v_comportamiento IN ('sin_sustitucion','reparado_en_ruta','reserva_en_reparacion') THEN
 IF v_comportamiento='sin_sustitucion' THEN
  IF v_sustituto IS NOT NULL OR EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=v_seguimiento) AND a.estado NOT IN ('cerrada','anulada') AND nullif(btrim(a.vehiculo_sustituto),'') IS NOT NULL) THEN RAISE EXCEPTION 'REC-001: la modalidad sin recuperación contradice el sustituto real %. Conserva la asignación y resuelve el conflicto.',v_sustituto USING ERRCODE='23514'; END IF;
 END IF;
  RETURN false;
 END IF;
 IF v_sustituto IS NOT NULL OR EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=v_seguimiento) AND a.estado NOT IN ('cerrada','anulada') AND nullif(btrim(a.vehiculo_sustituto),'') IS NOT NULL) THEN RETURN true; END IF;
 SELECT count(*),count(*) FILTER (WHERE lower(translate(btrim(coalesce(e.tipo_etapa,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) NOT IN ('gestion','tramite')) INTO v_total,v_fisicas FROM public.etapas_hotel e WHERE e.registro_hotel_id=p_registro_id AND NOT e.cancelado AND e.estado<>'anulada' AND NOT app_private.es_recuperacion_rec001(to_jsonb(e));
 IF v_total>0 AND v_fisicas=0 THEN RETURN false; END IF;
 IF v_total=0 AND EXISTS(SELECT 1 FROM app_private.manteniment_t_visitas v WHERE v.seguimiento_id=v_seguimiento) AND NOT EXISTS(SELECT 1 FROM app_private.manteniment_t_visitas v WHERE v.seguimiento_id=v_seguimiento AND v.modalidad NOT IN ('tramite','gestion')) THEN RETURN false; END IF;
 RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION app_private.es_recuperacion_rec001(p_etapa jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
SELECT coalesce(p_etapa->>'accion_sistema','')='recuperar_y_liberar' OR lower(coalesce(p_etapa->>'tipo_etapa','')) IN ('recuperar','recuperar_ruta') OR lower(translate(coalesce(p_etapa->>'nombre',''),'ÁÉÍÓÚáéíóú','AEIOUaeiou')) LIKE 'recuperar ruta%' OR lower(translate(coalesce(p_etapa->>'nombre',''),'ÁÉÍÓÚáéíóú','AEIOUaeiou')) LIKE 'recuperar vehiculo%';
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION app_private.recalcular_estado_reserva_hotel(p_codigo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_estado text;
begin
  if v_codigo = '' then
    return;
  end if;

  v_estado := app_private.calcular_estado_reserva_hotel(v_codigo);

  update public.reservas_hotel r
  set estado = v_estado,
      modificado_por = coalesce(auth.uid(), r.modificado_por)
  where upper(btrim(r.vehiculo_codigo)) = v_codigo
    and r.activo = true
    and r.estado is distinct from v_estado;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.liberar_al_marcar_recuperado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if new.estado='recuperado' and (tg_op='INSERT' or old.estado is distinct from new.estado) then
    perform app_private.liberar_sustituto_registro(new.id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.preparar_registro_fuera_hotel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if new.estado in ('recuperado','reserva_liberada') then
    new.retirado_hotel_activo=true;
    new.fecha_retirado_hotel=coalesce(new.fecha_retirado_hotel,now());
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.sincronizar_reservas_desde_registro_hotel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app_private.recalcular_estado_reserva_hotel(old.vehiculo_reserva);
    perform app_private.recalcular_estado_reserva_hotel(old.vehiculo_sustituido);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform app_private.recalcular_estado_reserva_hotel(new.vehiculo_reserva);
    perform app_private.recalcular_estado_reserva_hotel(new.vehiculo_sustituido);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.cerrar_modalidad_hotel_desde_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if current_setting('app.clonando_pizarra',true)='1'
     or current_setting('app.reconciliando_etapas',true)='1'
     or current_setting('app.audit_origin',true)='metrogestion-r1-editor' then
    return new;
  end if;
  if new.cancelado=false and new.estado='realizada'
     and new.accion_sistema<>'recuperar_y_liberar'
     and (tg_op='INSERT' or old.estado is distinct from new.estado or old.cancelado is distinct from new.cancelado) then
    perform app_private.cerrar_modalidad_hotel_sin_recuperacion(new.registro_hotel_id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.activacion_24h_reconciliar_hotel_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if new.registro_hotel_id is not null and current_setting('app.sit24h_cierre_controlado',true) IS DISTINCT FROM '1' then
    perform app_private.manteniment_reconciliar_asistencia_alpha74(new.registro_hotel_id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.activacion_24h_clasificar_tipo_t_alpha74()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if new.registro_hotel_id is null then
    return new;
  end if;

  update public.etapas_hotel e
  set tipo_etapa = '24H',
      modificado_por = coalesce(auth.uid(), e.modificado_por),
      version = e.version + 1,
      actualizado_en = clock_timestamp()
  where e.registro_hotel_id = new.registro_hotel_id
    and not e.cancelado
    and e.tipo_etapa is distinct from '24H'
    and regexp_replace(upper(e.nombre), '[^A-Z0-9]+', '', 'g')
      in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H');

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guardar_activacion_24h(p_id uuid, p_payload jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.guardar_activacion_24h_cierre_fecha_alpha75($1, $2, $3);
$function$;

SET check_function_bodies=on;
