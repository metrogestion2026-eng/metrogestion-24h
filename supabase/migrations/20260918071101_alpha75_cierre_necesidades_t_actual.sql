-- Regla general: la T actual cierra todas sus necesidades vinculadas.
-- Sin cambios en permisos ni código de las aplicaciones Alpha75/Alpha76.

CREATE OR REPLACE FUNCTION app_private.manteniment_fechas_desde_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_fecha date;
  v_seguimiento_id uuid;
  v_actualizados integer := 0;
begin
  if coalesce(current_setting('app.clonando_pizarra', true), '') = '1'
     or coalesce(current_setting('app.reconciliando_etapas', true), '') = '1'
     or coalesce(current_setting('app.manteniment_importando_paradas', true), '') = '1'
  then
    return new;
  end if;

  if new.cancelado
     or new.estado <> 'realizada'
     or (
       tg_op = 'UPDATE'
       and old.estado is not distinct from new.estado
       and old.cancelado is not distinct from new.cancelado
       and old.fecha_real is not distinct from new.fecha_real
       and old.fecha_fin_real is not distinct from new.fecha_fin_real
       and old.fecha_inicio_real is not distinct from new.fecha_inicio_real
     )
  then
    return new;
  end if;

  v_fecha := (
    coalesce(new.fecha_real, new.fecha_fin_real, new.fecha_inicio_real, clock_timestamp())
    at time zone 'Europe/Madrid'
  )::date;

  -- seguimiento_id de la T identifica la T, no la ficha.
  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r where r.id = new.registro_hotel_id;

  if new.tipo_etapa = 'entrada_taller' then
    update app_private.manteniment_t_trabajos w
       set fecha_realizada = v_fecha,
           fecha_recogida = case when v.modalidad in ('gestion', 'tramite', 'entrada_sin_recogida')
             then v_fecha else w.fecha_recogida end,
           actualizado_en = clock_timestamp()
      from public.trabajos_etapa_hotel th, app_private.manteniment_t_visitas v
     where th.id = w.trabajo_hotel_id and not th.cancelado
       and v.id = w.visita_id
       and w.seguimiento_id = v_seguimiento_id
       and app_private.manteniment_etapa_actual(w.seguimiento_id, th.etapa_hotel_id) = new.id
       and (w.fecha_realizada is distinct from v_fecha
         or (v.modalidad in ('gestion', 'tramite', 'entrada_sin_recogida')
             and w.fecha_recogida is distinct from v_fecha));
    get diagnostics v_actualizados = row_count;
  elsif new.tipo_etapa = 'recogida_taller' then
    update app_private.manteniment_t_trabajos w
       set fecha_recogida = v_fecha,
           actualizado_en = clock_timestamp()
      from app_private.manteniment_t_visitas v
     where v.id = w.visita_id
       and w.seguimiento_id = v_seguimiento_id
       and v.modalidad = 'taller'
       and v.grupo_recogida_id = new.grupo_documental_id
       and w.fecha_recogida is distinct from v_fecha;
    get diagnostics v_actualizados = row_count;
  else
    update app_private.manteniment_t_trabajos w
       set fecha_realizada = case
             -- REPUESTOS.J es el pedido. ACT/CV/LINDEP.J es entrada, no salida.
             when upper(btrim(w.designacion)) in ('REPUESTOS', 'ACT', 'CV', 'LINDEP')
               then w.fecha_realizada
             else v_fecha
           end,
           fecha_recogida = v_fecha,
           actualizado_en = clock_timestamp()
      from public.trabajos_etapa_hotel th
     where th.id = w.trabajo_hotel_id and not th.cancelado
       and w.seguimiento_id = v_seguimiento_id
       and app_private.manteniment_etapa_actual(w.seguimiento_id, th.etapa_hotel_id) = new.id
       and (w.fecha_realizada is distinct from v_fecha
            or w.fecha_recogida is distinct from v_fecha);
    get diagnostics v_actualizados = row_count;
  end if;

  if v_seguimiento_id is not null
     and (v_actualizados > 0 or new.accion_sistema = 'recuperar_y_liberar')
     and exists (
       select 1
       from app_private.manteniment_parada_sync s
       where s.seguimiento_id = v_seguimiento_id
     )
  then
    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;

  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION app_private.manteniment_trabajos_asignados(p_seguimiento_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'trabajo_sync_id', w.sync_id,
        'fila', nullif(source.value->>'fila', '')::integer,
        'clave_fila', coalesce(source.value->>'clave_fila', ''),
        'fecha_entrada', coalesce(w.fecha_realizada, case when etapa.estado = 'realizada'
          then (coalesce(etapa.fecha_real, etapa.fecha_fin_real, etapa.fecha_inicio_real) at time zone 'Europe/Madrid')::date end),
        'fecha_salida', coalesce(w.fecha_recogida, recogida.fecha,
          case when etapa.estado = 'realizada'
            and (etapa.tipo_etapa not in ('entrada_taller', 'recogida_taller')
              or (etapa.tipo_etapa = 'entrada_taller'
                  and visita.modalidad in ('gestion', 'tramite', 'entrada_sin_recogida')))
          then (coalesce(etapa.fecha_real, etapa.fecha_fin_real, etapa.fecha_inicio_real) at time zone 'Europe/Madrid')::date end)
      )
      order by nullif(source.value->>'fila', '')::integer, w.sync_id
    ),
    '[]'::jsonb
  )
  from app_private.manteniment_t_trabajos w
  left join app_private.manteniment_t_visitas visita on visita.id = w.visita_id
  cross join lateral jsonb_array_elements(w.fuentes) source(value)
  join public.trabajos_etapa_hotel trabajo on trabajo.id = w.trabajo_hotel_id
  join public.etapas_hotel etapa on etapa.id = app_private.manteniment_etapa_actual(
    w.seguimiento_id, trabajo.etapa_hotel_id)
  left join lateral (
    select (coalesce(e.fecha_real, e.fecha_fin_real) at time zone 'Europe/Madrid')::date as fecha
    from public.etapas_hotel e
    where e.registro_hotel_id = etapa.registro_hotel_id
      and e.etapa_origen_id = etapa.id and e.tipo_etapa = 'recogida_taller'
      and not e.cancelado and e.estado = 'realizada'
    order by e.posicion, e.id limit 1
  ) recogida on true
  where w.seguimiento_id = p_seguimiento_id
    and not trabajo.cancelado and not etapa.cancelado
    and etapa.estado <> 'anulada'
    -- Una nota copiada a una PARADA u otro trabajo no cambia su identidad.
    and translate(upper(btrim(split_part(source.value->>'clave_fila', '|', 5))), 'ÁÉÍÓÚÜ', 'AEIOUU')
      = translate(upper(btrim(w.designacion)), 'ÁÉÍÓÚÜ', 'AEIOUU');
