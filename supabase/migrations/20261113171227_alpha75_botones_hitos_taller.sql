-- MG75-TALLER-HITOS-001
-- Tres confirmaciones independientes sobre la misma T: entrada, terminado y recogido.
-- No hay backfill, cambio de orden, ejecución de otra T ni liberación de sustituto.
-- Los alias se reconocen sin reescribir el tipo guardado ni la identidad documental.

-- BEGIN ALPHA75_TALLER_CONTEXT
create or replace function app_private.es_tipo_entrada_taller_alpha75(p_tipo text)
returns boolean
language sql
immutable
parallel safe
set search_path to 'pg_catalog'
as $function$
  select btrim(regexp_replace(
    lower(translate(coalesce(p_tipo,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),
    '[[:space:]_]+',' ','g'
  )) in ('entrada taller','entrada en taller','entrada a taller');
$function$;

revoke all on function app_private.es_tipo_entrada_taller_alpha75(text)
  from public, anon, authenticated, service_role;

-- Serializador privado: únicamente datos de la T y el contexto necesario para sus botones.
create or replace function app_private.contexto_etapa_taller_alpha75(p_etapa_id uuid)
returns jsonb
language sql
stable
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
  select jsonb_build_object(
    'id',e.id,
    'registro_hotel_id',e.registro_hotel_id,
    'seguimiento_id',e.seguimiento_id,
    'nombre',e.nombre,
    'posicion',e.posicion,
    'estado',e.estado,
    'estado_catalogo_codigo',e.estado_catalogo_codigo,
    'tipo_etapa',e.tipo_etapa,
    'accion_sistema',e.accion_sistema,
    'taller_id',e.taller_id,
    'centro_taller_id',e.centro_taller_id,
    'lugar',e.lugar,
    'fecha_prevista',e.fecha_prevista,
    'fecha_inicio_real',e.fecha_inicio_real,
    'fecha_fin_real',e.fecha_fin_real,
    'fecha_real',e.fecha_real,
    'cancelado',e.cancelado,
    'version',e.version,
    'marcado_rapido',e.marcado_rapido,
    'marcado_rapido_en',e.marcado_rapido_en,
    'marcado_rapido_por',e.marcado_rapido_por,
    'datos_pendientes',e.datos_pendientes,
    'datos_completados_en',e.datos_completados_en,
    'datos_completados_por',e.datos_completados_por,
    'modelo_flujo_taller',coalesce(m.modelo,'legacy'),
    'es_entrada_taller',
      app_private.es_tipo_entrada_taller_alpha75(e.tipo_etapa)
      and coalesce(e.accion_sistema,'') not in ('recuperar_y_liberar','liberar_reserva'),
    'pizarra_estado',p.estado,
    'registro_cancelado',r.cancelado,
    'retirado_hotel_activo',r.retirado_hotel_activo
  )
  from public.etapas_hotel e
  join public.registros_hotel r on r.id=e.registro_hotel_id
  join public.pizarras p on p.id=r.pizarra_id
  left join app_private.hotel_flujo_modelo m on m.seguimiento_id=r.seguimiento_id
  where e.id=p_etapa_id;
$function$;

revoke all on function app_private.contexto_etapa_taller_alpha75(uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.obtener_contexto_taller_t_alpha75(p_etapa_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or public.dispositivo_autorizado() is not true
     or public.es_administrador_principal() is not true then
    raise exception 'Solo el administrador principal puede consultar los controles de las T';
  end if;
  if coalesce(cardinality(p_etapa_ids),0)=0 then return '[]'::jsonb; end if;
  if cardinality(p_etapa_ids)>500 or array_position(p_etapa_ids,null) is not null then
    raise exception 'La consulta admite hasta 500 identificadores de T válidos';
  end if;

  select coalesce(
    jsonb_agg(app_private.contexto_etapa_taller_alpha75(e.id)
      order by array_position(p_etapa_ids,e.id)),
    '[]'::jsonb
  ) into v_result
  from public.etapas_hotel e
  where e.id=any(p_etapa_ids);

  return v_result;
end;
$function$;

revoke all on function app_private.obtener_contexto_taller_t_alpha75(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function app_private.obtener_contexto_taller_t_alpha75(uuid[])
  to authenticated, service_role;

create or replace function public.obtener_contexto_taller_t_alpha75(p_etapa_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path to 'pg_catalog', 'app_private'
as $function$
  select app_private.obtener_contexto_taller_t_alpha75(p_etapa_ids);
$function$;

revoke all on function public.obtener_contexto_taller_t_alpha75(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.obtener_contexto_taller_t_alpha75(uuid[])
  to authenticated, service_role;
-- END ALPHA75_TALLER_CONTEXT

create or replace function app_private.registrar_hito_taller_alpha75(
  p_etapa_id uuid,
  p_version integer,
  p_hito text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_registro_id uuid;
  v_stage public.etapas_hotel%rowtype;
  v_record public.registros_hotel%rowtype;
  v_board_state text;
  v_modelo text;
  v_now timestamptz;
  v_siguiente_hito text;
  v_nuevo_estado text;
  v_efecto text;
  v_orden jsonb;
  v_siguiente_etapa jsonb;
  v_contexto jsonb;
  v_record_state text;
begin
  if auth.uid() is null
     or public.dispositivo_autorizado() is not true
     or public.es_administrador_principal() is not true then
    raise exception 'Solo el administrador principal puede confirmar un hito de taller';
  end if;
  if p_etapa_id is null or p_version is null then
    raise exception 'No se ha identificado la T o su versión';
  end if;
  if p_hito is null or p_hito not in ('entrada','terminado','recogido') then
    raise exception 'Hito de taller no válido';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de operación no válido';
  end if;

  -- El editor bloquea ficha antes que T: se conserva ese orden de bloqueos.
  select e.registro_hotel_id into v_registro_id
  from public.etapas_hotel e where e.id=p_etapa_id;
  if not found then raise exception 'La T indicada no existe'; end if;

  select r.* into v_record
  from public.registros_hotel r where r.id=v_registro_id for update;
  if not found then raise exception 'La ficha indicada no existe'; end if;

  select e.* into v_stage
  from public.etapas_hotel e where e.id=p_etapa_id for update;
  if not found or v_stage.registro_hotel_id is distinct from v_registro_id then
    raise exception 'La T ha cambiado de ficha. Recarga la Pizarra antes de confirmarla.';
  end if;

  select p.estado into v_board_state
  from public.pizarras p where p.id=v_record.pizarra_id for share;
  if v_board_state is distinct from 'en_curso' then
    raise exception 'Los hitos de taller solo están disponibles en la Pizarra actual';
  end if;
  if v_stage.version is distinct from p_version then
    raise exception 'La T ha cambiado desde que se cargó. Recarga la Pizarra antes de confirmarla.';
  end if;
  if v_record.cancelado or v_record.retirado_hotel_activo
     or v_record.estado in ('recuperado','reserva_liberada','anulado') then
    raise exception 'La ficha está cerrada o anulada. Revisa sus datos en el editor.';
  end if;
  if v_stage.cancelado or v_stage.estado='anulada' then
    raise exception 'Una T anulada no admite hitos de taller';
  end if;

  select m.modelo into v_modelo
  from app_private.hotel_flujo_modelo m
  where m.seguimiento_id=v_record.seguimiento_id for share;
  if v_modelo is distinct from 'entrada_hitos_v1'
     or not app_private.es_tipo_entrada_taller_alpha75(v_stage.tipo_etapa)
     or coalesce(v_stage.accion_sistema,'') in ('recuperar_y_liberar','liberar_reserva') then
    raise exception 'Esta T no es una entrada de taller del flujo por hitos';
  end if;

  v_now := clock_timestamp();

  -- Las fechas previas son hechos. Una cadena incompleta o imposible se revisa,
  -- nunca se completa inventando la entrada, el acabado o la recogida anteriores.
  if (v_stage.fecha_inicio_real is not null
      and (not isfinite(v_stage.fecha_inicio_real) or v_stage.fecha_inicio_real>v_now))
     or (v_stage.fecha_fin_real is not null
      and (not isfinite(v_stage.fecha_fin_real) or v_stage.fecha_fin_real>v_now))
     or (v_stage.fecha_real is not null
      and (not isfinite(v_stage.fecha_real) or v_stage.fecha_real>v_now)) then
    raise exception 'La T contiene una fecha real futura o no válida. Revisa sus fechas en el editor.';
  end if;
  if (v_stage.fecha_fin_real is not null and v_stage.fecha_inicio_real is null)
     or (v_stage.fecha_real is not null
      and (v_stage.fecha_inicio_real is null or v_stage.fecha_fin_real is null)) then
    raise exception 'La T contiene hitos incompletos: falta la entrada o el acabado previo. Revisa sus fechas en el editor.';
  end if;
  if v_stage.fecha_fin_real<v_stage.fecha_inicio_real
     or v_stage.fecha_real<v_stage.fecha_fin_real then
    raise exception 'Las fechas de la T están fuera de orden: entrada, acabado y recogida. Revisa sus fechas en el editor.';
  end if;
  if v_stage.estado='realizada' and v_stage.fecha_real is null then
    raise exception 'La T figura realizada sin una recogida registrada. Revisa la T en el editor.';
  end if;
  if v_stage.fecha_real is not null then
    raise exception 'La recogida de esta T ya está registrada';
  end if;

  v_siguiente_hito := case
    when v_stage.fecha_inicio_real is null then 'entrada'
    when v_stage.fecha_fin_real is null then 'terminado'
    else 'recogido'
  end;
  if p_hito<>v_siguiente_hito then
    raise exception 'El siguiente hito pendiente es %. Recarga la T antes de confirmarla.',
      case v_siguiente_hito
        when 'entrada' then 'Entrada a taller'
        when 'terminado' then 'Terminado en taller'
        else 'Recogido de taller'
      end;
  end if;

  v_nuevo_estado := case when p_hito='recogido' then 'realizada' else 'en_curso' end;
  v_efecto := case p_hito
    when 'entrada' then 'Entrada a taller registrada'
    when 'terminado' then 'Terminado en taller; pendiente de recoger'
    else 'Recogida de taller registrada'
  end;

  perform set_config('app.request_id',p_request_id,true);
  perform set_config('app.audit_origin','metrogestion-r1-taller-hito',true);
  perform set_config('app.audit_reason',
    format('T %s: %s',v_stage.posicion,v_efecto),true);

  update public.etapas_hotel
  set fecha_inicio_real=case when p_hito='entrada' then v_now else fecha_inicio_real end,
      fecha_fin_real=case when p_hito='terminado' then v_now else fecha_fin_real end,
      fecha_real=case when p_hito='recogido' then v_now else fecha_real end,
      estado=v_nuevo_estado,
      estado_catalogo_codigo=case
        when estado=v_nuevo_estado then estado_catalogo_codigo
        else v_nuevo_estado
      end,
      modificado_por=auth.uid()
  where id=p_etapa_id and version=p_version;
  if not found then
    raise exception 'La T cambió antes de confirmarse. Recarga la Pizarra.';
  end if;

  -- Los triggers existentes actualizan movimiento y las fechas de sus trabajos.
  -- Sincronizar aquí hace que la respuesta vea la misma cabecera que el COMMIT;
  -- no se llama a reconciliar, reordenar ni realizar ninguna otra T.
  perform app_private.sincronizar_situacion_operativa_hotel_alpha75(v_registro_id,true);
  select r.estado into v_record_state
  from public.registros_hotel r where r.id=v_registro_id;
  v_contexto := app_private.contexto_etapa_taller_alpha75(p_etapa_id);

  if p_hito='recogido' then
    v_orden := app_private.estado_t_pendiente_por_orden_alpha75(v_registro_id);
    select jsonb_build_object(
      'id',e.id,'nombre',e.nombre,'posicion',e.posicion,
      'tipo_etapa',e.tipo_etapa,'estado',e.estado
    ) into v_siguiente_etapa
    from public.etapas_hotel e
    where e.id=nullif(v_orden->>'etapa_id','')::uuid
      and e.registro_hotel_id=v_registro_id
      and e.id<>p_etapa_id
      and not e.cancelado
      and e.estado in ('pendiente','programada','en_curso');
  end if;

  return jsonb_build_object(
    'ok',true,
    'request_id',p_request_id,
    'hito',p_hito,
    'efecto',v_efecto,
    'etapa',v_contexto,
    'registro_estado',v_record_state,
    'siguiente_etapa',v_siguiente_etapa
  );
end;
$function$;

revoke all on function app_private.registrar_hito_taller_alpha75(uuid,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function app_private.registrar_hito_taller_alpha75(uuid,integer,text,text)
  to authenticated, service_role;

create or replace function public.registrar_hito_taller_alpha75(
  p_etapa_id uuid,
  p_version integer,
  p_hito text,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path to 'pg_catalog', 'app_private'
as $function$
  select app_private.registrar_hito_taller_alpha75(
    p_etapa_id,p_version,p_hito,p_request_id
  );
$function$;

revoke all on function public.registrar_hito_taller_alpha75(uuid,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.registrar_hito_taller_alpha75(uuid,integer,text,text)
  to authenticated, service_role;

-- Cambios acotados sobre las definiciones existentes: conservan owner, ACL,
-- search_path y todas las ramas ajenas a entrada_hitos_v1.
-- Cada ancla exige una coincidencia exacta; cualquier deriva aborta la migración.
do $patch$
declare
  v_definition text;
  v_patch record;
  v_count integer;
begin
  for v_patch in
    select * from (values
      (
        'app_private.marcar_t_realizada_rapida(uuid,integer,text)',
        $old$  if v_stage.estado = 'realizada' then$old$,
        $new$  if app_private.usa_flujo_taller_hitos(v_stage.registro_hotel_id)
     and app_private.es_tipo_entrada_taller_alpha75(v_stage.tipo_etapa)
     and coalesce(v_stage.accion_sistema,'') not in ('recuperar_y_liberar','liberar_reserva') then
    raise exception 'Esta entrada de taller se confirma por hitos: Entrada a taller, Terminado en taller y Recogido de taller.';
  end if;
  if v_stage.estado = 'realizada' then$new$,
        1
      ),
      (
        'app_private.manteniment_fechas_desde_etapa()',
        $old$if v_nuevo and new.tipo_etapa='entrada_taller' and not new.cancelado then$old$,
        $new$if v_nuevo and app_private.es_tipo_entrada_taller_alpha75(new.tipo_etapa)
     and coalesce(new.accion_sistema,'') not in ('recuperar_y_liberar','liberar_reserva')
     and not new.cancelado then$new$,
        1
      ),
      (
        'app_private.recalcular_fechas_manteniment_alpha75(uuid)',
        $old$and e.tipo_etapa='entrada_taller'
                 and e.grupo_documental_id=v.grupo_entrada_id$old$,
        $new$and app_private.es_tipo_entrada_taller_alpha75(e.tipo_etapa)
                 and e.grupo_documental_id=v.grupo_entrada_id$new$,
        2
      ),
      (
        'app_private.proyectar_situacion_operativa_hotel_alpha75(uuid)',
        $old$      e.tipo_etapa = 'entrada_taller'
      or ($old$,
        $new$      e.tipo_etapa = 'entrada_taller'
      or (app_private.usa_flujo_taller_hitos(p_registro_id)
        and app_private.es_tipo_entrada_taller_alpha75(e.tipo_etapa))
      or ($new$,
        1
      ),
      (
        'app_private.estado_t_pendiente_por_orden_alpha75(uuid)',
        $old$elsif v_tipo='entrada_taller' then$old$,
        $new$elsif v_tipo='entrada_taller'
     or (app_private.usa_flujo_taller_hitos(p_registro_id)
       and app_private.es_tipo_entrada_taller_alpha75(v_tipo)) then$new$,
        1
      ),
      (
        'app_private.estado_t_pendiente_por_orden_alpha75(uuid)',
        $old$      and lower(
        translate(
          btrim(coalesce(e.tipo_etapa,'')),
          'ÁÉÍÓÚÜÑáéíóúüñ',
          'AEIOUUNaeiouun'
        )
      )='entrada_taller'$old$,
        $new$      and (
        lower(translate(btrim(coalesce(e.tipo_etapa,'')),
          'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))='entrada_taller'
        or (app_private.usa_flujo_taller_hitos(p_registro_id)
          and app_private.es_tipo_entrada_taller_alpha75(e.tipo_etapa))
      )$new$,
        1
      ),
      (
        'app_private.cierre_sin_recuperacion_completo_rec001(uuid)',
        $old$IF lower(v_e.tipo_etapa)='entrada_taller' THEN$old$,
        $new$IF lower(v_e.tipo_etapa)='entrada_taller'
     OR (v_modelo='entrada_hitos_v1'
       AND app_private.es_tipo_entrada_taller_alpha75(v_e.tipo_etapa)) THEN$new$,
        1
      ),
      (
        'app_private.cerrar_modalidad_hotel_sin_recuperacion(uuid)',
        $old$AND NOT e.cancelado AND e.tipo_etapa='entrada_taller'
   AND e.fecha_inicio_real IS NOT NULL AND e.fecha_real IS NULL$old$,
        $new$AND NOT e.cancelado
   AND (e.tipo_etapa='entrada_taller'
     OR (app_private.usa_flujo_taller_hitos(p_registro_id)
       AND app_private.es_tipo_entrada_taller_alpha75(e.tipo_etapa)))
   AND e.fecha_inicio_real IS NOT NULL AND e.fecha_real IS NULL$new$,
        1
      )
    ) as patches(signature,old_text,new_text,expected_count)
  loop
    v_definition := pg_get_functiondef(v_patch.signature::regprocedure);
    v_count := (length(v_definition)-length(replace(v_definition,v_patch.old_text,'')))
      / greatest(length(v_patch.old_text),1);
    if v_count<>v_patch.expected_count then
      raise exception 'MG75-TALLER-HITOS-001: ha cambiado % (anclas %, esperadas %); revisar antes de aplicar',
        v_patch.signature,v_count,v_patch.expected_count;
    end if;
    execute replace(v_definition,v_patch.old_text,v_patch.new_text);
  end loop;
end;
$patch$;
