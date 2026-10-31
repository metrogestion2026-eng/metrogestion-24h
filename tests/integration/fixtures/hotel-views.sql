-- Isolated UI roundtrip fixture. Not a deployment/migration.
-- View definitions are the schema-only runtime definitions inspected 2026-10-28.
-- No operational rows, credentials or sessions. The auxiliary columns/catalogs
-- below supply only the missing schema needed by those exact view definitions.
-- Authentication, authorization and unrelated catalog services remain synthetic.
SET search_path = public, pg_catalog;
ALTER TABLE public.catalogo_modalidades_operativas_hotel ADD COLUMN nombre text NOT NULL DEFAULT 'Modalidad sintética';
ALTER TABLE public.trabajos_etapa_hotel
  ADD COLUMN peritaje_estado text NOT NULL DEFAULT '',
  ADD COLUMN motivo_cancelacion text NOT NULL DEFAULT '',
  ADD COLUMN creado_en timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.talleres(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nombre text);
CREATE TABLE public.centros_taller(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nombre text);
ALTER TABLE public.vehiculos
  ADD COLUMN matricula text NOT NULL DEFAULT '',
  ADD COLUMN categoria text NOT NULL DEFAULT '',
  ADD COLUMN clase_vehiculo text NOT NULL DEFAULT '',
  ADD COLUMN tipo_motor text NOT NULL DEFAULT '',
  ADD COLUMN marca text NOT NULL DEFAULT '',
  ADD COLUMN modelo text NOT NULL DEFAULT '',
  ADD COLUMN bastidor text NOT NULL DEFAULT '',
  ADD COLUMN upc text NOT NULL DEFAULT '',
  ADD COLUMN telefono text NOT NULL DEFAULT '',
  ADD COLUMN fecha_matriculacion date,
  ADD COLUMN fin_contrato_fecha date,
  ADD COLUMN fin_contrato_km integer,
  ADD COLUMN km_actual integer,
  ADD COLUMN reserva boolean NOT NULL DEFAULT false,
  ADD COLUMN activo boolean NOT NULL DEFAULT true;
ALTER TABLE public.reservas_hotel
  ADD COLUMN etiqueta text NOT NULL DEFAULT 'Reserva sintética',
  ADD COLUMN ubicacion text NOT NULL DEFAULT '',
  ADD COLUMN actualizado_en timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.usuarios(
  id uuid PRIMARY KEY,nombre text,apellidos text,correo text,tipo_usuario text,
  permisos jsonb,activo boolean,creado_en timestamptz DEFAULT now(),actualizado_en timestamptz DEFAULT now());

-- Definition SHA-256: e7031ab0664f153a4fd1bf29fdef02f63a6f1d32f645bcb7841ff54c3d7e905f
CREATE VIEW public.hotel_actual WITH (security_invoker=true) AS
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
              WHERE x.pizarra_id = r.pizarra_id AND x.id <> r.id AND NOT x.cancelado AND NOT x.retirado_hotel_activo AND x.tipo_sustituto = 'FLOTA'::text AND regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+'::text, ''::text, 'g'::text) = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+'::text, ''::text, 'g'::text))) THEN 'sustitucion_momentanea'::text
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
              WHERE x.pizarra_id = r.pizarra_id AND x.id <> r.id AND NOT x.cancelado AND NOT x.retirado_hotel_activo AND x.tipo_sustituto = 'FLOTA'::text AND regexp_replace(upper(btrim(x.vehiculo_reserva)), '[[:space:]]+'::text, ''::text, 'g'::text) = regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+'::text, ''::text, 'g'::text))) THEN 'marron'::text
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
  GROUP BY r.id, p.fecha;

-- Definition SHA-256: c16fa2209a383b165a7cf35599e18fb3bb1385d88dc8919b94e58814b0b8375d
CREATE VIEW public.hotel_actual_detalle WITH (security_invoker=true) AS
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
   FROM hotel_actual h;
