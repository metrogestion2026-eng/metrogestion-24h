-- Alpha 74: cada activación 24H genera y mantiene su ficha de Pizarra.
-- La ficha nace con la T de avería y la T final de recuperación. Entrada y
-- recogida siguen siendo responsabilidad del reconciliador cuando hay grúa.

create or replace function app_private.cronologia_activacion_24h_alpha74(
  p_activacion public.activaciones_24h
) returns text
language plpgsql
stable
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_fecha date := (p_activacion.creado_en at time zone 'Europe/Madrid')::date;
  v_ubicacion text;
  v_resultado text;
begin
  v_ubicacion := concat_ws(' · ',
    nullif(btrim(p_activacion.ubicacion_referencia), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(p_activacion.carretera), ''), nullif(btrim(p_activacion.punto_km), ''))), ''),
    nullif(btrim(p_activacion.sentido), '')
  );

  v_resultado := case p_activacion.resultado
    when 'operativo_reparado' then 'Reparado en carretera'
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
    case when p_activacion.hora_fin_reparacion is not null
      then 'HORA REAL DE FIN: ' || to_char(p_activacion.hora_fin_reparacion, 'HH24:MI') end,
    case when p_activacion.trasladado_taller and nullif(btrim(p_activacion.taller_traslado), '') is not null
      then 'TALLER DE TRASLADO: ' || btrim(p_activacion.taller_traslado) end,
    case when v_resultado is not null then 'RESULTADO: ' || v_resultado end
  );
end;
$function$;

revoke all on function app_private.cronologia_activacion_24h_alpha74(public.activaciones_24h) from public, anon, authenticated;

create or replace function app_private.activacion_24h_asegurar_ficha_alpha74()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_created jsonb;
  v_registro_id uuid := new.registro_hotel_id;
  v_seguimiento_id uuid := new.seguimiento_hotel_id;
  v_etapa_24h_id uuid;
  v_fecha_base date := (new.creado_en at time zone 'Europe/Madrid')::date;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_lugar text;
  v_cronologia text;
  v_cerrada boolean;
