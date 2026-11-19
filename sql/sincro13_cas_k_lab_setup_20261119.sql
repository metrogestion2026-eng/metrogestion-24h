-- SINCRO 13 · Únicamente en PostgreSQL 17 sintético de GitHub CI.
-- NO aplicar ni importar a los proyectos Supabase conectados.
ALTER TABLE app_private.manteniment_t_trabajos
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS fecha_realizada date,
  ADD COLUMN IF NOT EXISTS fecha_recogida date,
  ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE app_private.manteniment_parada_outbox (
  seguimiento_id uuid PRIMARY KEY,
  estado text NOT NULL CHECK (estado IN ('pendiente','confirmado','retenida_manual'))
);
-- La tabla genuina contiene otras columnas, que el candidato CAS no modifica.
