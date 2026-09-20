-- Run inside BEGIN / ROLLBACK against a database containing an imported work.
-- Uses an existing ID read at runtime with a deliberately fictional vehicle.
do $test$
declare
  sample record; bad jsonb; valid jsonb; result jsonb;
  stages_before bigint; works_before text;
begin
  select w.sync_id,r.vehiculo_sustituido as dfm into sample
  from app_private.manteniment_t_trabajos w
  join public.registros_hotel r on r.seguimiento_id=w.seguimiento_id
  order by w.id,r.id limit 1;
  if not found then raise exception 'Test requires an existing imported work'; end if;
  select count(*) into stages_before from public.etapas_hotel;
  select md5(jsonb_agg(to_jsonb(w) order by w.id)::text) into works_before
    from app_private.manteniment_t_trabajos w;
  bad := jsonb_build_object('fila',1,'trabajo_sync_id',sample.sync_id,
    'dfm','TEST_AJENO_'||sample.sync_id::text,'designacion','AV',
    'fecha_necesidad','2026-09-20','pendiente_fondo_blanco',true);
  valid := jsonb_build_object('fila',2,'dfm','TEST_SIN_HOTEL',
    'designacion','MCD','fecha_necesidad','2026-09-20','pendiente_fondo_blanco',false);
  result := app_private.manteniment_importar_trabajos(jsonb_build_array(bad,valid));
  if jsonb_array_length(result->'vinculos_rechazados')<>1
    or (result->>'recibidos')::int<>1 or (result->>'t_creadas')::int<>0 then
    raise exception 'Cross-vehicle row was not isolated: %',result;
  end if;
  if result->'vinculos_rechazados'->0->>'trabajo_sync_id'<>sample.sync_id::text then
    raise exception 'Rejection lost its identity';
  end if;
  if stages_before<>(select count(*) from public.etapas_hotel)
    or works_before is distinct from (select md5(jsonb_agg(to_jsonb(w) order by w.id)::text)
      from app_private.manteniment_t_trabajos w) then
    raise exception 'A rejected row changed existing work';
  end if;
  -- Bypassing the wrapper still cannot transfer a T to another vehicle.
  begin
    perform app_private.manteniment_importar_trabajos_alpha74_base(jsonb_build_array(bad));
    raise exception 'Base guard missing';
  exception when raise_exception then
    if sqlerrm<>'Una necesidad vinculada no coincide con el vehículo de su seguimiento' then raise; end if;
  end;
end;
$test$;
