begin;

alter table public.activaciones_24h
  add column if not exists hora_fin_reparacion time without time zone;

alter table public.activaciones_24h
  drop constraint if exists activaciones_24h_operativo_reparado_hora_ck;

alter table public.activaciones_24h
  add constraint activaciones_24h_operativo_reparado_hora_ck
  check (
    resultado <> 'operativo_reparado'
    or (
      hora_fin_reparacion is not null
      and estado_operativo_confirmado
      and estado = 'cerrada'
    )
  );

create or replace function app_private.guardar_activacion_24h(
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
  v_resultado text := coalesce(nullif(btrim(p_payload->>'resultado'),''),'seguimiento_abierto');
  v_operativo boolean := coalesce((p_payload->>'estado_operativo_confirmado')::boolean,false);
  v_hora_fin_reparacion time := nullif(p_payload->>'hora_fin_reparacion','')::time;
  v_estado text;
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

  if v_resultado = 'operativo_reparado' then
    if not v_operativo then
      raise exception 'Debes confirmar que el vehículo está operativo y reparado';
    end if;
    if v_hora_fin_reparacion is null then
      raise exception 'Debes indicar la hora de fin de reparación';
    end if;
    v_estado := 'cerrada';
  else
    v_estado := 'abierta';
  end if;

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
      numero_caso,hora_activacion,eta_tecnico,proveedor,tecnico_llegado,hora_llegada,diagnostico_confirmado,diagnostico,reparado_carretera,trasladado_taller,taller_traslado,estado_operativo_confirmado,hora_fin_reparacion,resultado,estado,
      creado_por,modificado_por
    ) values(
      v_dfm,v_matricula,v_vehicle,upper(btrim(coalesce(p_payload->>'marca',''))),btrim(coalesce(p_payload->>'modelo','')),upper(btrim(coalesce(p_payload->>'bastidor',''))),upper(btrim(coalesce(p_payload->>'upc',''))),
      nullif(p_payload->>'km_actual','')::integer,nullif(p_payload->>'contrato_km','')::integer,nullif(p_payload->>'fin_contrato_fecha','')::date,coalesce((p_payload->>'cobertura_ok')::boolean,false),
      btrim(coalesce(p_payload->>'conductor','')),btrim(coalesce(p_payload->>'telefono_conductor','')),btrim(coalesce(p_payload->>'ubicacion_tipo','')),btrim(coalesce(p_payload->>'ubicacion_referencia','')),btrim(coalesce(p_payload->>'carretera','')),btrim(coalesce(p_payload->>'punto_km','')),btrim(coalesce(p_payload->>'sentido','')),btrim(coalesce(p_payload->>'averia','')),btrim(coalesce(p_payload->>'codigo_alarma','')),btrim(coalesce(p_payload->>'color_alarma','')),upper(btrim(coalesce(p_payload->>'semirremolque',''))),btrim(coalesce(p_payload->>'carga','')),
      btrim(coalesce(p_payload->>'numero_caso','')),nullif(p_payload->>'hora_activacion','')::time,nullif(p_payload->>'eta_tecnico','')::time,btrim(coalesce(p_payload->>'proveedor','')),coalesce((p_payload->>'tecnico_llegado')::boolean,false),nullif(p_payload->>'hora_llegada','')::time,coalesce((p_payload->>'diagnostico_confirmado')::boolean,false),btrim(coalesce(p_payload->>'diagnostico','')),v_resultado='operativo_reparado',coalesce((p_payload->>'trasladado_taller')::boolean,false),btrim(coalesce(p_payload->>'taller_traslado','')),v_operativo,v_hora_fin_reparacion,v_resultado,v_estado,
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
        eta_tecnico=case when p_payload ? 'eta_tecnico' then nullif(p_payload->>'eta_tecnico','')::time else a.eta_tecnico end,
        proveedor=btrim(coalesce(p_payload->>'proveedor',a.proveedor)),
        tecnico_llegado=coalesce((p_payload->>'tecnico_llegado')::boolean,a.tecnico_llegado),
        hora_llegada=case when p_payload ? 'hora_llegada' then nullif(p_payload->>'hora_llegada','')::time else a.hora_llegada end,
        diagnostico_confirmado=coalesce((p_payload->>'diagnostico_confirmado')::boolean,a.diagnostico_confirmado),
        diagnostico=btrim(coalesce(p_payload->>'diagnostico',a.diagnostico)),
        reparado_carretera=(v_resultado='operativo_reparado'),
        trasladado_taller=coalesce((p_payload->>'trasladado_taller')::boolean,a.trasladado_taller),
        taller_traslado=btrim(coalesce(p_payload->>'taller_traslado',a.taller_traslado)),
        estado_operativo_confirmado=v_operativo,
        hora_fin_reparacion=v_hora_fin_reparacion,
        resultado=v_resultado,
        estado=v_estado,
        modificado_por=v_actor,
        actualizado_en=now(),
        version=a.version+1
    where a.id=p_id
    returning id,version into v_id,v_version;
  end if;

  return jsonb_build_object('ok',true,'id',v_id,'version',v_version);
end;
$$;

comment on column public.activaciones_24h.hora_fin_reparacion is
  'Hora obligatoria cuando el resultado de Activar 24H es vehículo operativo/reparado.';

revoke all on function app_private.guardar_activacion_24h(uuid, jsonb, text) from public, anon;
grant execute on function app_private.guardar_activacion_24h(uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.guardar_activacion_24h(uuid, jsonb, text) from public, anon;
grant execute on function public.guardar_activacion_24h(uuid, jsonb, text) to authenticated, service_role;

commit;
