-- Alpha72: separar la modalidad operativa del sustituto real.
-- Toda ficha conserva su numero de parada y termina en Historico; la modalidad
-- solo decide si corresponde crear una T final de recuperacion.

create table if not exists public.catalogo_modalidades_operativas_hotel (
  codigo text primary key,
  nombre text not null,
  comportamiento text not null default 'manual',
  orden integer not null default 0,
  activo boolean not null default true,
  constraint catalogo_modalidades_operativas_comportamiento_check
    check (comportamiento in ('sin_sustitucion','reparado_en_ruta','reserva_en_reparacion','manual')),
  constraint catalogo_modalidades_operativas_codigo_check
    check (btrim(codigo) <> '' and char_length(codigo) <= 120),
  constraint catalogo_modalidades_operativas_nombre_check
    check (btrim(nombre) <> '' and char_length(nombre) <= 120)
);

create unique index if not exists catalogo_modalidades_operativas_nombre_ci_uq
  on public.catalogo_modalidades_operativas_hotel(lower(btrim(nombre)));

insert into public.catalogo_modalidades_operativas_hotel(codigo,nombre,comportamiento,orden,activo)
values
  ('sin_sustitucion','Sin sustitución','sin_sustitucion',10,true),
  ('reparado_en_ruta','Reparado en ruta','reparado_en_ruta',20,true),
  ('reserva_en_reparacion','Reserva en reparación','reserva_en_reparacion',30,true)
on conflict (codigo) do update
set nombre=excluded.nombre,
    comportamiento=excluded.comportamiento,
    orden=excluded.orden,
    activo=true;

alter table public.catalogo_modalidades_operativas_hotel enable row level security;
revoke all on table public.catalogo_modalidades_operativas_hotel from anon,authenticated;
grant select on table public.catalogo_modalidades_operativas_hotel to authenticated;
drop policy if exists catalogo_modalidades_operativas_select_secure
  on public.catalogo_modalidades_operativas_hotel;
create policy catalogo_modalidades_operativas_select_secure
on public.catalogo_modalidades_operativas_hotel
for select to authenticated
using (public.usuario_activo() and public.dispositivo_autorizado());

alter table public.registros_hotel
  add column if not exists modalidad_operativa text not null default '';

-- El valor vacio mantiene el flujo historico normal y no pertenece al catalogo.
-- Un trigger aplica la integridad referencial solo a los valores no vacios.

create or replace function app_private.validar_modalidad_operativa_hotel()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.modalidad_operativa := btrim(coalesce(new.modalidad_operativa,''));
  if new.modalidad_operativa <> '' and not exists (
    select 1 from public.catalogo_modalidades_operativas_hotel c
    where c.codigo=new.modalidad_operativa and c.activo=true
  ) then
    raise exception 'La modalidad operativa no es válida';
  end if;
  return new;
end;
$function$;

revoke all on function app_private.validar_modalidad_operativa_hotel()
  from public,anon,authenticated;
drop trigger if exists registros_hotel_validar_modalidad_operativa on public.registros_hotel;
create trigger registros_hotel_validar_modalidad_operativa
before insert or update of modalidad_operativa on public.registros_hotel
for each row execute function app_private.validar_modalidad_operativa_hotel();

