-- SINCRO 13 · Barrera COMPARTIDA para todas las mutaciones de OUTBOX ACTIVOS.
-- CANDIDATA NO DESPLEGADA. La tabla de PARADA ya utiliza el advisory lock
-- desde el trigger instalado proteger_outbox_continuidad_alpha75.
-- Este trigger cubre también escrituras directas a ACTIVOS (no solo el RPC).
-- No cambia estados, payloads, permisos, prioridades, identidades ni T.
BEGIN;

CREATE OR REPLACE FUNCTION app_private.sincro13_bloquear_outbox_activo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $s13_lock_activo$
BEGIN
  PERFORM app_private.bloquear_sync_continuidad_alpha75();
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$s13_lock_activo$;

REVOKE ALL ON FUNCTION app_private.sincro13_bloquear_outbox_activo()
  FROM PUBLIC, anon, authenticated, service_role;

-- Solo una instalación intencional de esta migración crea el trigger.
CREATE TRIGGER sincro13_serializar_outbox_activo
  BEFORE INSERT OR UPDATE OR DELETE
  ON app_private.manteniment_activo_outbox
  FOR EACH ROW
  EXECUTE FUNCTION app_private.sincro13_bloquear_outbox_activo();

COMMIT;
