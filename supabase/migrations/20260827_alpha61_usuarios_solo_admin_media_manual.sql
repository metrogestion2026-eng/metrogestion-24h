begin;

-- Ningún perfil no administrador puede conservar o recibir acceso al módulo Usuarios.
update public.usuarios
set permisos = jsonb_set(
      coalesce(permisos, '{}'::jsonb),
      '{usuarios}',
      '{"ver":false,"editar":false}'::jsonb,
      true
    ),
    actualizado_en = now()
where tipo_usuario <> 'administrador_principal'
  and coalesce(permisos->'usuarios', '{}'::jsonb)
      is distinct from '{"ver":false,"editar":false}'::jsonb;

create or replace function app_private.forzar_usuarios_solo_administrador()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.tipo_usuario <> 'administrador_principal' then
    new.permisos := jsonb_set(
      coalesce(new.permisos, '{}'::jsonb),
      '{usuarios}',
      '{"ver":false,"editar":false}'::jsonb,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists usuarios_forzar_acceso_solo_admin on public.usuarios;
create trigger usuarios_forzar_acceso_solo_admin
before insert or update of tipo_usuario, permisos
on public.usuarios
for each row
execute function app_private.forzar_usuarios_solo_administrador();

-- Cada cuenta puede leer su propio perfil; la lista completa queda reservada al administrador principal.
drop policy if exists usuarios_select_own_primary_or_authorized on public.usuarios;
drop policy if exists usuarios_select_own_or_primary on public.usuarios;
create policy usuarios_select_own_or_primary
on public.usuarios
for select
to authenticated
using (
  id = auth.uid()
  or (
    public.dispositivo_autorizado()
    and public.es_administrador_principal()
  )
);

-- La media manual de sustitución queda reservada al administrador principal.
create or replace function public.guardar_km_dia_sustitucion(
  p_seguimiento_id uuid,
  p_km_dia numeric,
  p_observaciones text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_unidad text;
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede guardar una media manual de sustitución';
  end if;

  if p_km_dia is not null and (p_km_dia <= 0 or p_km_dia > 5000) then
    raise exception 'La media km/día debe estar entre 0 y 5000';
  end if;

  select r.vehiculo_sustituido
    into v_unidad
  from public.registros_hotel r
  where r.seguimiento_id = p_seguimiento_id
    and not r.cancelado
  order by r.actualizado_en desc
  limit 1;

  if not found then raise exception 'Parada no encontrada'; end if;
  if coalesce(v_unidad, '') ~ '^R' then raise exception 'Los R no usan media km/día'; end if;

  perform set_config('app.audit_origin', 'metrogestion-r1-substitution-manual', true);
  perform set_config('app.request_id', 'subst_' || replace(gen_random_uuid()::text, '-', ''), true);

  insert into public.ajustes_sustitucion_parada(
    seguimiento_id, km_dia_manual, observaciones, creado_por, modificado_por
  ) values (
    p_seguimiento_id, p_km_dia, coalesce(p_observaciones, ''), v_actor, v_actor
  )
  on conflict(seguimiento_id) do update
  set km_dia_manual = excluded.km_dia_manual,
      observaciones = excluded.observaciones,
      modificado_por = v_actor,
      actualizado_en = now();

  return jsonb_build_object(
    'ok', true,
    'seguimiento_id', p_seguimiento_id,
    'km_dia_manual', p_km_dia
  );
end;
$$;

-- El precio fijo de sustituciones R también queda reservado al administrador principal.
create or replace function public.guardar_precio_r_sustitucion(p_precio numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
     or not public.dispositivo_autorizado()
     or not public.es_administrador_principal() then
    raise exception 'Solo el administrador principal puede modificar la facturación de sustitución';
  end if;

  if p_precio is not null and (p_precio < 0 or p_precio > 100000) then
    raise exception 'Precio R fuera de rango';
  end if;

  update public.config_facturacion_sustituciones
  set precio_r_unidad = p_precio,
      actualizado_en = now(),
      actualizado_por = v_actor 
  where id = 1;

  if not found then
    insert into public.config_facturacion_sustituciones(
      id, precio_r_unidad, actualizado_en, actualizado_por
    ) values (1, p_precio, now(), v_actor);
  end if;

  return jsonb_build_object(
    'ok', true, 'precio_r_unidad', p_precio);
end;
$$;

commit;
