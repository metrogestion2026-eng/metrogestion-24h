-- A read-only snapshot of pending sheet needs, independent of Hotel admission.
-- No stages, orders, jobs, source cells or historical records are written here.
create table app_private.manteniment_pendientes_lectura (
  id boolean primary key default true check(id),
  generado_en timestamptz not null,
  completo boolean not null,
  filas jsonb not null check(jsonb_typeof(filas) = 'array')
);
alter table app_private.manteniment_pendientes_lectura enable row level security;
revoke all on app_private.manteniment_pendientes_lectura from public, anon, authenticated;
grant all on app_private.manteniment_pendientes_lectura to service_role;

create function app_private.manteniment_guardar_pendientes_lectura(
  p_filas jsonb, p_generado_en timestamptz, p_completo boolean default false
) returns integer language plpgsql security invoker
set search_path = pg_catalog, app_private
as $function$
declare v_count integer;
begin
  if p_filas is null then return 0; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas)>10000
      or p_generado_en is null or p_completo is null then
    raise exception 'Fotografía de pendientes no válida';
  end if;
  if exists(select 1 from jsonb_array_elements(p_filas) x where
      jsonb_typeof(x)<>'object'
      or coalesce(x->>'fila','') !~ '^[1-9][0-9]{0,5}$'
      or btrim(coalesce(x->>'dfm',''))=''
      or btrim(coalesce(x->>'designacion',''))=''
      or (coalesce(x->>'trabajo_sync_id','')<>'' and x->>'trabajo_sync_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or coalesce(x->>'pendiente_fondo_blanco','false') not in ('true','false')) then
    raise exception 'Una fila de pendientes no tiene identidad o estado válido';
  end if;
  if exists(select 1 from jsonb_array_elements(p_filas) x group by x->>'fila' having count(*)>1) then
    raise exception 'Una fila aparece repetida en la fotografía de pendientes';
  end if;
  -- Cast now: a malformed date cannot leave a poisoned snapshot for readers.
  perform nullif(x->>'fecha_necesidad','')::date,
    nullif(x->>'fecha_realizada','')::date, nullif(x->>'fecha_recogida','')::date
  from jsonb_array_elements(p_filas) x;
  insert into app_private.manteniment_pendientes_lectura(id,generado_en,completo,filas)
  values(true,p_generado_en,p_completo,p_filas)
  on conflict(id) do update set generado_en=excluded.generado_en,
    completo=excluded.completo, filas=excluded.filas
  where excluded.generado_en>manteniment_pendientes_lectura.generado_en;
  get diagnostics v_count = row_count;
  return case when v_count=0 then 0 else jsonb_array_length(p_filas) end;
end;
$function$;
revoke all on function app_private.manteniment_guardar_pendientes_lectura(jsonb,timestamptz,boolean) from public,anon,authenticated;
grant execute on function app_private.manteniment_guardar_pendientes_lectura(jsonb,timestamptz,boolean) to service_role;

do $guard$ begin if md5(regexp_replace(pg_get_functiondef('app_private.aplicar_snapshot_manteniment(jsonb,text,uuid,text)'::regprocedure),'[[:space:]]+$','')) <> '2db227b5fd947ba611e0f30c6d6e3e72' then raise exception 'Ha cambiado app_private.aplicar_snapshot_manteniment(jsonb,text,uuid,text); revisar migración'; end if; end; $guard$;

do $guard$ begin if md5(regexp_replace(pg_get_functiondef('app_private.listar_necesidades_manteniment_pendientes_alpha74()'::regprocedure),'[[:space:]]+$','')) <> '06a2259995ca7a4d291143bd03ef1f40' then raise exception 'Ha cambiado app_private.listar_necesidades_manteniment_pendientes_alpha74(); revisar migración'; end if; end; $guard$;

CREATE OR REPLACE FUNCTION app_private.aplicar_snapshot_manteniment(p_payload jsonb, p_modo text DEFAULT 'programada'::text, p_actor uuid DEFAULT NULL::uuid, p_origen text DEFAULT 'google_apps_script'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_payload jsonb := p_payload;
  v_filas jsonb := '[]'::jsonb;
  v_result jsonb;
  v_bloqueadas integer := 0;
  v_paradas integer := 0;
  v_trabajos jsonb := '{}'::jsonb;
  v_comandos jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_payload) = 'object' and jsonb_typeof(p_payload->'filas') = 'array' then
    select coalesce(jsonb_agg(f.value order by f.ordinality) filter (where not f.bloqueada), '[]'::jsonb),
           count(*) filter (where f.bloqueada)
      into v_filas, v_bloqueadas
    from (
      select e.value, e.ordinality,
             exists (
               select 1 from public.vehiculos v
               where v.baja_manual_bloquea_sync = true
                 and v.dfm = regexp_replace(upper(btrim(coalesce(e.value->>'dfm', ''))), '[[:space:]]+', '', 'g')
             ) as bloqueada
      from jsonb_array_elements(p_payload->'filas') with ordinality e(value, ordinality)
    ) f;
    v_payload := jsonb_set(p_payload, '{filas}', v_filas, true);
  end if;

  perform set_config('app.manteniment_importando_altas', '1', true);
  v_result := app_private.aplicar_snapshot_manteniment_base(v_payload, p_modo, p_actor, p_origen);
  if not coalesce((v_result->>'ok')::boolean, false) then
    perform set_config('app.manteniment_importando_altas', '0', true);
    return v_result;
  end if;

  update public.vehiculos v
  set fecha_matriculacion = x.fecha_matriculacion::date
  from jsonb_to_recordset(v_filas) as x(dfm text, fecha_matriculacion text)
  where v.dfm = regexp_replace(upper(btrim(coalesce(x.dfm, ''))), '[[:space:]]+', '', 'g')
    and btrim(coalesce(x.fecha_matriculacion, '')) ~ '^\d{4}-\d{2}-\d{2}$'
    and v.fecha_matriculacion is distinct from x.fecha_matriculacion::date;
  perform set_config('app.manteniment_importando_altas', '0', true);

  v_paradas := app_private.manteniment_importar_paradas(p_payload->'paradas');
  v_trabajos := app_private.manteniment_importar_trabajos(p_payload->'trabajos');

  -- Keep the complete read-only feed apart from predictive order creation.
  -- Legacy scripts already send the overdue/next-month window in trabajos.
  if p_modo <> 'prueba' then
    perform app_private.manteniment_guardar_pendientes_lectura(
      case when p_payload ? 'pendientes' then p_payload->'pendientes' else p_payload->'trabajos' end,
      (p_payload->>'generado_en')::timestamptz,
      p_payload ? 'pendientes'
    );
  end if;


  perform app_private.manteniment_encolar_parada(v.seguimiento_id)
  from public.paradas_sustitucion_resumen v
  join app_private.manteniment_parada_sync s using (seguimiento_id)
  where v.clase_facturacion = 'DFM'
    and v.sustituto is not null
    and v.fecha_fin_parada is null
    and s.fila_manteniment is not null;

  -- Retira órdenes antiguas que quedaron pendientes antes de registrar la baja.
  delete from app_private.manteniment_parada_outbox o
  using public.vehiculos v
  where o.estado='pendiente'
    and v.dfm=regexp_replace(upper(btrim(o.payload->>'dfm')),'[[:space:]]+','','g')
    and not v.activo and v.baja_manual_bloquea_sync;

  -- Si la fotografía válida ya no trae ALTA, no se debe recrear la unidad
  -- archivada como una fila BAJA nueva. Si aún trae ALTA, sí se envía la baja.
  if jsonb_typeof(p_payload->'filas')='array' then
    delete from app_private.manteniment_activo_outbox o
    using public.vehiculos v
    where o.vehiculo_id=v.id and o.estado='pendiente'
      and o.payload->>'estado'='BAJA'
      and not v.activo and v.baja_manual_bloquea_sync
      and not exists (
        select 1 from jsonb_array_elements(p_payload->'filas') x(value)
        where v.dfm=regexp_replace(upper(btrim(x.value->>'dfm')),'[[:space:]]+','','g')
      );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo', c.tipo,
    'vehiculo_id', c.vehiculo_id,
    'sync_id', c.sync_id,
    'revision', c.revision,
    'payload', c.payload
  ) order by c.actualizado_en, c.tipo, c.clave), '[]'::jsonb)
  into v_comandos
  from (
    select 'alta'::text as tipo, o.vehiculo_id, null::uuid as sync_id,
           o.revision, o.payload, o.actualizado_en, o.vehiculo_id::text as clave
    from app_private.manteniment_activo_outbox o
    where o.estado = 'pendiente'
    union all
    select 'parada'::text, null::uuid, o.sync_id,
           o.revision, o.payload, o.actualizado_en, o.sync_id::text
    from app_private.manteniment_parada_outbox o
    where o.estado = 'pendiente'
    order by actualizado_en, tipo, clave
    limit 200
  ) c;

  if v_bloqueadas > 0 then
    update public.manteniment_sync_ejecuciones
    set detalle = jsonb_set(coalesce(detalle, '{}'::jsonb), '{bajas_manuales_protegidas}', to_jsonb(v_bloqueadas), true),
        mensaje = concat_ws(' ', mensaje, format('%s baja(s) manual(es) protegida(s).', v_bloqueadas))
    where id = (v_result->>'ejecucion_id')::uuid;
  end if;

  update public.manteniment_sync_ejecuciones
  set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
    'paradas_recibidas', v_paradas,
    'trabajos_predictivos', v_trabajos,
    'comandos_manteniment_pendientes', jsonb_array_length(v_comandos)
  )
  where id = (v_result->>'ejecucion_id')::uuid;

  return v_result || jsonb_build_object(
    'bajas_manuales_protegidas', v_bloqueadas,
    'paradas_recibidas', v_paradas,
    'trabajos_predictivos', v_trabajos,
    'comandos_manteniment', v_comandos
  );
