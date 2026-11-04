-- MG75-SITUACION-OPERATIVA-001 · rollover canónico.
-- Antes de archivar la Pizarra se sincronizan todas sus fichas. Así:
--   * una ficha cerrada sin trabajo ni sustitución deja Activas;
--   * una ficha con sustitución todavía vigente continúa;
--   * estado y lugar se copian ya coherentes con la T operativa.

do $migration$
begin
  if to_regprocedure('app_private.crear_pizarra_diaria_sin_situacion_alpha75(date)') is null then
    alter function app_private.crear_pizarra_diaria(date)
      rename to crear_pizarra_diaria_sin_situacion_alpha75;
  end if;
end;
$migration$;

create or replace function app_private.crear_pizarra_diaria(p_fecha date)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_origen_id uuid;
  v_destino_id uuid;
  v_registro_id uuid;
begin
  select p.id
  into v_destino_id
  from public.pizarras p
  where p.fecha = p_fecha;

  if v_destino_id is not null then
    return v_destino_id;
  end if;

  select p.id
  into v_origen_id
  from public.pizarras p
  where p.fecha < p_fecha
    and p.estado <> 'anulada'
  order by p.fecha desc
  limit 1;

  if v_origen_id is null then
    raise exception 'No existe una pizarra anterior para copiar';
  end if;

  perform set_config(
    'app.request_id',
    'rollover_pre_' || to_char(p_fecha, 'YYYYMMDD'),
    true
  );
  perform set_config(
    'app.audit_origin',
    'metrogestion-r1-rollover-preflight',
    true
  );

  for v_registro_id in
    select r.id
    from public.registros_hotel r
    where r.pizarra_id = v_origen_id
      and not r.cancelado
      and not r.retirado_hotel_activo
    order by r.orden, r.id
  loop
    perform app_private.sincronizar_situacion_operativa_hotel_alpha75(
      v_registro_id,
      true
    );
  end loop;

  v_destino_id := app_private.crear_pizarra_diaria_sin_situacion_alpha75(
    p_fecha
  );

  for v_registro_id in
    select r.id
    from public.registros_hotel r
    where r.pizarra_id = v_destino_id
      and not r.cancelado
    order by r.orden, r.id
  loop
    perform app_private.sincronizar_situacion_operativa_hotel_alpha75(
      v_registro_id,
      true
    );
  end loop;

  return v_destino_id;
end;
$function$;
