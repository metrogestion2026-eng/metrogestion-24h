begin;

create or replace function app_private.vehiculo_asegurar_ficha_reserva()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,app_private
as $function$
declare
  v_es_reserva boolean;
  v_era_reserva boolean := false;
  v_actor uuid;
begin
  v_es_reserva :=
    coalesce(new.activo,false)
    and (
      coalesce(new.reserva,false)
      or upper(btrim(coalesce(new.asignacion_manteniment,''))) like '%RESERVA%'
    );

  if not v_es_reserva then
    return new;
  end if;

  if tg_op='UPDATE' then
    v_era_reserva :=
      coalesce(old.activo,false)
      and (
        coalesce(old.reserva,false)
        or upper(btrim(coalesce(old.asignacion_manteniment,''))) like '%RESERVA%'
      );
  end if;

  v_actor := coalesce(auth.uid(),new.alta_manual_por);

  insert into public.reservas_hotel(
    vehiculo_codigo,matricula,etiqueta,estado,ubicacion,pendientes,
    activo,fecha_alta,fecha_baja,creado_por,modificado_por
  )
  values(
    regexp_replace(upper(btrim(coalesce(new.dfm,''))),'[[:space:]]+','','g'),
    regexp_replace(upper(btrim(coalesce(new.matricula,''))),'[[:space:]]+','','g'),
    '',
    'libre',
    '',
    '',
    true,
    coalesce(new.fecha_alta_manteniment,new.fecha_matriculacion,current_date),
    null,
    v_actor,
    v_actor
  )
  on conflict (vehiculo_codigo) do update
  set matricula=excluded.matricula,
      fecha_alta=coalesce(public.reservas_hotel.fecha_alta,excluded.fecha_alta),
      activo=case when not v_era_reserva then true else public.reservas_hotel.activo end,
      fecha_baja=case when not v_era_reserva then null else public.reservas_hotel.fecha_baja end,
      modificado_por=coalesce(excluded.modificado_por,public.reservas_hotel.modificado_por)
  where public.reservas_hotel.matricula is distinct from excluded.matricula
     or public.reservas_hotel.fecha_alta is null
     or (not v_era_reserva and not public.reservas_hotel.activo);

  return new;
end;
$function$;

revoke all on function app_private.vehiculo_asegurar_ficha_reserva()
from public,anon,authenticated;

drop trigger if exists vehiculos_reserva_asegurar_catalogo on public.vehiculos;
create trigger vehiculos_reserva_asegurar_catalogo
after insert or update of dfm,matricula,reserva,asignacion_manteniment,activo,fecha_alta_manteniment
on public.vehiculos
for each row execute function app_private.vehiculo_asegurar_ficha_reserva();

-- Recupera únicamente huecos ya existentes. No modifica fichas de reserva
-- presentes ni sus campos manuales (etiqueta, ubicación, pendientes).
insert into public.reservas_hotel(
  vehiculo_codigo,matricula,etiqueta,estado,ubicacion,pendientes,
  activo,fecha_alta,fecha_baja,creado_por,modificado_por
)
select
  regexp_replace(upper(btrim(v.dfm)),'[[:space:]]+','','g'),
  regexp_replace(upper(btrim(coalesce(v.matricula,''))),'[[:space:]]+','','g'),
  '',
  'libre',
  '',
  '',
  true,
  coalesce(v.fecha_alta_manteniment,v.fecha_matriculacion,current_date),
  null,
  v.alta_manual_por,
  v.alta_manual_por
from public.vehiculos v
where v.activo
  and (
    coalesce(v.reserva,false)
    or upper(btrim(coalesce(v.asignacion_manteniment,''))) like '%RESERVA%'
  )
on conflict (vehiculo_codigo) do nothing;

comment on function app_private.vehiculo_asegurar_ficha_reserva() is
  'Registro es la identidad: todo vehículo activo marcado RESERVA garantiza su ficha de reservas_hotel sin duplicarla ni sobrescribir campos manuales.';

commit;
