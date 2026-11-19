-- SINCRO13 · Retención per-work de K MANUAL ACREDITADA en outbox PARADA.
-- CANDIDATO NO DESPLEGADO. No altera trabajos ni fechas y NUNCA borra cola.
-- Requiere evidencias aprobadas por administración y CAS ya completado.
-- Solo se consulta trabajo_sync_id, no la fila física ni DFM ni PA.
BEGIN;

CREATE OR REPLACE FUNCTION app_private.sincro13_retener_outbox_k_manual()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $s13_proteger$
DECLARE
  v_item jsonb;
  v_work text;
  v_k_aprobada date;
  v_encontrada boolean;
  v_items jsonb;
BEGIN
  IF NEW.estado IS DISTINCT FROM 'pendiente' THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' THEN
    NEW.estado:='retenida_manual';
    NEW.ultimo_error:='S13_K_MANUAL: payload no cotejable; requiere revisión.';
    RETURN NEW;
  END IF;

  IF (NEW.payload ? 'trabajos_asignados'
       AND jsonb_typeof(NEW.payload->'trabajos_asignados') IS DISTINCT FROM 'array')
     OR (NEW.payload ? 'trabajos_crear'
       AND jsonb_typeof(NEW.payload->'trabajos_crear') IS DISTINCT FROM 'array')
  THEN
    NEW.estado:='retenida_manual';
    NEW.ultimo_error:='S13_K_MANUAL: colección de trabajos no cotejable.';
    RETURN NEW;
  END IF;

  v_items := (
    CASE WHEN jsonb_typeof(NEW.payload->'trabajos_asignados')='array'
      THEN NEW.payload->'trabajos_asignados' ELSE '[]'::jsonb END
  ) || (
    CASE WHEN jsonb_typeof(NEW.payload->'trabajos_crear')='array'
      THEN NEW.payload->'trabajos_crear' ELSE '[]'::jsonb END
  );
  IF jsonb_array_length(v_items)=0 THEN RETURN NEW; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS x(value) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      NEW.estado:='retenida_manual';
      NEW.ultimo_error:='S13_K_MANUAL: trabajo de outbox no cotejable.';
      RETURN NEW;
    END IF;
    IF NOT (v_item ? 'fecha_salida') THEN CONTINUE; END IF;

    v_work:=lower(btrim(coalesce(v_item->>'trabajo_sync_id','')));
    IF v_work !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}

    SELECT ev.valor_nuevo INTO v_k_aprobada
    FROM app_private.sincro13_k_evidencias ev
    WHERE ev.trabajo_sync_id::text=v_work
      AND ev.estado='APLICADA'
      AND ev.spreadsheet_id=(
        SELECT spreadsheet_id FROM app_private.manteniment_sync_config WHERE id=1
      )
    ORDER BY ev.consumido_en DESC NULLS LAST,ev.evidencia_id DESC
    LIMIT 1;
    v_encontrada:=FOUND;
    IF v_encontrada AND v_item->'fecha_salida' IS DISTINCT FROM to_jsonb(v_k_aprobada) THEN
      -- No convertir K ni eliminar los otros trabajos del lote. La orden
      -- completa permanece visible, retenida para contraste humano.
      NEW.estado:='retenida_manual';
      NEW.ultimo_error:='S13_K_MANUAL: fecha_salida contradice K aprobada para un trabajo_sync_id. No reenviar esta orden.';
      RETURN NEW;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$s13_proteger$;

REVOKE ALL ON FUNCTION app_private.sincro13_retener_outbox_k_manual()
  FROM PUBLIC,anon,authenticated,service_role;

-- Orden alfabético posterior a los triggers existentes de MANTENIMENT:
-- mantener sus protecciones de continuidad/disposición.
CREATE TRIGGER sincro13_retener_k_manual_outbox_parada
  BEFORE INSERT OR UPDATE
  ON app_private.manteniment_parada_outbox
  FOR EACH ROW
  EXECUTE FUNCTION app_private.sincro13_retener_outbox_k_manual();
COMMIT;
 THEN
      NEW.estado:='retenida_manual';
      NEW.ultimo_error:='S13_K_MANUAL: UUID de trabajo ausente o inválido junto a K.';
      RETURN NEW;
    END IF;

    SELECT ev.valor_nuevo INTO v_k_aprobada
    FROM app_private.sincro13_k_evidencias ev
    WHERE ev.trabajo_sync_id::text=v_work
      AND ev.estado='APLICADA'
      AND ev.spreadsheet_id=(
        SELECT spreadsheet_id FROM app_private.manteniment_sync_config WHERE id=1
      )
    ORDER BY ev.consumido_en DESC NULLS LAST,ev.evidencia_id DESC
    LIMIT 1;
    v_encontrada:=FOUND;
    IF v_encontrada AND v_item->'fecha_salida' IS DISTINCT FROM to_jsonb(v_k_aprobada) THEN
      -- No convertir K ni eliminar los otros trabajos del lote. La orden
      -- completa permanece visible, retenida para contraste humano.
      NEW.estado:='retenida_manual';
      NEW.ultimo_error:='S13_K_MANUAL: fecha_salida contradice K aprobada para un trabajo_sync_id. No reenviar esta orden.';
      RETURN NEW;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$s13_proteger$;

REVOKE ALL ON FUNCTION app_private.sincro13_retener_outbox_k_manual()
  FROM PUBLIC,anon,authenticated,service_role;

-- Orden alfabético posterior a los triggers existentes de MANTENIMENT:
-- mantener sus protecciones de continuidad/disposición.
CREATE TRIGGER sincro13_retener_k_manual_outbox_parada
  BEFORE INSERT OR UPDATE
  ON app_private.manteniment_parada_outbox
  FOR EACH ROW
  EXECUTE FUNCTION app_private.sincro13_retener_outbox_k_manual();
COMMIT;
