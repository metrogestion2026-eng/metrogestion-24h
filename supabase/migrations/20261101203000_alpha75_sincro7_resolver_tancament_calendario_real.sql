-- SINCRO 7 · resolver periodo contable por fin real/corte del tramo.
-- K manda para cierres terminados; J se usa para cierres abiertos.
-- El texto TANCAMENT se conserva como fuente aunque sea histórico/discordante.

do $do$
declare
  v_def text;
  v_old text := $old$
    -- J identifica el tramo y desambigua el año. Si K sigue vacía porque la
    -- recuperación física aún no existe, el cierre contable usa el último día
    -- del periodo, exactamente como TANCAMENT.
    select c.* into v_periodo
    from public.cierres_facturacion c
    where v_fecha_j between c.fecha_inicio and c.fecha_cierre
      and v_tancament =
        'TANCAMENT ' || (split_part(c.periodo,'-',2)::integer)::text
    order by c.fecha_inicio desc
    limit 1;
    if not found then
      if v_fecha_j < (select min(c.fecha_inicio) from public.cierres_facturacion c) then
        -- Histórico anterior al calendario de cierres configurado: se conserva
        -- en MANTENIMENT pero no se incorpora a esta capa contable.
        continue;
      end if;
      raise exception 'No se puede resolver el periodo de % / J=% en fila %',
        v_tancament, v_fecha_j, coalesce(v_item->>'fila','?');
    end if;

    if v_fecha_k is null and v_periodo.fecha_cierre >= (now() at time zone 'Europe/Madrid')::date then
      -- Periodo todavía abierto: no se congela en el histórico contable.
      continue;
    end if;
    v_fecha_k := coalesce(v_fecha_k, v_periodo.fecha_cierre);
    if v_fecha_k < v_fecha_j or v_fecha_k > v_periodo.fecha_cierre then
      raise exception 'Fin contable inválido en fila %: J=% K=% cierre=%',
        coalesce(v_item->>'fila','?'), v_fecha_j, v_fecha_k, v_periodo.fecha_cierre;
    end if;
$old$;
  v_new text := $new$
    -- Un cierre terminado pertenece al periodo en el que cae K (fin/corte del
    -- tramo). El rótulo TANCAMENT se usa primero como confirmación, pero un
    -- rótulo histórico discordante no debe cambiar las fechas reales.
    if v_fecha_k is not null then
      select c.* into v_periodo
      from public.cierres_facturacion c
      where v_fecha_k between c.fecha_inicio and c.fecha_cierre
        and v_tancament =
          'TANCAMENT ' || (split_part(c.periodo,'-',2)::integer)::text
      order by c.fecha_inicio desc
      limit 1;

      if not found then
        select c.* into v_periodo
        from public.cierres_facturacion c
        where v_fecha_k between c.fecha_inicio and c.fecha_cierre
        order by c.fecha_inicio desc
        limit 1;
      end if;
    else
      -- Sin K todavía, J identifica el tramo abierto. Se admite el día de
      -- frontera compartido con el periodo anterior cuando el rótulo acredita
      -- explícitamente el periodo siguiente.
      select c.* into v_periodo
      from public.cierres_facturacion c
      where (v_fecha_j between c.fecha_inicio and c.fecha_cierre
             or v_fecha_j = c.fecha_inicio - 1)
        and v_tancament =
          'TANCAMENT ' || (split_part(c.periodo,'-',2)::integer)::text
      order by c.fecha_inicio desc
      limit 1;

      if not found then
        select c.* into v_periodo
        from public.cierres_facturacion c
        where v_fecha_j between c.fecha_inicio and c.fecha_cierre
        order by c.fecha_inicio desc
        limit 1;
      end if;
    end if;

    if not found then
      if least(v_fecha_j,coalesce(v_fecha_k,v_fecha_j))
           < (select min(c.fecha_inicio) from public.cierres_facturacion c) then
        -- Histórico anterior al calendario configurado: se conserva en
        -- MANTENIMENT pero no se incorpora a esta capa contable.
        continue;
      end if;
      raise exception 'No se puede resolver el periodo contable de % / J=% / K=% en fila %',
        v_tancament, v_fecha_j, v_fecha_k, coalesce(v_item->>'fila','?');
    end if;

    if v_fecha_k is null and v_periodo.fecha_cierre >= (now() at time zone 'Europe/Madrid')::date then
      -- Periodo todavía abierto: no se congela en el histórico contable.
      continue;
    end if;
    v_fecha_k := coalesce(v_fecha_k, v_periodo.fecha_cierre);
    if v_fecha_k < v_fecha_j then
      raise exception 'Fin contable inválido en fila %: J=% K=%',
        coalesce(v_item->>'fila','?'), v_fecha_j, v_fecha_k;
    end if;
$new$;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private'
    and p.proname='manteniment_importar_cierres_facturacion';

  if md5(v_def) <> '40c81cde70cce5df9c80b9cce8a42683' then
    raise exception 'MG_MIGRACION_TANCAMENT: definición base inesperada; no se modifica';
  end if;
  if position(v_old in v_def)=0 then
    raise exception 'MG_MIGRACION_TANCAMENT: bloque objetivo no encontrado';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end;
$do$;

comment on function app_private.manteniment_importar_cierres_facturacion(jsonb,timestamptz) is
  'SINCRO7: K determina el periodo de cierres terminados; J determina abiertos. TANCAMENT se conserva como fuente y desambigua cuando coincide.';
