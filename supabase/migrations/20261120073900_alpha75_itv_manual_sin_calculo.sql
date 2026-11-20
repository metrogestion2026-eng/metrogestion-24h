-- ALPHA75-ITV-MANUAL-001
-- No modifica lecturas existentes ni inventa la fecha de última ITV.
-- Mantiene ACL, propietario y metadatos originales de ambas funciones.
-- El formulario envía proxima_itv_fecha explícita: la edición manual manda.

do $patch$
declare v_reg regprocedure; v_ddl text; v_old text; v_new text; v_n integer;
begin
  v_reg := 'app_private.vehiculos_sync_fin_contrato_fecha()'::regprocedure;
  v_ddl := pg_get_functiondef(v_reg);
  v_old := $old$  new.proxima_itv_fecha := case
    when new.fecha_matriculacion is null then null
    else (new.fecha_matriculacion + interval '1 year')::date
  end;$old$;
  v_new := $new$  -- La ITV no se deduce de la primera matriculación.
  -- El valor manual (incluido NULL) se conserva en INSERT/UPDATE.$new$;
  v_n := (length(v_ddl)-length(replace(v_ddl,v_old,'')))/length(v_old);
  if v_n<>1 then raise exception 'ALPHA75-ITV-MANUAL-001: deriva en trigger de vehiculos (% anclas)',v_n; end if;
  execute replace(v_ddl,v_old,v_new);

  v_reg := 'app_private.guardar_activo(uuid,integer,jsonb,text)'::regprocedure;
  v_ddl := pg_get_functiondef(v_reg);

  v_old := $old$  v_fecha_alta date;$old$;
  v_new := $new$  v_fecha_alta date;
  v_proxima_itv date;$new$;
  v_n := (length(v_ddl)-length(replace(v_ddl,v_old,'')))/length(v_old);
  if v_n<>1 then raise exception 'ALPHA75-ITV-MANUAL-001: deriva en declaración de fecha ITV'; end if;
  v_ddl := replace(v_ddl,v_old,v_new);

  v_old := $old$    v_fecha_alta := nullif(p_payload->>'fecha_alta_manteniment', '')::date;$old$;
  v_new := $new$    v_fecha_alta := nullif(p_payload->>'fecha_alta_manteniment', '')::date;
    v_proxima_itv := nullif(p_payload->>'proxima_itv_fecha', '')::date;$new$;
  v_n := (length(v_ddl)-length(replace(v_ddl,v_old,'')))/length(v_old);
  if v_n<>1 then raise exception 'ALPHA75-ITV-MANUAL-001: deriva en lectura de ITV'; end if;
  v_ddl := replace(v_ddl,v_old,v_new);

  v_old := $old$      fecha_alta_manteniment, fin_contrato_fecha, fin_contrato_km, km_actual,$old$;
  v_new := $new$      fecha_alta_manteniment, proxima_itv_fecha, fin_contrato_fecha, fin_contrato_km, km_actual,$new$;
  v_n := (length(v_ddl)-length(replace(v_ddl,v_old,'')))/length(v_old);
  if v_n<>1 then raise exception 'ALPHA75-ITV-MANUAL-001: deriva en columnas INSERT'; end if;
  v_ddl := replace(v_ddl,v_old,v_new);

  v_old := $old$      v_fecha_alta, v_fin_contrato_fecha, v_fin_contrato_km, v_km_actual,$old$;
  v_new := $new$      v_fecha_alta, v_proxima_itv, v_fin_contrato_fecha, v_fin_contrato_km, v_km_actual,$new$;
  v_n := (length(v_ddl)-length(replace(v_ddl,v_old,'')))/length(v_old);
  if v_n<>1 then raise exception 'ALPHA75-ITV-MANUAL-001: deriva en valores INSERT'; end if;
  v_ddl := replace(v_ddl,v_old,v_new);

  v_old := $old$        fecha_alta_manteniment = v_fecha_alta,$old$;
  v_new := $new$        fecha_alta_manteniment = v_fecha_alta,
        proxima_itv_fecha = v_proxima_itv,$new$;
  v_n := (length(v_ddl)-length(replace(v_ddl,v_old,'')))/length(v_old);
  if v_n<>1 then raise exception 'ALPHA75-ITV-MANUAL-001: deriva en UPDATE'; end if;
  v_ddl := replace(v_ddl,v_old,v_new);
  execute v_ddl;
end
$patch$;
