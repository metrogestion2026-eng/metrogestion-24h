begin;

drop policy if exists activaciones_24h_select on public.activaciones_24h;
create policy activaciones_24h_select
on public.activaciones_24h
for select
to authenticated
using (
  public.dispositivo_autorizado()
  and public.puede_ver_modulo('activar24h')
  and (
    creado_por = auth.uid()
    or public.es_administrador_principal()
  )
);

drop policy if exists activaciones_24h_historial_select on public.activaciones_24h_historial;
create policy activaciones_24h_historial_select
on public.activaciones_24h_historial
for select
to authenticated
using (
  public.dispositivo_autorizado()
  and public.puede_ver_modulo('activar24h')
  and exists (
    select 1
    from public.activaciones_24h a
    where a.id = activaciones_24h_historial.activacion_id
  )
);

create or replace function public.guardar_activacion_24h(
  p_id uuid,
  p_payload jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_version integer;
  v_dfm text := btrim(coalesce(p_payload->>'dfm',''));
  v_matricula text := upper(btrim(coalesce(p_payload->>'matricula','')));
  v_vehicle uuid;
  v_existing public.activaciones_24h%rowtype;
  v_primary boolean := public.es_administrador_principal();
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;
  if v_dfm = '' then raise exception 'Debes indicar el DFM'; end if;
  if btrim(coalesce(p_payload->>'averia','')) = '' then raise exception 'Debes describir la avería'; end if;

  select id into v_vehicle
  from public.vehiculos
  where dfm = v_dfm
  limit 1;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-activar-24h', true);

  if p_id is null then
    insert into public.activaciones_24h(
      dfm,matricula,vehiculo_id,marca,modelo,bastidor,upc,km_actual,contrato_km,fin_contrato_fecha,cobertura_ok,
      conductor,telefono_conductor,ubicacion_tipo,ubicacion_referencia,carretera,punto_km,sentido,averia,codigo_alarma,color_alarma,semirremolque,carga,
      numero_caso,hora_activacion,eta_tecnico,proveedor,tecnico_llegado,hora_llegada,diagnostico_confirmado,diagnostico,reparado_carretera,trasladado_taller,taller_traslado,estado_operativo_confirmado,resultado,estado,
      creado_por,modificado_por
    ) values(
      v_dfm,v_matricula,v_vehicle,upper(btrim(coalesce(p_payload->>'marca',''))),btrim(coalesce(p_payload->>'modelo','')),upper(btrim(coalesce(p_payload->>'bastidor',''))),upper(btrim(coalesce(p_payload->>'upc',''))),
      nullif(p_payload->>'km_actual','')::integer,nullif(p_payload->>'contrato_km','')::integer,nullif(p_payload->>'fin_contrato_fecha','')::date,coalesce((p_payload->>'cobertura_ok')::boolean,false),
      btrim(coalesce(p_payload->>'conductor','')),btrim(coalesce(p_payload->>'telefono_conductor','')),btrim(coalesce(p_payload->>'ubicacion_tipo','')),btrim(coalesce(p_payload->>'ubicacion_referencia','')),btrim(coalesce(p_payload->>'carretera','')),btrim(coalesce(p_payload->>'punto_km','')),btrim(coalesce(p_payload->>'sentido','')),btrim(coalesce(p_payload->>'averia','')),btrim(coalesce(p_payload->>'codigo_alarma','')),btrim(coalesce(p_payload->>'color_alarma','')),upper(btrim(coalesce(p_payload->>'semirremolque',''))),btrim(coalesce(p_payload->>'carga','')),
      btrim(coalesce(p_payload->>'numero_caso','')),nullif(p_payload->>'hora_activacion','')::time,nullif(p_payload->>'eta_tecnico','')::time,btrim(coalesce(p_payload->>'proveedor','')),coalesce((p_payload->>'tecnico_llegado')::boolean,false),nullif(p_payload->>'hora_llegada','')::time,coalesce((p_payload->>'diagnostico_confirmado')::boolean,false),btrim(coalesce(p_payload->>'diagnostico','')),coalesce((p_payload->>'reparado_carretera')::boolean,false),coalesce((p_payload->>'trasladado_taller')::boolean,false),btrim(coalesce(p_payload->>'taller_traslado','')),coalesce((p_payload->>'estado_operativo_confirmado')::boolean,false),coalesce(nullif(p_payload->>'resultado',''),'seguimiento_abierto'),coalesce(nullif(p_payload->>'estado',''),'abierta'),
      v_actor,v_actor
    ) returning id,version into v_id,v_version;
  else
    select * into v_existing
    from public.activaciones_24h
    where id = p_id
    for update;

    if v_existing.id is null then
      raise exception 'Activación 24H no encontrada';
    end if;
    if not v_primary and v_existing.creado_por is distinct from v_actor then
      raise exception 'Solo puedes modificar tus propias incidencias';
    end if;
    if v_existing.estado = 'anulada' then
      raise exception 'La incidencia está anulada. Restáurala antes de modificarla';
    end if;

    update public.activaciones_24h a
    set numero_caso=btrim(coalesce(p_payload->>'numero_caso',a.numero_caso)),
        eta_tecnico=coalesce(nullif(p_payload->>'eta_tecnico','')::time,a.eta_tecnico),
        proveedor=btrim(coalesce(p_payload->>'proveedor',a.proveedor)),
        tecnico_llegado=coalesce((p_payload->>'tecnico_llegado')::boolean,a.tecnico_llegado),
        hora_llegada=case when p_payload ? 'hora_llegada' then nullif(p_payload->>'hora_llegada','')::time else a.hora_llegada end,
        diagnostico_confirmado=coalesce((p_payload->>'diagnostico_confirmado')::boolean,a.diagnostico_confirmado),
        diagnostico=btrim(coalesce(p_payload->>'diagnostico',a.diagnostico)),
        reparado_carretera=coalesce((p_payload->>'reparado_carretera')::boolean,a.reparado_carretera),
        trasladado_taller=coalesce((p_payload->>'trasladado_taller')::boolean,a.trasladado_taller),
        taller_traslado=btrim(coalesce(p_payload->>'taller_traslado',a.taller_traslado)),
        estado_operativo_confirmado=coalesce((p_payload->>'estado_operativo_confirmado')::boolean,a.estado_operativo_confirmado),
        resultado=coalesce(nullif(p_payload->>'resultado',''),a.resultado),
        estado=coalesce(nullif(p_payload->>'estado',''),a.estado),
        modificado_por=v_actor,
        actualizado_en=now(),
        version=a.version+1
    where a.id=p_id
    returning id,version into v_id,v_version;
  end if;

  return jsonb_build_object('ok',true,'id',v_id,'version',v_version);
end;
$$;

create or replace function public.modificar_activacion_24h(
  p_id uuid,
  p_cambios jsonb,
  p_motivo text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.activaciones_24h%rowtype;
  v_after public.activaciones_24h%rowtype;
  v_primary boolean := public.es_administrador_principal();
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para modificar incidencias 24H';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'Identificador no válido'; end if;
  if length(btrim(coalesce(p_motivo,''))) < 3 then raise exception 'Debes indicar el motivo de la modificación'; end if;

  select * into v_before from public.activaciones_24h where id=p_id for update;
  if v_before.id is null then raise exception 'Incidencia 24H no encontrada'; end if;
  if not v_primary and v_before.creado_por is distinct from v_actor then raise exception 'Solo puedes modificar tus propias incidencias'; end if;
  if v_before.estado='anulada' then raise exception 'La incidencia está anulada. Restáurala antes de modificarla'; end if;

  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.audit_origin','metrogestion-r1-24h-modificacion',true);

  update public.activaciones_24h a set
    matricula=case when p_cambios ? 'matricula' then upper(btrim(coalesce(p_cambios->>'matricula',''))) else a.matricula end,
    marca=case when p_cambios ? 'marca' then upper(btrim(coalesce(p_cambios->>'marca',''))) else a.marca end,
    modelo=case when p_cambios ? 'modelo' then btrim(coalesce(p_cambios->>'modelo','')) else a.modelo end,
    km_actual=case when p_cambios ? 'km_actual' then nullif(p_cambios->>'km_actual','')::integer else a.km_actual end,
    conductor=case when p_cambios ? 'conductor' then btrim(coalesce(p_cambios->>'conductor','')) else a.conductor end,
    telefono_conductor=case when p_cambios ? 'telefono_conductor' then btrim(coalesce(p_cambios->>'telefono_conductor','')) else a.telefono_conductor end,
    ubicacion_referencia=case when p_cambios ? 'ubicacion_referencia' then btrim(coalesce(p_cambios->>'ubicacion_referencia','')) else a.ubicacion_referencia end,
    carretera=case when p_cambios ? 'carretera' then btrim(coalesce(p_cambios->>'carretera','')) else a.carretera end,
    punto_km=case when p_cambios ? 'punto_km' then btrim(coalesce(p_cambios->>'punto_km','')) else a.punto_km end,
    sentido=case when p_cambios ? 'sentido' then btrim(coalesce(p_cambios->>'sentido','')) else a.sentido end,
    averia=case when p_cambios ? 'averia' then btrim(coalesce(p_cambios->>'averia','')) else a.averia end,
    codigo_alarma=case when p_cambios ? 'codigo_alarma' then btrim(coalesce(p_cambios->>'codigo_alarma','')) else a.codigo_alarma end,
    color_alarma=case when p_cambios ? 'color_alarma' then btrim(coalesce(p_cambios->>'color_alarma','')) else a.color_alarma end,
    semirremolque=case when p_cambios ? 'semirremolque' then upper(btrim(coalesce(p_cambios->>'semirremolque',''))) else a.semirremolque end,
    carga=case when p_cambios ? 'carga' then btrim(coalesce(p_cambios->>'carga','')) else a.carga end,
    numero_caso=case when p_cambios ? 'numero_caso' then btrim(coalesce(p_cambios->>'numero_caso','')) else a.numero_caso end,
    hora_activacion=case when p_cambios ? 'hora_activacion' then nullif(p_cambios->>'hora_activacion','')::time else a.hora_activacion end,
    eta_tecnico=case when p_cambios ? 'eta_tecnico' then nullif(p_cambios->>'eta_tecnico','')::time else a.eta_tecnico end,
    proveedor=case when p_cambios ? 'proveedor' then btrim(coalesce(p_cambios->>'proveedor','')) else a.proveedor end,
    diagnostico=case when p_cambios ? 'diagnostico' then btrim(coalesce(p_cambios->>'diagnostico','')) else a.diagnostico end,
    resultado=case when p_cambios ? 'resultado' then btrim(coalesce(p_cambios->>'resultado','')) else a.resultado end,
    estado=case when p_cambios ? 'estado' then btrim(coalesce(p_cambios->>'estado','')) else a.estado end,
    modificado_por=v_actor,
    actualizado_en=now(),
    version=a.version+1
  where a.id=p_id
  returning * into v_after;

  insert into public.activaciones_24h_historial(activacion_id,accion,motivo,datos_anteriores,datos_nuevos,usuario_id,request_id)
  values(p_id,'modificacion',btrim(p_motivo),to_jsonb(v_before),to_jsonb(v_after),v_actor,p_request_id);

  return jsonb_build_object('ok',true,'id',v_after.id,'version',v_after.version);
end;
$$;

create or replace function public.anular_activacion_24h(
  p_id uuid,
  p_motivo text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.activaciones_24h%rowtype;
  v_after public.activaciones_24h%rowtype;
  v_primary boolean := public.es_administrador_principal();
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para anular incidencias 24H';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'Identificador no válido'; end if;
  if length(btrim(coalesce(p_motivo,''))) < 3 then raise exception 'Debes indicar el motivo de la anulación'; end if;

  select * into v_before from public.activaciones_24h where id=p_id for update;
  if v_before.id is null then raise exception 'Incidencia 24H no encontrada'; end if;
  if not v_primary and v_before.creado_por is distinct from v_actor then raise exception 'Solo puedes anular tus propias incidencias'; end if;
  if v_before.estado='anulada' then raise exception 'La incidencia ya está anulada'; end if;

  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.audit_origin','metrogestion-r1-24h-anulacion',true);

  update public.activaciones_24h a
  set estado='anulada',modificado_por=v_actor,actualizado_en=now(),version=a.version+1
  where id=p_id
  returning * into v_after;

  insert into public.activaciones_24h_historial(activacion_id,accion,motivo,datos_anteriores,datos_nuevos,usuario_id,request_id)
  values(p_id,'anulacion',btrim(p_motivo),to_jsonb(v_before),to_jsonb(v_after),v_actor,p_request_id);

  return jsonb_build_object('ok',true,'id',v_after.id,'version',v_after.version);
end;
$$;

create or replace function public.restaurar_activacion_24h(
  p_id uuid,
  p_motivo text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.activaciones_24h%rowtype;
  v_after public.activaciones_24h%rowtype;
  v_primary boolean := public.es_administrador_principal();
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para restaurar incidencias 24H';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'Identificador no válido'; end if;
  if length(btrim(coalesce(p_motivo,''))) < 3 then raise exception 'Debes indicar el motivo de la restauración'; end if;

  select * into v_before from public.activaciones_24h where id=p_id for update;
  if v_before.id is null then raise exception 'Incidencia 24H no encontrada'; end if;
  if not v_primary and v_before.creado_por is distinct from v_actor then raise exception 'Solo puedes restaurar tus propias incidencias'; end if;
  if v_before.estado <> 'anulada' then raise exception 'La incidencia no está anulada'; end if;

  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.audit_origin','metrogestion-r1-24h-restauracion',true);

  update public.activaciones_24h a
  set estado='abierta',modificado_por=v_actor,actualizado_en=now(),version=a.version+1
  where id=p_id
  returning * into v_after;

  insert into public.activaciones_24h_historial(activacion_id,accion,motivo,datos_anteriores,datos_nuevos,usuario_id,request_id)
  values(p_id,'restauracion',btrim(p_motivo),to_jsonb(v_before),to_jsonb(v_after),v_actor,p_request_id);

  return jsonb_build_object('ok',true,'id',v_after.id,'version',v_after.version);
end;
$$;

commit;
