
create table if not exists public.catalogo_estados_etapa_hotel (
  codigo text primary key,
  nombre text not null,
  estado_operativo text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  constraint catalogo_estados_etapa_operativo_check
    check (estado_operativo in ('pendiente','programada','en_curso','realizada','anulada'))
);
create unique index if not exists catalogo_estados_etapa_codigo_ci_uq on public.catalogo_estados_etapa_hotel (lower(btrim(codigo)));
create unique index if not exists catalogo_estados_etapa_nombre_ci_uq on public.catalogo_estados_etapa_hotel (lower(btrim(nombre)));
insert into public.catalogo_estados_etapa_hotel(codigo,nombre,estado_operativo,orden,activo)
values ('pendiente','Pendiente','pendiente',10,true),('programada','Programada','programada',20,true),('en_curso','En curso','en_curso',30,true),('realizada','Realizada','realizada',40,true),('anulada','Anulada','anulada',50,true)
on conflict (codigo) do update set nombre=excluded.nombre,estado_operativo=excluded.estado_operativo,orden=excluded.orden,activo=true;

create table if not exists public.catalogo_tipos_etapa_hotel (
  codigo text primary key,
  nombre text not null,
  orden integer not null default 0,
  activo boolean not null default true
);
create unique index if not exists catalogo_tipos_etapa_codigo_ci_uq on public.catalogo_tipos_etapa_hotel (lower(btrim(codigo)));
create unique index if not exists catalogo_tipos_etapa_nombre_ci_uq on public.catalogo_tipos_etapa_hotel (lower(btrim(nombre)));
insert into public.catalogo_tipos_etapa_hotel(codigo,nombre,orden,activo)
values ('entrada_taller','Entrada en taller',10,true),('recogida_taller','Recogida de taller',20,true),('otro','Otro movimiento o trabajo',30,true)
on conflict (codigo) do update set nombre=excluded.nombre,orden=excluded.orden,activo=true;

alter table public.etapas_hotel add column if not exists estado_catalogo_codigo text;
update public.etapas_hotel set estado_catalogo_codigo=estado where estado_catalogo_codigo is null;
alter table public.etapas_hotel alter column estado_catalogo_codigo set default 'pendiente',alter column estado_catalogo_codigo set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.etapas_hotel'::regclass and conname='etapas_hotel_estado_catalogo_fkey') then
    alter table public.etapas_hotel add constraint etapas_hotel_estado_catalogo_fkey foreign key (estado_catalogo_codigo) references public.catalogo_estados_etapa_hotel(codigo) on update restrict on delete restrict;
  end if;
end
$$;

create unique index if not exists catalogo_estados_hotel_codigo_ci_uq on public.catalogo_estados_hotel (lower(btrim(codigo)));
create unique index if not exists catalogo_estados_hotel_nombre_ci_uq on public.catalogo_estados_hotel (lower(btrim(nombre)));
create unique index if not exists talleres_nombre_ci_uq on public.talleres (lower(btrim(nombre)));
create unique index if not exists centros_taller_nombre_ci_uq on public.centros_taller (taller_id,lower(btrim(nombre)));

alter table public.catalogo_estados_etapa_hotel enable row level security;
alter table public.catalogo_tipos_etapa_hotel enable row level security;
revoke all on public.catalogo_estados_etapa_hotel from anon,authenticated;
revoke all on public.catalogo_tipos_etapa_hotel from anon,authenticated;
grant select on public.catalogo_estados_etapa_hotel to authenticated;
grant select on public.catalogo_tipos_etapa_hotel to authenticated;
drop policy if exists catalogo_estados_etapa_select_secure on public.catalogo_estados_etapa_hotel;
create policy catalogo_estados_etapa_select_secure on public.catalogo_estados_etapa_hotel for select to authenticated using (public.usuario_activo() and public.dispositivo_autorizado());
drop policy if exists catalogo_tipos_etapa_select_secure on public.catalogo_tipos_etapa_hotel;
create policy catalogo_tipos_etapa_select_secure on public.catalogo_tipos_etapa_hotel for select to authenticated using (public.usuario_activo() and public.dispositivo_autorizado());

create or replace function app_private.sincronizar_catalogo_estado_etapa()
returns trigger language plpgsql set search_path='pg_catalog','public'
as $function$
declare
  v_context_id uuid;
  v_payload jsonb;
  v_codigo text;
  v_operativo text;