$function$;



-- Recupera cierres ya realizados. No infiere fechas si la T no tiene ninguna.
-- Conserva las fechas de pedido/entrada y cualquier K que ya estuviera guardada.
WITH cierres AS (
  SELECT w.id,
    (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) AT TIME ZONE 'Europe/Madrid')::date AS fecha
  FROM app_private.manteniment_t_trabajos w
  JOIN public.trabajos_etapa_hotel t ON t.id = w.trabajo_hotel_id
  JOIN public.etapas_hotel e ON e.id = app_private.manteniment_etapa_actual(w.seguimiento_id, t.etapa_hotel_id)
  LEFT JOIN app_private.manteniment_t_visitas v ON v.id = w.visita_id
  WHERE NOT t.cancelado AND NOT e.cancelado AND e.estado = 'realizada'
    AND (e.tipo_etapa NOT IN ('entrada_taller', 'recogida_taller')
      OR (e.tipo_etapa = 'entrada_taller' AND v.modalidad IN ('gestion','tramite','entrada_sin_recogida')))
)
UPDATE app_private.manteniment_t_trabajos w
SET fecha_recogida = coalesce(w.fecha_recogida, c.fecha),
    fecha_realizada = CASE WHEN upper(btrim(w.designacion)) IN ('REPUESTOS','ACT','CV','LINDEP')
      THEN w.fecha_realizada ELSE coalesce(w.fecha_realizada, c.fecha) END,
    actualizado_en = clock_timestamp()
FROM cierres c
WHERE c.id = w.id AND c.fecha IS NOT NULL
  AND (w.fecha_recogida IS NULL
    OR (w.fecha_realizada IS NULL AND upper(btrim(w.designacion)) NOT IN ('REPUESTOS','ACT','CV','LINDEP')));

-- Reenvía solo las fichas cuyo conjunto de fechas o vínculos haya cambiado.
DO $reenvio$
DECLARE v_follow uuid;
BEGIN
  FOR v_follow IN
    SELECT s.seguimiento_id
    FROM app_private.manteniment_parada_sync s
    LEFT JOIN app_private.manteniment_parada_outbox o USING (seguimiento_id)
    CROSS JOIN LATERAL (SELECT app_private.manteniment_trabajos_asignados(s.seguimiento_id) AS trabajos) x
    WHERE jsonb_array_length(x.trabajos) > 0
      AND o.payload->'trabajos_asignados' IS DISTINCT FROM x.trabajos
  LOOP
    PERFORM app_private.manteniment_encolar_parada(v_follow);
  END LOOP;
END;
$reenvio$;
