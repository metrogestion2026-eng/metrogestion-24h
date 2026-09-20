-- Synthetic fixtures only. Run in a transaction and ROLLBACK after deployment.
do $test$
declare
  q text; n integer; ids integer; before_stages bigint; before_works bigint;
  rows jsonb; saved app_private.manteniment_pendientes_lectura%rowtype;
begin
  select * into saved from app_private.manteniment_pendientes_lectura;
  select count(*) into before_stages from public.etapas_hotel;
  select count(*) into before_works from app_private.manteniment_t_trabajos;
  -- Exercise the exact read query as DB owner, without changing its auth guard.
  q := split_part(split_part(pg_get_functiondef('app_private.listar_necesidades_manteniment_pendientes_alpha74()'::regprocedure),'return query',2),'end;',1);
  q := regexp_replace(btrim(q),';[[:space:]]*$','');
  rows := '[
    {"fila":1,"dfm":"TEST_DFM","matricula":"TEST","designacion":"MCD","detalle":"M1","fecha_necesidad":"2099-01-01","pendiente_fondo_blanco":true},
    {"fila":2,"dfm":"TEST_DFM","matricula":"TEST","designacion":"MCD","detalle":"T1","fecha_necesidad":"2099-01-01","pendiente_fondo_blanco":true},
    {"fila":3,"dfm":"R_TEST","designacion":"ITV","fecha_necesidad":"2099-01-02","pendiente_fondo_blanco":true},
    {"fila":4,"dfm":"R_TEST","designacion":"AV","fecha_necesidad":"","pendiente_fondo_blanco":true},
    {"fila":5,"dfm":"TEST_DFM","designacion":"MCD","fecha_realizada":"2099-01-01","pendiente_fondo_blanco":true},
    {"fila":6,"dfm":"TEST_DFM","designacion":"ITV","pendiente_fondo_blanco":false},
    {"fila":7,"dfm":"TEST_DFM","designacion":"ALTA","pendiente_fondo_blanco":true},
    {"fila":8,"dfm":"TEST_DFM","designacion":"REPUESTOS","fecha_realizada":"2099-01-01","pendiente_fondo_blanco":true}
  ]'::jsonb;
  perform app_private.manteniment_guardar_pendientes_lectura(rows,'2199-01-01',true);
  execute 'select count(*), count(distinct necesidad_id) from ('||q||') t' into n,ids;
  if n<>5 or ids<>5 then raise exception 'List should contain 5 distinct pending needs, got %/%',n,ids; end if;
  execute 'select count(*) from ('||q||') t where etapa_id is not null' into n;
  if n<>0 then raise exception 'A need without Hotel has acquired a stage'; end if;
  perform app_private.manteniment_guardar_pendientes_lectura('[]','2198-01-01',false);
  if (select jsonb_array_length(filas) from app_private.manteniment_pendientes_lectura)<>8 then raise exception 'An older snapshot replaced newer data'; end if;
  begin
    perform app_private.manteniment_guardar_pendientes_lectura(rows||jsonb_build_array(rows->0),'2199-01-02',true);
    raise exception 'Duplicate row accepted';
  exception when raise_exception then
    if sqlerrm not like 'Una fila aparece repetida%' then raise; end if;
  end;
  select jsonb_agg((rows->0)||jsonb_build_object('fila',i)) into rows from generate_series(1,1005) i;
  perform app_private.manteniment_guardar_pendientes_lectura(rows,'2199-01-02',true);
  execute 'select count(*) from ('||q||') t' into n;
  if n<>1005 then raise exception 'List is truncated: % of 1005',n; end if;
  perform app_private.manteniment_guardar_pendientes_lectura('[]','2199-01-03',true);
  execute 'select count(*) from ('||q||') t' into n;
  if n<>0 then raise exception 'Empty snapshot resurrected legacy Hotel needs'; end if;
  if auth.uid() is null then
    begin
      perform public.listar_pendientes_manteniment_alpha75();
      raise exception 'Anonymous reader accepted';
    exception when insufficient_privilege then null;
    end;
  end if;
  if has_function_privilege('anon','public.listar_pendientes_manteniment_alpha75()','execute')
    or has_function_privilege('authenticated','app_private.manteniment_guardar_pendientes_lectura(jsonb,timestamptz,boolean)','execute')
    or has_table_privilege('authenticated','app_private.manteniment_pendientes_lectura','select') then
    raise exception 'Unexpected access to snapshot';
  end if;
  if before_stages<>(select count(*) from public.etapas_hotel)
    or before_works<>(select count(*) from app_private.manteniment_t_trabajos) then
    raise exception 'Read-only import changed Hotel';
  end if;
  delete from app_private.manteniment_pendientes_lectura;
  if saved.id is not null then insert into app_private.manteniment_pendientes_lectura values(saved.*); end if;
end;
$test$;
