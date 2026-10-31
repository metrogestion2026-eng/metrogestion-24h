-- Isolated browser fixture; never a migration or deployment.
-- hotel_por_dia is the literal schema-only runtime definition read 2026-10-28.
-- All rows and auxiliary catalogs/notes below are synthetic, with no auth/RLS
-- claim. Apply after hotel-views.sql and the base native PostgreSQL fixture.
SET search_path = public, pg_catalog;
CREATE TABLE public.anotaciones_manuales_hotel(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seguimiento_id uuid NOT NULL,
  registro_origen_id uuid, texto text NOT NULL, fecha_evento timestamptz,
  origen text DEFAULT 'manual', autor_nombre text, modificador_nombre text,
  version integer DEFAULT 1, creado_en timestamptz DEFAULT now(),
  actualizado_en timestamptz DEFAULT now(), cancelada boolean DEFAULT false);
CREATE TABLE public.anotaciones_generadas_hotel_anuladas(
  seguimiento_id uuid, etapa_seguimiento_id uuid, anulada_en timestamptz);
CREATE TABLE public.catalogo_tipos_trabajo(
  codigo text PRIMARY KEY, nombre text, requiere_expediente boolean DEFAULT false,
  requiere_diagnostico boolean DEFAULT false, activo boolean DEFAULT true);

-- Definition SHA-256: 1c7e6454ba947a3dca18e3932b3287fb1b1b48699ef31e30cf7973265e63b94d
CREATE VIEW public.hotel_por_dia WITH (security_invoker=true) AS
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
  GROUP BY r.id, p.fecha, p.estado;
