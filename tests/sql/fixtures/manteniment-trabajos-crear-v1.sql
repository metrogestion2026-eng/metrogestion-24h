-- Actual exporter baseline; no operational rows.
CREATE OR REPLACE FUNCTION app_private.manteniment_trabajos_por_crear(p_seguimiento_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'trabajo_sync_id', w.sync_id,
      'trabajo_hotel_id', w.trabajo_hotel_id,
      'dfm', coalesce(r.vehiculo_sustituido,''),
      'matricula', coalesce(r.matricula_sustituido,''),
      'tipo', coalesce(nullif(r.tipo_unidad,''), v.tipo_manteniment, ''),
      'upc', coalesce(nullif(r.upc,''), v.upc, ''),
      'numero_parada', 'PA-' || btrim(r.numero_parada),
      'taller', coalesce(w.taller,''),
      'tipo_trabajo', coalesce(w.tipo_trabajo,''),
      'designacion', w.designacion,
      'fecha_necesidad', w.fecha_necesidad,
      'fecha_entrada', w.fecha_realizada,
      'fecha_salida', w.fecha_recogida,
      'marca', coalesce(nullif(r.marca,''), v.marca, ''),
      'km_averia', trabajo.km_averia,
      'expediente', coalesce(trabajo.expediente,''),
      'motivo_entrada', coalesce(trabajo.motivo_entrada,''),
      'diagnostico_real', coalesce(trabajo.diagnostico_real,''),
      'detalle', concat_ws(E'\n',
        nullif(trabajo.motivo_entrada,''),
        nullif(trabajo.diagnostico_real,''),
        nullif(trabajo.descripcion,'')
      )
    )
    order by w.fecha_necesidad, w.creado_en, w.id
  ), '[]'::jsonb)
  from app_private.manteniment_t_trabajos w
  join public.trabajos_etapa_hotel trabajo on trabajo.id = w.trabajo_hotel_id
  join public.etapas_hotel etapa_origen on etapa_origen.id = trabajo.etapa_hotel_id
  join public.etapas_hotel etapa_actual on etapa_actual.id =
    app_private.manteniment_etapa_actual(w.seguimiento_id, trabajo.etapa_hotel_id)
  join lateral (
    select h.*
    from public.registros_hotel h
    join public.pizarras p on p.id=h.pizarra_id
    where h.seguimiento_id=w.seguimiento_id
    order by (p.estado='en_curso') desc,p.fecha desc,h.actualizado_en desc,h.id desc
    limit 1
  ) r on true
  left join public.vehiculos v
    on v.dfm = regexp_replace(upper(btrim(coalesce(r.vehiculo_sustituido,''))),'[[:space:]]+','','g')
  where w.seguimiento_id = p_seguimiento_id
    and jsonb_array_length(coalesce(w.fuentes,'[]'::jsonb)) = 0
    and not trabajo.cancelado
    and not etapa_actual.cancelado
    and etapa_actual.estado <> 'anulada'
    and upper(btrim(coalesce(etapa_actual.tipo_etapa,''))) <> '24H';
$function$
