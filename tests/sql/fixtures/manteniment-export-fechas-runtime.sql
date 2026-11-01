-- Minimal PostgreSQL schema for the actual exporter and identity resolver.
-- All rows are synthetic and created by the tests; no production export.
CREATE SCHEMA app_private;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.pizarras (
  id uuid PRIMARY KEY, estado text, fecha date
);
CREATE TABLE public.registros_hotel (
  id uuid PRIMARY KEY, seguimiento_id uuid NOT NULL,
  pizarra_id uuid REFERENCES public.pizarras(id), numero_parada text,
  vehiculo_sustituido text, matricula_sustituido text, tipo_unidad text,
  upc text, marca text, actualizado_en timestamptz,
  estado text, cancelado boolean DEFAULT false,
  retirado_hotel_activo boolean DEFAULT false
);
CREATE TABLE public.etapas_hotel (
  id uuid PRIMARY KEY, registro_hotel_id uuid REFERENCES public.registros_hotel(id),
  seguimiento_id uuid NOT NULL, grupo_documental_id uuid NOT NULL,
  creado_en timestamptz, estado text, cancelado boolean DEFAULT false,
  tipo_etapa text, fecha_prevista timestamptz, fecha_inicio_real timestamptz,
  fecha_fin_real timestamptz, fecha_real timestamptz
);
CREATE TABLE public.trabajos_etapa_hotel (
  id uuid PRIMARY KEY, etapa_hotel_id uuid REFERENCES public.etapas_hotel(id),
  km_averia numeric, expediente text, motivo_entrada text,
  diagnostico_real text, descripcion text, cancelado boolean DEFAULT false
);
CREATE TABLE app_private.manteniment_t_trabajos (
  id uuid PRIMARY KEY, sync_id uuid NOT NULL UNIQUE,
  seguimiento_id uuid NOT NULL, trabajo_hotel_id uuid REFERENCES public.trabajos_etapa_hotel(id),
  taller text, tipo_trabajo text, designacion text,
  fecha_necesidad date NOT NULL, fecha_realizada date, fecha_recogida date,
  fuentes jsonb NOT NULL DEFAULT '[]'::jsonb, creado_en timestamptz
);
CREATE TABLE public.vehiculos (
  dfm text PRIMARY KEY, tipo_manteniment text, upc text, marca text
);
CREATE TABLE app_private.test_sync_sentinels (
  id integer PRIMARY KEY,
  solo_lectura_manual_protegida boolean,
  escritura_segura_manual boolean,
  pausa_importacion_identidad boolean,
  revision integer,
  estado text,
  confirmado_en timestamptz
);
INSERT INTO app_private.test_sync_sentinels
VALUES (1,true,false,true,8,'pendiente',NULL);

CREATE OR REPLACE FUNCTION app_private.manteniment_etapa_actual(p_seguimiento_id uuid, p_etapa_origen_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select actual.id
  from public.etapas_hotel origen
  join public.registros_hotel original on original.id = origen.registro_hotel_id
  cross join lateral (
    select r.id from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = p_seguimiento_id
    order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
  ) ficha
  join public.etapas_hotel actual
    on actual.registro_hotel_id = ficha.id
   and (actual.seguimiento_id = origen.seguimiento_id
     or (actual.grupo_documental_id = origen.grupo_documental_id
       and not exists (
         select 1 from public.etapas_hotel identidad
         where identidad.registro_hotel_id = ficha.id
           and identidad.seguimiento_id = origen.seguimiento_id
       )))
  where origen.id = p_etapa_origen_id
    and original.seguimiento_id = p_seguimiento_id
  order by actual.cancelado, actual.creado_en, actual.id
  limit 1;
$function$
