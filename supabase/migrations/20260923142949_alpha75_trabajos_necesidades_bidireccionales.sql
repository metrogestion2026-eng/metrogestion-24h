-- Hotel -> MANTENIMENT: only new manual jobs, never historical clones/imports.
-- Install the matching Apps Script before enabling this migration.
create or replace function app_private.manteniment_necesidad_desde_trabajo()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public','app_private'
as $fn$
declare
 e public.etapas_hotel%rowtype; r public.registros_hotel%rowtype;
 v app_private.manteniment_t_visitas%rowtype; w app_private.manteniment_t_trabajos%rowtype;
 tipo text; taller text; fecha date; entrada date; salida date; clave text; ficha jsonb;
begin
 if new.cancelado or auth.uid() is null
    or coalesce(current_setting('app.audit_origin',true),'') <> 'metrogestion-r1-editor'
    or coalesce(current_setting('app.clonando_pizarra',true),'')='1'
    or coalesce(current_setting('app.reconciliando_etapas',true),'')='1'
    or coalesce(current_setting('app.manteniment_importando_paradas',true),'')='1' then return new; end if;
 select * into e from public.etapas_hotel where id=new.etapa_hotel_id;
 select * into r from public.registros_hotel where id=e.registro_hotel_id;
 if e.cancelado or e.estado='anulada' or r.cancelado or nullif(btrim(r.numero_parada),'') is null
    or e.tipo_etapa='recogida_taller' or coalesce(e.accion_sistema,'')<>'' then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('manteniment-visita:'||r.seguimiento_id::text,0));
 if exists(select 1 from app_private.manteniment_t_trabajos where trabajo_hotel_id=new.id) then return new; end if;
 select coalesce(c.nombre,new.tipo_trabajo) into tipo from public.catalogo_tipos_trabajo c where c.codigo=new.tipo_trabajo;
 tipo:=coalesce(nullif(btrim(tipo),''),new.tipo_trabajo);
 select * into v from app_private.manteniment_t_visitas
 where seguimiento_id=r.seguimiento_id and grupo_entrada_id=e.grupo_documental_id
 order by creado_en,id limit 1 for update;
 select coalesce(nullif(v.taller,''),nullif(t.nombre,''),nullif(e.lugar,''),'') into taller
 from (select 1) dummy left join public.talleres t on t.id=e.taller_id;
 fecha:=(coalesce(e.fecha_prevista,e.fecha_real,e.fecha_inicio_real,new.creado_en) at time zone 'Europe/Madrid')::date;
 if e.estado='realizada' then entrada:=(coalesce(e.fecha_real,e.fecha_inicio_real,e.fecha_fin_real) at time zone 'Europe/Madrid')::date; end if;
 select (coalesce(p.fecha_real,p.fecha_fin_real) at time zone 'Europe/Madrid')::date into salida
 from public.etapas_hotel p where p.etapa_origen_id=e.id and p.tipo_etapa='recogida_taller' and p.estado='realizada' and not p.cancelado order by p.posicion limit 1;
 if v.id is null then
   insert into app_private.manteniment_t_visitas(seguimiento_id,clave_visita,modalidad,taller,fecha_necesidad,grupo_entrada_id,grupo_recogida_id)
   values(r.seguimiento_id,'HOTEL|'||e.seguimiento_id::text,
     case when e.tipo_etapa='entrada_taller' then 'taller' else 'gestion' end,taller,fecha,e.grupo_documental_id,
     (select p.grupo_documental_id from public.etapas_hotel p where p.etapa_origen_id=e.id and p.tipo_etapa='recogida_taller' and not p.cancelado order by p.posicion limit 1)) returning * into v;
 end if;
 if e.tipo_etapa<>'entrada_taller' and e.estado='realizada' then salida:=entrada; end if;
 select to_jsonb(veh) into ficha from public.vehiculos veh where veh.dfm=r.vehiculo_sustituido;
 clave:=concat_ws('|',r.vehiculo_sustituido,r.matricula_sustituido,taller,coalesce(nullif(new.motivo_entrada,''),new.categoria_tecnica),tipo,fecha::text);
 select string_agg(regexp_replace(translate(upper(btrim(part)),'ÁÉÍÓÚÜ','AEIOUU'),'[[:space:]]+',' ','g'),'|' order by ord) into clave from unnest(string_to_array(clave,'|')) with ordinality parts(part,ord);
 insert into app_private.manteniment_t_trabajos(seguimiento_id,visita_id,clave_trabajo,taller,tipo_trabajo,designacion,fecha_necesidad,fecha_realizada,fecha_recogida,fuentes,grupo_etapa_id,trabajo_hotel_id)
 values(r.seguimiento_id,v.id,'HOTEL:'||new.id::text,taller,coalesce(nullif(new.motivo_entrada,''),new.categoria_tecnica),tipo,fecha,entrada,salida,
 jsonb_build_array(jsonb_build_object('clave_fila',clave,'crear_desde_hotel',true,'necesidad',jsonb_build_object(
 'dfm',r.vehiculo_sustituido,'matricula',r.matricula_sustituido,'tipo',coalesce(ficha->>'tipo_manteniment',''),
 'upc',r.upc,'numero_parada','PA-'||r.numero_parada,'taller',taller,'tipo_trabajo',coalesce(nullif(new.motivo_entrada,''),new.categoria_tecnica),
 'designacion',tipo,'fecha_necesidad',fecha,'marca',r.marca,'asignacion',coalesce(ficha->>'asignacion_manteniment',''),
 'km',new.km_averia,'detalle',concat_ws(E'\n',nullif(new.descripcion,''),nullif(new.observaciones,''))))),e.grupo_documental_id,new.id) returning * into w;
 perform app_private.manteniment_encolar_parada(r.seguimiento_id);
 return new;