end;
$function$;
CREATE OR REPLACE FUNCTION app_private.listar_necesidades_manteniment_pendientes_alpha74()
 RETURNS TABLE(necesidad_id uuid, etapa_id uuid, registro_hotel_id uuid, seguimiento_id uuid, dfm text, matricula text, numero_parada text, prioridad integer, posicion integer, nombre text, estado text, tipo_etapa text, lugar text, fecha_referencia date, familia text, trabajos text, origen_manteniment boolean, fila_origen integer, tipo_trabajo text, designacion text, taller text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  if auth.uid() is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not (
      public.puede_ver_modulo('t_programadas')
      or public.puede_ver_modulo('hotel')
    ) then
    raise exception 'No tienes permiso para consultar los pendientes de MANTENIMENT'
      using errcode = '42501';
  end if;

  return query
  with hotel_pendientes as (
    select
      mt.id as necesidad_id,
      e.id as etapa_id,
      e.registro_hotel_id,
      mt.seguimiento_id,
      coalesce(
        nullif(btrim(rh.vehiculo_sustituido), ''),
        nullif(split_part(mt.fuentes -> 0 ->> 'clave_fila', '|', 1), '')
      )::text as dfm,
      coalesce(
        nullif(btrim(rh.matricula_sustituido), ''),
        nullif(split_part(mt.fuentes -> 0 ->> 'clave_fila', '|', 2), '')
      )::text as matricula,
      nullif(btrim(rh.numero_parada), '')::text as numero_parada,
      rh.prioridad::integer,
      e.posicion,
      concat_ws(' · ', nullif(btrim(mt.tipo_trabajo), ''), nullif(btrim(mt.designacion), ''))::text as nombre,
      'pendiente'::text as estado,
      coalesce(nullif(btrim(e.tipo_etapa), ''), 'trabajo')::text as tipo_etapa,
      coalesce(nullif(btrim(mt.taller), ''), nullif(btrim(e.lugar), ''))::text as lugar,
      mt.fecha_necesidad as fecha_referencia,
      translate(
        upper(concat_ws(' ', mt.tipo_trabajo, mt.designacion, mt.taller)),
        'ÁÉÍÓÚÜÑ',
        'AEIOUUN'
      ) as texto_clasificacion,
      concat_ws(
        ' · ',
        nullif(btrim(mt.tipo_trabajo), ''),
        nullif(btrim(mt.designacion), ''),
        nullif(btrim(mt.taller), '')
      )::text as trabajos,
      coalesce(nullif(mt.fuentes -> 0 ->> 'fila', ''), '0')::integer as fila_origen,
      mt.tipo_trabajo::text,
      mt.designacion::text,
      mt.taller::text
    from app_private.manteniment_t_trabajos mt
    left join public.trabajos_etapa_hotel th
      on th.id = mt.trabajo_hotel_id
    left join public.etapas_hotel e
      on e.id = app_private.manteniment_etapa_actual(mt.seguimiento_id, th.etapa_hotel_id)
    left join public.registros_hotel rh
      on rh.id = e.registro_hotel_id
    where not th.cancelado and not e.cancelado and e.estado <> 'anulada'
      and not rh.cancelado
      and app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
        coalesce(mt.fecha_realizada, (coalesce(e.fecha_real, e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
        mt.fecha_recogida) is null
  ), hoja as (
    select x.*, nullif(x.fecha_necesidad,'')::date as fecha_i,
      nullif(x.fecha_realizada,'')::date as fecha_j,
      nullif(x.fecha_recogida,'')::date as fecha_k
    from app_private.manteniment_pendientes_lectura s
    cross join lateral jsonb_to_recordset(s.filas) as x(
      fila integer, trabajo_sync_id text, clave_fila text, dfm text, matricula text,
      numero_parada text, taller text, tipo_trabajo text, designacion text, detalle text,
      fecha_necesidad text, fecha_realizada text, fecha_recogida text,
      pendiente_fondo_blanco boolean)
  ), pendientes as (
    select h.* from hotel_pendientes h
    where not exists(select 1 from app_private.manteniment_pendientes_lectura)
    union all
    select
      md5('manteniment-fila:'||x.fila::text||':'||coalesce(x.clave_fila,''))::uuid as necesidad_id,
      e.id as etapa_id, e.registro_hotel_id, mt.seguimiento_id,
      btrim(x.dfm)::text, btrim(x.matricula)::text, nullif(btrim(x.numero_parada),'')::text,
      rh.prioridad::integer, e.posicion,
      concat_ws(' · ',nullif(btrim(x.designacion),''),nullif(btrim(x.detalle),''),nullif(btrim(x.tipo_trabajo),''))::text,
      case when x.fecha_j is not null then 'en_curso' else 'pendiente' end::text,
      coalesce(e.tipo_etapa,'trabajo')::text,
      nullif(btrim(x.taller),'')::text, x.fecha_i,
      translate(upper(concat_ws(' ',x.tipo_trabajo,x.designacion,x.taller)),'ÁÉÍÓÚÜÑ','AEIOUUN'),
      concat_ws(' · ',nullif(btrim(x.tipo_trabajo),''),nullif(btrim(x.designacion),''),nullif(btrim(x.detalle),''),nullif(btrim(x.taller),''))::text,
      x.fila, x.tipo_trabajo::text, x.designacion::text, x.taller::text
    from hoja x
    left join app_private.manteniment_t_trabajos mt
      on mt.sync_id=nullif(x.trabajo_sync_id,'')::uuid
      and mt.fecha_necesidad=x.fecha_i
      and upper(btrim(mt.designacion))=upper(btrim(x.designacion))
      and exists(select 1 from jsonb_array_elements(mt.fuentes) f
        where upper(split_part(f->>'clave_fila','|',1))=upper(btrim(x.dfm))
          and upper(split_part(f->>'clave_fila','|',2))=upper(btrim(x.matricula)))
    left join public.trabajos_etapa_hotel th on th.id=mt.trabajo_hotel_id and not th.cancelado
    left join public.etapas_hotel e on e.id=app_private.manteniment_etapa_actual(mt.seguimiento_id,th.etapa_hotel_id)
      and not e.cancelado and e.estado<>'anulada'
    left join public.registros_hotel rh on rh.id=e.registro_hotel_id and not rh.cancelado
    where upper(btrim(x.designacion)) not in
      ('ALTA','BAJA','PARADA','ANULADA','FIN','ARCHIVO','CARPETA','PRIMITIVA','TANCAMENT','MITJANA','CANVI')
      and (x.pendiente_fondo_blanco or (x.numero_parada ~* '^PA-[0-9]+$' and x.fecha_j is null))
      and x.fecha_k is null
      and (x.fecha_j is null or upper(btrim(x.designacion)) in ('REPUESTOS','ACT','LINDEP','CV'))
      and (mt.id is null or app_private.manteniment_fecha_cierre_necesidad(mt.designacion,
        coalesce(mt.fecha_realizada,(coalesce(e.fecha_real,e.fecha_fin_real) at time zone 'Europe/Madrid')::date),
        mt.fecha_recogida) is null)
  )
  select
    p.necesidad_id,
    p.etapa_id,
    p.registro_hotel_id,
    p.seguimiento_id,
    p.dfm,
    p.matricula,
    p.numero_parada,
    p.prioridad,
    p.posicion,
    coalesce(nullif(p.nombre, ''), 'Necesidad de MANTENIMENT')::text as nombre,
    p.estado,
    p.tipo_etapa,
    p.lugar,
    p.fecha_referencia,
    case
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])EXT(INTOR)?([^A-Z0-9]|$)' then 'EXTINTOR'
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])ITV([^A-Z0-9]|$)' then 'ITV'
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])(AV|AVERIA|REPARACION|BR|GP)([^A-Z0-9]|$)' then 'AVERIA'
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])(MANTENIMIENTO|MANTENIMENT|MCD|BPW)([^A-Z0-9]|$)' then 'MANTENIMIENTO'
      when p.texto_clasificacion ~ '(^|[^A-Z0-9])(TRAMITE|GESTION|TMG|ATP|44TN|LKT)([^A-Z0-9]|$)' then 'TRAMITE'
      else 'OTROS'
    end::text as familia,
    p.trabajos,
    true as origen_manteniment,
    nullif(p.fila_origen, 0) as fila_origen,
    p.tipo_trabajo,
    p.designacion,
    p.taller
  from pendientes p
  order by
    p.fecha_referencia asc nulls last,
    p.prioridad asc nulls last,
    p.dfm,
    p.fila_origen,
    p.necesidad_id
;
end;
$function$;

create function app_private.listar_pendientes_manteniment_alpha75()
returns jsonb language sql stable security definer
set search_path = pg_catalog, app_private
as $function$
  select jsonb_build_object(
    'filas',coalesce((select jsonb_agg(to_jsonb(p)) from app_private.listar_necesidades_manteniment_pendientes_alpha74() p),'[]'::jsonb),
    'generado_en',(select s.generado_en from app_private.manteniment_pendientes_lectura s),
    'completo',coalesce((select s.completo from app_private.manteniment_pendientes_lectura s),false)
  );
$function$;

revoke all on function app_private.listar_pendientes_manteniment_alpha75() from public,anon;
grant execute on function app_private.listar_pendientes_manteniment_alpha75() to authenticated,service_role;
create function public.listar_pendientes_manteniment_alpha75()
returns jsonb language sql stable security invoker set search_path=pg_catalog,app_private
as $function$ select app_private.listar_pendientes_manteniment_alpha75(); $function$;
revoke all on function public.listar_pendientes_manteniment_alpha75() from public,anon;
grant execute on function public.listar_pendientes_manteniment_alpha75() to authenticated,service_role;

-- Abort the whole migration if the read-only contract fails.
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
