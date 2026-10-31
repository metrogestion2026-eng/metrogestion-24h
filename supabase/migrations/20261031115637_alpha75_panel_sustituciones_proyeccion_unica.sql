-- MG75-PANEL-PROYECCION-001: preserve one projection per selected summary row.
-- No application rows, synchronization barriers or privileges are changed.
-- The single-use datos CTE is inlined by PostgreSQL. Its STABLE projection is
-- consequently expanded into every JSON extraction (11 references in the
-- observed Panel plan). OFFSET 0 keeps one parameterized scalar projection per
-- selected physical summary row while allowing seguimiento filters and unused
-- metadata columns to be pruned outside that projection.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $panel_projection_once$
DECLARE
  v_oid oid := to_regclass('public.paradas_sustitucion_resumen');
  v_owner oid;
  v_acl aclitem[];
  v_options text[];
  v_definition text;
  v_columns jsonb;
  v_columns_after jsonb;
  v_old_fragment constant text := '            app_private.proyectar_continuidad_sustitucion_alpha75(f.seguimiento_id) AS m
           FROM fisico f';
  v_new_fragment constant text := '            cm.m
           FROM fisico f
           CROSS JOIN LATERAL (
             SELECT app_private.proyectar_continuidad_sustitucion_alpha75(f.seguimiento_id) AS m
             OFFSET 0
           ) cm';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'MG75-PANEL-PROYECCION-001: falta la vista de sustituciones' USING ERRCODE = '55000';
  END IF;

  SELECT c.relowner, c.relacl, c.reloptions
  INTO v_owner, v_acl, v_options
  FROM pg_class c WHERE c.oid = v_oid AND c.relkind = 'v';
  v_definition := pg_get_viewdef(v_oid, true);

  IF v_owner IS NULL OR NOT coalesce('security_invoker=true' = ANY(v_options), false)
     OR md5(v_definition) <> '22e31cc9d721afac9f6432f44710766c' THEN
    RAISE EXCEPTION 'MG75-PANEL-PROYECCION-001: deriva de vista o seguridad' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('app_private.proyectar_continuidad_sustitucion_alpha75(uuid)'::regprocedure))
       <> '81e0775aa9d5cbe128f13a4e5cc08a81'
     OR md5(pg_get_functiondef('app_private.metadatos_continuidad_alpha75(uuid)'::regprocedure))
       <> '35510e4bbb9ae331ca741126debee1cd' THEN
    RAISE EXCEPTION 'MG75-PANEL-PROYECCION-001: deriva de proyeccion' USING ERRCODE = '55000';
  END IF;
  IF (length(v_definition) - length(replace(v_definition, v_old_fragment, '')))
       / length(v_old_fragment) <> 1 THEN
    RAISE EXCEPTION 'MG75-PANEL-PROYECCION-001: fragmento de proyeccion inesperado' USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod,
                                   a.attcollation, a.attnotnull) ORDER BY a.attnum)
  INTO v_columns
  FROM pg_attribute a WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped;

  EXECUTE 'CREATE OR REPLACE VIEW public.paradas_sustitucion_resumen '
    || 'WITH (security_invoker = true) AS '
    || replace(v_definition, v_old_fragment, v_new_fragment);

  SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod,
                                   a.attcollation, a.attnotnull) ORDER BY a.attnum)
  INTO v_columns_after
  FROM pg_attribute a WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped;
  IF to_regclass('public.paradas_sustitucion_resumen')::oid IS DISTINCT FROM v_oid
     OR v_columns_after IS DISTINCT FROM v_columns
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c WHERE c.oid = v_oid
         AND c.relowner = v_owner
         AND c.relacl IS NOT DISTINCT FROM v_acl
         AND c.reloptions IS NOT DISTINCT FROM v_options
     ) THEN
    RAISE EXCEPTION 'MG75-PANEL-PROYECCION-001: contrato de vista alterado' USING ERRCODE = '55000';
  END IF;
END;
$panel_projection_once$;
COMMIT;
