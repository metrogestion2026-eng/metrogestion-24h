begin;

-- MG75-PREFLIGHT-001. Diagnóstico autenticado: no importa datos ni habilita sync.
-- La cadena revisada es public.recibir_snapshot_manteniment ->
-- app_private.recibir_snapshot_manteniment_7525. Las huellas quedan fijadas;
-- cualquier cambio posterior exige revisar el contrato, no aprender otra huella.
create or replace function app_private.manteniment_preflight_solo_lectura(
  p_token text,
  p_cliente jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_config record;
  v_wrapper oid;
  v_receptor oid;
  v_wrapper_sha text;
  v_receptor_sha text;
  v_receptor_ok boolean := false;
  v_archivo_ok boolean := false;
  v_barreras_ok boolean := false;
  v_compatible boolean := false;
  v_motivos jsonb := '[]'::jsonb;
  v_version_script constant text := 'alpha75-2026.10.26.1';
  v_version_preflight constant text := 'alpha75-preflight-2026.10.27.1';
begin
  -- La configuración es privada. SECURITY DEFINER solo permite esta lectura;
  -- ambas funciones están restringidas a service_role y exigen el token activo.
  select token_activo, token_hash, spreadsheet_id,
         solo_lectura_manual_protegida, escritura_segura_manual,
         pausa_importacion_identidad
    into v_config
    from app_private.manteniment_sync_config
   where id = 1;

  if not found
     or v_config.token_activo is distinct from true
     or coalesce(v_config.token_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_token, '') !~* '^mg_[0-9a-f]{64}$'
     or encode(extensions.digest(p_token, 'sha256'), 'hex')
        is distinct from v_config.token_hash then
    raise exception using errcode = '28000',
      message = 'Clave de conexión no válida.';
  end if;

  if jsonb_typeof(p_cliente) is distinct from 'object' then
    raise exception using errcode = '22023',
      message = 'Metadatos de comprobación no válidos.';
  end if;
  if exists (
       select 1 from jsonb_object_keys(p_cliente) as k(key)
        where k.key not in ('version_script', 'version_preflight',
                            'escritura_segura_manual', 'spreadsheet_id')
     )
     or jsonb_typeof(p_cliente->'version_script') is distinct from 'string'
     or jsonb_typeof(p_cliente->'version_preflight') is distinct from 'string'
     or jsonb_typeof(p_cliente->'spreadsheet_id') is distinct from 'string'
     or jsonb_typeof(p_cliente->'escritura_segura_manual') is distinct from 'boolean'
     or (p_cliente->>'version_script') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
     or (p_cliente->>'version_preflight') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
     or (p_cliente->>'spreadsheet_id') !~ '^[A-Za-z0-9_-]{20,150}$'
     or (p_cliente->>'version_script') ~* 'mg_[0-9a-f]{64}'
     or (p_cliente->>'version_preflight') ~* 'mg_[0-9a-f]{64}' then
    raise exception using errcode = '22023',
      message = 'Metadatos de comprobación no válidos.';
  end if;

  -- Solo catálogo: nunca se ejecutan receptor, importador ni confirmador.
  v_wrapper := to_regprocedure('public.recibir_snapshot_manteniment(text,jsonb)');
  v_receptor := to_regprocedure('app_private.recibir_snapshot_manteniment_7525(text,jsonb)');
  if v_wrapper is not null and v_receptor is not null then
    v_wrapper_sha := encode(extensions.digest(pg_get_functiondef(v_wrapper), 'sha256'), 'hex');
    v_receptor_sha := encode(extensions.digest(pg_get_functiondef(v_receptor), 'sha256'), 'hex');
    v_receptor_ok := coalesce(
      v_wrapper_sha = '2e7bd5cb02bb5f582b9eaa241cc7d2db8b36879fe8b048de71e150aeee9defbd'
      and v_receptor_sha = 'd5f484eee92b433ae9e8a176e16a4ce1727f0909692628cca65414080511e494'
      and not has_function_privilege('anon', v_wrapper, 'EXECUTE')
      and not has_function_privilege('authenticated', v_wrapper, 'EXECUTE')
      and has_function_privilege('service_role', v_wrapper, 'EXECUTE')
      and not has_function_privilege('anon', v_receptor, 'EXECUTE')
      and not has_function_privilege('authenticated', v_receptor, 'EXECUTE')
      and has_function_privilege('service_role', v_receptor, 'EXECUTE'), false
    );
  end if;

  v_archivo_ok := coalesce(
    nullif(v_config.spreadsheet_id, '') = p_cliente->>'spreadsheet_id', false
  );
  v_barreras_ok := v_config.solo_lectura_manual_protegida is true
    and v_config.escritura_segura_manual is false
    and v_config.pausa_importacion_identidad is true;
  v_compatible := (p_cliente->>'version_script') = v_version_script
    and (p_cliente->>'version_preflight') = v_version_preflight
    and p_cliente->'escritura_segura_manual' = 'true'::jsonb
    and v_archivo_ok and v_receptor_ok;

  if p_cliente->>'version_script' <> v_version_script then
    v_motivos := v_motivos || '["VERSION_SCRIPT_DISTINTA"]'::jsonb;
  end if;
  if p_cliente->>'version_preflight' <> v_version_preflight then
    v_motivos := v_motivos || '["VERSION_PREFLIGHT_DISTINTA"]'::jsonb;
  end if;
  if p_cliente->'escritura_segura_manual' <> 'true'::jsonb then
    v_motivos := v_motivos || '["CLIENTE_SIN_ESCRITURA_SEGURA"]'::jsonb;
  end if;
  if not v_archivo_ok then
    v_motivos := v_motivos || '["ARCHIVO_DISTINTO"]'::jsonb;
  end if;
  if not v_receptor_ok then
    v_motivos := v_motivos || '["RECEPTOR_NO_VERIFICADO"]'::jsonb;
  end if;
  if not v_barreras_ok then
    v_motivos := v_motivos || '["BARRERAS_NO_CERRADAS"]'::jsonb;
  end if;

  return jsonb_build_object(
    'protocolo', 'manteniment-preflight-v1',
    'version_preflight', v_version_preflight,
    'solo_lectura', true,
    'compatible', v_compatible,
    'version_script_recibida', p_cliente->>'version_script',
    'version_script_esperada', v_version_script,
    'version_preflight_recibida', p_cliente->>'version_preflight',
    'cliente_escritura_segura_manual', p_cliente->'escritura_segura_manual',
    'archivo_coincide', v_archivo_ok,
    'receptor_coincide', v_receptor_ok,
    'barreras', jsonb_build_object(
      'solo_lectura_manual_protegida', v_config.solo_lectura_manual_protegida,
      'escritura_segura_manual', v_config.escritura_segura_manual,
      'pausa_importacion_identidad', v_config.pausa_importacion_identidad
    ),
    'barreras_cerradas', v_barreras_ok,
    'sincronizacion_autorizada', false,
    'motivos', v_motivos
  );
end;
$function$;

create or replace function public.preflight_manteniment(
  p_token text,
  p_cliente jsonb
) returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select app_private.manteniment_preflight_solo_lectura(p_token, p_cliente);
$function$;

revoke all on function app_private.manteniment_preflight_solo_lectura(text,jsonb)
  from public, anon, authenticated;
revoke all on function public.preflight_manteniment(text,jsonb)
  from public, anon, authenticated;
grant execute on function app_private.manteniment_preflight_solo_lectura(text,jsonb)
  to service_role;
grant execute on function public.preflight_manteniment(text,jsonb)
  to service_role;

comment on function public.preflight_manteniment(text,jsonb) is
  'MG75-PREFLIGHT-001: diagnóstico autenticado de solo lectura. Comprueba identidad declarada, receptor y barreras; nunca autoriza sincronización.';

commit;
