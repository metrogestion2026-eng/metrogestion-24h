-- MG75-MOVIMIENTO-TALLER-001
-- 1) Cualquier hito real nuevo avanza Entrada / movimiento sin retroceder.
-- 2) Una T física en curso con taller/centro asignado proyecta EN TALLER
--    aunque un legado la haya dejado con tipo_etapa='otro'.
-- No se altera Fecha real de parada: sigue siendo el inicio del episodio.

do $migration$
declare
  definition text := pg_get_functiondef(
    'app_private.proyectar_situacion_operativa_hotel_alpha75(uuid)'::regprocedure
  );
  old_where text := $old$  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.tipo_etapa = 'entrada_taller'
    and e.estado = 'en_curso'
    and e.fecha_inicio_real is not null
    and coalesce(e.fecha_fin_real, e.fecha_real) is null$old$;
  new_where text := $new$  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.estado = 'en_curso'
    and e.fecha_inicio_real is not null
    and coalesce(e.fecha_fin_real, e.fecha_real) is null
    and (
      e.tipo_etapa = 'entrada_taller'
      or (
        (e.taller_id is not null or e.centro_taller_id is not null)
        and lower(
          translate(
            btrim(coalesce(e.tipo_etapa,'')),
            'ÁÉÍÓÚÜÑáéíóúüñ',
            'AEIOUUNaeiouun'
          )
        ) not in (
          'tramite','gestion','24h',
          'recuperar_ruta','recuperar','recogida_taller'
        )
        and coalesce(e.accion_sistema,'') <> 'recuperar_y_liberar'
      )
    )$new$;
begin
  if (length(definition)-length(replace(definition,old_where,'')))
       / greatest(length(old_where),1) <> 1 then
    raise exception 'MG75-MOVIMIENTO-TALLER-001: ha cambiado el bloque de estancia de taller; revisar';
  end if;

  definition := replace(definition,old_where,new_where);
  definition := replace(
    definition,
    $$v_motivo := 'entrada_taller_en_curso';$$,
    $$v_motivo := 'estancia_taller_en_curso';$$
  );
  execute definition;
end;
$migration$;

create or replace function app_private.actualizar_fecha_movimiento_hotel_alpha75()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_registro_id uuid;
  v_movimiento timestamptz;
  v_actual timestamptz;
  v_prev_guard text;
  v_prev_origin text;
begin
  if tg_op = 'DELETE' then
    return null;
  end if;

  v_registro_id := new.registro_hotel_id;
  if v_registro_id is null then
    return null;
  end if;

  select max(m.ts)
  into v_movimiento
  from public.etapas_hotel e
  cross join lateral (
    values (e.fecha_inicio_real), (e.fecha_fin_real), (e.fecha_real)
  ) as m(ts)
  where e.registro_hotel_id = v_registro_id
    and not e.cancelado
    and m.ts is not null;

  if v_movimiento is null then
    return null;
  end if;

  select r.fecha_entrada
  into v_actual
  from public.registros_hotel r
  where r.id = v_registro_id;

  if not found
     or (v_actual is not null and v_actual >= v_movimiento) then
    return null;
  end if;

  v_prev_guard := current_setting('app.situacion_operativa_hotel', true);
  v_prev_origin := current_setting('app.audit_origin', true);

  perform set_config('app.situacion_operativa_hotel','1',true);
  if nullif(v_prev_origin,'') is null then
    perform set_config(
      'app.audit_origin',
      'metrogestion-r1-movimiento-hotel',
      true
    );
  end if;

  update public.registros_hotel
  set fecha_entrada = v_movimiento,
      modificado_por = coalesce(auth.uid(), modificado_por, creado_por)
  where id = v_registro_id
    and (fecha_entrada is null or fecha_entrada < v_movimiento);

  perform set_config(
    'app.situacion_operativa_hotel',
    coalesce(v_prev_guard,''),
    true
  );
  perform set_config(
    'app.audit_origin',
    coalesce(v_prev_origin,''),
    true
  );

  return null;
