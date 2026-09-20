-- Execute inside BEGIN / ROLLBACK. Synthetic snapshot; no Hotel mutations.
do $test$
declare
  q text; n integer; in_progress integer; before_stages bigint;
  saved app_private.manteniment_pendientes_lectura%rowtype;
  rows jsonb;
begin
  select * into saved from app_private.manteniment_pendientes_lectura;
  select count(*) into before_stages from public.etapas_hotel;
  q := split_part(split_part(pg_get_functiondef(
    'app_private.listar_necesidades_manteniment_pendientes_alpha74()'::regprocedure),
    'return query',2),'end;',1);
  q := regexp_replace(btrim(q),';[[:space:]]*$','');
  rows := '[
    {"fila":1,"dfm":"TEST_DFM","numero_parada":"PA-9999999","taller":"TEST_TALLER","designacion":"GP","fecha_realizada":"2099-01-01","pendiente_fondo_blanco":false},
    {"fila":2,"dfm":"TEST_DFM","numero_parada":"PA-9999999","taller":"TEST_TALLER","designacion":"GC","fecha_realizada":"2099-01-01","pendiente_fondo_blanco":false},
    {"fila":3,"dfm":"TEST_DFM","numero_parada":"PA-9999999","taller":"TEST_TALLER","designacion":"MCD","fecha_realizada":"2099-01-01","pendiente_fondo_blanco":false},
    {"fila":4,"dfm":"TEST_DFM","numero_parada":"PA-9999999","taller":"TEST_TALLER","designacion":"GP","fecha_realizada":"2099-01-01","fecha_recogida":"2099-01-02","pendiente_fondo_blanco":true},
    {"fila":5,"dfm":"TEST_DFM","taller":"TEST_TALLER","designacion":"GP","fecha_realizada":"2099-01-01","pendiente_fondo_blanco":true},
    {"fila":6,"dfm":"TEST_DFM","numero_parada":"PA-9999999","taller":"TEST_TALLER","designacion":"ITV","fecha_realizada":"2099-01-01","pendiente_fondo_blanco":true},
    {"fila":7,"dfm":"TEST_DFM","numero_parada":"PA-9999999","taller":"UPC","tipo_trabajo":"GESTIÓN","designacion":"SG","fecha_realizada":"2099-01-01","pendiente_fondo_blanco":true}
  ]';
  perform app_private.manteniment_guardar_pendientes_lectura(rows,'2199-01-01',true);
  execute 'select count(*),count(*) filter(where estado=''en_curso'') from ('||q||') t' into n,in_progress;
  if n<>3 or in_progress<>3 then raise exception 'Expected 3 pending pickups, got %/%',n,in_progress; end if;
  if before_stages<>(select count(*) from public.etapas_hotel) then raise exception 'The list mutated Hotel'; end if;
  if has_function_privilege('anon','app_private.manteniment_requiere_recogida_alpha75(text,text,text)','execute')
    or has_function_privilege('authenticated','app_private.manteniment_requiere_recogida_alpha75(text,text,text)','execute') then
    raise exception 'Pickup helper exposed directly';
  end if;
  delete from app_private.manteniment_pendientes_lectura;
  if saved.id is not null then insert into app_private.manteniment_pendientes_lectura values(saved.*); end if;
end;
$test$;
