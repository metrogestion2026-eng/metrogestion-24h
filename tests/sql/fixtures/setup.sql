SET check_function_bodies=off;
-- Isolated synthetic PostgreSQL fixture, not a Supabase deployment script.
-- Same 137 runtime columns and relevant CHECK/unique constraints. External
-- catalog, editor internals, audit, document, auth and sync services are doubles.
-- Function source under test is the schema-only runtime snapshot plus migration.
CREATE SCHEMA app_private;
CREATE SCHEMA auth;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.actor',true),'')::uuid
$$;
CREATE FUNCTION public.dispositivo_autorizado() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('test.device_allowed',true),'')::boolean,true)
$$;
CREATE FUNCTION public.puede_editar_modulo(text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('test.edit_allowed',true),'')::boolean,true)
$$;
CREATE FUNCTION public.es_administrador_principal() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000001',false);
CREATE TABLE public.pizarras(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estado text,fecha date);
INSERT INTO public.pizarras VALUES('00000000-0000-4000-8000-000000000010','en_curso','2026-10-28');
CREATE TABLE public.catalogo_estados_hotel(codigo text PRIMARY KEY,activo boolean DEFAULT true);
INSERT INTO public.catalogo_estados_hotel(codigo) SELECT unnest(ARRAY['asistencia_24h','pendiente_taller','en_taller','realizada','recuperado','reserva_liberada','pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos','t_pendientes','recogido_pendiente_ruta']);
CREATE TABLE public.catalogo_modalidades_operativas_hotel(codigo text PRIMARY KEY,comportamiento text,activo boolean DEFAULT true);
INSERT INTO public.catalogo_modalidades_operativas_hotel(codigo,comportamiento) VALUES('sin_sustitucion','sin_sustitucion'),('reserva_en_reparacion','reserva_en_reparacion'),('reparado_en_ruta','reparado_en_ruta');
CREATE TABLE public.activaciones_24h(
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  dfm text NOT NULL,
  matricula text DEFAULT ''::text NOT NULL,
  vehiculo_id uuid,
  marca text DEFAULT ''::text NOT NULL,
  modelo text DEFAULT ''::text NOT NULL,
  bastidor text DEFAULT ''::text NOT NULL,
  upc text DEFAULT ''::text NOT NULL,
  km_actual integer,
  contrato_km integer,
  fin_contrato_fecha date,
  cobertura_ok boolean,
  conductor text DEFAULT ''::text NOT NULL,
  telefono_conductor text DEFAULT ''::text NOT NULL,
  ubicacion_tipo text DEFAULT ''::text NOT NULL,
  ubicacion_referencia text DEFAULT ''::text NOT NULL,
  carretera text DEFAULT ''::text NOT NULL,
  punto_km text DEFAULT ''::text NOT NULL,
  sentido text DEFAULT ''::text NOT NULL,
  averia text DEFAULT ''::text NOT NULL,
  codigo_alarma text DEFAULT ''::text NOT NULL,
  color_alarma text DEFAULT ''::text NOT NULL,
  semirremolque text DEFAULT ''::text NOT NULL,
  carga text DEFAULT ''::text NOT NULL,
  numero_caso text DEFAULT ''::text NOT NULL,
  hora_activacion time without time zone,
  eta_tecnico time without time zone,
  proveedor text DEFAULT ''::text NOT NULL,
  tecnico_llegado boolean DEFAULT false NOT NULL,
  hora_llegada time without time zone,
  diagnostico_confirmado boolean DEFAULT false NOT NULL,
  diagnostico text DEFAULT ''::text NOT NULL,
  reparado_carretera boolean DEFAULT false NOT NULL,
  trasladado_taller boolean DEFAULT false NOT NULL,
  taller_traslado text DEFAULT ''::text NOT NULL,
  estado_operativo_confirmado boolean DEFAULT false NOT NULL,
  resultado text DEFAULT 'seguimiento_abierto'::text NOT NULL,
  estado text DEFAULT 'abierta'::text NOT NULL,
  registro_hotel_id uuid,
  seguimiento_hotel_id uuid,
  version integer DEFAULT 1 NOT NULL,
  creado_por uuid,
  modificado_por uuid,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  hora_fin_reparacion time without time zone,
  fecha_activacion date DEFAULT ((clock_timestamp() AT TIME ZONE 'Europe/Madrid'::text))::date NOT NULL,
  estado_seguimiento text DEFAULT 'en_curso'::text NOT NULL,
  vehiculo_sustituto text DEFAULT ''::text NOT NULL,
  matricula_sustituto text DEFAULT ''::text NOT NULL,
  fecha_fin_reparacion date
);
CREATE TABLE public.registros_hotel(
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  pizarra_id uuid NOT NULL,
  seguimiento_id uuid DEFAULT gen_random_uuid() NOT NULL,
  numero_parada text,
  vehiculo_sustituido text DEFAULT ''::text NOT NULL,
  matricula_sustituido text DEFAULT ''::text NOT NULL,
  vehiculo_reserva text DEFAULT ''::text NOT NULL,
  matricula_reserva text DEFAULT ''::text NOT NULL,
  etiqueta_reserva text DEFAULT ''::text NOT NULL,
  tipo_unidad text DEFAULT ''::text NOT NULL,
  marca text DEFAULT ''::text NOT NULL,
  tipo_motor text DEFAULT ''::text NOT NULL,
  modelo text DEFAULT ''::text NOT NULL,
  upc text DEFAULT ''::text NOT NULL,
  telefono text DEFAULT ''::text NOT NULL,
  prioridad integer DEFAULT 5 NOT NULL,
  estado text DEFAULT 'pendiente_taller'::text NOT NULL,
  lugar text DEFAULT ''::text NOT NULL,
  fecha_parada date,
  fecha_entrada timestamp with time zone,
  tipo_movimiento text DEFAULT ''::text NOT NULL,
  causa text DEFAULT ''::text NOT NULL,
  trabajos_reserva text DEFAULT ''::text NOT NULL,
  incidencia text DEFAULT ''::text NOT NULL,
  proximo text DEFAULT ''::text NOT NULL,
  observaciones text DEFAULT ''::text NOT NULL,
  sustitucion_temporal boolean DEFAULT false NOT NULL,
  motivo_sustitucion_temporal text DEFAULT ''::text NOT NULL,
  fecha_limite_sustitucion timestamp with time zone,
  orden integer DEFAULT 0 NOT NULL,
  retirado_hotel_activo boolean DEFAULT false NOT NULL,
  fecha_retirado_hotel timestamp with time zone,
  cancelado boolean DEFAULT false NOT NULL,
  motivo_cancelacion text DEFAULT ''::text NOT NULL,
  cancelado_en timestamp with time zone,
  cancelado_por uuid,
  version integer DEFAULT 1 NOT NULL,
  creado_por uuid,
  modificado_por uuid,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  tipo_sustituto text DEFAULT ''::text NOT NULL,
  trazo_marron boolean DEFAULT false NOT NULL,
  modalidad_operativa text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.etapas_hotel(
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  registro_hotel_id uuid NOT NULL,
  seguimiento_id uuid DEFAULT gen_random_uuid() NOT NULL,
  nombre text NOT NULL,
  posicion integer NOT NULL,
  estado text DEFAULT 'pendiente'::text NOT NULL,
  tipo_etapa text DEFAULT 'otro'::text NOT NULL,
  taller_id uuid,
  centro_taller_id uuid,
  lugar text DEFAULT ''::text NOT NULL,
  fecha_prevista timestamp with time zone,
  fecha_inicio_real timestamp with time zone,
  fecha_fin_real timestamp with time zone,
  fecha_real timestamp with time zone,
  observaciones text DEFAULT ''::text NOT NULL,
  cancelado boolean DEFAULT false NOT NULL,
  motivo_cancelacion text DEFAULT ''::text NOT NULL,
  cancelado_en timestamp with time zone,
  cancelado_por uuid,
  version integer DEFAULT 1 NOT NULL,
  creado_por uuid,
  modificado_por uuid,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  posicion_activa integer GENERATED ALWAYS AS (
CASE
    WHEN (cancelado = false) THEN posicion
    ELSE NULL::integer
END) STORED,
  accion_sistema text DEFAULT ''::text NOT NULL,
  etapa_origen_id uuid,
  grupo_documental_id uuid DEFAULT gen_random_uuid() NOT NULL,
  marcado_rapido boolean DEFAULT false NOT NULL,
  marcado_rapido_en timestamp with time zone,
  marcado_rapido_por uuid,
  datos_pendientes boolean DEFAULT false NOT NULL,
  datos_completados_en timestamp with time zone,
  datos_completados_por uuid,
  estado_catalogo_codigo text DEFAULT 'pendiente'::text NOT NULL,
  reabierta_en timestamp with time zone,
  reabierta_por uuid,
  motivo_reapertura text DEFAULT ''::text NOT NULL,
  reaperturas integer DEFAULT 0 NOT NULL,
  estado_registro_antes_realizar text,
  retirado_hotel_antes_realizar boolean,
  fecha_retirado_hotel_antes_realizar timestamp with time zone
);
ALTER TABLE public.registros_hotel ADD CONSTRAINT registros_hotel_check CHECK (((NOT sustitucion_temporal) OR ((btrim(motivo_sustitucion_temporal) <> ''::text) AND (fecha_limite_sustitucion IS NOT NULL))));
ALTER TABLE public.registros_hotel ADD CONSTRAINT registros_hotel_prioridad_check CHECK (((prioridad >= 0) AND (prioridad <= 5)));
ALTER TABLE public.registros_hotel ADD CONSTRAINT registros_hotel_tipo_sustituto_check CHECK ((tipo_sustituto = ANY (ARRAY[''::text, 'RESERVA'::text, 'FLOTA'::text])));
ALTER TABLE public.etapas_hotel ADD CONSTRAINT etapas_hotel_datos_completados_coherente_check CHECK ((((datos_completados_en IS NULL) AND (datos_completados_por IS NULL)) OR ((datos_completados_en IS NOT NULL) AND (datos_completados_por IS NOT NULL) AND marcado_rapido AND (NOT datos_pendientes))));
ALTER TABLE public.etapas_hotel ADD CONSTRAINT etapas_hotel_datos_pendientes_coherente_check CHECK (((NOT datos_pendientes) OR marcado_rapido));
ALTER TABLE public.etapas_hotel ADD CONSTRAINT etapas_hotel_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'programada'::text, 'en_curso'::text, 'realizada'::text, 'anulada'::text])));
ALTER TABLE public.etapas_hotel ADD CONSTRAINT etapas_hotel_marcado_rapido_coherente_check CHECK (((NOT marcado_rapido) OR ((marcado_rapido_en IS NOT NULL) AND (marcado_rapido_por IS NOT NULL))));
ALTER TABLE public.etapas_hotel ADD CONSTRAINT etapas_hotel_posicion_check CHECK ((posicion > 0));
ALTER TABLE public.etapas_hotel ADD CONSTRAINT etapas_hotel_reaperturas_no_negativas_check CHECK ((reaperturas >= 0));
ALTER TABLE public.activaciones_24h ADD CONSTRAINT activaciones_24h_estado_ck CHECK ((estado = ANY (ARRAY['abierta'::text, 'cerrada'::text, 'anulada'::text])));
ALTER TABLE public.activaciones_24h ADD CONSTRAINT activaciones_24h_estado_seguimiento_ck CHECK ((estado_seguimiento = ANY (ARRAY['en_curso'::text, 'pendiente_diagnostico'::text, 'pendiente_presupuesto'::text, 'pendiente_autorizacion'::text, 'pendiente_repuestos'::text, 'en_reparacion'::text, 'realizada'::text])));
ALTER TABLE public.activaciones_24h ADD CONSTRAINT activaciones_24h_km_ck CHECK (((km_actual IS NULL) OR (km_actual >= 0)));
ALTER TABLE public.activaciones_24h ADD CONSTRAINT activaciones_24h_operativo_reparado_fin_ck CHECK (((resultado <> 'operativo_reparado'::text) OR ((fecha_fin_reparacion IS NOT NULL) AND (hora_fin_reparacion IS NOT NULL) AND estado_operativo_confirmado AND (estado = 'cerrada'::text) AND (fecha_fin_reparacion >= fecha_activacion))));