begin
  begin
    v_context_id:=nullif(current_setting('app.hotel_catalogos_registro_id',true),'')::uuid;
    v_payload:=coalesce(nullif(current_setting('app.hotel_catalogos_etapas',true),'')::jsonb,'[]'::jsonb);
  exception when others then
    v_context_id:=null;
    v_payload:='[]'::jsonb;
  end;
  if v_context_id=NEW.registro_hotel_id then
    select nullif(btrim(value->>'estado_catalogo_codigo'),'') into v_codigo
    from jsonb_array_elements(v_payload)
    where nullif(value->>'posicion','')::integer=NEW.posicion limit 1;
  end if;
  if v_codigo is not null then
    select c.estado_operativo into v_operativo from public.catalogo_estados_etapa_hotel c where c.codigo=v_codigo and c.activo=true;
    if v_operativo is null or v_operativo<>NEW.estado then raise exception 'El estado personalizado de la T no corresponde con su estado operativo'; end if;
    NEW.estado_catalogo_codigo:=v_codigo;
  elsif TG_OP='INSERT' then
    NEW.estado_catalogo_codigo:=NEW.estado;
  elsif NEW.estado is distinct from OLD.estado and NEW.estado_catalogo_codigo is not distinct from OLD.estado_catalogo_codigo then
    NEW.estado_catalogo_codigo:=NEW.estado;
  end if;
  select c.estado_operativo into v_operativo from public.catalogo_estados_etapa_hotel c where c.codigo=NEW.estado_catalogo_codigo and c.activo=true;
  if v_operativo is null or v_operativo<>NEW.estado then raise exception 'El estado visible de la T no es válido'; end if;
  return NEW;
end;
$function$;
revoke all on function app_private.sincronizar_catalogo_estado_etapa() from public,anon,authenticated;
drop trigger if exists etapas_hotel_zzz_catalogo_estado on public.etapas_hotel;
create trigger etapas_hotel_zzz_catalogo_estado before insert or update of estado,estado_catalogo_codigo,posicion on public.etapas_hotel for each row execute function app_private.sincronizar_catalogo_estado_etapa();

create or replace function public.obtener_ficha_hotel_edicion(p_registro_id uuid)
returns jsonb language plpgsql set search_path='pg_catalog','public'
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_ver_modulo('hotel') then raise exception 'Acceso no autorizado a la ficha de Hotel'; end if;
  if not exists (select 1 from public.hotel_edicion_piloto h where h.registro_hotel_id=p_registro_id and h.activo=true) then raise exception 'Esta ficha todavía no está habilitada para edición'; end if;
  select jsonb_build_object(
    'ficha',to_jsonb(r),
    'etapas',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('trabajos',coalesce((select jsonb_agg(to_jsonb(t) order by t.creado_en,t.id) from public.trabajos_etapa_hotel t where t.etapa_hotel_id=e.id),'[]'::jsonb)) order by e.cancelado,e.posicion,e.creado_en,e.id) from public.etapas_hotel e where e.registro_hotel_id=r.id),'[]'::jsonb),
    'catalogos',jsonb_build_object(
      'estados',coalesce((select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'orden',c.orden,'color',c.color_semantico) order by c.orden,c.nombre) from public.catalogo_estados_hotel c where c.activo=true),'[]'::jsonb),
      'estados_etapa',coalesce((select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'estado_operativo',c.estado_operativo,'orden',c.orden) order by c.orden,c.nombre) from public.catalogo_estados_etapa_hotel c where c.activo=true),'[]'::jsonb),
      'tipos_etapa',coalesce((select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'orden',c.orden) order by c.orden,c.nombre) from public.catalogo_tipos_etapa_hotel c where c.activo=true),'[]'::jsonb),
      'tipos_trabajo',coalesce((select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'requiere_expediente',c.requiere_expediente,'requiere_diagnostico',c.requiere_diagnostico) order by c.codigo) from public.catalogo_tipos_trabajo c where c.activo=true),'[]'::jsonb),
      'talleres',coalesce((select jsonb_agg(jsonb_build_object('id',tw.id,'nombre',tw.nombre,'observaciones',tw.observaciones,'centros',coalesce((select jsonb_agg(jsonb_build_object('id',ct.id,'nombre',ct.nombre,'direccion',ct.direccion,'poblacion',ct.poblacion) order by ct.nombre) from public.centros_taller ct where ct.taller_id=tw.id and ct.activo=true),'[]'::jsonb)) order by tw.nombre) from public.talleres tw where tw.activo=true),'[]'::jsonb)
    )
  ) into v_result from public.registros_hotel r where r.id=p_registro_id;
  if v_result is null then raise exception 'Ficha de Hotel no encontrada'; end if;
  return v_result;
