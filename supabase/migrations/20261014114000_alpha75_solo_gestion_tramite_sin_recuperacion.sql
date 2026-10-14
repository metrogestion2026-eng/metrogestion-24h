-- Alpha75 · GESTIÓN/TRÁMITE solitario no genera recuperación.
-- Corrige una regresión posterior a 20260910074500: la protección no debe
-- depender de que la T proceda de MANTENIMENT.

create or replace function app_private.modalidad_hotel_requiere_recuperacion(p_registro_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_codigo text;
  v_comportamiento text;
  v_seguimiento_id uuid;
  v_tipo_movimiento text;
  v_total_operativas integer := 0;
  v_no_administrativas integer := 0;
begin
  v_codigo := nullif(btrim(coalesce(current_setting('app.hotel_modalidad_operativa', true), '')), '');

  select coalesce(v_codigo, nullif(btrim(r.modalidad_operativa), '')),
         r.seguimiento_id,
         upper(btrim(coalesce(r.tipo_movimiento, '')))
    into v_codigo, v_seguimiento_id, v_tipo_movimiento
  from public.registros_hotel r
  where r.id = p_registro_id;

  if not found then
    return false;
  end if;

  if v_tipo_movimiento = '24H' then
    return true;
  end if;

  select count(*),
         count(*) filter (
           where lower(translate(btrim(coalesce(e.tipo_etapa, '')),
                                 'ÁÉÍÓÚÜÑáéíóúüñ',
                                 'AEIOUUNaeiouun'))
                 not in ('gestion', 'tramite')
         )
    into v_total_operativas, v_no_administrativas
  from public.etapas_hotel e
  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and coalesce(e.accion_sistema, '') <> 'recuperar_y_liberar';

  if v_total_operativas > 0 and v_no_administrativas = 0 then
    return false;
  end if;

  if exists (
       select 1 from app_private.manteniment_t_visitas v
       where v.seguimiento_id = v_seguimiento_id
     )
     and not exists (
       select 1 from app_private.manteniment_t_visitas v
       where v.seguimiento_id = v_seguimiento_id
         and v.modalidad not in ('tramite', 'gestion')
     ) then
    return false;
  end if;

  if v_codigo is null then
    return true;
  end if;

  select c.comportamiento
    into v_comportamiento
  from public.catalogo_modalidades_operativas_hotel c
  where c.codigo = v_codigo
    and c.activo = true;

  if v_comportamiento is null or v_comportamiento = 'manual' then
    return true;
  end if;

  if v_comportamiento in ('sin_sustitucion', 'reparado_en_ruta', 'reserva_en_reparacion') then
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function app_private.modalidad_hotel_requiere_recuperacion(uuid)
  from public, anon, authenticated;

select set_config('app.reconciliando_etapas', '1', true);
select set_config('app.audit_origin', 'alpha75-solo-gestion-tramite-sin-recuperacion', true);

update public.etapas_hotel recovery
set cancelado = true,
    estado = 'anulada',
    estado_catalogo_codigo = 'anulada',
    motivo_cancelacion = 'GESTIÓN/TRÁMITE solitario: no corresponde recuperación de tractora/ruta.',
    cancelado_en = clock_timestamp(),
    cancelado_por = coalesce(recovery.modificado_por, recovery.creado_por),
    modificado_por = coalesce(recovery.modificado_por, recovery.creado_por),
    actualizado_en = clock_timestamp(),
    version = recovery.version + 1
where not recovery.cancelado
  and recovery.accion_sistema = 'recuperar_y_liberar'
  and recovery.estado <> 'realizada'
  and exists (
    select 1
    from public.etapas_hotel admin_stage
    where admin_stage.registro_hotel_id = recovery.registro_hotel_id
      and not admin_stage.cancelado
      and coalesce(admin_stage.accion_sistema, '') <> 'recuperar_y_liberar'
  )
  and not exists (
    select 1
    from public.etapas_hotel other_stage
    where other_stage.registro_hotel_id = recovery.registro_hotel_id
      and not other_stage.cancelado
      and coalesce(other_stage.accion_sistema, '') <> 'recuperar_y_liberar'
      and lower(translate(btrim(coalesce(other_stage.tipo_etapa, '')),
                          'ÁÉÍÓÚÜÑáéíóúüñ',
                          'AEIOUUNaeiouun'))
          not in ('gestion', 'tramite')
  );

select set_config('app.reconciliando_etapas', '0', true);

comment on function app_private.modalidad_hotel_requiere_recuperacion(uuid) is
  'Una ficha exclusivamente administrativa (GESTIÓN/TRÁMITE), venga de MANTENIMENT o se cree en Metrogestión, no genera recuperación. 24H y T físicas conservan su flujo operativo.';
