-- SINCRO 13 · BASE TOTALMENTE FICTICIA PostgreSQL 17.
-- NO aplicar a Supabase ni a MANTENIMENT.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA app_private;
GRANT USAGE ON SCHEMA app_private TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

CREATE TABLE app_private.manteniment_sync_config (
  id smallint PRIMARY KEY,
  spreadsheet_id text NOT NULL,
  token_activo boolean NOT NULL,
  token_hash text NOT NULL
);
CREATE TABLE app_private.manteniment_entregas_continuidad_alpha75 (
  sync_id uuid NOT NULL,
  revision integer NOT NULL,
  seguimiento_id uuid NOT NULL,
  tipo text NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  origen text NOT NULL,
  entregado_en timestamptz,
  confirmado_en timestamptz,
  PRIMARY KEY(sync_id,revision)
);
CREATE TABLE app_private.manteniment_t_trabajos (
  sync_id uuid PRIMARY KEY,
  trabajo_hotel_id uuid NOT NULL,
  seguimiento_id uuid NOT NULL
);
CREATE TABLE app_private.mg9_filas_identidad (
  spreadsheet_id text NOT NULL,id_fila bigint NOT NULL,
  PRIMARY KEY(spreadsheet_id,id_fila)
);

CREATE FUNCTION app_private.referencia_ejecucion_manteniment_valida(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p)='object'
    AND p ?& ARRAY['tipo','sync_id','revision','payload_sha256']
    AND (SELECT count(*) FROM jsonb_object_keys(p))=4
    AND p->>'tipo' IN ('trabajos','parada')
    AND coalesce(p->>'sync_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND coalesce(p->>'revision','') ~ '^[1-9][0-9]{0,5}$'
    AND coalesce(p->>'payload_sha256','') ~ '^[0-9a-f]{64}$';
$$;
INSERT INTO app_private.manteniment_sync_config
VALUES (1,'sincro13-hoja-sintetica-20261118',true,
  encode(extensions.digest('mg_'||repeat('0',64),'sha256'),'hex'));

INSERT INTO app_private.manteniment_t_trabajos
 (sync_id,trabajo_hotel_id,seguimiento_id) VALUES
 ('11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'),
 ('11111111-1111-4111-8111-111111111112',
  '22222222-2222-4222-8222-222222222223',
  '33333333-3333-4333-8333-333333333333');

INSERT INTO app_private.manteniment_entregas_continuidad_alpha75
(sync_id,revision,seguimiento_id,tipo,payload,payload_sha256,origen,entregado_en)
SELECT
 '44444444-4444-4444-8444-444444444444',7,
 '33333333-3333-4333-8333-333333333333','trabajos',
 p,encode(sha256(convert_to(p::text,'UTF8')),'hex'),'entrega',
 clock_timestamp()-interval '2 minutes'
FROM (
  SELECT jsonb_build_object('trabajos_crear',jsonb_build_array(
    jsonb_build_object(
      'trabajo_sync_id','11111111-1111-4111-8111-111111111111',
      'trabajo_hotel_id','22222222-2222-4222-8222-222222222222',
      'dfm','LABORATORIO-01',
      'retener_propuesta',false
    )
  )) AS p
) x;

-- Otro seguimiento sintético pero entrega antigua: debe rechazarse.
INSERT INTO app_private.manteniment_entregas_continuidad_alpha75
(sync_id,revision,seguimiento_id,tipo,payload,payload_sha256,origen,entregado_en)
SELECT '55555555-5555-4555-8555-555555555555',1,
 '33333333-3333-4333-8333-333333333333','trabajos',
 p,encode(sha256(convert_to(p::text,'UTF8')),'hex'),'entrega',
 '2026-11-10T10:00:00Z'::timestamptz
FROM (SELECT jsonb_build_object('trabajos_crear',jsonb_build_array(
  jsonb_build_object('trabajo_sync_id','11111111-1111-4111-8111-111111111112',
                     'trabajo_hotel_id','22222222-2222-4222-8222-222222222223',
                     'dfm','LABORATORIO-02'))) AS p) x;