end;
$function$;

create or replace function app_private.guardar_ficha_hotel_edicion_catalogos(p_registro_id uuid,p_version integer,p_ficha jsonb,p_etapas jsonb,p_request_id text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public'
as $function$
declare
  v_ficha_out jsonb:=p_ficha;
  v_ficha_estado_input text; v_ficha_estado_codigo text;
  v_stage jsonb; v_stage_out jsonb; v_work jsonb; v_work_out jsonb;
  v_stages_out jsonb:='[]'::jsonb; v_works_out jsonb;
  v_taller_id uuid; v_taller_nombre text; v_centro_id uuid; v_centro_nombre text;
  v_tipo_input text; v_tipo_codigo text; v_tipo_nombre text;
  v_estado_etapa_input text; v_estado_etapa_codigo text; v_estado_operativo text;
  v_tipo_etapa_input text; v_tipo_etapa_codigo text; v_saved jsonb;
  v_new_estados integer:=0; v_new_estados_etapa integer:=0; v_new_tipos_etapa integer:=0;
  v_new_talleres integer:=0; v_new_centros integer:=0; v_new_tipos integer:=0;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then raise exception 'No tienes permiso para modificar Hotel'; end if;
  if jsonb_typeof(p_ficha)<>'object' or jsonb_typeof(p_etapas)<>'array' then raise exception 'Formato de ficha o T no válido'; end if;

  v_ficha_estado_input:=btrim(coalesce(p_ficha->>'estado',''));
  if coalesce((p_ficha->>'cancelado')::boolean,false) then
    v_ficha_out:=jsonb_set(v_ficha_out,'{estado}',to_jsonb('anulado'::text),true);
  elsif v_ficha_estado_input<>'' then
    if char_length(v_ficha_estado_input)>120 then raise exception 'El estado de la ficha es demasiado largo'; end if;
    select c.codigo into v_ficha_estado_codigo from public.catalogo_estados_hotel c
    where c.activo=true and (lower(btrim(c.codigo))=lower(v_ficha_estado_input) or lower(btrim(c.nombre))=lower(v_ficha_estado_input))
    order by (lower(btrim(c.codigo))=lower(v_ficha_estado_input)) desc limit 1;
    if v_ficha_estado_codigo is null then
      begin
        insert into public.catalogo_estados_hotel(codigo,nombre,orden,color_semantico,activo)
        select v_ficha_estado_input,v_ficha_estado_input,coalesce(max(orden),0)+10,'neutral',true from public.catalogo_estados_hotel
        returning codigo into v_ficha_estado_codigo;
        v_new_estados:=v_new_estados+1;
      exception when unique_violation then
        select c.codigo into v_ficha_estado_codigo from public.catalogo_estados_hotel c
        where lower(btrim(c.codigo))=lower(v_ficha_estado_input) or lower(btrim(c.nombre))=lower(v_ficha_estado_input) limit 1;
      end;
    end if;
    v_ficha_out:=jsonb_set(v_ficha_out,'{estado}',to_jsonb(v_ficha_estado_codigo),true);
  end if;

  for v_stage in select value from jsonb_array_elements(p_etapas) loop
    v_stage_out:=v_stage;
    if coalesce((v_stage->>'cancelado')::boolean,false) then
      v_estado_operativo:='anulada'; v_estado_etapa_codigo:='anulada';
    else
      v_estado_operativo:=coalesce(nullif(v_stage->>'estado',''),'pendiente');
      if v_estado_operativo not in ('pendiente','programada','en_curso','realizada') then raise exception 'El estado operativo de una T no es válido'; end if;
      v_estado_etapa_input:=btrim(coalesce(v_stage->>'estado_catalogo_codigo',v_stage->>'estado',''));
      if v_estado_etapa_input='' then v_estado_etapa_input:=v_estado_operativo; end if;
      if char_length(v_estado_etapa_input)>120 then raise exception 'El estado visible de una T es demasiado largo'; end if;
      select c.codigo,c.estado_operativo into v_estado_etapa_codigo,v_estado_operativo from public.catalogo_estados_etapa_hotel c
      where c.activo=true and (lower(btrim(c.codigo))=lower(v_estado_etapa_input) or lower(btrim(c.nombre))=lower(v_estado_etapa_input))
      order by (lower(btrim(c.codigo))=lower(v_estado_etapa_input)) desc limit 1;
      if v_estado_etapa_codigo is null then
        v_estado_operativo:=coalesce(nullif(v_stage->>'estado',''),'pendiente');
        begin
          insert into public.catalogo_estados_etapa_hotel(codigo,nombre,estado_operativo,orden,activo)
          select v_estado_etapa_input,v_estado_etapa_input,v_estado_operativo,coalesce(max(orden),0)+10,true from public.catalogo_estados_etapa_hotel
          returning codigo into v_estado_etapa_codigo;
          v_new_estados_etapa:=v_new_estados_etapa+1;
        exception when unique_violation then
          select c.codigo,c.estado_operativo into v_estado_etapa_codigo,v_estado_operativo from public.catalogo_estados_etapa_hotel c
          where lower(btrim(c.codigo))=lower(v_estado_etapa_input) or lower(btrim(c.nombre))=lower(v_estado_etapa_input) limit 1;
        end;
      end if;
    end if;
    v_stage_out:=jsonb_set(v_stage_out,'{estado}',to_jsonb(v_estado_operativo),true);
    v_stage_out:=jsonb_set(v_stage_out,'{estado_catalogo_codigo}',to_jsonb(v_estado_etapa_codigo),true);

    v_tipo_etapa_input:=btrim(coalesce(v_stage->>'tipo_etapa','otro'));
    if v_tipo_etapa_input='' then v_tipo_etapa_input:='otro'; end if;
    if char_length(v_tipo_etapa_input)>120 then raise exception 'El tipo de T es demasiado largo'; end if;
    select c.codigo into v_tipo_etapa_codigo from public.catalogo_tipos_etapa_hotel c
    where c.activo=true and (lower(btrim(c.codigo))=lower(v_tipo_etapa_input) or lower(btrim(c.nombre))=lower(v_tipo_etapa_input))
    order by (lower(btrim(c.codigo))=lower(v_tipo_etapa_input)) desc limit 1;
    if v_tipo_etapa_codigo is null then
      begin
        insert into public.catalogo_tipos_etapa_hotel(codigo,nombre,orden,activo)
        select v_tipo_etapa_input,v_tipo_etapa_input,coalesce(max(orden),0)+10,true from public.catalogo_tipos_etapa_hotel
        returning codigo into v_tipo_etapa_codigo;
        v_new_tipos_etapa:=v_new_tipos_etapa+1;
      exception when unique_violation then
        select c.codigo into v_tipo_etapa_codigo from public.catalogo_tipos_etapa_hotel c
        where lower(btrim(c.codigo))=lower(v_tipo_etapa_input) or lower(btrim(c.nombre))=lower(v_tipo_etapa_input) limit 1;
      end;
    end if;
    v_stage_out:=jsonb_set(v_stage_out,'{tipo_etapa}',to_jsonb(v_tipo_etapa_codigo),true);

    v_taller_id:=nullif(v_stage->>'taller_id','')::uuid;
    v_taller_nombre:=btrim(coalesce(v_stage->>'taller_nombre',''));
    if char_length(v_taller_nombre)>160 then raise exception 'El nombre del taller es demasiado largo'; end if;
    if v_taller_id is null and v_taller_nombre<>'' then
      select t.id into v_taller_id from public.talleres t where t.activo=true and lower(btrim(t.nombre))=lower(v_taller_nombre) order by t.creado_en limit 1;
      if v_taller_id is null then
        begin
          insert into public.talleres(nombre,observaciones,activo,creado_por,modificado_por) values(v_taller_nombre,'Alta automática desde Hotel',true,auth.uid(),auth.uid()) returning id into v_taller_id;
          v_new_talleres:=v_new_talleres+1;
        exception when unique_violation then
          select t.id into v_taller_id from public.talleres t where lower(btrim(t.nombre))=lower(v_taller_nombre) limit 1;
        end;
      end if;
    end if;
    v_stage_out:=jsonb_set(v_stage_out,'{taller_id}',case when v_taller_id is null then '""'::jsonb else to_jsonb(v_taller_id::text) end,true);

    v_centro_id:=nullif(v_stage->>'centro_taller_id','')::uuid;
    v_centro_nombre:=btrim(coalesce(v_stage->>'centro_nombre',''));
    if char_length(v_centro_nombre)>160 then raise exception 'El nombre del centro es demasiado largo'; end if;
    if v_centro_id is null and v_centro_nombre<>'' then
      if v_taller_id is null then raise exception 'Para crear un centro nuevo primero debes indicar el taller'; end if;
      select c.id into v_centro_id from public.centros_taller c where c.activo=true and c.taller_id=v_taller_id and lower(btrim(c.nombre))=lower(v_centro_nombre) order by c.creado_en limit 1;
      if v_centro_id is null then
        begin
          insert into public.centros_taller(taller_id,nombre,direccion,poblacion,codigo_postal,plus_code,observaciones,activo,creado_por,modificado_por)
          values(v_taller_id,v_centro_nombre,'','','','','Alta automática desde Hotel',true,auth.uid(),auth.uid()) returning id into v_centro_id;
          v_new_centros:=v_new_centros+1;
        exception when unique_violation then
          select c.id into v_centro_id from public.centros_taller c where c.taller_id=v_taller_id and lower(btrim(c.nombre))=lower(v_centro_nombre) limit 1;
        end;
      end if;
    end if;
    v_stage_out:=jsonb_set(v_stage_out,'{centro_taller_id}',case when v_centro_id is null then '""'::jsonb else to_jsonb(v_centro_id::text) end,true);

    v_works_out:='[]'::jsonb;
    for v_work in select value from jsonb_array_elements(coalesce(v_stage->'trabajos','[]'::jsonb)) loop
      v_work_out:=v_work; v_tipo_input:=btrim(coalesce(v_work->>'tipo_trabajo','')); v_tipo_codigo:=null; v_tipo_nombre:=null;
      if v_tipo_input<>'' then
        select c.codigo,c.nombre into v_tipo_codigo,v_tipo_nombre from public.catalogo_tipos_trabajo c where c.activo=true and upper(c.codigo)=upper(v_tipo_input) limit 1;
        if v_tipo_codigo is null then select c.codigo,c.nombre into v_tipo_codigo,v_tipo_nombre from public.catalogo_tipos_trabajo c where c.activo=true and lower(btrim(c.nombre))=lower(v_tipo_input) limit 1; end if;
        if v_tipo_codigo is null then
          v_tipo_codigo:='USR_'||upper(substr(md5(lower(v_tipo_input)),1,8));
          begin
            insert into public.catalogo_tipos_trabajo(codigo,nombre,requiere_expediente,requiere_diagnostico,activo) values(v_tipo_codigo,v_tipo_input,false,false,true);
            v_new_tipos:=v_new_tipos+1;
          exception when unique_violation then null;
          end;
        end if;
      end if;
      if v_tipo_codigo is not null then v_work_out:=jsonb_set(v_work_out,'{tipo_trabajo}',to_jsonb(v_tipo_codigo),true); end if;
      v_works_out:=v_works_out||jsonb_build_array(v_work_out);
    end loop;
    v_stage_out:=jsonb_set(v_stage_out,'{trabajos}',v_works_out,true);
    v_stages_out:=v_stages_out||jsonb_build_array(v_stage_out);
  end loop;

  perform set_config('app.hotel_catalogos_registro_id',p_registro_id::text,true);
  perform set_config('app.hotel_catalogos_etapas',v_stages_out::text,true);
  v_saved:=public.guardar_ficha_hotel_edicion(p_registro_id,p_version,v_ficha_out,v_stages_out,p_request_id);
  return v_saved||jsonb_build_object('catalogos_nuevos',jsonb_build_object('estados',v_new_estados,'estados_etapa',v_new_estados_etapa,'tipos_etapa',v_new_tipos_etapa,'talleres',v_new_talleres,'centros',v_new_centros,'tipos_trabajo',v_new_tipos));
end;
$function$;

