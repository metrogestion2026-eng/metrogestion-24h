-- MG75: accept the real ISO edit stamps already emitted by Apps Script.
-- No synthetic timestamps, baseline promotion, replay, flag change or data repair.
BEGIN;
DO $sellos_iso$
DECLARE
  v_oid oid;
  v_before text;
  v_after text;
  v_properties jsonb;
  v_old constant text := $old$    and c.value ~ '^\\d{4}-\\d{2}-\\d{2}T'$old$;
  v_new constant text := $new$    and c.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'$new$;
BEGIN
  -- Share the receiver's existing serialization boundary; it only takes a lock.
  IF md5(pg_get_functiondef(to_regprocedure(
       'app_private.bloquear_sync_continuidad_alpha75()')))
       IS DISTINCT FROM '1e357e8cce17d1538f9a69424e0378e2' THEN
    RAISE EXCEPTION 'MG_SELLOS_LOCK_INESPERADO: revisar el bloqueo antes de instalar';
  END IF;
  PERFORM app_private.bloquear_sync_continuidad_alpha75();

  v_oid := to_regprocedure(
    'app_private.aplicar_snapshot_manteniment(jsonb,text,uuid,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'MG_SELLOS_BASE_AUSENTE: no existe el importador revisado';
  END IF;
  SELECT pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
    INTO v_before,v_properties
    FROM pg_proc p WHERE p.oid=v_oid;
  IF md5(v_before) IS DISTINCT FROM 'cf7c2a01aaf8db1c2a68c8ba42bd8249' THEN
    RAISE EXCEPTION 'MG_SELLOS_BASE_INESPERADA: no se cambia un importador distinto de la base revisada';
  END IF;
  IF (length(v_before)-length(replace(v_before,v_old,'')))/length(v_old) <> 1 THEN
    RAISE EXCEPTION 'MG_SELLOS_ANCLA_INESPERADA: se esperaba exactamente un filtro de sellos';
  END IF;

  v_after := replace(v_before,v_old,v_new);
  IF md5(v_after) IS DISTINCT FROM '4a3fcfe1e98eb6315aef5e5d219c71c0' THEN
    RAISE EXCEPTION 'MG_SELLOS_RESULTADO_INESPERADO: revisar el reemplazo literal';
  END IF;
  EXECUTE v_after;

  IF to_regprocedure(
       'app_private.aplicar_snapshot_manteniment(jsonb,text,uuid,text)')::oid
       IS DISTINCT FROM v_oid
     OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=v_oid)
       IS DISTINCT FROM v_properties
     OR pg_get_functiondef(v_oid) IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'MG_SELLOS_PROPIEDADES_ALTERADAS: se conservan OID, propietario, ACL y contrato';
  END IF;
END;
$sellos_iso$;
COMMIT;
