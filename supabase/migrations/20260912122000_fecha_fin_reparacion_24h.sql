begin;

alter table public.activaciones_24h
  add column if not exists fecha_fin_reparacion date;

-- La carga histórica solo completa el dato que antes se infería. No debe
-- reabrir, crear ni reconciliar fichas antiguas.
alter table public.activaciones_24h disable trigger user;

update public.activaciones_24h
set fecha_fin_reparacion = fecha_activacion
  + case
      when hora_activacion is not null
       and hora_fin_reparacion is not null
       and hora_fin_reparacion < hora_activacion then 1
      else 0
    end
where resultado = 'operativo_reparado'
  and fecha_fin_reparacion is null;

alter table public.activaciones_24h enable trigger user;

comment on column public.activaciones_24h.fecha_fin_reparacion is
  'Fecha real en que finalizó la reparación de la asistencia 24H.';

alter table public.activaciones_24h
  drop constraint if exists activaciones_24h_operativo_reparado_hora_ck;

alter table public.activaciones_24h
  add constraint activaciones_24h_operativo_reparado_fin_ck check (
    resultado <> 'operativo_reparado'
    or (
      fecha_fin_reparacion is not null
      and hora_fin_reparacion is not null
      and estado_operativo_confirmado
      and estado = 'cerrada'
      and fecha_fin_reparacion >= fecha_activacion
    )
  );

