begin;

alter table public.activaciones_24h
  add column if not exists estado_seguimiento text not null default 'en_curso',
  add column if not exists vehiculo_sustituto text not null default '',
  add column if not exists matricula_sustituto text not null default '';

alter table public.activaciones_24h
  drop constraint if exists activaciones_24h_estado_seguimiento_ck;
alter table public.activaciones_24h
  add constraint activaciones_24h_estado_seguimiento_ck check (
    estado_seguimiento in (
      'en_curso', 'pendiente_diagnostico', 'pendiente_presupuesto',
      'pendiente_autorizacion', 'pendiente_repuestos', 'en_reparacion'
    )
  );

comment on column public.activaciones_24h.estado_seguimiento is
  'Situación operativa visible de la asistencia y de su ficha de Pizarra.';
comment on column public.activaciones_24h.vehiculo_sustituto is
  'DFM del vehículo asignado como sustituto durante la asistencia.';
comment on column public.activaciones_24h.matricula_sustituto is
  'Matrícula del vehículo asignado como sustituto durante la asistencia.';

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
  v_situacion text;
  v_sustituto text;
begin
  v_ubicacion := concat_ws(' · ',
    nullif(btrim(p_activacion.ubicacion_referencia), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(p_activacion.carretera), ''), nullif(btrim(p_activacion.punto_km), ''))), ''),
    nullif(btrim(p_activacion.sentido), '')
  );

  v_resultado := case p_activacion.resultado
    when 'operativo_reparado' then 'Reparado en carretera'
    when 'trasladado_taller' then 'Trasladado en grúa a taller'
    when 'necesita_sustitucion' then 'Necesita vehículo de sustitución'
    when 'seguimiento_abierto' then 'Seguimiento abierto'
    else nullif(btrim(replace(p_activacion.resultado, '_', ' ')), '')
  end;
  v_situacion := case p_activacion.estado_seguimiento
    when 'en_curso' then 'En curso'
    when 'pendiente_diagnostico' then 'Pendiente de diagnóstico'
    when 'pendiente_presupuesto' then 'Pendiente de presupuesto'
    when 'pendiente_autorizacion' then 'Pendiente de autorización'
    when 'pendiente_repuestos' then 'Pendiente de repuestos'
    when 'en_reparacion' then 'En reparación'
    else null
  end;
  v_sustituto := concat_ws(' · ',
    case when nullif(btrim(p_activacion.vehiculo_sustituto), '') is not null
      then 'DFM ' || btrim(p_activacion.vehiculo_sustituto) end,
    nullif(upper(btrim(p_activacion.matricula_sustituto)), '')
  );

  return concat_ws(E'\n',
    nullif('AVERÍA: ' || btrim(p_activacion.averia), 'AVERÍA: '),
    case when p_activacion.hora_activacion is not null
      then 'ACTIVACIÓN 24H: ' || to_char(v_fecha, 'DD/MM/YYYY') || ' ' || to_char(p_activacion.hora_activacion, 'HH24:MI') end,
    case when v_situacion is not null then 'SITUACIÓN ACTUAL: ' || v_situacion end,
    case when nullif(btrim(p_activacion.numero_caso), '') is not null
      then 'CASO: ' || btrim(p_activacion.numero_caso) end,
    case when v_sustituto <> '' then 'VEHÍCULO SUSTITUTO: ' || v_sustituto end,
    case when v_ubicacion <> '' then 'UBICACIÓN: ' || v_ubicacion end,
    case when nullif(btrim(p_activacion.proveedor), '') is not null
      then 'PROVEEDOR: ' || btrim(p_activacion.proveedor) end,
    case when p_activacion.eta_tecnico is not null
      then 'LLEGADA PREVISTA DEL MECÁNICO: ' || to_char(p_activacion.eta_tecnico, 'HH24:MI') end,
    case when p_activacion.hora_llegada is not null
      then 'LLEGADA REAL DEL MECÁNICO: ' || to_char(p_activacion.hora_llegada, 'HH24:MI') end,
    case when nullif(btrim(p_activacion.diagnostico), '') is not null
      then 'DIAGNÓSTICO: ' || btrim(p_activacion.diagnostico) end,
    case when p_activacion.hora_fin_reparacion is not null
      then 'HORA REAL DE FIN: ' || to_char(p_activacion.hora_fin_reparacion, 'HH24:MI') end,
    case when p_activacion.trasladado_taller and nullif(btrim(p_activacion.taller_traslado), '') is not null
      then 'TALLER DE TRASLADO: ' || btrim(p_activacion.taller_traslado) end,
    case when v_resultado is not null then 'RESULTADO: ' || v_resultado end
  );
end;
$function$;

revoke all on function app_private.cronologia_activacion_24h_alpha74(public.activaciones_24h) from public, anon, authenticated;

