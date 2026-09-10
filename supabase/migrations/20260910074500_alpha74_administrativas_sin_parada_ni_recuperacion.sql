begin;

-- El numero de actuacion existe siempre, pero la fila PARADA de MANTENIMENT
-- representa una sustitucion real. Sin sustituto no se publica esa fila.
create or replace function app_private.manteniment_construir_payload_parada(p_seguimiento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_sync app_private.manteniment_parada_sync%rowtype;
  v_ficha record;
  v_resumen record;
  v_periodo record;
  v_fecha_k date;
  v_dias integer;
  v_km numeric;
  v_anulada boolean;
  v_tancament_payload text;
begin
  select * into v_sync
  from app_private.manteniment_parada_sync
  where seguimiento_id = p_seguimiento_id;
  if not found then return null; end if;

  select r.*, p.fecha as fecha_pizarra
    into v_ficha
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.seguimiento_id = p_seguimiento_id
  order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
  limit 1;
  if not found then return null; end if;

  -- Una actuacion sin sustituto conserva su numero en Hotel, pero no tiene
  -- linea PARADA en MANTENIMENT.
  if btrim(coalesce(v_ficha.vehiculo_reserva, '')) = '' then
    return null;
  end if;

  v_anulada := coalesce(v_ficha.cancelado, false) or v_ficha.estado = 'anulado';

  v_tancament_payload := btrim(coalesce(v_sync.tancament, ''));
  if v_tancament_payload = '' and not v_anulada then
    select 'TANCAMENT ' || (split_part(c.periodo, '-', 2)::integer)::text
      into v_tancament_payload
    from public.cierres_facturacion c
    where (clock_timestamp() at time zone 'Europe/Madrid')::date
          between c.fecha_inicio and c.fecha_cierre
    order by c.fecha_inicio desc
    limit 1;
    v_tancament_payload := coalesce(v_tancament_payload, '');
  end if;

  select * into v_resumen
  from public.paradas_sustitucion_resumen
  where seguimiento_id = p_seguimiento_id;

  v_fecha_k := case
    when v_ficha.retirado_hotel_activo
         or v_ficha.estado in ('recuperado', 'reserva_liberada')
      then coalesce(v_sync.fecha_corte, v_ficha.fecha_retirado_hotel::date, v_ficha.fecha_pizarra)
    when btrim(coalesce(v_sync.tancament, '')) <> '' then v_sync.fecha_corte
    else null
  end;

  if v_sync.dias_parada_manual is not null then
    v_dias := v_sync.dias_parada_manual;
  elsif btrim(coalesce(v_sync.tancament, '')) <> '' and v_fecha_k is not null then
    select c.* into v_periodo
    from public.cierres_facturacion c
    where v_fecha_k between c.fecha_inicio and c.fecha_cierre
    order by c.fecha_inicio desc
    limit 1;
    v_dias := greatest(
      0,
      v_fecha_k - greatest(
        coalesce(v_resumen.fecha_inicio_parada, v_ficha.fecha_parada, v_ficha.fecha_pizarra),
        coalesce(v_periodo.fecha_inicio, coalesce(v_resumen.fecha_inicio_parada, v_ficha.fecha_parada, v_ficha.fecha_pizarra))
      ) + 1
    );
  else
    v_dias := coalesce(v_resumen.dias_parada_total, 0);
  end if;

  v_km := coalesce(
    v_sync.km_facturables_manual,
    case when v_resumen.km_dia is not null then round(v_dias::numeric * v_resumen.km_dia, 2) end
  );

  return jsonb_build_object(
    'sync_id', v_sync.sync_id,
    'seguimiento_id', p_seguimiento_id,
    'dfm', coalesce(v_ficha.vehiculo_sustituido, ''),
    'matricula', coalesce(v_ficha.matricula_sustituido, ''),
    'tipo', coalesce(v_ficha.tipo_unidad, ''),
    'upc', coalesce(v_ficha.upc, ''),
    'numero_parada', case
      when btrim(coalesce(v_ficha.numero_parada, '')) = '' then ''
      else 'PA-' || btrim(v_ficha.numero_parada)
    end,
    'sustituto', coalesce(v_ficha.vehiculo_reserva, ''),
    'estado', case when v_anulada then 'ANULADA' else 'PARADA' end,
    'fecha_programada', v_sync.fecha_programada_parada,
    'fecha_parada', v_ficha.fecha_parada,
    'fecha_k', v_fecha_k,
    'dias_parada', v_dias,
    'marca', coalesce(v_ficha.marca, ''),
    'km_facturables', v_km,
    'tancament', v_tancament_payload,
    'tancament_supervisado', case
      when btrim(coalesce(v_sync.tancament, '')) = '' then false
      else v_sync.tancament_supervisado
    end
  );
end;
$function$;

revoke all on function app_private.manteniment_construir_payload_parada(uuid)
  from public, anon, authenticated;

create or replace function app_private.manteniment_encolar_parada(p_seguimiento_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_payload jsonb;
  v_sync_id uuid;
begin
  v_payload := app_private.manteniment_construir_payload_parada(p_seguimiento_id);
  if v_payload is null then
    -- Evita que una orden antigua vuelva a crear una PARADA sin sustituto.
    delete from app_private.manteniment_parada_outbox
    where seguimiento_id = p_seguimiento_id;
    return;
  end if;
  if btrim(coalesce(v_payload->>'numero_parada', '')) = '' then return; end if;
  v_payload := jsonb_set(
    v_payload,
    '{trabajos_asignados}',
    app_private.manteniment_trabajos_asignados(p_seguimiento_id),
    true
  );
  v_sync_id := (v_payload->>'sync_id')::uuid;

  insert into app_private.manteniment_parada_outbox(
    seguimiento_id, sync_id, revision, estado, payload, actualizado_en, confirmado_en, ultimo_error
  ) values (
    p_seguimiento_id, v_sync_id, 1, 'pendiente', v_payload, clock_timestamp(), null, ''
  )
  on conflict (seguimiento_id) do update
  set sync_id = excluded.sync_id,
      revision = app_private.manteniment_parada_outbox.revision + 1,
      estado = 'pendiente',
      payload = excluded.payload,
      actualizado_en = clock_timestamp(),
      confirmado_en = null,
      ultimo_error = '';
end;
$function$;

revoke all on function app_private.manteniment_encolar_parada(uuid)
  from public, anon, authenticated;

-- Una ficha formada exclusivamente por TRAMITE/GESTION es administrativa:
-- no inmoviliza ni requiere una T final de recuperacion.
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
  v_seguimiento_id uuid;
  v_total integer:=0;
  v_pendientes integer:=0;
  v_ultima_fecha date;
  v_hoy date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
begin
  v_codigo:=nullif(btrim(coalesce(current_setting('app.hotel_modalidad_operativa',true),'')),'');
  select coalesce(v_codigo,nullif(btrim(r.modalidad_operativa),'')),r.fecha_parada,r.seguimiento_id
    into v_codigo,v_fecha_parada,v_seguimiento_id
  from public.registros_hotel r where r.id=p_registro_id;

  if exists (
       select 1 from app_private.manteniment_t_visitas v
       where v.seguimiento_id=v_seguimiento_id
     )
     and not exists (
       select 1 from app_private.manteniment_t_visitas v
       where v.seguimiento_id=v_seguimiento_id
         and v.modalidad not in ('tramite','gestion')
     ) then
    return false;
  end if;

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
  from public, anon, authenticated;

-- Corrige las fichas administrativas que ya recibieron la T final antigua.
select set_config('app.reconciliando_etapas', '1', true);
select set_config('app.audit_origin', 'alpha74-administrativas-sin-recuperacion', true);

update public.etapas_hotel e
set cancelado = true,
    estado = 'anulada',
    estado_catalogo_codigo = 'anulada',
    motivo_cancelacion = 'Trámite/Gestión: no corresponde recuperación de ruta.',
    cancelado_en = clock_timestamp(),
    cancelado_por = coalesce(e.modificado_por, e.creado_por),
    actualizado_en = clock_timestamp(),
    version = e.version + 1
from public.registros_hotel r
where r.id = e.registro_hotel_id
  and not e.cancelado
  and e.accion_sistema = 'recuperar_y_liberar'
  and exists (
    select 1 from app_private.manteniment_t_visitas v
    where v.seguimiento_id = r.seguimiento_id
  )
  and not exists (
    select 1 from app_private.manteniment_t_visitas v
    where v.seguimiento_id = r.seguimiento_id
      and v.modalidad not in ('tramite','gestion')
  );

-- LKT y EXTINTOR conservan la etiqueta de TRAMITE aunque G tuviera GESTION.
update public.etapas_hotel e
set nombre = 'Trámite · ' || w.designacion,
    actualizado_en = clock_timestamp(),
    version = e.version + 1
from public.trabajos_etapa_hotel t
join app_private.manteniment_t_trabajos w on w.trabajo_hotel_id = t.id
join app_private.manteniment_t_visitas v on v.id = w.visita_id
where e.id = t.etapa_hotel_id
  and not e.cancelado
  and v.modalidad = 'tramite'
  and upper(btrim(w.designacion)) in ('LKT','EXTINTOR')
  and e.nombre is distinct from 'Trámite · ' || w.designacion;

-- Elimina cualquier orden pendiente sin sustituto. El numero de actuacion y
-- la ficha permanecen intactos.
delete from app_private.manteniment_parada_outbox o
using public.registros_hotel r
where r.seguimiento_id = o.seguimiento_id
  and btrim(coalesce(r.vehiculo_reserva, '')) = '';

update app_private.manteniment_parada_sync s
set fila_manteniment = null,
    ultimo_payload_confirmado = '{}'::jsonb,
    actualizado_en = clock_timestamp()
from public.registros_hotel r
where r.seguimiento_id = s.seguimiento_id
  and btrim(coalesce(r.vehiculo_reserva, '')) = '';

select set_config('app.reconciliando_etapas', '0', true);

comment on function app_private.manteniment_construir_payload_parada(uuid) is
  'Solo publica PARADA en MANTENIMENT cuando la ficha tiene sustituto real.';

commit;
