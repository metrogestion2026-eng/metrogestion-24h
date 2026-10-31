begin;

-- 75.25 stabilization:
-- 1) MANTENIMENT TANCAMENT is the accounting source of truth for closed periods.
-- 2) Current Hotel state must not rewrite a period that has already closed.
-- 3) Current-stop synchronization may advance one billing period at a time.

create table if not exists public.facturacion_tancament_cierres (
  id bigint generated always as identity primary key,
  source_key text not null unique,
  sync_id uuid,
  seguimiento_id uuid,
  fila_manteniment integer,
  dfm text not null,
  matricula text,
  numero_parada text,
  sustituto text,
  tancament text not null,
  periodo text not null,
  fecha_programada date,
  fecha_inicio_tramo date not null,
  fecha_fin_tramo date not null,
  dias_facturables integer,
  km_facturables numeric,
  marca text,
  presente_en_manteniment boolean not null default true,
  payload_hash text not null,
  capturado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint facturacion_tancament_cierres_dias_nonnegative
    check (dias_facturables is null or dias_facturables >= 0),
  constraint facturacion_tancament_cierres_km_nonnegative
    check (km_facturables is null or km_facturables >= 0),
  constraint facturacion_tancament_cierres_q
    check (tancament ~ '^TANCAMENT [0-9]+$')
);

create index if not exists facturacion_tancament_cierres_periodo_idx
  on public.facturacion_tancament_cierres(periodo, presente_en_manteniment);
create index if not exists facturacion_tancament_cierres_sync_idx
  on public.facturacion_tancament_cierres(sync_id, periodo)
  where sync_id is not null;

alter table public.facturacion_tancament_cierres enable row level security;

revoke all on table public.facturacion_tancament_cierres from public, anon, authenticated;
grant select on table public.facturacion_tancament_cierres to authenticated;
grant all on table public.facturacion_tancament_cierres to service_role;

drop policy if exists facturacion_tancament_cierres_select_hotel
  on public.facturacion_tancament_cierres;
create policy facturacion_tancament_cierres_select_hotel
on public.facturacion_tancament_cierres
for select
to authenticated
using (
  (select public.dispositivo_autorizado())
  and (
    (select public.puede_ver_modulo('hotel'))
    or (select public.puede_ver_modulo('historico'))
  )
);

