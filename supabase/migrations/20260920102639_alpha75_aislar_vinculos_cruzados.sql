-- A stale or copied sheet note must not transfer a T or block valid rows.
-- CREATE OR REPLACE preserves the existing private function's ACL.
CREATE OR REPLACE FUNCTION app_private.manteniment_importar_trabajos(p_trabajos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_trabajos jsonb;
  v_resultado jsonb;
  v_registro_id uuid;
  v_rechazos jsonb := '[]'::jsonb;
begin
  if p_trabajos is null or jsonb_typeof(p_trabajos) <> 'array' then
    return app_private.manteniment_importar_trabajos_alpha74_base(p_trabajos);
  end if;

  -- Reject only the mismatched row before either importer or reconciliation.
  -- Keep the base importer's cross-vehicle exception as a second protection.
  with checked as (
    select item.value,item.ordinality,
      ficha.dfm as linked_dfm,
      w.id is not null and regexp_replace(upper(btrim(coalesce(item.value->>'dfm',''))),
        '[[:space:]]+','','g') is distinct from ficha.dfm as rejected
    from jsonb_array_elements(p_trabajos) with ordinality item(value,ordinality)
    left join app_private.manteniment_t_trabajos w
      on w.sync_id::text=lower(btrim(coalesce(item.value->>'trabajo_sync_id','')))
    left join lateral (
      select regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+','','g') as dfm
      from public.registros_hotel r
      join public.pizarras p on p.id=r.pizarra_id
      where r.seguimiento_id=w.seguimiento_id
      order by (p.estado='en_curso') desc,p.fecha desc,r.actualizado_en desc,r.id desc
      limit 1
    ) ficha on true
  )
  select coalesce(jsonb_agg(value order by ordinality) filter(where not rejected),'[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object(
           'fila',value->'fila','dfm',value->>'dfm',
           'dfm_vinculado',linked_dfm,'trabajo_sync_id',value->>'trabajo_sync_id',
           'motivo','El vínculo técnico pertenece a otro vehículo; fila omitida sin reasignar su T'
         ) order by ordinality) filter(where rejected),'[]'::jsonb)
    into v_trabajos,v_rechazos
  from checked;

  select coalesce(
    jsonb_agg(
      case
        when btrim(coalesce(item.value->>'taller', '')) <> '' then item.value
        when inferred.taller is null then item.value
        else jsonb_set(item.value, '{taller}', to_jsonb(inferred.taller), true)
      end
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into v_trabajos
  from jsonb_array_elements(v_trabajos) with ordinality as item(value, ordinality)
  cross join lateral (
    select app_private.manteniment_inferir_taller_alpha74(
      item.value->>'dfm', item.value->>'taller', item.value->>'tipo_trabajo',
      item.value->>'designacion', item.value->>'marca_equipo',
      item.value->>'marca_vehiculo'
    ) as taller
  ) inferred
  where not app_private.manteniment_dfm_bloqueado_por_24h_alpha74(item.value->>'dfm');

  v_resultado := app_private.manteniment_importar_trabajos_alpha74_base(v_trabajos);

  for v_registro_id in
    with dfm_lote as (
      select distinct regexp_replace(upper(btrim(coalesce(x.value->>'dfm', ''))), '[[:space:]]+', '', 'g') as dfm
      from jsonb_array_elements(v_trabajos) x(value)
    ), fichas as (
      select r.id,
             row_number() over (
               partition by r.seguimiento_id
               order by (p.estado = 'en_curso') desc, p.fecha desc,
                        r.actualizado_en desc, r.id desc
             ) as rn
      from public.registros_hotel r
      join public.pizarras p on p.id = r.pizarra_id
      join dfm_lote d
        on d.dfm = regexp_replace(upper(btrim(coalesce(r.vehiculo_sustituido, ''))), '[[:space:]]+', '', 'g')
      where not r.cancelado
        and not r.retirado_hotel_activo
        and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
    )
    select id from fichas where rn = 1
  loop
    perform app_private.manteniment_reconciliar_asistencia_alpha74(v_registro_id);
  end loop;

  return v_resultado || jsonb_build_object('vinculos_rechazados',v_rechazos);
end;
$function$;


do $migration$
declare definition text := pg_get_functiondef(
  'app_private.aplicar_snapshot_manteniment(jsonb,text,uuid,text)'::regprocedure);
begin
  if (length(definition)-length(replace(definition,$old$  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,$old$,'')))
      / length($old$  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,$old$) <> 1 then
    raise exception 'La sincronización ha cambiado; revisar el aviso de vínculos antes de aplicar';
  end if;
  execute replace(definition,$old$  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,$old$,$new$  -- The installed Apps Script already displays resultado.mensaje.
  -- Include the rejected count there and retain row details in the run log.
  if jsonb_array_length(coalesce(v_trabajos->'vinculos_rechazados','[]'::jsonb)) > 0 then
    v_result := jsonb_set(v_result,'{mensaje}',to_jsonb(concat_ws(' ',v_result->>'mensaje',
      format('%s vínculo(s) de otro vehículo omitido(s); revisar el detalle de sincronización.',
        jsonb_array_length(v_trabajos->'vinculos_rechazados')))),true);
    update public.manteniment_sync_ejecuciones
    set mensaje=v_result->>'mensaje',
        filas_con_avisos=coalesce(filas_con_avisos,0)+jsonb_array_length(v_trabajos->'vinculos_rechazados')
    where id=(v_result->>'ejecucion_id')::uuid;
  end if;

  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,$new$);
end;
$migration$;