end;
$fn$;
revoke all on function app_private.manteniment_necesidad_desde_trabajo() from public,anon,authenticated;
create trigger trabajos_manteniment_necesidad_manual after insert on public.trabajos_etapa_hotel
for each row execute function app_private.manteniment_necesidad_desde_trabajo();

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
        'crear_necesidad', case when source.value->>'crear_desde_hotel'='true' then source.value->'necesidad' end,
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


CREATE OR REPLACE FUNCTION app_private.manteniment_confirmar_comandos(p_token text, p_confirmaciones jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'extensions'
AS $function$
declare
  v_config app_private.manteniment_sync_config%rowtype;
  v_hash text;
  v_item jsonb;
  v_seguimiento_id uuid;
  v_payload jsonb;
  v_count integer := 0;
begin
  select * into v_config from app_private.manteniment_sync_config where id = 1;
  if not found or not v_config.token_activo or v_config.token_hash = '' then
    raise exception 'La actualización automática de MANTENIMENT no está activada';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_hash is distinct from v_config.token_hash then raise exception 'Clave de conexión no válida'; end if;
  if jsonb_typeof(p_confirmaciones) <> 'array' or jsonb_array_length(p_confirmaciones) > 500 then
    raise exception 'Las confirmaciones no tienen un formato válido';
  end if;

  perform set_config('app.manteniment_importando_altas', '1', true);
  perform set_config('app.manteniment_importando_paradas', '1', true);
  for v_item in select value from jsonb_array_elements(p_confirmaciones)
  loop
    if coalesce(v_item->>'estado', '') <> 'aplicado' then continue; end if;

    if coalesce(v_item->>'tipo', 'parada') = 'alta' then
      update app_private.manteniment_activo_outbox o
      set estado = 'confirmado', confirmado_en = clock_timestamp(), intentos = intentos + 1
      where o.vehiculo_id = (v_item->>'vehiculo_id')::uuid
        and o.revision = (v_item->>'revision')::integer
        and o.estado = 'pendiente';
      if found then
        update public.vehiculos
        set fuente_manteniment_fila = nullif(v_item->>'fila', '')::integer,
            fuente_manteniment_actualizado_en = clock_timestamp()
        where id = (v_item->>'vehiculo_id')::uuid;
        v_count := v_count + 1;
      end if;
    else
      v_seguimiento_id := null;
      v_payload := null;
      select o.payload into v_payload from app_private.manteniment_parada_outbox o
      where o.sync_id=(v_item->>'sync_id')::uuid and o.revision=(v_item->>'revision')::integer and o.estado='pendiente' for update;
      if exists (
        select 1 from jsonb_array_elements(coalesce(v_payload->'trabajos_asignados','[]'::jsonb)) a
        where a->'crear_necesidad' is not null and a->'crear_necesidad'<>'null'::jsonb
        and not exists(select 1 from jsonb_array_elements(coalesce(v_item->'necesidades_hotel','[]'::jsonb)) c
          where c->>'trabajo_sync_id'=a->>'trabajo_sync_id' and c->>'clave_fila'=a->>'clave_fila'
            and coalesce(c->>'fila','') ~ '^[0-9]{1,6}$' and (c->>'fila')::int>=2)
      ) then raise exception 'Actualiza el script de MANTENIMENT para crear las necesidades añadidas desde Hotel. La orden sigue pendiente.'; end if;
      update app_private.manteniment_parada_outbox o
      set estado = 'confirmado', confirmado_en = clock_timestamp(), intentos = intentos + 1
      where o.sync_id = (v_item->>'sync_id')::uuid
        and o.revision = (v_item->>'revision')::integer
        and o.estado = 'pendiente'
      returning o.seguimiento_id, o.payload into v_seguimiento_id, v_payload;

      if v_seguimiento_id is not null then
        update app_private.manteniment_t_trabajos w
        set fuentes=jsonb_build_array(jsonb_build_object('fila',(c.value->>'fila')::int,'clave_fila',c.value->>'clave_fila')),
            actualizado_en=clock_timestamp()
        from jsonb_array_elements(coalesce(v_item->'necesidades_hotel','[]'::jsonb)) c(value)
        where w.seguimiento_id=v_seguimiento_id and w.sync_id::text=c.value->>'trabajo_sync_id'
          and exists(select 1 from jsonb_array_elements(w.fuentes) s where s->>'crear_desde_hotel'='true' and s->>'clave_fila'=c.value->>'clave_fila');
        update app_private.manteniment_parada_sync s
        set ultimo_payload_confirmado = v_payload,
            fila_manteniment = nullif(v_item->>'fila', '')::integer
        where s.seguimiento_id = v_seguimiento_id;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  perform set_config('app.manteniment_importando_paradas', '0', true);
  perform set_config('app.manteniment_importando_altas', '0', true);
  return jsonb_build_object('ok', true, 'confirmados', v_count);
end;
$function$;


do $patch$
declare d text; n int;
begin
 d:=pg_get_functiondef('app_private.manteniment_importar_trabajos_alpha74_base(jsonb)'::regprocedure);
 n:=(length(d)-length(replace(d,$old$or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'$old$,'')))/length($old$or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'$old$);
 if n<>3 then raise exception 'Unexpected entry reuse predicates'; end if;
 d:=replace(d,$old$or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'$old$,
 $new$or (v_modalidad='taller' and e.tipo_etapa='entrada_taller' and e.estado='realizada'
                and exists(select 1 from public.etapas_hotel open_pickup where open_pickup.etapa_origen_id=e.id
                  and open_pickup.tipo_etapa='recogida_taller' and not open_pickup.cancelado
                  and open_pickup.estado not in ('realizada','anulada') and open_pickup.fecha_real is null))
            or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'$new$);
 d:=replace(d,$o$when v_group.designacion_norm = 'REPUESTOS' then 'gestion'$o$, $n$when v_group.designacion_norm in ('REPUESTOS','OTA') then 'gestion'$n$);
 d:=replace(d,$o$c.designacion_norm not in ('REPUESTOS', 'LKT', 'EXTINTOR', 'LINDEP')$o$,$n$c.designacion_norm not in ('REPUESTOS', 'LKT', 'EXTINTOR', 'LINDEP', 'OTA')$n$);
 execute d;
end;
$patch$;

do $patch$
declare d text; old text; replacement text;
begin
 d:=pg_get_functiondef('app_private.manteniment_importar_trabajos_alpha74_base(jsonb)'::regprocedure);
 old:=$old$and key_work.clave_trabajo = 'F:' || x.taller_norm || '|H:' || x.designacion_norm$old$;replacement:=$new$and (key_work.clave_trabajo = 'ROW:' || x.clave_fila or (key_work.clave_trabajo = 'F:' || x.taller_norm || '|H:' || x.designacion_norm and exists(select 1 from jsonb_array_elements(key_work.fuentes) source where source->>'clave_fila'=x.clave_fila)))$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Importer row identity definition has changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$and key_work.clave_trabajo='F:' || x.taller_norm || '|H:' || x.designacion_norm$old$;replacement:=$new$and (key_work.clave_trabajo='ROW:' || x.clave_fila or (key_work.clave_trabajo='F:' || x.taller_norm || '|H:' || x.designacion_norm and exists(select 1 from jsonb_array_elements(key_work.fuentes) source where source->>'clave_fila'=x.clave_fila)))$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Importer row identity definition has changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$'F:' || c.taller_norm || '|H:' || c.designacion_norm as clave_trabajo,$old$;replacement:=$new$coalesce(c.existing_work_id::text,'ROW:' || c.clave_fila) as clave_trabajo,$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Importer row identity definition has changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$c.existing_work_id, c.taller_norm, c.designacion_norm
    order by$old$;replacement:=$new$c.existing_work_id, c.taller_norm, c.designacion_norm, coalesce(c.existing_work_id::text,'ROW:' || c.clave_fila)
    order by$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Importer row identity definition has changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$v_clave_trabajo := v_group.clave_trabajo;$old$;replacement:=$new$v_clave_trabajo := coalesce((select clave_trabajo from app_private.manteniment_t_trabajos where id=v_group.existing_work_id),v_group.clave_trabajo);$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Importer row identity definition has changed';end if;
 d:=replace(d,old,replacement);
 execute d;
end;
$patch$;

-- OTA remains remote even when the same workshop has an open physical visit.
-- Existing explicitly linked work keeps its identity and historical placement.
do $patch$
declare d text; old text;
begin
 d:=pg_get_functiondef('app_private.manteniment_importar_trabajos_alpha74_base(jsonb)'::regprocedure);
 old:=$old$v_clave_visita := case$old$;
 if strpos(d,old)=0 then raise exception 'Visit key definition has changed';end if;
 d:=replace(d,old,$new$v_clave_visita := case
      when v_group.designacion_norm='OTA' then 'REMOTO|F:' || coalesce(v_group.taller_norm,'')$new$);
 old:=$old$and (clave_visita = v_clave_visita$old$;
 if strpos(d,old)=0 then raise exception 'Visit lookup definition has changed';end if;
 d:=replace(d,old,$new$and (v_group.designacion_norm<>'OTA' or modalidad='gestion')
        and (clave_visita = v_clave_visita$new$);
 old:=$old$if coalesce(v_group.taller_norm, '') <> '' and exists ($old$;
 if strpos(d,old)=0 then raise exception 'Physical visit classification has changed';end if;
 d:=replace(d,old,$new$if v_group.designacion_norm<>'OTA' and coalesce(v_group.taller_norm, '') <> '' and exists ($new$);
 old:=$old$and e.tipo_etapa in ('entrada_taller', 'otro')$old$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>2 then raise exception 'Legacy visit lookup has changed';end if;
 d:=replace(d,old,$new$and e.tipo_etapa in ('entrada_taller', 'otro')
          and (v_group.designacion_norm<>'OTA' or e.tipo_etapa='otro')$new$);
 execute d;
end;
$patch$;
