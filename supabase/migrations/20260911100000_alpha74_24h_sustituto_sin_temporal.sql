begin;

-- El vehículo indicado en el seguimiento 24H es el sustituto normal de la
-- parada. No debe activar "sustitución temporal", porque esa opción manual
-- exige motivo y fecha límite propios.
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

commit;