end;
$function$;

revoke all on function app_private.actualizar_fecha_movimiento_hotel_alpha75()
  from public, anon, authenticated;

drop trigger if exists zzzzz_etapas_hotel_fecha_movimiento_alpha75
  on public.etapas_hotel;

create trigger zzzzz_etapas_hotel_fecha_movimiento_alpha75
after insert or update of fecha_inicio_real,fecha_fin_real,fecha_real,cancelado
on public.etapas_hotel
for each row
execute function app_private.actualizar_fecha_movimiento_hotel_alpha75();

do $backfill$
declare
  v_id uuid;
begin
  perform set_config('app.request_id','movimiento_taller_20261110',true);
  perform set_config('app.audit_origin','metrogestion-r1-movimiento-taller',true);
  perform set_config('app.manteniment_importando_paradas','1',true);

  with ultimos as (
    select
      r.id,
      max(m.ts) as movimiento
    from public.registros_hotel r
    join public.pizarras p
      on p.id = r.pizarra_id
     and p.estado = 'en_curso'
    join public.etapas_hotel e
      on e.registro_hotel_id = r.id
     and not e.cancelado
    cross join lateral (
      values (e.fecha_inicio_real), (e.fecha_fin_real), (e.fecha_real)
    ) as m(ts)
    where m.ts is not null
    group by r.id
  )
  update public.registros_hotel r
  set fecha_entrada = u.movimiento,
      modificado_por = coalesce(auth.uid(),r.modificado_por,r.creado_por)
  from ultimos u
  where r.id = u.id
    and (r.fecha_entrada is null or r.fecha_entrada < u.movimiento);

  for v_id in
    select r.id
    from public.registros_hotel r
    join public.pizarras p on p.id=r.pizarra_id
    where p.estado='en_curso'
      and not r.cancelado
      and not r.retirado_hotel_activo
  loop
    perform app_private.sincronizar_situacion_operativa_hotel_alpha75(v_id,true);
  end loop;
end;
$backfill$;

do $check$
begin
  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p
      on p.id=r.pizarra_id and p.estado='en_curso'
    join public.etapas_hotel e
      on e.registro_hotel_id=r.id
     and not e.cancelado
     and e.estado='en_curso'
     and e.fecha_inicio_real is not null
     and coalesce(e.fecha_fin_real,e.fecha_real) is null
     and (e.taller_id is not null or e.centro_taller_id is not null)
     and lower(
       translate(
         btrim(coalesce(e.tipo_etapa,'')),
         'ÁÉÍÓÚÜÑáéíóúüñ',
         'AEIOUUNaeiouun'
       )
     ) not in (
       'tramite','gestion','24h',
       'recuperar_ruta','recuperar','recogida_taller'
     )
     and coalesce(e.accion_sistema,'') <> 'recuperar_y_liberar'
    where not r.cancelado
      and not r.retirado_hotel_activo
      and r.estado not in (
        'en_taller',
        'pendiente_diagnostico',
        'pendiente_autorizacion',
        'pendiente_repuestos'
      )
  ) then
    raise exception 'MG75-MOVIMIENTO-TALLER-001: queda una estancia física fuera de En taller';
  end if;

  if exists (
    select 1
    from public.registros_hotel r
    join public.pizarras p
      on p.id=r.pizarra_id and p.estado='en_curso'
    join lateral (
      select max(m.ts) as movimiento
      from public.etapas_hotel e
      cross join lateral (
        values (e.fecha_inicio_real), (e.fecha_fin_real), (e.fecha_real)
      ) as m(ts)
      where e.registro_hotel_id=r.id
        and not e.cancelado
        and m.ts is not null
    ) x on true
    where x.movimiento is not null
      and (r.fecha_entrada is null or r.fecha_entrada < x.movimiento)
  ) then
    raise exception 'MG75-MOVIMIENTO-TALLER-001: queda una cabecera con movimiento anterior al último hito real';
  end if;
end;
$check$;