begin
  -- La actualización interna que guarda el vínculo vuelve a pasar por este
  -- trigger. Al recibir ya los identificadores solo sincroniza el contenido.
  if v_registro_id is null then
    v_lugar := coalesce(
      nullif(btrim(new.ubicacion_referencia), ''),
      nullif(btrim(concat_ws(' ', nullif(btrim(new.carretera), ''), nullif(btrim(new.punto_km), ''))), ''),
      ''
    );
    v_cronologia := app_private.cronologia_activacion_24h_alpha74(new);

    v_created := app_private.crear_ficha_hotel_con_etapas_alpha72(
      jsonb_build_object(
        'numero_parada', '',
        'vehiculo_sustituido', new.dfm,
        'matricula_sustituido', new.matricula,
        'vehiculo_reserva', '',
        'matricula_reserva', '',
        'etiqueta_reserva', '',
        'modalidad_operativa', 'sin_sustitucion',
        'tipo_unidad', '',
        'marca', new.marca,
        'tipo_motor', '',
        'modelo', new.modelo,
        'upc', new.upc,
        'telefono', new.telefono_conductor,
        'prioridad', 5,
        'estado', 'asistencia_24h',
        'lugar', v_lugar,
        'fecha_programada_parada', v_fecha_base,
        'fecha_parada', v_fecha_base,
        'fecha_entrada', '',
        'tipo_movimiento', '24H',
        'causa', new.averia,
        'trabajos_reserva', '',
        'incidencia', new.numero_caso,
        'proximo', '',
        'observaciones', 'Ficha creada automáticamente desde Activar 24H.',
        'sustitucion_temporal', false,
        'motivo_sustitucion_temporal', '',
        'fecha_limite_sustitucion', '',
        'orden', 0,
        'retirado_hotel_activo', false,
        'cancelado', false,
        'motivo_cancelacion', '',
        'manteniment_fecha_corte', '',
        'manteniment_tancament', '',
        'anotaciones_manuales', '[]'::jsonb
      ),
      jsonb_build_array(
        jsonb_build_object(
          'id', '', 'version', '', 'nombre', '24H · Avería', 'posicion', 1,
          'estado', 'en_curso', 'estado_catalogo_codigo', 'en_curso',
          'tipo_etapa', 'otro', 'taller_id', '', 'centro_taller_id', '',
          'taller_nombre', '', 'centro_nombre', '', 'lugar', v_lugar,
          'fecha_prevista', '', 'fecha_inicio_real', '', 'fecha_fin_real', '', 'fecha_real', '',
          'observaciones', v_cronologia, 'cancelado', false, 'motivo_cancelacion', '',
          'trabajos', jsonb_build_array(jsonb_build_object(
            'id', '', 'version', '', 'tipo_trabajo', 'AV', 'categoria_tecnica', '24H',
            'motivo_entrada', new.averia, 'diagnostico_real', new.diagnostico,
            'km_averia', coalesce(new.km_actual::text, ''), 'expediente', new.numero_caso,
            'descripcion', new.averia, 'peritaje_estado', '', 'observaciones', v_cronologia,
            'cancelado', false, 'motivo_cancelacion', ''
          ))
        ),
        jsonb_build_object(
          'id', '', 'version', '', 'nombre', 'Recuperar ruta y liberar reserva', 'posicion', 2,
          'estado', 'pendiente', 'estado_catalogo_codigo', 'pendiente',
          'tipo_etapa', 'recuperar_ruta', 'taller_id', '', 'centro_taller_id', '',
          'taller_nombre', '', 'centro_nombre', '', 'lugar', '',
          'fecha_prevista', '', 'fecha_inicio_real', '', 'fecha_fin_real', '', 'fecha_real', '',
          'observaciones', 'Generada automáticamente como T final de cierre.',
          'cancelado', false, 'motivo_cancelacion', '', 'trabajos', '[]'::jsonb
        )
      ),
      'activar24h_' || replace(new.id::text, '-', '')
    );

    v_registro_id := (v_created->>'id')::uuid;
    select r.seguimiento_id into v_seguimiento_id
    from public.registros_hotel r where r.id = v_registro_id;

    update public.activaciones_24h
    set registro_hotel_id = v_registro_id,
        seguimiento_hotel_id = v_seguimiento_id,
        modificado_por = coalesce(auth.uid(), modificado_por)
    where id = new.id
      and registro_hotel_id is null;
  end if;

  if v_registro_id is null then
    return new;
  end if;

  v_cronologia := app_private.cronologia_activacion_24h_alpha74(new);
  v_lugar := coalesce(
    nullif(btrim(new.ubicacion_referencia), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(new.carretera), ''), nullif(btrim(new.punto_km), ''))), ''),
    ''
  );
  v_inicio := case when new.hora_activacion is null then null else
    (v_fecha_base + new.hora_activacion) at time zone 'Europe/Madrid' end;
  v_fin := case when new.hora_fin_reparacion is null then null else
    (v_fecha_base + case when new.hora_activacion is not null and new.hora_fin_reparacion < new.hora_activacion then 1 else 0 end + new.hora_fin_reparacion)
      at time zone 'Europe/Madrid' end;
  v_cerrada := new.estado = 'cerrada'
    or new.resultado in ('operativo_reparado', 'trasladado_taller');

  select e.id into v_etapa_24h_id
  from public.etapas_hotel e
  where e.registro_hotel_id = v_registro_id
    and not e.cancelado
    and regexp_replace(upper(e.nombre), '[^A-Z0-9]+', '', 'g') in ('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H')
  order by e.posicion, e.creado_en
  limit 1;

  if v_etapa_24h_id is not null then
    update public.etapas_hotel
    set nombre = '24H · Avería',
        lugar = v_lugar,
        observaciones = v_cronologia,
        fecha_inicio_real = coalesce(fecha_inicio_real, v_inicio),
        fecha_fin_real = case when v_cerrada then coalesce(v_fin, fecha_fin_real, clock_timestamp()) else fecha_fin_real end,
        fecha_real = case when v_cerrada then coalesce(v_fin, fecha_real, clock_timestamp()) else fecha_real end,
        estado = case when v_cerrada then 'realizada' else estado end,
        estado_catalogo_codigo = case when v_cerrada then 'realizada' else estado_catalogo_codigo end,
        modificado_por = coalesce(auth.uid(), modificado_por),
        version = version + 1,
        actualizado_en = clock_timestamp()
    where id = v_etapa_24h_id;

    update public.trabajos_etapa_hotel
    set motivo_entrada = new.averia,
        diagnostico_real = new.diagnostico,
        expediente = new.numero_caso,
        descripcion = new.averia,
        observaciones = v_cronologia,
        km_averia = coalesce(new.km_actual, km_averia),
        modificado_por = coalesce(auth.uid(), modificado_por),
        version = version + 1,
        actualizado_en = clock_timestamp()
    where etapa_hotel_id = v_etapa_24h_id
      and not cancelado
      and upper(btrim(tipo_trabajo)) in ('AV', 'AVERÍA', 'AVERIA');
  end if;

  update public.registros_hotel
  set causa = new.averia,
      incidencia = new.numero_caso,
      lugar = v_lugar,
      modificado_por = coalesce(auth.uid(), modificado_por),
      version = version + 1,
      actualizado_en = clock_timestamp()
  where id = v_registro_id;

  return new;
end;
$function$;

revoke all on function app_private.activacion_24h_asegurar_ficha_alpha74() from public, anon, authenticated;

drop trigger if exists activaciones_24h_asegurar_ficha_alpha74_trg on public.activaciones_24h;
create trigger activaciones_24h_asegurar_ficha_alpha74_trg
after insert or update on public.activaciones_24h
for each row execute function app_private.activacion_24h_asegurar_ficha_alpha74();