create or replace function app_private.guardar_activacion_24h(
  p_id uuid,
  p_payload jsonb,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
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
  v_fecha_activacion date := coalesce(
    nullif(p_payload->>'fecha_activacion','')::date,
    (clock_timestamp() at time zone 'Europe/Madrid')::date
  );
  v_fecha_fin_reparacion date := nullif(p_payload->>'fecha_fin_reparacion','')::date;
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
    if v_fecha_fin_reparacion is null then
      raise exception 'Debes indicar la fecha de fin de reparación';
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
    if v_fecha_fin_reparacion is not null and v_fecha_fin_reparacion < v_fecha_activacion then
      raise exception 'La fecha de fin no puede ser anterior a la activación';
    end if;

    insert into public.activaciones_24h(
      dfm,matricula,vehiculo_id,marca,modelo,bastidor,upc,km_actual,contrato_km,fin_contrato_fecha,cobertura_ok,
      conductor,telefono_conductor,ubicacion_tipo,ubicacion_referencia,carretera,punto_km,sentido,averia,codigo_alarma,color_alarma,semirremolque,carga,
      numero_caso,fecha_activacion,hora_activacion,eta_tecnico,proveedor,tecnico_llegado,hora_llegada,diagnostico_confirmado,diagnostico,reparado_carretera,trasladado_taller,taller_traslado,estado_operativo_confirmado,fecha_fin_reparacion,hora_fin_reparacion,resultado,estado,
      creado_por,modificado_por
    ) values(
      v_dfm,v_matricula,v_vehicle,upper(btrim(coalesce(p_payload->>'marca',''))),btrim(coalesce(p_payload->>'modelo','')),upper(btrim(coalesce(p_payload->>'bastidor',''))),upper(btrim(coalesce(p_payload->>'upc',''))),
      nullif(p_payload->>'km_actual','')::integer,nullif(p_payload->>'contrato_km','')::integer,nullif(p_payload->>'fin_contrato_fecha','')::date,coalesce((p_payload->>'cobertura_ok')::boolean,false),
      btrim(coalesce(p_payload->>'conductor','')),btrim(coalesce(p_payload->>'telefono_conductor','')),btrim(coalesce(p_payload->>'ubicacion_tipo','')),btrim(coalesce(p_payload->>'ubicacion_referencia','')),btrim(coalesce(p_payload->>'carretera','')),btrim(coalesce(p_payload->>'punto_km','')),btrim(coalesce(p_payload->>'sentido','')),btrim(coalesce(p_payload->>'averia','')),btrim(coalesce(p_payload->>'codigo_alarma','')),btrim(coalesce(p_payload->>'color_alarma','')),upper(btrim(coalesce(p_payload->>'semirremolque',''))),btrim(coalesce(p_payload->>'carga','')),
      btrim(coalesce(p_payload->>'numero_caso','')),v_fecha_activacion,nullif(p_payload->>'hora_activacion','')::time,nullif(p_payload->>'eta_tecnico','')::time,btrim(coalesce(p_payload->>'proveedor','')),coalesce((p_payload->>'tecnico_llegado')::boolean,false),nullif(p_payload->>'hora_llegada','')::time,coalesce((p_payload->>'diagnostico_confirmado')::boolean,false),btrim(coalesce(p_payload->>'diagnostico','')),v_resultado='operativo_reparado',coalesce((p_payload->>'trasladado_taller')::boolean,false),btrim(coalesce(p_payload->>'taller_traslado','')),v_operativo,v_fecha_fin_reparacion,v_hora_fin_reparacion,v_resultado,v_estado,
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
    if v_fecha_fin_reparacion is not null
       and v_fecha_fin_reparacion < (case when p_payload ? 'fecha_activacion'
         then v_fecha_activacion else v_existing.fecha_activacion end) then
      raise exception 'La fecha de fin no puede ser anterior a la activación';
    end if;

    update public.activaciones_24h a
    set numero_caso=btrim(coalesce(p_payload->>'numero_caso',a.numero_caso)),
        fecha_activacion=case when p_payload ? 'fecha_activacion' then v_fecha_activacion else a.fecha_activacion end,
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
        fecha_fin_reparacion=v_fecha_fin_reparacion,
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
$function$;

create or replace function app_private.cronologia_activacion_24h_alpha74(
  p_activacion public.activaciones_24h
) returns text
language plpgsql
stable
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_fecha date := coalesce(
    p_activacion.fecha_activacion,
    (p_activacion.creado_en at time zone 'Europe/Madrid')::date
  );
  v_ubicacion text;
  v_resultado text;
begin
  v_ubicacion := concat_ws(' · ',
    nullif(btrim(p_activacion.ubicacion_referencia), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(p_activacion.carretera), ''), nullif(btrim(p_activacion.punto_km), ''))), ''),
    nullif(btrim(p_activacion.sentido), '')
  );

  v_resultado := case p_activacion.resultado
    when 'operativo_reparado' then 'Reparación finalizada'
    when 'trasladado_taller' then 'Trasladado en grúa a taller'
    when 'seguimiento_abierto' then 'Seguimiento abierto'
    else nullif(btrim(replace(p_activacion.resultado, '_', ' ')), '')
  end;

  return concat_ws(E'\n',
    nullif('AVERÍA: ' || btrim(p_activacion.averia), 'AVERÍA: '),
    case when p_activacion.hora_activacion is not null
      then 'ACTIVACIÓN 24H: ' || to_char(v_fecha, 'DD/MM/YYYY') || ' ' || to_char(p_activacion.hora_activacion, 'HH24:MI') end,
    case when nullif(btrim(p_activacion.numero_caso), '') is not null
      then 'CASO: ' || btrim(p_activacion.numero_caso) end,
    case when v_ubicacion <> '' then 'UBICACIÓN: ' || v_ubicacion end,
    case when nullif(btrim(p_activacion.proveedor), '') is not null
      then 'PROVEEDOR: ' || btrim(p_activacion.proveedor) end,
    case when p_activacion.eta_tecnico is not null
      then 'LLEGADA PREVISTA DEL MECÁNICO: ' || to_char(p_activacion.eta_tecnico, 'HH24:MI') end,
    case when p_activacion.hora_llegada is not null
      then 'LLEGADA REAL DEL MECÁNICO: ' || to_char(p_activacion.hora_llegada, 'HH24:MI') end,
    case when nullif(btrim(p_activacion.diagnostico), '') is not null
      then 'DIAGNÓSTICO: ' || btrim(p_activacion.diagnostico) end,
    case when p_activacion.fecha_fin_reparacion is not null and p_activacion.hora_fin_reparacion is not null
      then 'FIN REAL DE REPARACIÓN: ' || to_char(p_activacion.fecha_fin_reparacion, 'DD/MM/YYYY')
        || ' ' || to_char(p_activacion.hora_fin_reparacion, 'HH24:MI') end,
    case when p_activacion.trasladado_taller and nullif(btrim(p_activacion.taller_traslado), '') is not null
      then 'TALLER DE TRASLADO: ' || btrim(p_activacion.taller_traslado) end,
    case when v_resultado is not null then 'RESULTADO: ' || v_resultado end
  );
end;
$function$;

create or replace function app_private.activacion_24h_sincronizar_fecha_alpha74()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_registro_id uuid := new.registro_hotel_id;
  v_seguimiento_id uuid;
  v_etapa_id uuid;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_cronologia text;
