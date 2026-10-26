begin;

create or replace function app_private.recibir_snapshot_manteniment_7525(
  p_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions
as $function$
declare
  v_config app_private.manteniment_sync_config%rowtype;
  v_hash text;
  v_mode text;
  v_result jsonb;
  v_retenidas_parada integer := 0;
  v_retenidas_alta integer := 0;
  v_safe_commands jsonb := '[]'::jsonb;
  v_safe_count integer := 0;
  v_script_version text := btrim(coalesce(p_payload->>'version_script',''));
  v_version_validada constant text := 'alpha75-2026.10.26.1';
begin
  select * into v_config
  from app_private.manteniment_sync_config
  where id=1;

  if not found or not v_config.token_activo or v_config.token_hash='' then
    raise exception 'La actualización automática de MANTENIMENT no está activada';
  end if;
  if length(coalesce(p_token,''))<40 then
    raise exception 'Clave de conexión no válida';
  end if;

  v_hash := encode(extensions.digest(p_token,'sha256'),'hex');
  if v_hash is distinct from v_config.token_hash then
    raise exception 'Clave de conexión no válida';
  end if;

  -- No bypass: the identity pause still blocks both directions.
  if coalesce(v_config.pausa_importacion_identidad,true) then
    raise exception using errcode='55000',
      message='MG_SYNC_PAUSADA_IDENTIDAD: Sincronización detenida hasta completar la revisión de identidad; no reenviar ni confirmar órdenes.';
  end if;

  update app_private.manteniment_sync_config
     set ultima_version_script=nullif(v_script_version,''),
         ultima_version_script_en=clock_timestamp(),
         actualizado_en=clock_timestamp()
   where id=1;

  v_mode := lower(btrim(coalesce(p_payload->>'modo','programada')));
  if v_mode not in ('manual','programada','prueba') then
    v_mode := 'programada';
  end if;

  v_result := app_private.aplicar_snapshot_manteniment_7525(
    p_payload,v_mode,null,'google_apps_script'
  );

  if coalesce(v_config.solo_lectura_manual_protegida,false) then
    update app_private.manteniment_parada_outbox
       set estado='retenida_manual',
           ultimo_error='Retenida: MANTENIMENT en modo lectura protegida; requiere revisión antes de escribir sobre datos manuales.',
           actualizado_en=clock_timestamp()
     where estado='pendiente';
    get diagnostics v_retenidas_parada=row_count;

    update app_private.manteniment_activo_outbox
       set estado='retenida_manual',
           ultimo_error='Retenida: MANTENIMENT en modo lectura protegida; requiere revisión antes de escribir sobre datos manuales.',
           actualizado_en=clock_timestamp()
     where estado='pendiente';
    get diagnostics v_retenidas_alta=row_count;

    v_result := jsonb_set(v_result,'{comandos_manteniment}','[]'::jsonb,true);
    v_result := jsonb_set(
      v_result,'{mensaje}',
      to_jsonb(concat_ws(' ',
        nullif(v_result->>'mensaje',''),
        format('Modo lectura protegida: %s orden(es) retenida(s); no se ha escrito automáticamente en MANTENIMENT.',
          v_retenidas_parada+v_retenidas_alta)
      )),true
    );
    v_result := v_result || jsonb_build_object(
      'solo_lectura_manual_protegida',true,
      'escritura_segura_manual',false,
      'version_script_recibida',nullif(v_script_version,''),
      'version_script_validada',v_script_version=v_version_validada,
      'ordenes_retenidas',v_retenidas_parada+v_retenidas_alta
    );

  elsif coalesce(v_config.escritura_segura_manual,false) then
    if v_script_version<>v_version_validada then
      update app_private.manteniment_parada_outbox
         set estado='retenida_manual',
             ultimo_error=format(
               'Retenida: el Apps Script %s no incorpora la estabilización 75.25 validada.',
               coalesce(nullif(v_script_version,''),'sin versión')
             ),
             actualizado_en=clock_timestamp()
       where estado='pendiente';
      get diagnostics v_retenidas_parada=row_count;

      update app_private.manteniment_activo_outbox
         set estado='retenida_manual',
             ultimo_error=format(
               'Retenida: el Apps Script %s no incorpora la estabilización 75.25 validada.',
               coalesce(nullif(v_script_version,''),'sin versión')
             ),
             actualizado_en=clock_timestamp()
       where estado='pendiente';
      get diagnostics v_retenidas_alta=row_count;

      v_result := jsonb_set(v_result,'{comandos_manteniment}','[]'::jsonb,true);
      v_result := jsonb_set(
        v_result,'{mensaje}',
        to_jsonb(concat_ws(' ',
          nullif(v_result->>'mensaje',''),
          format('Escritura segura bloqueada: Apps Script %s no validado; %s orden(es) retenida(s).',
            coalesce(nullif(v_script_version,''),'sin versión'),
            v_retenidas_parada+v_retenidas_alta)
        )),true
      );
    else
      -- ALTA and destructive flows remain retained. Period rollover is not
      -- classified as destructive because it only fills K in the previous
      -- billing segment and creates a new period row.
      update app_private.manteniment_activo_outbox
         set estado='retenida_manual',
             ultimo_error='Retenida por escritura segura: ALTA no se modifica automáticamente.',
             actualizado_en=clock_timestamp()
       where estado='pendiente';
      get diagnostics v_retenidas_alta=row_count;

      update app_private.manteniment_parada_outbox
         set estado='retenida_manual',
             ultimo_error='Retenida por escritura segura: AV24H/reapertura puede borrar o reorganizar datos existentes.',
             actualizado_en=clock_timestamp()
       where estado='pendiente'
         and (
           coalesce(jsonb_typeof(payload->'ajuste_24h'),'null')='object'
           or coalesce((payload #>> '{reversion_t,limpiar_fecha_entrada}')::boolean,false)
           or coalesce((payload #>> '{reversion_t,limpiar_fecha_salida}')::boolean,false)
           or coalesce((payload #>> '{reversion_t,limpiar_k_parada}')::boolean,false)
         );
      get diagnostics v_retenidas_parada=row_count;

      select coalesce(jsonb_agg(cmd),'[]'::jsonb),count(*)::integer
      into v_safe_commands,v_safe_count
      from jsonb_array_elements(coalesce(v_result->'comandos_manteniment','[]'::jsonb)) cmd
      where coalesce(cmd->>'tipo','parada')<>'alta'
        and coalesce(jsonb_typeof(cmd #> '{payload,ajuste_24h}'),'null')<>'object'
        and not coalesce((cmd #>> '{payload,reversion_t,limpiar_fecha_entrada}')::boolean,false)
        and not coalesce((cmd #>> '{payload,reversion_t,limpiar_fecha_salida}')::boolean,false)
        and not coalesce((cmd #>> '{payload,reversion_t,limpiar_k_parada}')::boolean,false);

      v_result := jsonb_set(v_result,'{comandos_manteniment}',v_safe_commands,true);
      v_result := jsonb_set(
        v_result,'{mensaje}',
        to_jsonb(concat_ws(' ',
          nullif(v_result->>'mensaje',''),
          format('Escritura segura 75.25 activa: %s orden(es) apta(s); %s orden(es) destructiva(s)/ALTA retenida(s).',
            v_safe_count,v_retenidas_parada+v_retenidas_alta)
        )),true
      );
    end if;

    v_result := v_result || jsonb_build_object(
      'solo_lectura_manual_protegida',false,
      'escritura_segura_manual',true,
      'version_script_recibida',nullif(v_script_version,''),
      'version_script_validada',v_script_version=v_version_validada,
      'ordenes_retenidas',v_retenidas_parada+v_retenidas_alta,
      'ordenes_seguras',v_safe_count
    );
  end if;

  return v_result;
end;
$function$;

revoke all on function app_private.recibir_snapshot_manteniment_7525(text,jsonb)
  from public, anon, authenticated;

create or replace function public.recibir_snapshot_manteniment(
  p_token text,
  p_payload jsonb
)
returns jsonb
language sql
set search_path = pg_catalog, app_private
as $function$
  select app_private.recibir_snapshot_manteniment_7525(p_token,p_payload);
$function$;

grant execute on function public.recibir_snapshot_manteniment(text,jsonb)
  to service_role;
revoke execute on function public.recibir_snapshot_manteniment(text,jsonb)
  from public, anon, authenticated;

comment on function app_private.recibir_snapshot_manteniment_7525(text,jsonb) is
  'Receptor de sincronización 75.25 estabilizada. Mantiene pausa, lectura protegida y barreras destructivas; valida alpha75-2026.10.26.1.';

commit;