create or replace function app_private.manteniment_importar_cierres_facturacion(
  p_cierres jsonb,
  p_generado_en timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_item jsonb;
  v_sync_id uuid;
  v_seguimiento_id uuid;
  v_tancament text;
  v_periodo public.cierres_facturacion%rowtype;
  v_fecha_i date;
  v_fecha_j date;
  v_fecha_k date;
  v_dias integer;
  v_km numeric;
  v_source_key text;
  v_count integer := 0;
begin
  if p_cierres is null then
    return jsonb_build_object('recibidos',0,'actualizados',0);
  end if;
  if jsonb_typeof(p_cierres) <> 'array' then
    raise exception 'cierres_facturacion debe ser un array JSON';
  end if;
  if jsonb_array_length(p_cierres) > 2500 then
    raise exception 'cierres_facturacion supera el máximo de 2500 filas';
  end if;

  create temp table if not exists tmp_facturacion_tancament_keys (
    source_key text primary key,
    periodo text not null
  ) on commit drop;
  truncate tmp_facturacion_tancament_keys;

  for v_item in select value from jsonb_array_elements(p_cierres)
  loop
    if upper(btrim(coalesce(v_item->>'estado',''))) <> 'PARADA' then
      continue;
    end if;

    v_tancament := upper(btrim(coalesce(v_item->>'tancament','')));
    if v_tancament !~ '^TANCAMENT [0-9]+$' then
      raise exception 'TANCAMENT no válido en fila %: %',
        coalesce(v_item->>'fila','?'), v_item->>'tancament';
    end if;

    v_fecha_i := nullif(v_item->>'fecha_programada','')::date;
    v_fecha_j := nullif(v_item->>'fecha_parada','')::date;
    v_fecha_k := nullif(v_item->>'fecha_k','')::date;
    if v_fecha_j is null then
      raise exception 'El cierre de la fila % requiere J',
        coalesce(v_item->>'fila','?');
    end if;

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

    v_dias := nullif(v_item->>'dias_parada','')::integer;
    v_km := nullif(v_item->>'km_facturables','')::numeric;
    if v_dias is not null and v_dias < 0 then
      raise exception 'Días negativos en cierre de fila %', coalesce(v_item->>'fila','?');
    end if;
    if v_km is not null and v_km < 0 then
      raise exception 'KM negativos en cierre de fila %', coalesce(v_item->>'fila','?');
    end if;

    v_sync_id := case
      when coalesce(v_item->>'sync_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (v_item->>'sync_id')::uuid
      else null
    end;
    v_seguimiento_id := null;
    if v_sync_id is not null then
      select s.seguimiento_id into v_seguimiento_id
      from app_private.manteniment_parada_sync s
      where s.sync_id = v_sync_id;
    end if;

    if v_sync_id is not null then
      v_source_key := concat_ws('|',
        'SYNC',v_sync_id::text,v_periodo.periodo,
        v_fecha_j::text,
        upper(btrim(coalesce(v_item->>'sustituto','')))
      );
    else
      v_source_key := concat_ws('|',
        'MANTENIMENT',
        regexp_replace(upper(btrim(coalesce(v_item->>'dfm',''))),'[[:space:]]+','','g'),
        regexp_replace(upper(btrim(coalesce(v_item->>'matricula',''))),'[[:space:]]+','','g'),
        upper(btrim(coalesce(v_item->>'numero_parada',''))),
        upper(btrim(coalesce(v_item->>'sustituto',''))),
        v_periodo.periodo,
        v_fecha_j::text,
        coalesce(v_fecha_i,v_fecha_j)::text
      );
    end if;

    insert into public.facturacion_tancament_cierres (
      source_key,sync_id,seguimiento_id,fila_manteniment,
      dfm,matricula,numero_parada,sustituto,tancament,periodo,
      fecha_programada,fecha_inicio_tramo,fecha_fin_tramo,
      dias_facturables,km_facturables,marca,presente_en_manteniment,
      payload_hash,capturado_en,actualizado_en
    ) values (
      v_source_key,v_sync_id,v_seguimiento_id,
      nullif(v_item->>'fila','')::integer,
      btrim(coalesce(v_item->>'dfm','')),
      btrim(coalesce(v_item->>'matricula','')),
      nullif(btrim(coalesce(v_item->>'numero_parada','')),''),
      nullif(btrim(coalesce(v_item->>'sustituto','')),''),
      v_tancament,v_periodo.periodo,
      v_fecha_i,v_fecha_j,v_fecha_k,
      v_dias,v_km,nullif(btrim(coalesce(v_item->>'marca','')),''),
      true,md5(v_item::text),coalesce(p_generado_en,now()),now()
    )
    on conflict (source_key) do update
    set sync_id=excluded.sync_id,
        seguimiento_id=coalesce(excluded.seguimiento_id,public.facturacion_tancament_cierres.seguimiento_id),
        fila_manteniment=excluded.fila_manteniment,
        dfm=excluded.dfm,
        matricula=excluded.matricula,
        numero_parada=excluded.numero_parada,
        sustituto=excluded.sustituto,
        tancament=excluded.tancament,
        periodo=excluded.periodo,
        fecha_programada=excluded.fecha_programada,
        fecha_inicio_tramo=excluded.fecha_inicio_tramo,
        fecha_fin_tramo=excluded.fecha_fin_tramo,
        dias_facturables=excluded.dias_facturables,
        km_facturables=excluded.km_facturables,
        marca=excluded.marca,
        presente_en_manteniment=true,
        payload_hash=excluded.payload_hash,
        actualizado_en=now();

    insert into tmp_facturacion_tancament_keys(source_key,periodo)
    values (v_source_key,v_periodo.periodo)
    on conflict (source_key) do nothing;

    v_count := v_count + 1;
  end loop;

  update public.facturacion_tancament_cierres f
  set presente_en_manteniment=false,
      actualizado_en=now()
  where f.periodo in (select distinct periodo from tmp_facturacion_tancament_keys)
    and f.presente_en_manteniment
    and not exists (
      select 1 from tmp_facturacion_tancament_keys k
      where k.source_key=f.source_key
    );

  return jsonb_build_object('recibidos',jsonb_array_length(p_cierres),'actualizados',v_count);
end;
$function$;

revoke all on function app_private.manteniment_importar_cierres_facturacion(jsonb,timestamptz)
  from public, anon, authenticated;

create or replace function app_private.aplicar_snapshot_manteniment_7525(
  p_payload jsonb,
  p_modo text default 'programada',
  p_actor uuid default null,
  p_origen text default 'google_apps_script'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_result jsonb;
  v_cierres jsonb;
begin
  v_result := app_private.aplicar_snapshot_manteniment(p_payload,p_modo,p_actor,p_origen);
  if not coalesce((v_result->>'ok')::boolean,false) then
    return v_result;
  end if;

  if p_payload ? 'cierres_facturacion' then
    v_cierres := app_private.manteniment_importar_cierres_facturacion(
      p_payload->'cierres_facturacion',
      coalesce(nullif(p_payload->>'generado_en','')::timestamptz,now())
    );
  else
    v_cierres := jsonb_build_object('recibidos',0,'actualizados',0);
  end if;

  update public.manteniment_sync_ejecuciones
  set detalle=coalesce(detalle,'{}'::jsonb)
      || jsonb_build_object('cierres_facturacion',v_cierres)
  where id=(v_result->>'ejecucion_id')::uuid;

  return v_result || jsonb_build_object('cierres_facturacion',v_cierres);
end;
$function$;

revoke all on function app_private.aplicar_snapshot_manteniment_7525(jsonb,text,uuid,text)
  from public, anon, authenticated;

-- Advance exactly one billing period at a time when the physical stop survived
-- the previous period. The Apps Script receives an explicit previous-period
-- closure plus the next segment, so no period is skipped after downtime.
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
  v_periodo public.cierres_facturacion%rowtype;
  v_periodo_sync public.cierres_facturacion%rowtype;
  v_periodo_siguiente public.cierres_facturacion%rowtype;
  v_fecha_k date;
  v_dias integer;
  v_km numeric;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_inicio date;
  v_fin date;
  v_anulada boolean;
  v_tancament_payload text;
  v_fecha_parada_payload date;
  v_cierre_periodo_anterior jsonb := null;
begin
  select * into v_sync
  from app_private.manteniment_parada_sync
  where seguimiento_id=p_seguimiento_id;
  if not found then return null; end if;

  select r.*,p.fecha as fecha_pizarra
  into v_ficha
  from public.registros_hotel r
  join public.pizarras p on p.id=r.pizarra_id
  where r.seguimiento_id=p_seguimiento_id
  order by (p.estado='en_curso') desc,p.fecha desc,r.actualizado_en desc,r.id desc
  limit 1;
  if not found then return null; end if;

  if btrim(coalesce(v_ficha.vehiculo_reserva,''))='' then
    return null;
  end if;

  select * into v_resumen
  from public.paradas_sustitucion_resumen
  where seguimiento_id=p_seguimiento_id;

  v_anulada := coalesce(v_ficha.cancelado,false) or v_ficha.estado='anulado';
  v_tancament_payload := btrim(coalesce(v_sync.tancament,''));
  v_fecha_parada_payload := coalesce(v_sync.fecha_inicio_tramo,v_ficha.fecha_parada);

  if v_tancament_payload<>'' then
    select c.* into v_periodo_sync
    from public.cierres_facturacion c
    where v_tancament_payload=
          'TANCAMENT '||(split_part(c.periodo,'-',2)::integer)::text
      and (
        v_sync.fecha_inicio_tramo between c.fecha_inicio and c.fecha_cierre
        or v_sync.fecha_corte between c.fecha_inicio and c.fecha_cierre
      )
    order by c.fecha_inicio desc
    limit 1;
  end if;

  if v_periodo_sync.periodo is not null
     and not v_anulada
     and coalesce(v_resumen.fecha_fin_parada,v_hoy+1)>v_periodo_sync.fecha_cierre
  then
    select c.* into v_periodo_siguiente
    from public.cierres_facturacion c
    where c.fecha_inicio>v_periodo_sync.fecha_cierre
      and c.fecha_inicio<=v_hoy
    order by c.fecha_inicio
    limit 1;

    if v_periodo_siguiente.periodo is not null then
      v_cierre_periodo_anterior := jsonb_build_object(
        'tancament',v_tancament_payload,
        'fecha_k',v_periodo_sync.fecha_cierre
      );
      v_tancament_payload :=
        'TANCAMENT '||(split_part(v_periodo_siguiente.periodo,'-',2)::integer)::text;
      v_fecha_parada_payload := v_periodo_siguiente.fecha_inicio;
      v_periodo := v_periodo_siguiente;

      if v_resumen.fecha_fin_parada is not null then
        v_fecha_k := least(v_resumen.fecha_fin_parada,v_periodo_siguiente.fecha_cierre);
      elsif v_hoy>v_periodo_siguiente.fecha_cierre then
        v_fecha_k := v_periodo_siguiente.fecha_cierre;
      else
        v_fecha_k := null;
      end if;
    end if;
  end if;

  if v_tancament_payload='' and not v_anulada then
    select c.* into v_periodo
    from public.cierres_facturacion c
    where v_hoy between c.fecha_inicio and c.fecha_cierre
    order by c.fecha_inicio desc
    limit 1;
    if v_periodo.periodo is not null then
      v_tancament_payload :=
        'TANCAMENT '||(split_part(v_periodo.periodo,'-',2)::integer)::text;
    end if;
  end if;

  if v_cierre_periodo_anterior is null then
    v_fecha_k := case
      when v_ficha.retirado_hotel_activo
           or v_ficha.estado in ('recuperado','reserva_liberada')
        then coalesce(v_sync.fecha_corte,v_ficha.fecha_retirado_hotel::date,v_ficha.fecha_pizarra)
      when btrim(coalesce(v_sync.tancament,''))<>'' then v_sync.fecha_corte
      else null
    end;
  end if;

  if v_periodo.periodo is null and v_tancament_payload<>'' then
    select c.* into v_periodo
    from public.cierres_facturacion c
    where v_tancament_payload=
          'TANCAMENT '||(split_part(c.periodo,'-',2)::integer)::text
      and coalesce(v_fecha_parada_payload,v_hoy) between c.fecha_inicio and c.fecha_cierre
    order by c.fecha_inicio desc
    limit 1;
  end if;

  if v_sync.calculo_periodo_automatico and not v_sync.tancament_supervisado then
    v_inicio := coalesce(v_fecha_parada_payload,v_resumen.fecha_inicio_parada);
    v_fin := least(coalesce(v_fecha_k,v_hoy),coalesce(v_periodo.fecha_cierre,v_hoy),v_hoy);
    v_dias := case when v_inicio is null then 0 else
      greatest(0,v_fin-greatest(v_inicio,coalesce(v_periodo.fecha_inicio,v_inicio))+1)
    end;
    v_km := case when v_resumen.km_dia is not null
      then round(v_dias::numeric*v_resumen.km_dia,2) end;
  else
    if v_sync.dias_parada_manual is not null and v_cierre_periodo_anterior is null then
      v_dias := v_sync.dias_parada_manual;
    elsif v_fecha_k is not null then
      v_dias := greatest(
        0,
        v_fecha_k-greatest(
          coalesce(v_fecha_parada_payload,v_resumen.fecha_inicio_parada,v_ficha.fecha_parada,v_ficha.fecha_pizarra),
          coalesce(v_periodo.fecha_inicio,coalesce(v_fecha_parada_payload,v_resumen.fecha_inicio_parada,v_ficha.fecha_parada,v_ficha.fecha_pizarra))
        )+1
      );
    else
      v_dias := coalesce(v_resumen.dias_parada_total,0);
    end if;
    v_km := coalesce(
      case when v_cierre_periodo_anterior is null then v_sync.km_facturables_manual end,
      case when v_resumen.km_dia is not null then round(v_dias::numeric*v_resumen.km_dia,2) end
    );
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'sync_id',v_sync.sync_id,
    'seguimiento_id',p_seguimiento_id,
    'dfm',coalesce(v_ficha.vehiculo_sustituido,''),
    'matricula',coalesce(v_ficha.matricula_sustituido,''),
    'tipo',coalesce(v_ficha.tipo_unidad,''),
    'upc',coalesce(v_ficha.upc,''),
    'numero_parada',case
      when btrim(coalesce(v_ficha.numero_parada,''))='' then ''
      else 'PA-'||btrim(v_ficha.numero_parada)
    end,
    'sustituto',coalesce(v_ficha.vehiculo_reserva,''),
    'estado',case when v_anulada then 'ANULADA' else 'PARADA' end,
    'fecha_programada',v_sync.fecha_programada_parada,
    'fecha_parada',v_fecha_parada_payload,
    'fecha_k',v_fecha_k,
    'dias_parada',v_dias,
    'marca',coalesce(v_ficha.marca,''),
    'km_facturables',v_km,
    'tancament',v_tancament_payload,
    'tancament_supervisado',case
      when v_cierre_periodo_anterior is not null then false
      when btrim(coalesce(v_sync.tancament,''))='' then false
      else v_sync.tancament_supervisado
    end,
    'cierre_periodo_anterior',v_cierre_periodo_anterior
  ));
end;
$function$;

revoke all on function app_private.manteniment_construir_payload_parada(uuid)
  from public, anon, authenticated;

-- Closed periods use the exact MANTENIMENT snapshot. The live Hotel-derived
-- calculation remains only as a fallback for the current period, or for a
-- historical period that has never yet been captured by the new feed.
create or replace view public.facturacion_dfm_periodos
with (security_invoker=true)
as
with snapshot as (
  select
    f.seguimiento_id,
    regexp_replace(coalesce(f.numero_parada,''),'^PA-','','i') as numero_parada,
    f.dfm,
    f.matricula,
    f.sustituto,
    null::text as matricula_sustituto,
    p.incidencia,
    p.causa,
    p.upc,
    f.periodo,
    c.fecha_inicio as periodo_inicio,
    c.fecha_cierre as periodo_cierre,
    f.fecha_inicio_tramo as tramo_inicio,
    f.fecha_fin_tramo as tramo_fin,
    f.dias_facturables,
    null::numeric(12,3) as km_dia_automatico,
    null::numeric(10,3) as km_dia_manual,
    case when coalesce(f.dias_facturables,0)>0 and f.km_facturables is not null
      then round(f.km_facturables/f.dias_facturables,3) end as km_dia,
    'TANCAMENT'::text as km_dia_fuente,
    f.km_facturables,
    f.dias_facturables as dias_parada_total,
    null::numeric as km_sustitucion_total,
    coalesce(p.estado,'tancament') as estado
  from public.facturacion_tancament_cierres f
  join public.cierres_facturacion c on c.periodo=f.periodo
  left join public.paradas_sustitucion_resumen p using (seguimiento_id)
  where f.presente_en_manteniment
    and f.dfm !~* '^R'
    and c.fecha_cierre < (now() at time zone 'Europe/Madrid')::date
),
live_tramos as (
  select
    p.seguimiento_id,
    p.numero_parada,
    p.unidad as dfm,
    p.matricula,
    p.sustituto,
    p.matricula_sustituto,
    p.incidencia,
    p.causa,
    p.upc,
    c.periodo,
    c.fecha_inicio as periodo_inicio,
    c.fecha_cierre as periodo_cierre,
    greatest(p.fecha_inicio_parada,c.fecha_inicio) as tramo_inicio,
    least(coalesce(p.fecha_fin_parada,current_date),c.fecha_cierre,current_date) as tramo_fin,
    greatest(0,
      least(coalesce(p.fecha_fin_parada,current_date),c.fecha_cierre,current_date)
      - greatest(p.fecha_inicio_parada,c.fecha_inicio)+1
    ) as dias_facturables,
    p.km_dia_automatico,
    p.km_dia_manual,
    p.km_dia,
    p.km_dia_fuente,
    case when p.km_dia is null then null::numeric
      else round(
        greatest(0,
          least(coalesce(p.fecha_fin_parada,current_date),c.fecha_cierre,current_date)
          - greatest(p.fecha_inicio_parada,c.fecha_inicio)+1
        )::numeric*p.km_dia
      )
    end as km_facturables,
    p.dias_parada_total,
    p.km_sustitucion_total,
    p.estado
  from public.paradas_sustitucion_resumen p
  join public.cierres_facturacion c
    on p.clase_facturacion='DFM'
   and p.sustituto is not null
   and p.km_dia is not null
   and p.fecha_inicio_parada<=c.fecha_cierre
   and coalesce(p.fecha_fin_parada,current_date)>=c.fecha_inicio
   and c.fecha_inicio<=current_date
)
select * from snapshot
union all
select l.*
from live_tramos l
where l.periodo_cierre >= (now() at time zone 'Europe/Madrid')::date
   or not exists (
     select 1 from snapshot s where s.periodo=l.periodo
   );

grant select on public.facturacion_dfm_periodos to authenticated, service_role;

comment on table public.facturacion_tancament_cierres is
  'Copia persistente de cada tramo TANCAMENT cerrado en MANTENIMENT. No se recalcula desde el estado vivo de Hotel.';
comment on function app_private.manteniment_importar_cierres_facturacion(jsonb,timestamptz) is
  'Importa el feed contable completo de filas PARADA/TANCAMENT cerradas, incluidas las históricas sin UUID.';
comment on function app_private.aplicar_snapshot_manteniment_7525(jsonb,text,uuid,text) is
  'Wrapper atómico de 75.25: sincronización vigente + captura de cierres TANCAMENT.';
comment on function app_private.manteniment_construir_payload_parada(uuid) is
  'Genera PARADA y avanza un periodo facturable cada vez sin perder el cierre anterior.';

commit;
