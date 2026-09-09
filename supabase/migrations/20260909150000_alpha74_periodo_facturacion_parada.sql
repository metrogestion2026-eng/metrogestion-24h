begin;

-- Las filas PARADA nacen con el periodo de facturación abierto en Q. El valor
-- ya escrito por MANTENIMENT sigue siendo autoritativo y nunca se sobrescribe.
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

  -- La última copia de la pizarra es la autoridad del estado. No se excluyen las
  -- canceladas porque precisamente deben producir el comando ANULADA.
  select r.*, p.fecha as fecha_pizarra
    into v_ficha
  from public.registros_hotel r
  join public.pizarras p on p.id = r.pizarra_id
  where r.seguimiento_id = p_seguimiento_id
  order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
  limit 1;
  if not found then return null; end if;

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
    when v_sync.tancament <> '' then v_sync.fecha_corte
    when v_ficha.retirado_hotel_activo
         or v_ficha.estado in ('recuperado', 'reserva_liberada')
      then coalesce(v_ficha.fecha_retirado_hotel::date, v_ficha.fecha_pizarra)
    else null
  end;

  if v_sync.dias_parada_manual is not null then
    v_dias := v_sync.dias_parada_manual;
  elsif v_sync.tancament <> '' and v_fecha_k is not null then
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

comment on function app_private.manteniment_construir_payload_parada(uuid) is
  'Construye la orden PARADA y completa Q con el TANCAMENT del periodo abierto cuando todavía está vacío.';

commit;