ALTER TABLE public.etapas_hotel ADD CONSTRAINT etapas_hotel_posicion_activa_uq UNIQUE(registro_hotel_id,posicion_activa) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE public.activaciones_24h ADD FOREIGN KEY(registro_hotel_id) REFERENCES public.registros_hotel(id);
ALTER TABLE public.etapas_hotel ADD FOREIGN KEY(registro_hotel_id) REFERENCES public.registros_hotel(id);
CREATE SEQUENCE public.test_pa_sequence START 91000;
CREATE TABLE public.vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dfm text);
CREATE TABLE public.vehiculos_hotel_autocompletar(dfm text,matricula text,tipo_sustituto_catalogo text,etiqueta_reserva text);
INSERT INTO public.vehiculos_hotel_autocompletar VALUES('R-TEST','TEST123','RESERVA','Reserva sintética');
CREATE TABLE public.reservas_hotel(id uuid DEFAULT gen_random_uuid() UNIQUE,matricula text DEFAULT '',vehiculo_codigo text PRIMARY KEY,estado text,pendientes text DEFAULT '',activo boolean DEFAULT true,modificado_por uuid);
INSERT INTO public.reservas_hotel(vehiculo_codigo,estado) VALUES('R-TEST','libre');
CREATE TABLE public.reservas_pendientes_resueltos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reserva_id uuid,reserva_codigo text,pendiente_codigo text,pendiente_texto text,registro_hotel_id uuid,etapa_hotel_id uuid,numero_parada text,etapa_posicion integer,etapa_nombre text,resuelto_en timestamptz,resuelto_por uuid,origen text,UNIQUE(reserva_id,etapa_hotel_id,pendiente_codigo));
CREATE TABLE app_private.reservas_pendientes_reaperturas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resolucion_id uuid,etapa_hotel_id uuid,resuelto_nuevamente_en timestamptz,resuelto_nuevamente_por uuid);
CREATE TABLE public.hotel_edicion_piloto(registro_hotel_id uuid PRIMARY KEY,activo boolean,observaciones text);
CREATE TABLE public.auditoria_cambios(id uuid DEFAULT gen_random_uuid(),request_id text);
CREATE TABLE public.trabajos_etapa_hotel(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),etapa_hotel_id uuid,seguimiento_id uuid DEFAULT gen_random_uuid(),
 tipo_trabajo text,categoria_tecnica text,motivo_entrada text,diagnostico_real text,expediente text,
 descripcion text,observaciones text,km_averia numeric,cancelado boolean DEFAULT false,
 modificado_por uuid,creado_por uuid,version integer DEFAULT 1,actualizado_en timestamptz DEFAULT now());
