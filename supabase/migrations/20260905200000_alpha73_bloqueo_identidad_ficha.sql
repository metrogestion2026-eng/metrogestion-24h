-- Alpha73: impide que el editor completo guarde datos sobre una ficha distinta
-- de la que se abrió, aunque ambas hayan utilizado la misma reserva.

create or replace function app_private.guardar_ficha_hotel_edicion_alpha73(
  p_registro_id uuid,
  p_version integer,
  p_ficha jsonb,
  p_etapas jsonb,
  p_identidad jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_actual public.registros_hotel%rowtype;
  v_etapa jsonb;
  v_trabajo jsonb;
  v_saved jsonb;
begin
  if auth.uid() is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_identidad) <> 'object'
    or octet_length(p_identidad::text) > 4000 then
    raise exception 'La identidad de la ficha no es válida'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_etapas) <> 'array' then
    raise exception 'La lista de T no es válida'
      using errcode = '22023';
  end if;

  select r.* into v_actual
  from public.registros_hotel r
  where r.id = p_registro_id
  for update;
  if not found then
    raise exception 'Ficha de Hotel no encontrada'
      using errcode = 'P0002';
  end if;

  if coalesce(p_identidad->>'registro_id', '') <> v_actual.id::text
    or coalesce(p_identidad->>'seguimiento_id', '') <> v_actual.seguimiento_id::text
    or coalesce(p_identidad->>'pizarra_id', '') <> v_actual.pizarra_id::text
    or btrim(coalesce(p_identidad->>'numero_parada', ''))
         <> btrim(coalesce(v_actual.numero_parada, ''))
    or upper(btrim(coalesce(p_identidad->>'vehiculo_sustituido', '')))
         <> upper(btrim(coalesce(v_actual.vehiculo_sustituido, '')))
    or upper(btrim(coalesce(p_identidad->>'matricula_sustituido', '')))
         <> upper(btrim(coalesce(v_actual.matricula_sustituido, '')))
    or upper(btrim(coalesce(p_identidad->>'vehiculo_reserva', '')))
         <> upper(btrim(coalesce(v_actual.vehiculo_reserva, '')))
    or upper(btrim(coalesce(p_identidad->>'matricula_reserva', '')))
         <> upper(btrim(coalesce(v_actual.matricula_reserva, ''))) then
    raise exception 'La identidad de la ficha ha cambiado. Cierra y vuelve a abrirla antes de guardar.'
      using errcode = '40001';
  end if;

  for v_etapa in select value from jsonb_array_elements(p_etapas) loop
    if nullif(v_etapa->>'id', '') is not null
      and not exists (
        select 1
        from public.etapas_hotel e
        where e.id::text = v_etapa->>'id'
          and e.registro_hotel_id = p_registro_id
      ) then
      raise exception 'Una T no pertenece a la ficha abierta. Recarga antes de guardar.'
        using errcode = '40001';
    end if;

    if jsonb_typeof(coalesce(v_etapa->'trabajos', '[]'::jsonb)) <> 'array' then
      raise exception 'La lista de trabajos de una T no es válida'
        using errcode = '22023';
    end if;
    for v_trabajo in
      select value
      from jsonb_array_elements(coalesce(v_etapa->'trabajos', '[]'::jsonb))
    loop
      if nullif(v_trabajo->>'id', '') is not null
        and not exists (
          select 1
          from public.trabajos_etapa_hotel t
          join public.etapas_hotel e on e.id = t.etapa_hotel_id
          where t.id::text = v_trabajo->>'id'
            and t.etapa_hotel_id::text = v_etapa->>'id'
            and e.registro_hotel_id = p_registro_id
        ) then
        raise exception 'Un trabajo no pertenece a la T y ficha abiertas. Recarga antes de guardar.'
          using errcode = '40001';
      end if;
    end loop;
  end loop;

  v_saved := app_private.guardar_ficha_hotel_edicion_alpha72(
    p_registro_id,
    p_version,
    p_ficha,
    p_etapas,
    p_request_id
  );
  return v_saved || jsonb_build_object('identidad_validada', true);
end;
$function$;

create or replace function public.guardar_ficha_hotel_edicion_alpha73(
  p_registro_id uuid,
  p_version integer,
  p_ficha jsonb,
  p_etapas jsonb,
  p_identidad jsonb,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $function$
  select app_private.guardar_ficha_hotel_edicion_alpha73($1, $2, $3, $4, $5, $6);
$function$;

revoke all on function app_private.guardar_ficha_hotel_edicion_alpha73(uuid, integer, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function app_private.guardar_ficha_hotel_edicion_alpha73(uuid, integer, jsonb, jsonb, jsonb, text)
  to authenticated, service_role;

revoke all on function public.guardar_ficha_hotel_edicion_alpha73(uuid, integer, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.guardar_ficha_hotel_edicion_alpha73(uuid, integer, jsonb, jsonb, jsonb, text)
  to authenticated, service_role;

-- Corrección de datos localizada y auditable. Las dos líneas procedentes de
-- la intervención anterior de R1304 se conservan canceladas, nunca se borran.
select set_config('app.request_id', 'repair-r1443-notes-20260905', true);
select set_config('app.audit_origin', 'metrogestion-alpha73-reparacion-integridad', true);
select set_config(
  'app.audit_reason',
  'Datos de R1304 mezclados accidentalmente en la ficha R1443; corrección exacta y reversible',
  true
);

update public.anotaciones_manuales_hotel n
set cancelada = true,
    motivo_cancelacion = 'Anotación perteneciente a R1304, incorporada por error a R1443',
    cancelada_en = clock_timestamp(),
    cancelada_por = n.autor_id,
    modificado_por = n.autor_id,
    modificador_nombre = n.autor_nombre,
    version = n.version + 1,
    actualizado_en = clock_timestamp()
from public.registros_hotel r
where r.id = n.registro_origen_id
  and upper(btrim(coalesce(r.vehiculo_sustituido, ''))) = 'R1443'
  and btrim(coalesce(r.numero_parada, '')) = '2600151'
  and upper(btrim(coalesce(r.vehiculo_reserva, ''))) = 'R1269'
  and n.origen = 'importada'
  and n.autor_id is not null
  and not n.cancelada
  and n.texto in (
    '-04/09/26 reparado tapa de filtro suelta.',
    '-04/09/26 recuperado.'
  );
