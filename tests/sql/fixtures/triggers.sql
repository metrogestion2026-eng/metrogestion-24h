-- Runtime trigger wiring; unrelated subsystems are named doubles below.
-- Double: auditar_cambio_fila; no external side effects.
CREATE FUNCTION app_private.auditar_cambio_fila() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
CREATE OR REPLACE FUNCTION app_private.derivar_tipo_sustituto_hotel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  -- Una unidad del catálogo de reservas nunca puede convertirse en una
  -- sustitución momentánea de FLOTA.
  if new.sustitucion_temporal
     and exists (
       select 1
       from public.reservas_hotel r
       where regexp_replace(upper(btrim(r.vehiculo_codigo)), '[[:space:]]+', '', 'g')
             = regexp_replace(upper(btrim(new.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
         and r.activo
     ) then
    new.sustitucion_temporal := false;
    new.motivo_sustitucion_temporal := '';
    new.fecha_limite_sustitucion := null;
  end if;

  if btrim(coalesce(new.vehiculo_reserva, '')) = '' then
    new.tipo_sustituto := '';
  elsif exists (
    select 1
    from public.reservas_hotel r
    where regexp_replace(upper(btrim(r.vehiculo_codigo)), '[[:space:]]+', '', 'g')
          = regexp_replace(upper(btrim(new.vehiculo_reserva)), '[[:space:]]+', '', 'g')
      and r.activo
  ) then
    new.tipo_sustituto := 'RESERVA';
  else
    new.tipo_sustituto := 'FLOTA';
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION app_private.validar_coherencia_ficha_hotel_diferida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_registro_id uuid;
  v_registro public.registros_hotel%rowtype;
  v_row jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_registro_id := case
    when tg_table_name = 'etapas_hotel'
      then nullif(v_row->>'registro_hotel_id', '')::uuid
    else nullif(v_row->>'id', '')::uuid
  end;

  select * into v_registro
  from public.registros_hotel
  where id = v_registro_id;
  if not found then return null; end if;

  if not v_registro.cancelado
     and not v_registro.retirado_hotel_activo
     and v_registro.estado not in ('recuperado', 'reserva_liberada', 'anulado')
     and exists (
       select 1
       from public.etapas_hotel e
       where e.registro_hotel_id = v_registro.id
         and not e.cancelado
         and (e.accion_sistema='liberar_reserva' or (e.accion_sistema='recuperar_y_liberar' and app_private.modalidad_hotel_requiere_recuperacion(v_registro.id)))
         and (
           e.estado = 'realizada'
           or e.fecha_fin_real is not null
           or e.fecha_real is not null
           or e.marcado_rapido
         )
     ) then
    raise exception using
      errcode = '23514',
      constraint = 'ficha_hotel_activa_sin_cierre_realizado',
      message = 'Una ficha activa no puede conservar realizada la T que recupera la ruta o libera la reserva';
  end if;

  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION app_private.liberar_reserva_al_anular_ficha_hotel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if new.cancelado then
    new.vehiculo_reserva := '';
    new.matricula_reserva := '';
    new.etiqueta_reserva := '';
    new.tipo_sustituto := '';
    new.sustitucion_temporal := false;
    new.motivo_sustitucion_temporal := '';
    new.fecha_limite_sustitucion := null;
  end if;
  return new;
end;
$function$;
-- Double: manteniment_registro_hotel_trigger; no external side effects.
CREATE FUNCTION app_private.manteniment_registro_hotel_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
-- Double: asignar_numero_parada_nuevo; no external side effects.
CREATE FUNCTION app_private.asignar_numero_parada_nuevo() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
-- Double: reabrir_cierre_al_reactivar_registro_hotel; no external side effects.
CREATE FUNCTION app_private.reabrir_cierre_al_reactivar_registro_hotel() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
CREATE OR REPLACE FUNCTION app_private.tocar_actualizado_en_y_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (to_jsonb(new) - array['actualizado_en','version','modificado_por','posicion_activa'])
     = (to_jsonb(old) - array['actualizado_en','version','modificado_por','posicion_activa']) then
    new.actualizado_en := old.actualizado_en;
    new.version := old.version;
    new.modificado_por := old.modificado_por;
  else
    new.actualizado_en := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION app_private.validar_modalidad_operativa_hotel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.modalidad_operativa := btrim(coalesce(new.modalidad_operativa,''));
  if new.modalidad_operativa <> '' and not exists (
    select 1 from public.catalogo_modalidades_operativas_hotel c
    where c.codigo=new.modalidad_operativa and c.activo=true
  ) then
    raise exception 'La modalidad operativa no es válida';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION app_private.marcar_accion_sistema_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_nombre text;
begin
  v_nombre := lower(translate(coalesce(new.nombre,''),'áéíóúÁÉÍÓÚ','aeiouAEIOU'));
  if new.tipo_etapa='recuperar' or v_nombre like 'recuperar vehiculo%' or v_nombre like 'recuperar ruta%' then
    new.accion_sistema='recuperar_y_liberar';
  elsif v_nombre like 'reserva libre%' or v_nombre like '%libre para asignar%' then
    new.accion_sistema='liberar_reserva';
  end if;
  return new;
end;
$function$;
-- Double: bloquear_recogida_manteniment_alpha74; no external side effects.
CREATE FUNCTION app_private.bloquear_recogida_manteniment_alpha74() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
-- Double: capturar_estado_registro_antes_realizar_t; no external side effects.
CREATE FUNCTION app_private.capturar_estado_registro_antes_realizar_t() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
-- Double: preparar_grupo_documental_etapa; no external side effects.
CREATE FUNCTION app_private.preparar_grupo_documental_etapa() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
-- Double: heredar_control_marcado_rapido_etapa; no external side effects.
CREATE FUNCTION app_private.heredar_control_marcado_rapido_etapa() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
CREATE OR REPLACE FUNCTION app_private.aplicar_liberacion_reserva_desde_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_codigo text;
begin
  if current_setting('app.clonando_pizarra', true)='1' then return new; end if;
  if new.cancelado=false
     and new.estado='realizada'
     and new.accion_sistema='liberar_reserva'
     and (tg_op='INSERT' or old.estado is distinct from new.estado or old.cancelado is distinct from new.cancelado) then
    select vehiculo_reserva into v_codigo
    from public.registros_hotel
    where id=new.registro_hotel_id
      and btrim(coalesce(vehiculo_sustituido,''))=''
      and tipo_sustituto='RESERVA'
      and not cancelado;

    if btrim(coalesce(v_codigo,''))<>'' then
      update public.registros_hotel
      set estado='reserva_liberada',modificado_por=coalesce(auth.uid(),modificado_por)
      where id=new.registro_hotel_id and not cancelado;

      update public.reservas_hotel r
      set estado=case when btrim(coalesce(r.pendientes,''))='' then 'libre' else 'disponible_con_pendientes' end,
          modificado_por=coalesce(auth.uid(),r.modificado_por)
      where r.vehiculo_codigo=v_codigo and r.activo=true;
    end if;
  end if;
  return new;
end;
$function$;
-- Double: manteniment_fechas_desde_etapa; no external side effects.
CREATE FUNCTION app_private.manteniment_fechas_desde_etapa() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
-- Double: normalizar_control_marcado_rapido_etapa; no external side effects.
CREATE FUNCTION app_private.normalizar_control_marcado_rapido_etapa() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
CREATE OR REPLACE FUNCTION app_private.sincronizar_estado_programado_t()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  -- Alpha75: la fecha programada y el estado son campos independientes.
  -- Cambiar fecha_prevista no debe convertir automáticamente PENDIENTE
  -- en PROGRAMADA ni PROGRAMADA en PENDIENTE. El estado lo decide
  -- explícitamente el usuario o la operación que guarda la T.
  return new;
end;
$function$;
-- Double: sincronizar_catalogo_estado_etapa; no external side effects.
CREATE FUNCTION app_private.sincronizar_catalogo_estado_etapa() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN coalesce(NEW,OLD); END$$;
CREATE OR REPLACE FUNCTION app_private.proteger_recuperacion_rec001()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
BEGIN
 IF current_setting('app.clonando_pizarra',true)='1' OR new.cancelado OR new.estado='anulada' OR NOT app_private.es_recuperacion_rec001(to_jsonb(new)) THEN RETURN new; END IF;
 IF app_private.modalidad_hotel_requiere_recuperacion(new.registro_hotel_id) THEN RETURN new; END IF;
 IF tg_op='UPDATE' AND NOT old.cancelado AND app_private.es_recuperacion_rec001(to_jsonb(old)) THEN
   IF new.estado=old.estado THEN RETURN new; END IF;
 END IF;
 RAISE EXCEPTION 'REC-001: esta ficha no requiere recuperación. No se puede crear, reactivar ni realizar una T de recuperación o liberación de sustituto.' USING ERRCODE='23514';
END $function$;
CREATE OR REPLACE FUNCTION app_private.asignar_numero_parada_nuevo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.numero_parada:=nextval('public.test_pa_sequence')::text; RETURN NEW; END$$;
CREATE TRIGGER auditar_registros_hotel AFTER INSERT OR DELETE OR UPDATE ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.auditar_cambio_fila();
CREATE TRIGGER derivar_tipo_sustituto_hotel BEFORE INSERT OR UPDATE OF vehiculo_reserva, vehiculo_sustituido, sustitucion_temporal ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.derivar_tipo_sustituto_hotel();
CREATE CONSTRAINT TRIGGER registros_hotel_coherencia_diferida AFTER INSERT OR UPDATE ON public.registros_hotel DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.validar_coherencia_ficha_hotel_diferida();
CREATE TRIGGER registros_hotel_liberar_recuperado AFTER INSERT OR UPDATE OF estado ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.liberar_al_marcar_recuperado();
CREATE TRIGGER registros_hotel_liberar_reserva_al_anular BEFORE INSERT OR UPDATE OF cancelado ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.liberar_reserva_al_anular_ficha_hotel();
CREATE TRIGGER registros_hotel_manteniment_encolar AFTER INSERT OR UPDATE OF vehiculo_sustituido, matricula_sustituido, vehiculo_reserva, tipo_unidad, upc, marca, fecha_parada, retirado_hotel_activo, fecha_retirado_hotel, estado, cancelado ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.manteniment_registro_hotel_trigger();
CREATE TRIGGER registros_hotel_normalizar_estado_taller_24h_alpha74_trg BEFORE INSERT OR UPDATE OF estado, tipo_movimiento ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.normalizar_estado_taller_24h_alpha74();
CREATE TRIGGER registros_hotel_numero_parada_auto BEFORE INSERT ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.asignar_numero_parada_nuevo();
CREATE TRIGGER registros_hotel_preparar_fuera_hotel BEFORE INSERT OR UPDATE OF estado, retirado_hotel_activo ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.preparar_registro_fuera_hotel();
CREATE TRIGGER registros_hotel_reabrir_cierre AFTER UPDATE OF estado, retirado_hotel_activo, cancelado ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.reabrir_cierre_al_reactivar_registro_hotel();
CREATE TRIGGER registros_hotel_sincronizar_reservas AFTER INSERT OR DELETE OR UPDATE ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.sincronizar_reservas_desde_registro_hotel();
CREATE TRIGGER registros_hotel_touch BEFORE UPDATE ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.tocar_actualizado_en_y_version();
CREATE TRIGGER registros_hotel_validar_modalidad_operativa BEFORE INSERT OR UPDATE OF modalidad_operativa ON public.registros_hotel FOR EACH ROW EXECUTE FUNCTION app_private.validar_modalidad_operativa_hotel();
CREATE TRIGGER auditar_etapas_hotel AFTER INSERT OR DELETE OR UPDATE ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.auditar_cambio_fila();
CREATE TRIGGER etapas_aa_resolver_reaperturas_reserva AFTER INSERT OR UPDATE OF estado, cancelado ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.resolver_reaperturas_pendiente_reserva();
CREATE TRIGGER etapas_hotel_accion_sistema BEFORE INSERT OR UPDATE OF nombre, tipo_etapa ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.marcar_accion_sistema_etapa();
CREATE TRIGGER etapas_hotel_aplicar_recuperacion AFTER INSERT OR UPDATE OF estado, cancelado, accion_sistema ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.aplicar_recuperacion_desde_etapa();
CREATE TRIGGER etapas_hotel_asegurar_recuperacion AFTER INSERT ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.asegurar_recuperacion_final();
CREATE TRIGGER etapas_hotel_bloquear_recogida_manteniment_alpha74 BEFORE INSERT ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.bloquear_recogida_manteniment_alpha74();
CREATE TRIGGER etapas_hotel_capturar_estado_antes_realizar BEFORE INSERT OR UPDATE OF estado, cancelado ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.capturar_estado_registro_antes_realizar_t();
CREATE TRIGGER etapas_hotel_cerrar_modalidad AFTER INSERT OR UPDATE OF estado, cancelado ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.cerrar_modalidad_hotel_desde_etapa();
CREATE CONSTRAINT TRIGGER etapas_hotel_coherencia_diferida AFTER INSERT OR DELETE OR UPDATE ON public.etapas_hotel DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.validar_coherencia_ficha_hotel_diferida();
CREATE TRIGGER etapas_hotel_generar_recogida AFTER INSERT OR UPDATE OF tipo_etapa, cancelado ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.generar_recogida_tras_entrada_taller();
CREATE TRIGGER etapas_hotel_grupo_documental BEFORE INSERT ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.preparar_grupo_documental_etapa();
CREATE TRIGGER etapas_hotel_heredar_marcado_rapido BEFORE INSERT ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.heredar_control_marcado_rapido_etapa();
CREATE TRIGGER etapas_hotel_liberar_reserva AFTER INSERT OR UPDATE OF estado, cancelado, accion_sistema ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.aplicar_liberacion_reserva_desde_etapa();
CREATE TRIGGER etapas_hotel_manteniment_fechas AFTER INSERT OR UPDATE OF estado, cancelado, fecha_real, fecha_fin_real, fecha_inicio_real ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.manteniment_fechas_desde_etapa();
CREATE TRIGGER etapas_hotel_normalizar_marcado_rapido BEFORE UPDATE OF estado, cancelado ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.normalizar_control_marcado_rapido_etapa();
CREATE TRIGGER etapas_hotel_sincronizar_estado_24h_alpha74_trg AFTER INSERT OR DELETE OR UPDATE OF estado, cancelado, tipo_etapa ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.sincronizar_estado_24h_desde_entrada_alpha74();
CREATE TRIGGER etapas_hotel_sync_programada BEFORE INSERT OR UPDATE OF fecha_prevista, estado, cancelado ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.sincronizar_estado_programado_t();
CREATE TRIGGER etapas_hotel_touch BEFORE UPDATE ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.tocar_actualizado_en_y_version();
CREATE TRIGGER etapas_hotel_zzz_catalogo_estado BEFORE INSERT OR UPDATE OF estado, estado_catalogo_codigo, posicion ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.sincronizar_catalogo_estado_etapa();
CREATE TRIGGER etapas_resolver_pendientes_reserva AFTER INSERT OR UPDATE OF estado, cancelado ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.resolver_pendientes_reserva_desde_etapa_trigger();
CREATE TRIGGER zzzz_etapas_hotel_rec001 BEFORE INSERT OR UPDATE ON public.etapas_hotel FOR EACH ROW EXECUTE FUNCTION app_private.proteger_recuperacion_rec001();
CREATE TRIGGER activaciones_24h_asegurar_ficha_alpha74_trg AFTER INSERT OR UPDATE ON public.activaciones_24h FOR EACH ROW EXECUTE FUNCTION app_private.activacion_24h_asegurar_ficha_alpha74();
CREATE TRIGGER activaciones_24h_clasificar_tipo_t_alpha74_trg AFTER INSERT OR UPDATE OF registro_hotel_id ON public.activaciones_24h FOR EACH ROW EXECUTE FUNCTION app_private.activacion_24h_clasificar_tipo_t_alpha74();
CREATE TRIGGER activaciones_24h_reconciliar_hotel_alpha74_trg AFTER INSERT OR UPDATE OF trasladado_taller, taller_traslado, resultado, estado ON public.activaciones_24h FOR EACH ROW EXECUTE FUNCTION app_private.activacion_24h_reconciliar_hotel_alpha74();
CREATE TRIGGER activaciones_24h_sincronizar_fecha_alpha74_trg AFTER INSERT OR UPDATE OF fecha_activacion, fecha_fin_reparacion, hora_fin_reparacion, resultado, estado ON public.activaciones_24h FOR EACH ROW EXECUTE FUNCTION app_private.activacion_24h_sincronizar_fecha_alpha74();
CREATE TRIGGER activaciones_24h_vincular_hotel_alpha74_trg BEFORE INSERT OR UPDATE ON public.activaciones_24h FOR EACH ROW EXECUTE FUNCTION app_private.activacion_24h_vincular_hotel_alpha74();
CREATE TRIGGER auditar_activaciones_24h AFTER INSERT OR DELETE OR UPDATE ON public.activaciones_24h FOR EACH ROW EXECUTE FUNCTION app_private.auditar_cambio_fila();
REVOKE ALL ON FUNCTION app_private.activacion_24h_asegurar_ficha_alpha74() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.activacion_24h_asegurar_ficha_alpha74() TO service_role;
REVOKE ALL ON FUNCTION app_private.activacion_24h_clasificar_tipo_t_alpha74() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.activacion_24h_clasificar_tipo_t_alpha74() TO service_role;
REVOKE ALL ON FUNCTION app_private.activacion_24h_reconciliar_hotel_alpha74() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.activacion_24h_reconciliar_hotel_alpha74() TO service_role;
REVOKE ALL ON FUNCTION app_private.activacion_24h_sincronizar_fecha_alpha74() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.activacion_24h_sincronizar_fecha_alpha74() TO service_role;
REVOKE ALL ON FUNCTION app_private.activacion_24h_vincular_hotel_alpha74() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.activacion_24h_vincular_hotel_alpha74() TO service_role;
REVOKE ALL ON FUNCTION app_private.crear_ficha_hotel(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_ficha_hotel(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_ficha_hotel(jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.crear_ficha_hotel_alpha71(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_ficha_hotel_alpha71(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_ficha_hotel_alpha71(jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.crear_ficha_hotel_con_etapas_alpha71(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_ficha_hotel_con_etapas_alpha71(jsonb,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_ficha_hotel_con_etapas_alpha71(jsonb,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.crear_ficha_hotel_con_etapas_alpha72(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_ficha_hotel_con_etapas_alpha72(jsonb,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_ficha_hotel_con_etapas_alpha72(jsonb,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.cronologia_activacion_24h_alpha74(activaciones_24h) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.cronologia_activacion_24h_alpha74(activaciones_24h) TO service_role;
REVOKE ALL ON FUNCTION app_private.guardar_activacion_24h(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_activacion_24h(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_activacion_24h(uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.guardar_activacion_24h_cierre_fecha_alpha75(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_activacion_24h_cierre_fecha_alpha75(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_activacion_24h_cierre_fecha_alpha75(uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.guardar_activacion_24h_con_fecha_alpha74(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_activacion_24h_con_fecha_alpha74(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_activacion_24h_con_fecha_alpha74(uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.guardar_activacion_24h_operativa_alpha74(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_activacion_24h_operativa_alpha74(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_activacion_24h_operativa_alpha74(uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.guardar_ficha_hotel_edicion(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.guardar_ficha_hotel_edicion(uuid,integer,jsonb,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.manteniment_reconciliar_asistencia_alpha74(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.manteniment_reconciliar_asistencia_alpha74(uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.modalidad_hotel_requiere_recuperacion(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.modalidad_hotel_requiere_recuperacion(uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.reconciliar_etapas_hotel(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.reconciliar_etapas_hotel(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.guardar_activacion_24h(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_activacion_24h(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_activacion_24h(uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION app_private.asegurar_recuperacion_final() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.asegurar_recuperacion_final() TO service_role;
REVOKE ALL ON FUNCTION app_private.calcular_estado_reserva_hotel(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.calcular_estado_reserva_hotel(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.calcular_estado_reserva_hotel(text) TO service_role;
REVOKE ALL ON FUNCTION app_private.cerrar_modalidad_hotel_sin_recuperacion(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.cerrar_modalidad_hotel_sin_recuperacion(uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.recalcular_estado_reserva_hotel(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.recalcular_estado_reserva_hotel(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.recalcular_estado_reserva_hotel(text) TO service_role;
REVOKE ALL ON FUNCTION app_private.asistencia_24h_finalizada_sit001(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION app_private.consolidar_rec001(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION app_private.es_recuperacion_rec001(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION app_private.sincronizar_cierre_24h_sit001(uuid) FROM PUBLIC,anon,authenticated;