create or replace function app_private.resolver_modalidad_operativa_hotel(p_valor text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_valor text := btrim(coalesce(p_valor,''));
  v_codigo text;
begin
  if v_valor='' then return ''; end if;
  if char_length(v_valor)>120 then raise exception 'La modalidad operativa es demasiado larga'; end if;

  select c.codigo into v_codigo
  from public.catalogo_modalidades_operativas_hotel c
  where c.activo=true
    and (lower(btrim(c.codigo))=lower(v_valor) or lower(btrim(c.nombre))=lower(v_valor))
  order by (lower(btrim(c.codigo))=lower(v_valor)) desc
  limit 1;

  if v_codigo is not null then return v_codigo; end if;

  begin
    insert into public.catalogo_modalidades_operativas_hotel(codigo,nombre,comportamiento,orden,activo)
    select v_valor,v_valor,'manual',coalesce(max(orden),0)+10,true
    from public.catalogo_modalidades_operativas_hotel
    returning codigo into v_codigo;
  exception when unique_violation then
    select c.codigo into v_codigo
    from public.catalogo_modalidades_operativas_hotel c
    where lower(btrim(c.codigo))=lower(v_valor) or lower(btrim(c.nombre))=lower(v_valor)
    limit 1;
  end;
  return v_codigo;
end;
$function$;

revoke all on function app_private.resolver_modalidad_operativa_hotel(text)
  from public,anon,authenticated;

-- Corrige los cinco valores historicos que se guardaron como si fueran un
-- vehiculo sustituto. No se elimina ninguna ficha ni ninguna T.
select set_config('app.request_id','alpha72_modalidades_backfill',true);
select set_config('app.audit_origin','alpha72-modalidades-backfill',true);
update public.registros_hotel
set modalidad_operativa = case
      when lower(btrim(vehiculo_reserva))='en ruta' then 'reparado_en_ruta'
      else 'sin_sustitucion'
    end,
    vehiculo_reserva='',
    matricula_reserva='',
    etiqueta_reserva='',
    modificado_por=coalesce(modificado_por,creado_por)
where lower(btrim(vehiculo_reserva)) in ('en ruta','sin sustitucion','sin sustitución');

create or replace function app_private.modalidad_hotel_requiere_recuperacion(p_registro_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_codigo text;
  v_comportamiento text;
  v_fecha_parada date;
  v_total integer:=0;
  v_pendientes integer:=0;
  v_ultima_fecha date;
  v_hoy date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
begin
  v_codigo:=nullif(btrim(coalesce(current_setting('app.hotel_modalidad_operativa',true),'')),'');
  select coalesce(v_codigo,nullif(btrim(r.modalidad_operativa),'')),r.fecha_parada
    into v_codigo,v_fecha_parada
  from public.registros_hotel r where r.id=p_registro_id;

  if v_codigo is null then return true; end if;
  select c.comportamiento into v_comportamiento
  from public.catalogo_modalidades_operativas_hotel c
  where c.codigo=v_codigo and c.activo=true;

  if v_comportamiento is null or v_comportamiento='manual' then return true; end if;
  if v_comportamiento in ('reparado_en_ruta','reserva_en_reparacion') then return false; end if;
  if v_comportamiento<>'sin_sustitucion' then return true; end if;

  select count(*),
         count(*) filter (where e.estado not in ('realizada','anulada')),
         max(coalesce(e.fecha_real,e.fecha_fin_real,e.fecha_inicio_real,e.fecha_prevista)::date)
    into v_total,v_pendientes,v_ultima_fecha
  from public.etapas_hotel e
  where e.registro_hotel_id=p_registro_id
    and not e.cancelado
    and e.accion_sistema<>'recuperar_y_liberar';

  if v_total=0 then return false; end if;
  if v_fecha_parada is null then return true; end if;
  if v_pendientes>0 then
    return greatest(coalesce(v_ultima_fecha,v_fecha_parada),v_hoy)>v_fecha_parada;
  end if;
  return coalesce(v_ultima_fecha,v_fecha_parada)>v_fecha_parada;
end;
$function$;

revoke all on function app_private.modalidad_hotel_requiere_recuperacion(uuid)
  from public,anon,authenticated;

create or replace function app_private.cerrar_modalidad_hotel_sin_recuperacion(p_registro_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_codigo text;
  v_comportamiento text;
  v_total integer:=0;
  v_pendientes integer:=0;
begin
  v_codigo:=nullif(btrim(coalesce(current_setting('app.hotel_modalidad_operativa',true),'')),'');
  select coalesce(v_codigo,nullif(btrim(r.modalidad_operativa),'')) into v_codigo
  from public.registros_hotel r where r.id=p_registro_id and not r.cancelado;
  if v_codigo is null then return false; end if;

  select c.comportamiento into v_comportamiento
  from public.catalogo_modalidades_operativas_hotel c
  where c.codigo=v_codigo and c.activo=true;
  if v_comportamiento is null or v_comportamiento='manual' then return false; end if;
  if app_private.modalidad_hotel_requiere_recuperacion(p_registro_id) then return false; end if;

  select count(*),count(*) filter (where e.estado not in ('realizada','anulada'))
    into v_total,v_pendientes
  from public.etapas_hotel e
  where e.registro_hotel_id=p_registro_id
    and not e.cancelado
    and e.accion_sistema<>'recuperar_y_liberar';

  if v_total=0 or v_pendientes>0 then return false; end if;
  update public.registros_hotel
  set estado='recuperado',
      retirado_hotel_activo=true,
      fecha_retirado_hotel=coalesce(fecha_retirado_hotel,clock_timestamp()),
      modificado_por=coalesce(auth.uid(),modificado_por)
  where id=p_registro_id and not cancelado
    and (estado<>'recuperado' or not retirado_hotel_activo);
  return found;
end;
$function$;

revoke all on function app_private.cerrar_modalidad_hotel_sin_recuperacion(uuid)
  from public,anon,authenticated;

create or replace function app_private.cerrar_modalidad_hotel_desde_etapa()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  if current_setting('app.clonando_pizarra',true)='1'
     or current_setting('app.reconciliando_etapas',true)='1'
     or current_setting('app.audit_origin',true)='metrogestion-r1-editor' then
    return new;
  end if;
  if new.cancelado=false and new.estado='realizada'
     and new.accion_sistema<>'recuperar_y_liberar'
     and (tg_op='INSERT' or old.estado is distinct from new.estado or old.cancelado is distinct from new.cancelado) then
    perform app_private.cerrar_modalidad_hotel_sin_recuperacion(new.registro_hotel_id);
  end if;
  return new;
end;
$function$;

revoke all on function app_private.cerrar_modalidad_hotel_desde_etapa()
  from public,anon,authenticated;
drop trigger if exists etapas_hotel_cerrar_modalidad on public.etapas_hotel;
create trigger etapas_hotel_cerrar_modalidad
after insert or update of estado,cancelado on public.etapas_hotel
for each row execute function app_private.cerrar_modalidad_hotel_desde_etapa();

create or replace function app_private.asegurar_recuperacion_final()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare v_actor uuid; v_last_pos integer; v_name_normalized text;
begin
  if current_setting('app.clonando_pizarra',true)='1' then return new; end if;
  if current_setting('app.reconciliando_etapas',true)='1' then return new; end if;
  if current_setting('app.audit_origin',true)='metrogestion-r1-editor' then return new; end if;
  if new.cancelado then return new; end if;
  v_name_normalized:=lower(translate(coalesce(new.nombre,''),'áéíóúÁÉÍÓÚ','aeiouAEIOU'));
  if new.accion_sistema='recuperar_y_liberar' or v_name_normalized like 'recuperar ruta%' or v_name_normalized like 'recuperar vehiculo%' then return new; end if;
  if not app_private.modalidad_hotel_requiere_recuperacion(new.registro_hotel_id) then return new; end if;
  if exists(select 1 from public.etapas_hotel e where e.registro_hotel_id=new.registro_hotel_id and e.cancelado=false and e.accion_sistema='recuperar_y_liberar') then return new; end if;
  v_actor:=coalesce(auth.uid(),new.modificado_por,new.creado_por);
  select coalesce(max(e.posicion),0)+1 into v_last_pos from public.etapas_hotel e where e.registro_hotel_id=new.registro_hotel_id and e.cancelado=false;
  insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,lugar,fecha_prevista,fecha_inicio_real,fecha_fin_real,fecha_real,observaciones,cancelado,creado_por,modificado_por,accion_sistema)
  values(new.registro_hotel_id,gen_random_uuid(),'Recuperar ruta y liberar reserva',v_last_pos,'pendiente','otro','',null,null,null,null,'Generada automáticamente como T final de cierre.',false,v_actor,v_actor,'recuperar_y_liberar');
  return new;
end;
$function$;

revoke all on function app_private.asegurar_recuperacion_final()
  from public,anon,authenticated;

create or replace function app_private.reconciliar_etapas_hotel(p_registro_id uuid,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actor uuid;
  v_entry record;
  v_last_pos integer;
  v_audit_count integer;
  v_active_count integer;
  v_requiere_recuperacion boolean;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'Identificador de guardado no válido'; end if;
  perform 1 from public.registros_hotel where id=p_registro_id for update;
  if not found then raise exception 'Ficha de Hotel no encontrada'; end if;

  v_actor:=auth.uid();
  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.audit_origin','metrogestion-r1-reconcile',true);
  perform set_config('app.reconciliando_etapas','1',true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  for v_entry in
    select e.id,e.posicion,e.taller_id,e.centro_taller_id,e.lugar
    from public.etapas_hotel e
    where e.registro_hotel_id=p_registro_id and not e.cancelado
      and e.tipo_etapa='entrada_taller' and e.etapa_origen_id is null
      and not exists(select 1 from public.etapas_hotel r where r.etapa_origen_id=e.id and not r.cancelado and r.tipo_etapa='recogida_taller')
    order by e.posicion,e.creado_en,e.id
  loop
    insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,taller_id,centro_taller_id,lugar,observaciones,cancelado,creado_por,modificado_por,etapa_origen_id)
    values(p_registro_id,gen_random_uuid(),'Recogida taller',v_entry.posicion+1,'pendiente','recogida_taller',v_entry.taller_id,v_entry.centro_taller_id,coalesce(v_entry.lugar,''),'Generada automáticamente al crear la entrada a taller.',false,v_actor,v_actor,v_entry.id);
  end loop;

  v_requiere_recuperacion:=app_private.modalidad_hotel_requiere_recuperacion(p_registro_id);
  if v_requiere_recuperacion then
    if not exists(select 1 from public.etapas_hotel e where e.registro_hotel_id=p_registro_id and not e.cancelado and e.accion_sistema='recuperar_y_liberar') then
      select coalesce(max(e.posicion),0)+1 into v_last_pos from public.etapas_hotel e where e.registro_hotel_id=p_registro_id and not e.cancelado;
      insert into public.etapas_hotel(registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,lugar,observaciones,cancelado,creado_por,modificado_por,accion_sistema)
      values(p_registro_id,gen_random_uuid(),'Recuperar ruta y liberar reserva',v_last_pos,'pendiente','otro','','Generada automáticamente como T final de cierre.',false,v_actor,v_actor,'recuperar_y_liberar');
    end if;
  else
    update public.etapas_hotel
    set cancelado=true,estado='anulada',estado_catalogo_codigo='anulada',
        motivo_cancelacion='No corresponde a la modalidad operativa seleccionada.',
        cancelado_en=clock_timestamp(),cancelado_por=v_actor,modificado_por=v_actor
    where registro_hotel_id=p_registro_id and not cancelado
      and accion_sistema='recuperar_y_liberar' and estado<>'realizada';
  end if;

  select count(*) into v_active_count from public.etapas_hotel e
  where e.registro_hotel_id=p_registro_id and not e.cancelado;
  if v_active_count>99 then raise exception 'La ficha supera el máximo de 99 T activas'; end if;

  create temp table if not exists tmp_hotel_reconcile_order(stage_id uuid primary key,new_pos integer not null) on commit drop;
  truncate tmp_hotel_reconcile_order;
  insert into tmp_hotel_reconcile_order(stage_id,new_pos)
  select x.id,row_number() over(order by
    case when x.accion_sistema='recuperar_y_liberar' then 1 else 0 end,
    case when x.accion_sistema='recuperar_y_liberar' then 2147483000::bigint
         when x.tipo_etapa='recogida_taller' and p.id is not null then (p.posicion::bigint*2)+1
         else (x.posicion::bigint*2) end,
    x.creado_en,x.id)::integer
  from public.etapas_hotel x left join public.etapas_hotel p on p.id=x.etapa_origen_id
  where x.registro_hotel_id=p_registro_id and not x.cancelado;
  update public.etapas_hotel e set posicion=1000+o.new_pos,modificado_por=v_actor
  from tmp_hotel_reconcile_order o where e.id=o.stage_id;
  update public.etapas_hotel e set posicion=o.new_pos,modificado_por=v_actor
  from tmp_hotel_reconcile_order o where e.id=o.stage_id;

  perform app_private.cerrar_modalidad_hotel_sin_recuperacion(p_registro_id);
  perform set_config('app.reconciliando_etapas','0',true);
  select count(*) into v_audit_count from public.auditoria_cambios where request_id=p_request_id;
  return jsonb_build_object('ok',true,'request_id',p_request_id,'eventos_auditoria',v_audit_count,'detalle',public.obtener_ficha_hotel_edicion(p_registro_id));
end;
$function$;

revoke all on function app_private.reconciliar_etapas_hotel(uuid,text)
  from public,anon,authenticated;
grant execute on function app_private.reconciliar_etapas_hotel(uuid,text)
  to authenticated,service_role;

create or replace function app_private.obtener_ficha_hotel_edicion_alpha72(p_registro_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare v_detail jsonb;
begin
  v_detail:=app_private.obtener_ficha_hotel_edicion_alpha71(p_registro_id);
  return jsonb_set(v_detail,'{catalogos,modalidades_operativas}',coalesce((
    select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'comportamiento',c.comportamiento,'orden',c.orden) order by c.orden,c.nombre)
    from public.catalogo_modalidades_operativas_hotel c where c.activo=true
  ),'[]'::jsonb),true);
end;
$function$;

create or replace function app_private.guardar_ficha_hotel_edicion_alpha72(
  p_registro_id uuid,p_version integer,p_ficha jsonb,p_etapas jsonb,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_codigo text;
  v_saved jsonb;
  v_version integer;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then raise exception 'No tienes permiso para modificar Hotel'; end if;
  v_codigo:=app_private.resolver_modalidad_operativa_hotel(p_ficha->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa',v_codigo,true);
  v_saved:=app_private.guardar_ficha_hotel_edicion_alpha71(p_registro_id,p_version,p_ficha,p_etapas,p_request_id);
  update public.registros_hotel
  set modalidad_operativa=v_codigo,modificado_por=auth.uid()
  where id=p_registro_id and modalidad_operativa is distinct from v_codigo;
  select version into v_version from public.registros_hotel where id=p_registro_id;
  return v_saved || jsonb_build_object(
    'ok',true,'version',v_version,'modalidad_operativa',v_codigo,
    'detalle',app_private.obtener_ficha_hotel_edicion_alpha72(p_registro_id)
  );
end;
$function$;

create or replace function app_private.crear_ficha_hotel_con_etapas_alpha72(p_ficha jsonb,p_etapas jsonb,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_codigo text;
  v_created jsonb;
  v_registro_id uuid;
  v_numero_parada text;
  v_version integer;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then raise exception 'No tienes permiso para añadir fichas y T al Hotel'; end if;
  v_codigo:=app_private.resolver_modalidad_operativa_hotel(p_ficha->>'modalidad_operativa');
  perform set_config('app.hotel_modalidad_operativa',v_codigo,true);
  v_created:=app_private.crear_ficha_hotel_con_etapas_alpha71(p_ficha,p_etapas,p_request_id);
  v_registro_id:=(v_created->>'id')::uuid;
  v_numero_parada:=nullif(btrim(v_created->>'numero_parada'),'');
  if v_numero_parada is null then raise exception 'La ficha recién creada no tiene número de parada'; end if;
  update public.registros_hotel set modalidad_operativa=v_codigo,modificado_por=auth.uid()
  where id=v_registro_id;
  select version into v_version from public.registros_hotel where id=v_registro_id;
  return v_created || jsonb_build_object(
    'ok',true,'id',v_registro_id,'numero_parada',v_numero_parada,
    'version',v_version,'modalidad_operativa',v_codigo,
    'detalle',app_private.obtener_ficha_hotel_edicion_alpha72(v_registro_id)
  );
end;
$function$;

create or replace function public.obtener_ficha_hotel_edicion_alpha72(p_registro_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog,app_private
as $function$ select app_private.obtener_ficha_hotel_edicion_alpha72($1); $function$;
create or replace function public.guardar_ficha_hotel_edicion_alpha72(p_registro_id uuid,p_version integer,p_ficha jsonb,p_etapas jsonb,p_request_id text)
returns jsonb language sql security invoker set search_path=pg_catalog,app_private
as $function$ select app_private.guardar_ficha_hotel_edicion_alpha72($1,$2,$3,$4,$5); $function$;
create or replace function public.crear_ficha_hotel_con_etapas_alpha72(p_ficha jsonb,p_etapas jsonb,p_request_id text)
returns jsonb language sql security invoker set search_path=pg_catalog,app_private
as $function$ select app_private.crear_ficha_hotel_con_etapas_alpha72($1,$2,$3); $function$;

revoke all on function app_private.obtener_ficha_hotel_edicion_alpha72(uuid) from public,anon;
revoke all on function app_private.guardar_ficha_hotel_edicion_alpha72(uuid,integer,jsonb,jsonb,text) from public,anon;
revoke all on function app_private.crear_ficha_hotel_con_etapas_alpha72(jsonb,jsonb,text) from public,anon;
grant execute on function app_private.obtener_ficha_hotel_edicion_alpha72(uuid) to authenticated,service_role;
grant execute on function app_private.guardar_ficha_hotel_edicion_alpha72(uuid,integer,jsonb,jsonb,text) to authenticated,service_role;
grant execute on function app_private.crear_ficha_hotel_con_etapas_alpha72(jsonb,jsonb,text) to authenticated,service_role;
revoke all on function public.obtener_ficha_hotel_edicion_alpha72(uuid) from public,anon;
revoke all on function public.guardar_ficha_hotel_edicion_alpha72(uuid,integer,jsonb,jsonb,text) from public,anon;
revoke all on function public.crear_ficha_hotel_con_etapas_alpha72(jsonb,jsonb,text) from public,anon;
grant execute on function public.obtener_ficha_hotel_edicion_alpha72(uuid) to authenticated,service_role;
grant execute on function public.guardar_ficha_hotel_edicion_alpha72(uuid,integer,jsonb,jsonb,text) to authenticated,service_role;
grant execute on function public.crear_ficha_hotel_con_etapas_alpha72(jsonb,jsonb,text) to authenticated,service_role;

-- Las vistas añaden la modalidad al final para no alterar las columnas previas.
create or replace view public.hotel_actual with (security_invoker=true) as
select r.id,r.pizarra_id,p.fecha as fecha_pizarra,r.seguimiento_id,r.numero_parada,
  nullif(r.vehiculo_sustituido,'') as dfm,nullif(r.matricula_sustituido,'') as matricula,
  nullif(r.vehiculo_reserva,'') as reserva,nullif(r.matricula_reserva,'') as matricula_reserva,
  nullif(r.vehiculo_reserva,'') as sustituto,nullif(r.matricula_reserva,'') as matricula_sustituto,
  r.tipo_sustituto,r.etiqueta_reserva,r.etiqueta_reserva as etiqueta_sustituto,
  r.tipo_unidad,r.marca,r.tipo_motor,r.modelo,r.upc,r.telefono,r.prioridad,r.estado,r.lugar,
  r.fecha_parada,r.fecha_entrada,r.tipo_movimiento,r.causa,r.trabajos_reserva,r.incidencia,
  r.proximo,r.observaciones,r.trazo_marron,
  case when exists(select 1 from public.registros_hotel x where x.pizarra_id=r.pizarra_id and not x.cancelado and not x.retirado_hotel_activo and x.tipo_sustituto='FLOTA' and x.vehiculo_reserva=r.vehiculo_sustituido) then 'marron'
       when r.estado='planificado' then 'amarillo' when r.estado='pendiente_taller' then 'blanco'
       when r.estado in ('en_taller','pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos') then 'lila'
       when r.estado='terminado_pendiente_recogida' then 'azul' when r.estado='recogido_pendiente_ruta' then 'calabaza'
       when r.estado='reserva_liberada' then 'verde' else 'blanco' end as fondo_visual,
  r.orden,r.version,r.modificado_por,r.actualizado_en,
  count(e.id) filter(where not e.cancelado) as total_t,
  count(e.id) filter(where not e.cancelado and e.estado='realizada') as t_realizadas,
  count(e.id) filter(where not e.cancelado and e.estado not in ('realizada','anulada')) as t_pendientes,
  r.modalidad_operativa,
  (select c.nombre from public.catalogo_modalidades_operativas_hotel c where c.codigo=r.modalidad_operativa) as modalidad_operativa_nombre
from public.registros_hotel r join public.pizarras p on p.id=r.pizarra_id
left join public.etapas_hotel e on e.registro_hotel_id=r.id
where p.estado='en_curso' and not r.cancelado and not r.retirado_hotel_activo and r.estado<>'reserva_liberada'
group by r.id,p.fecha;

create or replace view public.hotel_por_dia with (security_invoker=true) as
select r.id,r.pizarra_id,p.fecha as fecha_pizarra,p.estado as estado_pizarra,r.seguimiento_id,r.numero_parada,
  nullif(r.vehiculo_sustituido,'') as dfm,nullif(r.matricula_sustituido,'') as matricula,
  nullif(r.vehiculo_reserva,'') as reserva,nullif(r.matricula_reserva,'') as matricula_reserva,
  nullif(r.vehiculo_reserva,'') as sustituto,nullif(r.matricula_reserva,'') as matricula_sustituto,
  r.tipo_sustituto,r.etiqueta_reserva,r.etiqueta_reserva as etiqueta_sustituto,
  r.tipo_unidad,r.marca,r.tipo_motor,r.modelo,r.upc,r.telefono,r.prioridad,r.estado,r.lugar,
  r.fecha_parada,r.fecha_entrada,r.tipo_movimiento,r.causa,r.trabajos_reserva,r.incidencia,
  r.proximo,r.observaciones,r.trazo_marron,
  case when exists(select 1 from public.registros_hotel x where x.pizarra_id=r.pizarra_id and not x.cancelado and not x.retirado_hotel_activo and x.tipo_sustituto='FLOTA' and x.vehiculo_reserva=r.vehiculo_sustituido) then 'marron'
       when r.estado='planificado' then 'amarillo' when r.estado='pendiente_taller' then 'blanco'
       when r.estado in ('en_taller','pendiente_diagnostico','pendiente_autorizacion','pendiente_repuestos') then 'lila'
       when r.estado='terminado_pendiente_recogida' then 'azul' when r.estado='recogido_pendiente_ruta' then 'calabaza'
       when r.estado='reserva_liberada' then 'verde' else 'blanco' end as fondo_visual,
  r.orden,r.retirado_hotel_activo,r.fecha_retirado_hotel,r.cancelado,r.motivo_cancelacion,
  r.cancelado_en,r.cancelado_por,r.version,r.modificado_por,r.actualizado_en,
  count(e.id) filter(where not e.cancelado) as total_t,
  count(e.id) filter(where not e.cancelado and e.estado='realizada') as t_realizadas,
  count(e.id) filter(where not e.cancelado and e.estado not in ('realizada','anulada')) as t_pendientes,
  r.modalidad_operativa,
  (select c.nombre from public.catalogo_modalidades_operativas_hotel c where c.codigo=r.modalidad_operativa) as modalidad_operativa_nombre
from public.registros_hotel r join public.pizarras p on p.id=r.pizarra_id
left join public.etapas_hotel e on e.registro_hotel_id=r.id
group by r.id,p.fecha,p.estado;

create or replace view public.hotel_actual_detalle with (security_invoker=true) as
select h.id,h.pizarra_id,h.fecha_pizarra,h.seguimiento_id,h.numero_parada,h.dfm,h.matricula,
  h.reserva,h.matricula_reserva,h.sustituto,h.matricula_sustituto,h.tipo_sustituto,
  h.etiqueta_reserva,h.etiqueta_sustituto,h.tipo_unidad,h.marca,h.tipo_motor,h.modelo,
  h.upc,h.telefono,h.prioridad,h.estado,h.lugar,h.fecha_parada,h.fecha_entrada,
  h.tipo_movimiento,h.causa,h.trabajos_reserva,h.incidencia,h.proximo,h.observaciones,
  h.trazo_marron,h.fondo_visual,h.orden,h.version,h.modificado_por,h.actualizado_en,
  h.total_t,h.t_realizadas,h.t_pendientes,
  coalesce((select jsonb_agg(jsonb_build_object(
    'id',e.id,'posicion',e.posicion,'nombre',e.nombre,'estado',e.estado,'tipo_etapa',e.tipo_etapa,
    'taller_id',e.taller_id,'taller',t.nombre,'centro_taller_id',e.centro_taller_id,'centro',c.nombre,
    'lugar',e.lugar,'fecha_prevista',e.fecha_prevista,'fecha_inicio_real',e.fecha_inicio_real,
    'fecha_fin_real',e.fecha_fin_real,'fecha_real',e.fecha_real,'observaciones',e.observaciones,
    'cancelado',e.cancelado,'motivo_cancelacion',e.motivo_cancelacion,'version',e.version,
    'accion_sistema',e.accion_sistema,'trabajos',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'tipo_trabajo',w.tipo_trabajo,'categoria_tecnica',w.categoria_tecnica,
      'motivo_entrada',w.motivo_entrada,'diagnostico_real',w.diagnostico_real,'km_averia',w.km_averia,
      'expediente',w.expediente,'descripcion',w.descripcion,'peritaje_estado',w.peritaje_estado,
      'observaciones',w.observaciones,'cancelado',w.cancelado,'motivo_cancelacion',w.motivo_cancelacion,
      'version',w.version) order by w.creado_en,w.id) from public.trabajos_etapa_hotel w where w.etapa_hotel_id=e.id),'[]'::jsonb)
  ) order by e.cancelado,e.posicion,e.creado_en,e.id)
  from public.etapas_hotel e left join public.talleres t on t.id=e.taller_id
  left join public.centros_taller c on c.id=e.centro_taller_id where e.registro_hotel_id=h.id),'[]'::jsonb) as etapas_resumen,
  h.modalidad_operativa,h.modalidad_operativa_nombre
from public.hotel_actual h;

grant select on public.hotel_actual,public.hotel_por_dia,public.hotel_actual_detalle to authenticated;

comment on column public.registros_hotel.modalidad_operativa is
  'Modalidad separada del sustituto real. Vacio conserva el flujo historico normal.';
