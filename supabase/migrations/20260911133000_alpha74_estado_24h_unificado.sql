begin;

-- El estado general de Hotel/Pizarra es una clasificación operativa compartida.
-- El detalle del seguimiento (diagnóstico, repuestos, autorización...) permanece
-- en activaciones_24h.estado_seguimiento y no debe convertir por sí solo la
-- ficha en "En taller".
create or replace function app_private.normalizar_estado_taller_24h_alpha74()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  if upper(btrim(coalesce(new.tipo_movimiento, ''))) = '24H'
     and new.estado in (
       'en_taller',
       'pendiente_diagnostico',
       'pendiente_autorizacion',
       'pendiente_repuestos'
     )
     and not exists (
       select 1
       from public.etapas_hotel e
       where e.registro_hotel_id = new.id
         and not e.cancelado
         and e.tipo_etapa = 'entrada_taller'
         and e.estado = 'realizada'
     )
  then
    new.estado := 'asistencia_24h';
  end if;
  return new;
end;
$function$;

revoke all on function app_private.normalizar_estado_taller_24h_alpha74()
  from public, anon, authenticated;

-- La T de entrada es el único hecho que cambia una asistencia 24H a taller.
-- Si se reabre/anula esa entrada, la ficha vuelve automáticamente a 24H.
create or replace function app_private.sincronizar_estado_24h_desde_entrada_alpha74()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_registro_id uuid;
  v_registro public.registros_hotel%rowtype;
  v_tiene_entrada_realizada boolean;
  v_estado_taller text;
begin
  v_registro_id := case
    when tg_op = 'DELETE' then old.registro_hotel_id
    else new.registro_hotel_id
  end;

  select r.* into v_registro
  from public.registros_hotel r
  where r.id = v_registro_id
  for update;

  if not found
     or upper(btrim(coalesce(v_registro.tipo_movimiento, ''))) <> '24H'
  then
    return coalesce(new, old);
  end if;

  select exists (
    select 1
    from public.etapas_hotel e
    where e.registro_hotel_id = v_registro_id
      and not e.cancelado
      and e.tipo_etapa = 'entrada_taller'
      and e.estado = 'realizada'
  ) into v_tiene_entrada_realizada;

  if v_tiene_entrada_realizada and v_registro.estado = 'asistencia_24h' then
    select case a.estado_seguimiento
      when 'pendiente_diagnostico' then 'pendiente_diagnostico'
      when 'pendiente_autorizacion' then 'pendiente_autorizacion'
      when 'pendiente_repuestos' then 'pendiente_repuestos'
      else 'en_taller'
    end
      into v_estado_taller
    from public.activaciones_24h a
    where coalesce(a.estado, '') <> 'anulada'
      and (a.registro_hotel_id = v_registro_id
           or a.seguimiento_hotel_id = v_registro.seguimiento_id)
    order by (a.registro_hotel_id = v_registro_id) desc,
             a.actualizado_en desc, a.creado_en desc
    limit 1;

    update public.registros_hotel
    set estado = coalesce(v_estado_taller, 'en_taller')
    where id = v_registro_id;
  elsif not v_tiene_entrada_realizada
        and v_registro.estado in (
          'en_taller',
          'pendiente_diagnostico',
          'pendiente_autorizacion',
          'pendiente_repuestos'
        )
  then
    update public.registros_hotel
    set estado = 'asistencia_24h'
    where id = v_registro_id;
  end if;

  return coalesce(new, old);
end;
$function$;

revoke all on function app_private.sincronizar_estado_24h_desde_entrada_alpha74()
  from public, anon, authenticated;

drop trigger if exists etapas_hotel_sincronizar_estado_24h_alpha74_trg
  on public.etapas_hotel;
create trigger etapas_hotel_sincronizar_estado_24h_alpha74_trg
after insert or delete or update of estado, cancelado, tipo_etapa
on public.etapas_hotel
for each row execute function app_private.sincronizar_estado_24h_desde_entrada_alpha74();

-- Corrige todas las fichas activas existentes, incluido el DFM 2625.
select set_config('app.audit_origin', 'alpha74:estado-24h-unificado', true);

update public.registros_hotel r
set estado = 'asistencia_24h'
where upper(btrim(coalesce(r.tipo_movimiento, ''))) = '24H'
  and r.estado in (
    'en_taller',
    'pendiente_diagnostico',
    'pendiente_autorizacion',
    'pendiente_repuestos'
  )
  and not r.cancelado
  and not r.retirado_hotel_activo
  and not exists (
    select 1
    from public.etapas_hotel e
    where e.registro_hotel_id = r.id
      and not e.cancelado
      and e.tipo_etapa = 'entrada_taller'
      and e.estado = 'realizada'
  );

comment on function app_private.normalizar_estado_taller_24h_alpha74() is
  'Fuente única del estado general 24H: no es taller hasta realizar la T de entrada.';

comment on function app_private.sincronizar_estado_24h_desde_entrada_alpha74() is
  'Sincroniza Hotel, Panel y Pizarra cuando se realiza o se deshace una entrada de una asistencia 24H.';

commit;
