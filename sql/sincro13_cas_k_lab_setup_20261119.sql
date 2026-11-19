-- SINCRO 13 · Únicamente en PostgreSQL 17 sintético de GitHub CI.
-- NO aplicar ni importar a los proyectos Supabase conectados.
ALTER TABLE app_private.manteniment_t_trabajos
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS fecha_realizada date,
  ADD COLUMN IF NOT EXISTS fecha_recogida date,
  ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE app_private.manteniment_parada_outbox (
  seguimiento_id uuid PRIMARY KEY,
  estado text NOT NULL CHECK (estado IN ('pendiente','confirmado','retenida_manual')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ultimo_error text NOT NULL DEFAULT ''
);
-- La tabla genuina contiene otras columnas, que el candidato CAS no modifica.

-- Etapas y trabajos de Hotel totalmente ficticios. K del flujo nuevo se
-- deriva de fecha_real de la etapa ENTRADA, NO de fecha_fin_real.
CREATE TABLE public.registros_hotel (
 id uuid PRIMARY KEY, seguimiento_id uuid NOT NULL,
 vehiculo_sustituido text NOT NULL,
 cancelado boolean NOT NULL DEFAULT false,
 hitos boolean NOT NULL DEFAULT true
);
CREATE TABLE public.vehiculos (
 id uuid PRIMARY KEY, dfm text NOT NULL
);
CREATE TABLE app_private.manteniment_activo_outbox (
 vehiculo_id uuid PRIMARY KEY,
 estado text NOT NULL CHECK (estado IN ('pendiente','confirmado','retenida_manual'))
);
CREATE TABLE public.etapas_hotel (
 id uuid PRIMARY KEY, registro_hotel_id uuid NOT NULL REFERENCES public.registros_hotel(id),
 seguimiento_id uuid NOT NULL, tipo_etapa text NOT NULL,
 fecha_real timestamptz, fecha_fin_real timestamptz,
 cancelado boolean NOT NULL DEFAULT false
);
CREATE TABLE public.trabajos_etapa_hotel (
 id uuid PRIMARY KEY, etapa_hotel_id uuid NOT NULL REFERENCES public.etapas_hotel(id),
 cancelado boolean NOT NULL DEFAULT false
);
CREATE FUNCTION app_private.usa_flujo_taller_hitos(p_registro_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT hitos FROM public.registros_hotel WHERE id=p_registro_id;
$$;
CREATE FUNCTION app_private.es_tipo_entrada_taller_alpha75(p_tipo text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT p_tipo='entrada_taller';
$$;
INSERT INTO public.registros_hotel(id,seguimiento_id,vehiculo_sustituido) VALUES
 ('77777777-7777-4777-8777-777777777777',
  '33333333-3333-4333-8333-333333333333','LABORATORIO-01');
INSERT INTO public.vehiculos(id,dfm) VALUES
 ('99999999-9999-4999-8999-999999999999','LABORATORIO-01');
INSERT INTO public.etapas_hotel(
 id,registro_hotel_id,seguimiento_id,tipo_etapa,fecha_real,fecha_fin_real)
VALUES
 ('66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'entrada_taller','2026-11-19T15:00:00Z','2026-11-18T15:00:00Z');
INSERT INTO public.trabajos_etapa_hotel(id,etapa_hotel_id) VALUES
 ('22222222-2222-4222-8222-222222222222',
  '66666666-6666-4666-8666-666666666666'),
 ('22222222-2222-4222-8222-222222222223',
  '66666666-6666-4666-8666-666666666666');


-- SOLO LAB. Emular la resolución de auth.uid/JWT y los controles REALES de
-- Metroges sin copiar usuarios ni sesiones del proyecto conectado.
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION app_private.sesion_auth_activa() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT auth.uid() IS NOT NULL AND
   auth.jwt()->>'session_id' = 'aaaaaaaa-0000-4000-8000-000000000001'
   AND coalesce(current_setting('s13.lab.session',true),'')='ACTIVA';
$$;
CREATE FUNCTION app_private.usuario_activo() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(current_setting('s13.lab.user',true),'')='ACTIVO';
$$;
CREATE FUNCTION app_private.dispositivo_autorizado() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(current_setting('s13.lab.device',true),'')='AUTORIZADO';
$$;
CREATE FUNCTION app_private.es_administrador_principal() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(current_setting('s13.lab.admin',true),'')='PRINCIPAL';
$$;
GRANT USAGE ON SCHEMA app_private,auth TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;


-- ÚNICAMENTE LABORATORIO: reproducir la función de lock que ya existe en
-- Supabase pruebas, más el bloqueo PARADA de su trigger instalado.
CREATE OR REPLACE FUNCTION app_private.bloquear_sync_continuidad_alpha75()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('MG75-CONTINUIDAD-001:manteniment-sync',0));
END;
$$;

CREATE FUNCTION app_private.sincro13_lab_bloquear_outbox_parada()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sincro13_lab_serializar_parada
BEFORE INSERT OR UPDATE OR DELETE ON app_private.manteniment_parada_outbox
FOR EACH ROW EXECUTE FUNCTION app_private.sincro13_lab_bloquear_outbox_parada();
