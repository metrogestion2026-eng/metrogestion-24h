begin;

-- SINCRO 7: una misma PA puede conservar varios tramos PARADA con sustitutos
-- distintos. MANTENIMENT manda: el único tramo abierto define el sustituto
-- vigente; los tramos cerrados siguen siendo historia/facturación.

create or replace function app_private.manteniment_resolver_seguimiento_parada_item(p_item jsonb)
returns uuid
language plpgsql
stable security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_sync_id uuid;
  v_pa text;
  v_dfm text;
  v_matricula text;
  v_count integer := 0;
  v_result uuid;
begin
  if coalesce(p_item->>'sync_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_sync_id := (p_item->>'sync_id')::uuid;
    select s.seguimiento_id
      into v_result
    from app_private.manteniment_parada_sync s
    where s.sync_id = v_sync_id;
    if found then
      return v_result;
    end if;
  end if;

  v_pa := regexp_replace(upper(btrim(coalesce(p_item->>'numero_parada',''))), '^PA-', '', 'i');
  v_dfm := app_private.normalizar_dfm_continuidad_alpha75(p_item->>'dfm');
  v_matricula := app_private.normalizar_matricula_continuidad_alpha75(p_item->>'matricula');

  if v_pa = '' or v_dfm = '' then
    return null;
  end if;

  select count(distinct r.seguimiento_id),
         min(r.seguimiento_id::text)::uuid
    into v_count, v_result
  from public.registros_hotel r
  join app_private.manteniment_parada_sync s
    on s.seguimiento_id = r.seguimiento_id
  where regexp_replace(upper(btrim(coalesce(r.numero_parada,''))), '^PA-', '', 'i') = v_pa
    and app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_sustituido) = v_dfm
    and (
      v_matricula = ''
      or app_private.normalizar_matricula_continuidad_alpha75(r.matricula_sustituido) = v_matricula
    )
    and not coalesce(r.cancelado,false);

  if v_count = 0 then
    return null;
  end if;
  if v_count > 1 then
    raise exception
      'MG_IDENTIDAD_PENDIENTE: DFM % y PA-% acreditan más de un seguimiento; no se modifica el sustituto.',
      v_dfm, v_pa
      using errcode='23514';
  end if;
  return v_result;
end;
$function$;

create or replace function app_private.manteniment_fecha_inicio_tramo_actual(p_seguimiento_id uuid)
returns date
language sql
stable security definer
set search_path = pg_catalog, app_private
as $function$
  select s.fecha_inicio_tramo
  from app_private.manteniment_parada_sync s
  where s.seguimiento_id = p_seguimiento_id;
$function$;