create or replace function app_private.guardar_activacion_24h_operativa_alpha74(
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
  v_seguimiento_id uuid;
  v_version integer;
  v_resultado text := coalesce(nullif(btrim(p_payload->>'resultado'), ''), 'seguimiento_abierto');
  v_situacion text := coalesce(nullif(btrim(p_payload->>'estado_seguimiento'), ''), 'en_curso');
  v_sustituto text := btrim(coalesce(p_payload->>'vehiculo_sustituto', ''));
  v_matricula text := upper(btrim(coalesce(p_payload->>'matricula_sustituto', '')));
  v_tipo_sustituto text := '';
  v_etiqueta text := '';
  v_sustituto_catalogo text;
  v_matricula_catalogo text;
  v_estado_hotel text;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;
  if v_situacion not in (
    'en_curso', 'pendiente_diagnostico', 'pendiente_presupuesto',
    'pendiente_autorizacion', 'pendiente_repuestos', 'en_reparacion'
  ) then
    raise exception 'La situación actual de la asistencia no es válida';
  end if;
  if v_resultado = 'necesita_sustitucion' and v_sustituto = '' and v_matricula = '' then
    raise exception 'Debes indicar el DFM o la matrícula del vehículo sustituto';
  end if;

  v_result := app_private.guardar_activacion_24h_con_fecha_alpha74(p_id, p_payload, p_request_id);
  v_id := (v_result->>'id')::uuid;

  update public.activaciones_24h a
  set estado_seguimiento = v_situacion,
      vehiculo_sustituto = case when v_resultado = 'necesita_sustitucion' then v_sustituto else a.vehiculo_sustituto end,
      matricula_sustituto = case when v_resultado = 'necesita_sustitucion' then v_matricula else a.matricula_sustituto end,
      modificado_por = auth.uid(),
      actualizado_en = clock_timestamp(),
      version = a.version + 1
  where a.id = v_id
  returning a.registro_hotel_id, a.seguimiento_hotel_id, a.version
    into v_registro_id, v_seguimiento_id, v_version;

  if v_resultado = 'necesita_sustitucion' then
    select coalesce(v.tipo_sustituto_catalogo, ''), coalesce(v.etiqueta_reserva, ''),
           v.dfm, v.matricula
      into v_tipo_sustituto, v_etiqueta, v_sustituto_catalogo, v_matricula_catalogo
    from public.vehiculos_hotel_autocompletar v
    where (v_sustituto <> '' and upper(btrim(v.dfm)) = upper(v_sustituto))
       or (v_matricula <> '' and upper(btrim(v.matricula)) = v_matricula)
    order by case when v_sustituto <> '' and upper(btrim(v.dfm)) = upper(v_sustituto) then 0 else 1 end
    limit 1;

    v_sustituto := coalesce(nullif(v_sustituto, ''), v_sustituto_catalogo, '');
    v_matricula := coalesce(nullif(v_matricula, ''), v_matricula_catalogo, '');
    v_tipo_sustituto := coalesce(nullif(v_tipo_sustituto, ''), 'FLOTA');

    update public.activaciones_24h a
    set vehiculo_sustituto = v_sustituto,
        matricula_sustituto = v_matricula,
        modificado_por = auth.uid(),
        actualizado_en = clock_timestamp(),
        version = a.version + 1
    where a.id = v_id
    returning a.version into v_version;
  end if;

  v_estado_hotel := case v_situacion
    when 'pendiente_diagnostico' then 'pendiente_diagnostico'
    when 'pendiente_presupuesto' then 'pendiente_autorizacion'
    when 'pendiente_autorizacion' then 'pendiente_autorizacion'
    when 'pendiente_repuestos' then 'pendiente_repuestos'
    when 'en_reparacion' then 'en_taller'
    else 'asistencia_24h'
  end;

  if v_registro_id is not null then
    update public.registros_hotel r
    set estado = v_estado_hotel,
        vehiculo_reserva = case when v_resultado = 'necesita_sustitucion' then v_sustituto else r.vehiculo_reserva end,
        matricula_reserva = case when v_resultado = 'necesita_sustitucion' then v_matricula else r.matricula_reserva end,
        etiqueta_reserva = case when v_resultado = 'necesita_sustitucion' then v_etiqueta else r.etiqueta_reserva end,
        tipo_sustituto = case when v_resultado = 'necesita_sustitucion' then v_tipo_sustituto else r.tipo_sustituto end,
        sustitucion_temporal = case when v_resultado = 'necesita_sustitucion' then true else r.sustitucion_temporal end,
        motivo_sustitucion_temporal = case when v_resultado = 'necesita_sustitucion'
          then 'Vehículo sustituto asignado desde el seguimiento 24H' else r.motivo_sustitucion_temporal end,
        modalidad_operativa = case when v_resultado = 'necesita_sustitucion'
          then 'reserva_en_reparacion' else r.modalidad_operativa end,
        modificado_por = auth.uid(),
        actualizado_en = clock_timestamp(),
        version = r.version + 1
    where r.id = v_registro_id;

    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;

  return v_result || jsonb_build_object(
    'version', v_version,
    'estado_seguimiento', v_situacion,
    'vehiculo_sustituto', v_sustituto,
    'matricula_sustituto', v_matricula,
    'estado_hotel', v_estado_hotel
  );
end;
$function$;

revoke all on function app_private.guardar_activacion_24h_operativa_alpha74(uuid, jsonb, text) from public, anon;
grant execute on function app_private.guardar_activacion_24h_operativa_alpha74(uuid, jsonb, text) to authenticated, service_role;

create or replace function public.guardar_activacion_24h(
  p_id uuid,
  p_payload jsonb,
  p_request_id text
) returns jsonb
language sql
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_activacion_24h_operativa_alpha74($1, $2, $3);
$function$;

revoke all on function public.guardar_activacion_24h(uuid, jsonb, text) from public, anon;
grant execute on function public.guardar_activacion_24h(uuid, jsonb, text) to authenticated, service_role;

commit;