begin
  if v_registro_id is null then
    select a.registro_hotel_id into v_registro_id
    from public.activaciones_24h a
    where a.id = new.id;
  end if;
  if v_registro_id is null then return new; end if;

  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r
  where r.id = v_registro_id;

  v_cronologia := app_private.cronologia_activacion_24h_alpha74(new);
  v_inicio := case when new.hora_activacion is null then null else
    (new.fecha_activacion + new.hora_activacion) at time zone 'Europe/Madrid' end;
  v_fin := case
    when new.fecha_fin_reparacion is null or new.hora_fin_reparacion is null then null
    else (new.fecha_fin_reparacion + new.hora_fin_reparacion) at time zone 'Europe/Madrid'
  end;

  update public.registros_hotel
  set fecha_parada = new.fecha_activacion,
      modificado_por = coalesce(auth.uid(), modificado_por),
      version = version + 1,
      actualizado_en = clock_timestamp()
  where id = v_registro_id;

  update app_private.manteniment_parada_sync
  set fecha_programada_parada = new.fecha_activacion
  where seguimiento_id = v_seguimiento_id;

  select e.id into v_etapa_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_registro_id
    and not e.cancelado
    and regexp_replace(upper(e.nombre), '[^A-Z0-9]+', '', 'g') in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H')
  order by e.posicion, e.creado_en
  limit 1;

  if v_etapa_id is not null then
    update public.etapas_hotel
    set observaciones = v_cronologia,
        fecha_inicio_real = coalesce(v_inicio, fecha_inicio_real),
        fecha_fin_real = case when estado = 'realizada' then coalesce(v_fin, fecha_fin_real) else fecha_fin_real end,
        fecha_real = case when estado = 'realizada' then coalesce(v_fin, fecha_real) else fecha_real end,
        modificado_por = coalesce(auth.uid(), modificado_por),
        version = version + 1,
        actualizado_en = clock_timestamp()
    where id = v_etapa_id;

    update public.trabajos_etapa_hotel
    set observaciones = v_cronologia,
        modificado_por = coalesce(auth.uid(), modificado_por),
        version = version + 1,
        actualizado_en = clock_timestamp()
    where etapa_hotel_id = v_etapa_id
      and not cancelado
      and upper(btrim(tipo_trabajo)) in ('AV', 'AVERÍA', 'AVERIA');
  end if;

  return new;
end;
$function$;

drop trigger if exists activaciones_24h_sincronizar_fecha_alpha74_trg on public.activaciones_24h;
create trigger activaciones_24h_sincronizar_fecha_alpha74_trg
after insert or update of fecha_activacion, fecha_fin_reparacion, hora_fin_reparacion, resultado, estado
on public.activaciones_24h
for each row execute function app_private.activacion_24h_sincronizar_fecha_alpha74();

create or replace function app_private.guardar_activacion_24h_cierre_fecha_alpha75(
  p_id uuid,
  p_payload jsonb,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_result jsonb;
  v_id uuid;
  v_registro_id uuid;
  v_estado_hotel text;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;

  v_result := app_private.guardar_activacion_24h_operativa_alpha74(p_id, p_payload, p_request_id);
  v_id := (v_result->>'id')::uuid;

  select a.registro_hotel_id into v_registro_id
  from public.activaciones_24h a
  where a.id = v_id;

  if coalesce(p_payload->>'resultado', '') = 'operativo_reparado'
     and v_registro_id is not null
     and exists (
       select 1
       from public.registros_hotel r
       where r.id = v_registro_id
         and nullif(btrim(coalesce(r.vehiculo_reserva, '')), '') is not null
     )
     and exists (
       select 1
       from public.etapas_hotel e
       where e.registro_hotel_id = v_registro_id
         and not e.cancelado
         and e.accion_sistema = 'recuperar_y_liberar'
         and e.estado in ('pendiente', 'programada', 'en_curso')
     ) then
    update public.registros_hotel r
    set estado = 'recogido_pendiente_ruta',
        modificado_por = auth.uid(),
        actualizado_en = clock_timestamp(),
        version = r.version + 1
    where r.id = v_registro_id
      and r.estado is distinct from 'recogido_pendiente_ruta';
  end if;

  select r.estado into v_estado_hotel
  from public.registros_hotel r
  where r.id = v_registro_id;

  return v_result || jsonb_build_object(
    'fecha_fin_reparacion', (select a.fecha_fin_reparacion from public.activaciones_24h a where a.id = v_id),
    'estado_hotel', v_estado_hotel
  );
end;
$function$;

revoke all on function app_private.guardar_activacion_24h_cierre_fecha_alpha75(uuid, jsonb, text) from public, anon;
grant execute on function app_private.guardar_activacion_24h_cierre_fecha_alpha75(uuid, jsonb, text) to authenticated, service_role;

create or replace function public.guardar_activacion_24h(
  p_id uuid,
  p_payload jsonb,
  p_request_id text
) returns jsonb
language sql
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_activacion_24h_cierre_fecha_alpha75($1, $2, $3);
$function$;

revoke all on function public.guardar_activacion_24h(uuid, jsonb, text) from public, anon;
grant execute on function public.guardar_activacion_24h(uuid, jsonb, text) to authenticated, service_role;

commit;
