begin;

create or replace function app_private.conciliar_alcance_manteniment(p_token text,p_solicitud jsonb)
returns jsonb language plpgsql stable security definer
set search_path='pg_catalog','public','app_private'
as $$
declare
  v_config record;
  v_ref jsonb;
  v_out app_private.manteniment_parada_outbox%rowtype;
  v_ent app_private.manteniment_entregas_continuidad_alpha75%rowtype;
  v_tipo text;
  v_hash text;
  v_estado text;
  v_items jsonb:='[]'::jsonb;
begin
  select token_activo,token_hash,spreadsheet_id into v_config
  from app_private.manteniment_sync_config where id=1;
  if not found or v_config.token_activo is distinct from true
    or coalesce(v_config.token_hash,'') !~ '^[0-9a-f]{64}$'
    or coalesce(p_token,'') !~* '^mg_[0-9a-f]{64}$'
    or encode(extensions.digest(p_token,'sha256'),'hex') is distinct from v_config.token_hash
  then raise exception using errcode='28000',message='Clave de conexión no válida.'; end if;

  if jsonb_typeof(p_solicitud) is distinct from 'object'
     or not (p_solicitud ?& array['version_ejecucion','spreadsheet_id','alcance'])
     or (select count(*) from jsonb_object_keys(p_solicitud))<>3
     or p_solicitud->>'version_ejecucion'<>'MG75-EJECUCION-ORDEN-001'
     or p_solicitud->>'spreadsheet_id' is distinct from v_config.spreadsheet_id
     or jsonb_typeof(p_solicitud->'alcance') is distinct from 'array'
     or jsonb_array_length(p_solicitud->'alcance') not between 1 and 200
  then raise exception using errcode='22023',message='Solicitud de conciliación no válida.'; end if;

  for v_ref in select value from jsonb_array_elements(p_solicitud->'alcance') loop
    if not app_private.referencia_ejecucion_manteniment_valida(v_ref) then
      raise exception using errcode='22023',message='Referencia de alcance no válida.';
    end if;

    select * into v_out from app_private.manteniment_parada_outbox
    where sync_id=(v_ref->>'sync_id')::uuid and revision=(v_ref->>'revision')::integer;

    if v_out.sync_id is null then
      v_estado:='NO_VIGENTE';
    else
      v_tipo:=case when app_private.payload_solo_trabajos_continuidad_alpha75(v_out.payload) then 'trabajos' else 'parada' end;
      v_hash:=encode(sha256(convert_to(v_out.payload::text,'UTF8')),'hex');
      select * into v_ent from app_private.manteniment_entregas_continuidad_alpha75
      where sync_id=v_out.sync_id and revision=v_out.revision;

      if v_out.estado='pendiente'
         and v_tipo=v_ref->>'tipo'
         and v_hash=v_ref->>'payload_sha256'
         and v_ent.sync_id is not null
         and v_ent.origen='entrega'
         and v_ent.confirmado_en is null
         and v_ent.payload_sha256=v_ref->>'payload_sha256'
      then v_estado:='VIGENTE';
      else v_estado:='DUDOSA';
      end if;
    end if;

    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'tipo',v_ref->>'tipo','sync_id',v_ref->>'sync_id',
      'revision',(v_ref->>'revision')::integer,
      'payload_sha256',v_ref->>'payload_sha256','estado',v_estado));
  end loop;

  return jsonb_build_object(
    'protocolo','manteniment-conciliar-alcance-v1',
    'version_ejecucion',p_solicitud->>'version_ejecucion',
    'spreadsheet_id',p_solicitud->>'spreadsheet_id',
    'solo_lectura',true,'referencias',v_items);
end $$;

create or replace function public.conciliar_alcance_manteniment(p_token text,p_solicitud jsonb)
returns jsonb language sql stable set search_path='pg_catalog'
as $$ select app_private.conciliar_alcance_manteniment(p_token,p_solicitud); $$;

commit;