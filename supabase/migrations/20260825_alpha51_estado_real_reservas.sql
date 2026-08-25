create or replace function app_private.calcular_estado_reserva_hotel(p_codigo text)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_pendientes text := '';
begin
  if v_codigo = '' then return 'libre'; end if;

  select coalesce(r.pendientes, '')
    into v_pendientes
  from public.reservas_hotel r
  where upper(btrim(r.vehiculo_codigo)) = v_codigo
  limit 1;

  if exists (
    select 1
    from public.registros_hotel h
    join public.pizarras p on p.id = h.pizarra_id
    where p.estado = 'en_curso'
      and not h.cancelado
      and not h.retirado_hotel_activo
      and h.estado not in ('reserva_liberada', 'recuperado', 'anulado')
      and upper(btrim(coalesce(h.vehiculo_sustituido, ''))) = v_codigo
  ) then
    return 'fuera_servicio';
  end if;

  if exists (
    select 1
    from public.registros_hotel h
    join public.pizarras p on p.id = h.pizarra_id
    where p.estado = 'en_curso'
      and not h.cancelado
      and not h.retirado_hotel_activo
      and h.estado not in ('reserva_liberada', 'recuperado', 'anulado')
      and upper(btrim(coalesce(h.vehiculo_reserva, ''))) = v_codigo
  ) then
    return 'ocupada';
  end if;

  if btrim(coalesce(v_pendientes, '')) <> '' then
    return 'disponible_con_pendientes';
  end if;

  return 'libre';
end;
$$;

create or replace function app_private.recalcular_estado_reserva_hotel(p_codigo text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_estado text;
begin
  if v_codigo = '' then return; end if;

  v_estado := app_private.calcular_estado_reserva_hotel(v_codigo);

  update public.reservas_hotel r
  set estado = v_estado,
      modificado_por = coalesce(auth.uid(), r.modificado_por)
  where upper(btrim(r.vehiculo_codigo)) = v_codigo
    and r.activo = true
    and r.estado is distinct from v_estado;
end;
$$;

create or replace function app_private.recalcular_estados_reservas_hotel()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actualizadas integer := 0;
begin
  with calculadas as (
    select r.id,
           app_private.calcular_estado_reserva_hotel(r.vehiculo_codigo) as estado_real
    from public.reservas_hotel r
    where r.activo = true
  )
  update public.reservas_hotel r
  set estado = c.estado_real,
      modificado_por = coalesce(auth.uid(), r.modificado_por)
  from calculadas c
  where r.id = c.id
    and r.estado is distinct from c.estado_real;

  get diagnostics v_actualizadas = row_count;
  return v_actualizadas;
end;
$$;

create or replace function app_private.sincronizar_reservas_desde_registro_hotel()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app_private.recalcular_estado_reserva_hotel(old.vehiculo_reserva);
    perform app_private.recalcular_estado_reserva_hotel(old.vehiculo_sustituido);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform app_private.recalcular_estado_reserva_hotel(new.vehiculo_reserva);
    perform app_private.recalcular_estado_reserva_hotel(new.vehiculo_sustituido);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists registros_hotel_sincronizar_reservas on public.registros_hotel;
create trigger registros_hotel_sincronizar_reservas
after insert or update or delete on public.registros_hotel
for each row execute function app_private.sincronizar_reservas_desde_registro_hotel();

create or replace function app_private.sincronizar_reservas_desde_pizarra()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and new.estado is not distinct from old.estado then
    return new;
  end if;

  perform app_private.recalcular_estados_reservas_hotel();

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists pizarras_sincronizar_reservas on public.pizarras;
create trigger pizarras_sincronizar_reservas
after insert or update or delete on public.pizarras
for each row execute function app_private.sincronizar_reservas_desde_pizarra();

create or replace function app_private.sincronizar_reserva_tras_cambio_catalogo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE'
     and new.vehiculo_codigo is not distinct from old.vehiculo_codigo
     and new.pendientes is not distinct from old.pendientes
     and new.activo is not distinct from old.activo then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    perform app_private.recalcular_estado_reserva_hotel(old.vehiculo_codigo);
  end if;
  perform app_private.recalcular_estado_reserva_hotel(new.vehiculo_codigo);
  return new;
end;
$$;

drop trigger if exists reservas_hotel_recalcular_estado_real on public.reservas_hotel;
create trigger reservas_hotel_recalcular_estado_real
after insert or update on public.reservas_hotel
for each row execute function app_private.sincronizar_reserva_tras_cambio_catalogo();

select app_private.recalcular_estados_reservas_hotel();