create or replace function app_private.manteniment_reconciliar_tramos_parada(p_cierres jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_item jsonb;
  v_seguimiento uuid;
  v_registro public.registros_hotel%rowtype;
  v_identidad jsonb;
  v_sustituto text;
  v_matricula_sustituto text;
  v_tipo_sustituto text;
  v_etiqueta text;
  v_fecha_j date;
  v_pa text;
  v_dfm text;
  v_open_count integer;
  v_reconciliados integer := 0;
  v_sin_vinculo integer := 0;
begin
  perform app_private.bloquear_sync_continuidad_alpha75();

  if p_cierres is null then
    return jsonb_build_object('reconciliados',0,'sin_vinculo',0);
  end if;
  if jsonb_typeof(p_cierres) <> 'array' or jsonb_array_length(p_cierres) > 2500 then
    raise exception 'cierres_facturacion no tiene un formato válido para reconciliar tramos';
  end if;

  for v_item in select value from jsonb_array_elements(p_cierres)
  loop
    if upper(btrim(coalesce(v_item->>'estado',''))) <> 'PARADA' then
      continue;
    end if;
    if nullif(btrim(coalesce(v_item->>'fecha_k','')),'') is not null then
      continue;
    end if;

    v_pa := regexp_replace(upper(btrim(coalesce(v_item->>'numero_parada',''))), '^PA-', '', 'i');
    v_dfm := app_private.normalizar_dfm_continuidad_alpha75(v_item->>'dfm');
    v_fecha_j := nullif(btrim(coalesce(v_item->>'fecha_parada','')),'')::date;

    if v_pa = '' or v_dfm = '' or v_fecha_j is null then
      continue;
    end if;

    select count(*)
      into v_open_count
    from jsonb_array_elements(p_cierres) e(value)
    where upper(btrim(coalesce(e.value->>'estado',''))) = 'PARADA'
      and nullif(btrim(coalesce(e.value->>'fecha_k','')),'') is null
      and regexp_replace(upper(btrim(coalesce(e.value->>'numero_parada',''))), '^PA-', '', 'i') = v_pa
      and app_private.normalizar_dfm_continuidad_alpha75(e.value->>'dfm') = v_dfm;

    if v_open_count <> 1 then
      raise exception
        'MG_TRAMOS_PARADA_AMBIGUOS: DFM % / PA-% mantiene % tramos abiertos; no se modifica el sustituto.',
        v_dfm, v_pa, v_open_count
        using errcode='23514';
    end if;

    v_seguimiento := app_private.manteniment_resolver_seguimiento_parada_item(v_item);
    if v_seguimiento is null then
      v_sin_vinculo := v_sin_vinculo + 1;
      continue;
    end if;

    -- La continuidad entre PAs tiene su propio contrato y no se reescribe aquí.
    if app_private.seguimiento_con_continuidad_sustitucion_alpha75(v_seguimiento) then
      continue;
    end if;

    select r.*
      into v_registro
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = v_seguimiento
      and p.estado = 'en_curso'
      and not coalesce(r.cancelado,false)
      and not coalesce(r.retirado_hotel_activo,false)
    order by p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
    for update of r;

    if not found then
      continue;
    end if;

    v_sustituto := app_private.normalizar_dfm_continuidad_alpha75(v_item->>'sustituto');
    v_matricula_sustituto := '';
    v_tipo_sustituto := '';
    v_etiqueta := '';

    if v_sustituto <> '' then
      v_identidad := app_private.resolver_sustituto_continuidad_alpha75(v_sustituto,'');
      v_sustituto := v_identidad->>'dfm';
      v_matricula_sustituto := coalesce(v_identidad->>'matricula','');

      select v.tipo_sustituto_catalogo,
             coalesce(nullif(v.etiqueta_reserva,''), v.tipo_sustituto_catalogo)
        into v_tipo_sustituto, v_etiqueta
      from public.vehiculos_hotel_autocompletar v
      where app_private.normalizar_dfm_continuidad_alpha75(v.dfm) = v_sustituto
      limit 1;

      if not found then
        raise exception
          'MG_IDENTIDAD_PENDIENTE: el sustituto % de DFM % / PA-% no existe de forma acreditada en el catálogo.',
          v_sustituto, v_dfm, v_pa
          using errcode='23514';
      end if;
    end if;

    perform set_config('app.request_id',
      'mnt_tramo_' || substr(md5(v_item::text),1,24), true);
    perform set_config('app.audit_origin','metrogestion-r1-manteniment-sync',true);
    perform set_config('app.audit_reason',
      'Reconciliación del tramo PARADA vigente desde MANTENIMENT',true);
    perform set_config('app.manteniment_importando_paradas','1',true);

    update public.registros_hotel r
       set vehiculo_reserva = v_sustituto,
           matricula_reserva = v_matricula_sustituto,
           etiqueta_reserva = v_etiqueta,
           modificado_por = coalesce(r.modificado_por,r.creado_por)
     where r.id = v_registro.id
       and (
         app_private.normalizar_dfm_continuidad_alpha75(r.vehiculo_reserva) is distinct from v_sustituto
         or app_private.normalizar_matricula_continuidad_alpha75(r.matricula_reserva) is distinct from v_matricula_sustituto
         or coalesce(r.etiqueta_reserva,'') is distinct from v_etiqueta
       );

    update app_private.manteniment_parada_sync s
       set fecha_inicio_parada_origen = coalesce(
             s.fecha_inicio_parada_origen,
             v_registro.fecha_parada,
             nullif(btrim(coalesce(v_item->>'fecha_programada','')),'')::date,
             v_fecha_j
           ),
           fecha_inicio_tramo = v_fecha_j,
           fecha_programada_parada = coalesce(
             nullif(btrim(coalesce(v_item->>'fecha_programada','')),'')::date,
             s.fecha_programada_parada
           ),
           fecha_corte = null,
           tancament = upper(btrim(coalesce(v_item->>'tancament',''))),
           fila_manteniment = nullif(btrim(coalesce(v_item->>'fila','')),'')::integer,
           actualizado_en = clock_timestamp()
     where s.seguimiento_id = v_seguimiento;

    perform set_config('app.manteniment_importando_paradas','0',true);
    v_reconciliados := v_reconciliados + 1;
  end loop;

  return jsonb_build_object(
    'reconciliados',v_reconciliados,
    'sin_vinculo',v_sin_vinculo
  );
end;
$function$;

-- La proyección existente sigue mandando en continuidad entre PAs. Sólo cuando
-- no existe continuidad, el inicio del tramo vigente puede venir del último
-- PARADA abierto de MANTENIMENT.
create or replace function app_private.proyectar_continuidad_sustitucion_alpha75(p_seguimiento_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_result jsonb;
  v_inicio_manteniment date;
begin
  if coalesce(current_setting('role',true),'')='authenticated'
    or (session_user<>current_user and coalesce(current_setting('role',true),'')<>'service_role') then
    if auth.uid() is null or not public.usuario_activo() or not public.dispositivo_autorizado()
      or not(public.puede_ver_modulo('hotel') or public.puede_ver_modulo('historico')
        or public.puede_ver_modulo('resumen') or public.puede_ver_modulo('listados')) then
      raise exception 'No tienes permiso para consultar la proyección de sustitución'
        using errcode='42501';
    end if;
  end if;

  v_result := app_private.metadatos_continuidad_alpha75(p_seguimiento_id);

  if (v_result->>'continuidad_entrada_id') is null
     and (v_result->>'continuidad_salida_id') is null then
    v_inicio_manteniment := app_private.manteniment_fecha_inicio_tramo_actual(p_seguimiento_id);
    if v_inicio_manteniment is not null then
      v_result := jsonb_set(
        v_result,
        '{fecha_inicio_imputacion}',
        to_jsonb(v_inicio_manteniment),
        true
      );
    end if;
  end if;

  return v_result;
end;
$function$;

-- El wrapper 75.25 procesa cierres y, a continuación, reconcilia el único
-- tramo abierto de cada PA. No requiere METROGESTION_PARADA si DFM+PA son
-- inequívocos y pertenecen a un seguimiento ya conocido por Metrogestión.
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
  v_tramos jsonb;
begin
  perform app_private.bloquear_sync_continuidad_alpha75();

  v_result := app_private.aplicar_snapshot_manteniment(p_payload,p_modo,p_actor,p_origen);
  if not coalesce((v_result->>'ok')::boolean,false) then
    return v_result;
  end if;

  if p_payload ? 'cierres_facturacion' then
    v_cierres := app_private.manteniment_importar_cierres_facturacion(
      p_payload->'cierres_facturacion',
      coalesce(nullif(p_payload->>'generado_en','')::timestamptz,now())
    );
    v_tramos := app_private.manteniment_reconciliar_tramos_parada(
      p_payload->'cierres_facturacion'
    );
  else
    v_cierres := jsonb_build_object('recibidos',0,'actualizados',0);
    v_tramos := jsonb_build_object('reconciliados',0,'sin_vinculo',0);
  end if;

  update public.manteniment_sync_ejecuciones
     set detalle=coalesce(detalle,'{}'::jsonb)
       || jsonb_build_object(
         'cierres_facturacion',v_cierres,
         'tramos_parada',v_tramos
       )
   where id=(v_result->>'ejecucion_id')::uuid;

  return v_result || jsonb_build_object(
    'cierres_facturacion',v_cierres,
    'tramos_parada',v_tramos
  );
end;
$function$;

-- Un cierre de tramo ya terminado debe ser visible aun cuando el periodo
-- contable mensual siga abierto. El tramo vigente se obtiene del resumen,
-- cuyo inicio ya respeta fecha_inicio_tramo de MANTENIMENT.
do $do$
declare
  v_def text;
  v_old text :=
    'WHERE f.presente_en_manteniment AND f.dfm !~* ''^R''::text AND c.fecha_cierre < (now() AT TIME ZONE ''Europe/Madrid''::text)::date';
  v_new text :=
    'WHERE f.presente_en_manteniment AND f.dfm !~* ''^R''::text AND (c.fecha_cierre < (now() AT TIME ZONE ''Europe/Madrid''::text)::date OR (f.fecha_fin_tramo IS NOT NULL AND f.fecha_fin_tramo < (now() AT TIME ZONE ''Europe/Madrid''::text)::date))';
begin
  select pg_get_viewdef('public.facturacion_dfm_periodos'::regclass,true)
    into v_def;
  if position(v_old in v_def)=0 then
    raise exception 'No se reconoce la definición vigente de facturacion_dfm_periodos';
  end if;
  v_def := replace(v_def,v_old,v_new);
  execute 'create or replace view public.facturacion_dfm_periodos as ' || v_def;
  execute 'alter view public.facturacion_dfm_periodos set (security_invoker=true)';
end;
$do$;

commit;
