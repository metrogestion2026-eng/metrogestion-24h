BEGIN;
-- MG75-EDITOR-FECHAS-001. Preserve persisted instants when the complete editor
-- saves an unrelated field. ISO timestamps with an explicit zone retain that
-- zone; legacy datetime-local values retain Europe/Madrid interpretation.
-- The six editable date fields occur in ten core expressions (T insert/update).
-- No row, trigger, RPC signature, authorization rule or grant is changed here.
-- The read capability is published in the SAME transaction as the parser.
SET LOCAL search_path = pg_catalog, public;

CREATE TEMP TABLE editor_fechas_alpha75_function_security ON COMMIT DROP AS
SELECT p.oid, to_jsonb(p) - ARRAY['prosrc', 'prosqlbody'] AS properties
FROM pg_proc p WHERE false;

DO $editor_fechas$
DECLARE
  x record;
  p pg_proc%rowtype;
  v_acl text[];
  v_definition text;
  v_getter text;
  v_original text;
  v_replacement text;
  v_count integer;
  v_core_oid oid;
  v_getter_oid oid;
  -- PostgreSQL validates the date/time itself. This recognizes only an ISO
  -- date/time with an explicit numeric offset or Z, never a bare date suffix.
  v_zoned_pattern constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)$';
BEGIN
  FOR x IN SELECT * FROM (VALUES
    ('public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text)',
      '093c9f6c9f2b9dd172ed640969c3464c',
      ARRAY['search_path=pg_catalog, public'],
      ARRAY['postgres', 'service_role']),
    ('public.obtener_ficha_hotel_edicion_alpha72(uuid)',
      '770cfe5b3429c7026e00cfa961b40d3c',
      ARRAY['search_path=pg_catalog, app_private'],
      ARRAY['authenticated', 'postgres', 'service_role'])
  ) AS reviewed(signature, definition_md5, settings, grantees)
  LOOP
    SELECT * INTO p FROM pg_proc WHERE oid = to_regprocedure(x.signature);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'EDITOR-FECHAS-001: falta la función revisada %', x.signature USING ERRCODE = '55000';
    END IF;
    SELECT array_agg(pg_get_userbyid(a.grantee)::text ORDER BY pg_get_userbyid(a.grantee)::text)
      INTO v_acl FROM aclexplode(p.proacl) a;
    IF md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM x.definition_md5
       OR pg_get_userbyid(p.proowner) <> 'postgres'
       OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proretset
       OR p.provolatile <> 'v' OR p.proparallel <> 'u' OR p.prokind <> 'f'
       OR p.proconfig IS DISTINCT FROM x.settings
       OR p.proacl IS NULL OR v_acl IS DISTINCT FROM x.grantees
       OR EXISTS (
         SELECT 1 FROM aclexplode(p.proacl) a
         WHERE a.grantor <> p.proowner OR a.privilege_type <> 'EXECUTE' OR a.is_grantable
       ) THEN
      RAISE EXCEPTION 'EDITOR-FECHAS-001: deriva de definición o seguridad en %, requiere revisión', x.signature
        USING ERRCODE = '55000';
    END IF;
    INSERT INTO editor_fechas_alpha75_function_security
      SELECT p.oid, to_jsonb(p) - ARRAY['prosrc', 'prosqlbody'];
  END LOOP;

  v_core_oid := to_regprocedure('public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text)');
  v_getter_oid := to_regprocedure('public.obtener_ficha_hotel_edicion_alpha72(uuid)');
  v_definition := pg_get_functiondef(v_core_oid);
  FOR x IN SELECT * FROM (VALUES
    ('p_ficha', 'fecha_entrada', 1),
    ('p_ficha', 'fecha_limite_sustitucion', 1),
    ('v_stage', 'fecha_prevista', 2),
    ('v_stage', 'fecha_inicio_real', 2),
    ('v_stage', 'fecha_fin_real', 2),
    ('v_stage', 'fecha_real', 2)
  ) AS fields(variable_name, field_name, occurrences)
  LOOP
    v_original := format('(%s->>%L)::timestamp at time zone %L',
      x.variable_name, x.field_name, 'Europe/Madrid');
    v_count := (length(v_definition) - length(replace(v_definition, v_original, ''))) / length(v_original);
    IF v_count <> x.occurrences THEN
      RAISE EXCEPTION 'EDITOR-FECHAS-001: conversión inesperada de %.%', x.variable_name, x.field_name
        USING ERRCODE = '55000';
    END IF;
    v_replacement := format('(case when (%s->>%L) ~ %L then (%s->>%L)::timestamptz else %s end)',
      x.variable_name, x.field_name, v_zoned_pattern,
      x.variable_name, x.field_name, v_original);
    v_definition := replace(v_definition, v_original, v_replacement);
  END LOOP;
  EXECUTE v_definition;

  v_getter := pg_get_functiondef(v_getter_oid);
  v_original := 'select app_private.obtener_ficha_hotel_edicion_alpha72($1);';
  IF (length(v_getter) - length(replace(v_getter, v_original, ''))) / length(v_original) <> 1 THEN
    RAISE EXCEPTION 'EDITOR-FECHAS-001: lector inesperado, no se anuncia el contrato' USING ERRCODE = '55000';
  END IF;
  v_getter := replace(v_getter, v_original,
    'select app_private.obtener_ficha_hotel_edicion_alpha72($1) || pg_catalog.jsonb_build_object(''contrato_fechas_editor'', ''MG75-EDITOR-FECHAS-001'');');
  EXECUTE v_getter;

  IF pg_get_functiondef(v_core_oid) IS DISTINCT FROM v_definition
     OR pg_get_functiondef(v_getter_oid) IS DISTINCT FROM v_getter
     OR EXISTS (
       SELECT 1 FROM editor_fechas_alpha75_function_security s
       LEFT JOIN pg_proc f ON f.oid = s.oid
       WHERE f.oid IS NULL OR (to_jsonb(f) - ARRAY['prosrc', 'prosqlbody']) IS DISTINCT FROM s.properties
     ) THEN
    RAISE EXCEPTION 'EDITOR-FECHAS-001: la sustitución no conservó exactamente el contrato o la seguridad'
      USING ERRCODE = '55000';
  END IF;
END $editor_fechas$;
COMMIT;