CREATE TABLE app_private.manteniment_parada_sync(
 seguimiento_id uuid PRIMARY KEY,sync_id uuid DEFAULT gen_random_uuid(),fecha_programada_parada date,
 fecha_corte date,tancament text,fecha_inicio_tramo date,dias_parada_manual integer,
 km_facturables_manual numeric,km_dia_manual numeric,tancament_supervisado boolean DEFAULT false,
 calculo_periodo_automatico boolean DEFAULT false);
CREATE TABLE app_private.manteniment_t_visitas(id uuid DEFAULT gen_random_uuid(),seguimiento_id uuid,modalidad text);
CREATE TABLE app_private.hotel_flujo_modelo(seguimiento_id uuid PRIMARY KEY,modelo text,creado_por uuid);
CREATE TABLE app_private.test_side_effects(kind text,registro_id uuid);
CREATE TABLE app_private.test_sync_config(enabled boolean,media_manual numeric);
INSERT INTO app_private.test_sync_config VALUES(false,37.25);
-- Explicit doubles for systems outside this change's local integration boundary.
CREATE FUNCTION app_private.manteniment_encolar_parada(uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO app_private.test_side_effects VALUES('encolar',$1); END $$;
CREATE FUNCTION app_private.liberar_sustituto_registro(uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO app_private.test_side_effects VALUES('liberar',$1);
 UPDATE public.registros_hotel SET vehiculo_reserva='',matricula_reserva='' WHERE id=$1;
END $$;
CREATE FUNCTION app_private.usa_flujo_taller_hitos(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM app_private.hotel_flujo_modelo WHERE seguimiento_id=(SELECT seguimiento_id FROM public.registros_hotel WHERE id=$1) AND modelo='entrada_hitos_v1')
$$;
CREATE FUNCTION app_private.resolver_modalidad_operativa_hotel(text) RETURNS text LANGUAGE sql AS $$SELECT coalesce($1,'')$$;
CREATE FUNCTION app_private.modalidad_codigo_rec001(uuid) RETURNS text LANGUAGE sql AS $$
 SELECT nullif(modalidad_operativa,'') FROM public.registros_hotel WHERE id=$1
$$;
CREATE FUNCTION app_private.sincronizar_anotaciones_manuales_hotel(uuid,jsonb) RETURNS integer LANGUAGE sql AS $$SELECT 0$$;
CREATE FUNCTION public.obtener_ficha_hotel_edicion(uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT to_jsonb(r) FROM public.registros_hotel r WHERE id=$1
$$;
CREATE FUNCTION app_private.obtener_ficha_hotel_edicion_alpha72(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT public.obtener_ficha_hotel_edicion($1)$$;
CREATE FUNCTION public.crear_ficha_hotel(jsonb,text) RETURNS jsonb LANGUAGE sql AS $$SELECT app_private.crear_ficha_hotel($1,$2)$$;
-- Reproduce the editor's write boundary, not its unrelated form/document logic.
CREATE FUNCTION app_private.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE x jsonb; w jsonb; v_e uuid;
BEGIN
 FOR x IN SELECT value FROM jsonb_array_elements($4) LOOP
  INSERT INTO public.etapas_hotel(registro_hotel_id,nombre,posicion,estado,estado_catalogo_codigo,tipo_etapa,lugar,observaciones,creado_por,modificado_por,
    fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real)
  VALUES($1,x->>'nombre',(x->>'posicion')::integer,coalesce(x->>'estado','pendiente'),coalesce(x->>'estado_catalogo_codigo','pendiente'),coalesce(x->>'tipo_etapa','otro'),coalesce(x->>'lugar',''),coalesce(x->>'observaciones',''),auth.uid(),auth.uid(),
    nullif(x->>'fecha_prevista','')::timestamptz,nullif(x->>'fecha_inicio_real','')::timestamptz,nullif(x->>'fecha_fin_real','')::timestamptz,nullif(x->>'fecha_real','')::timestamptz)
  RETURNING id INTO v_e;
  FOR w IN SELECT value FROM jsonb_array_elements(coalesce(x->'trabajos','[]')) LOOP
   INSERT INTO public.trabajos_etapa_hotel(etapa_hotel_id,tipo_trabajo,categoria_tecnica,motivo_entrada,diagnostico_real,expediente,descripcion,observaciones,km_averia)
   VALUES(v_e,w->>'tipo_trabajo',w->>'categoria_tecnica',w->>'motivo_entrada',w->>'diagnostico_real',w->>'expediente',w->>'descripcion',w->>'observaciones',nullif(w->>'km_averia','')::numeric);
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'id',$1);
END $$;
-- General card save double is used only to prove candidate post-save guards.
CREATE FUNCTION public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN UPDATE public.registros_hotel SET estado=coalesce($3->>'estado',estado) WHERE id=$1;
 RETURN jsonb_build_object('ok',true,'id',$1); END $$;
CREATE FUNCTION app_private.propagar_correcciones_globales_parada(uuid,jsonb) RETURNS integer LANGUAGE sql AS $$SELECT 0$$;
CREATE FUNCTION app_private.propagar_detalles_t_parada(uuid) RETURNS integer LANGUAGE sql AS $$SELECT 0$$;
CREATE FUNCTION app_private.normalizar_orden_t_parada(uuid) RETURNS integer LANGUAGE sql AS $$SELECT 0$$;
CREATE FUNCTION app_private.asegurar_reactivacion_historica(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN; END $$;
CREATE FUNCTION public.reconciliar_etapas_hotel(uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT app_private.reconciliar_etapas_hotel($1,$2)$$;

SET check_function_bodies=on;
