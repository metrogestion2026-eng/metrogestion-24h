begin;

alter table public.activaciones_24h
  add column if not exists fecha_activacion date;

-- La carga histórica no debe disparar la creación de fichas para asistencias
-- antiguas. Solo completa su fecha con el día en que fueron registradas.
alter table public.activaciones_24h disable trigger user;
update public.activaciones_24h
set fecha_activacion = (creado_en at time zone 'Europe/Madrid')::date
where fecha_activacion is null;
alter table public.activaciones_24h enable trigger user;

alter table public.activaciones_24h
  alter column fecha_activacion set default ((clock_timestamp() at time zone 'Europe/Madrid')::date),
  alter column fecha_activacion set not null;

comment on column public.activaciones_24h.fecha_activacion is
  'Fecha real en que se activó la asistencia, aunque se registre posteriormente.';

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

create or replace function app_private.guardar_activacion_24h_con_fecha_alpha74(
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
  v_fecha date;
  v_version integer;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('activar24h') then
    raise exception 'No tienes permiso para activar 24H';
  end if;

  if p_id is null or p_payload ? 'fecha_activacion' then
    v_fecha := coalesce(
      nullif(p_payload->>'fecha_activacion', '')::date,
      (clock_timestamp() at time zone 'Europe/Madrid')::date
    );
  end if;

  v_result := app_private.guardar_activacion_24h(p_id, p_payload, p_request_id);
  v_id := (v_result->>'id')::uuid;

  if v_fecha is not null then
    update public.activaciones_24h a
    set fecha_activacion = v_fecha,
        modificado_por = auth.uid(),
        actualizado_en = clock_timestamp(),
        version = a.version + 1
    where a.id = v_id
      and a.fecha_activacion is distinct from v_fecha
    returning a.version into v_version;
  end if;

  return v_result || jsonb_build_object(
    'fecha_activacion', (select a.fecha_activacion from public.activaciones_24h a where a.id = v_id),
    'version', coalesce(v_version, (v_result->>'version')::integer)
  );
end;
$function$;

revoke all on function app_private.guardar_activacion_24h_con_fecha_alpha74(uuid, jsonb, text) from public, anon;
grant execute on function app_private.guardar_activacion_24h_con_fecha_alpha74(uuid, jsonb, text) to authenticated, service_role;

create or replace function public.guardar_activacion_24h(
  p_id uuid,
  p_payload jsonb,
  p_request_id text
) returns jsonb
language sql
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_activacion_24h_con_fecha_alpha74($1, $2, $3);
$function$;

revoke all on function public.guardar_activacion_24h(uuid, jsonb, text) from public, anon;
grant execute on function public.guardar_activacion_24h(uuid, jsonb, text) to authenticated, service_role;

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
  v_fin := case when new.hora_fin_reparacion is null then null else
    (new.fecha_activacion
      + case when new.hora_activacion is not null and new.hora_fin_reparacion < new.hora_activacion then 1 else 0 end
      + new.hora_fin_reparacion) at time zone 'Europe/Madrid' end;

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
        fecha_fin_real = case when fecha_fin_real is not null then coalesce(v_fin, fecha_fin_real) else null end,
        fecha_real = case when fecha_real is not null then coalesce(v_fin, fecha_real) else null end,
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

revoke all on function app_private.activacion_24h_sincronizar_fecha_alpha74() from public, anon, authenticated;

drop trigger if exists activaciones_24h_sincronizar_fecha_alpha74_trg on public.activaciones_24h;
create trigger activaciones_24h_sincronizar_fecha_alpha74_trg
after insert or update of fecha_activacion on public.activaciones_24h
for each row execute function app_private.activacion_24h_sincronizar_fecha_alpha74();

commit;
