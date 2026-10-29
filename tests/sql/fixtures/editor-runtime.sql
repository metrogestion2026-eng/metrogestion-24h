-- Native full-editor fixture, never a migration or deployment script.
-- Literal schema-only runtime definitions read on 29/10/2026.
-- Apply AFTER createContinuityFixture. Candidate guard/reconciliation/continuity
-- definitions are retained; no old implementation replaces those migrations.
-- Synthetic users, authorization, audit, document storage and external work
-- services remain explicitly outside this fixture's acceptance boundary.
BEGIN;
SET LOCAL check_function_bodies=off;
SET LOCAL search_path=public,pg_catalog;
-- The old explicitly labelled reactivation stub returned void; runtime returns
-- the active row UUID. Drop only this local double, without CASCADE.
DROP FUNCTION app_private.asegurar_reactivacion_historica(uuid);

ALTER TABLE public.catalogo_estados_hotel
 ADD COLUMN nombre text NOT NULL DEFAULT 'Estado sintético',
 ADD COLUMN orden integer NOT NULL DEFAULT 0,
 ADD COLUMN color_semantico text NOT NULL DEFAULT 'neutral';
ALTER TABLE public.catalogo_modalidades_operativas_hotel ADD COLUMN orden integer NOT NULL DEFAULT 0;
ALTER TABLE public.catalogo_estados_etapa_hotel
 ADD COLUMN nombre text NOT NULL DEFAULT 'Estado sintético',ADD COLUMN orden integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT catalogo_estados_etapa_operativo_check CHECK(estado_operativo=ANY(ARRAY['pendiente','programada','en_curso','realizada','anulada']));
CREATE TABLE public.catalogo_tipos_etapa_hotel(
 codigo text PRIMARY KEY,nombre text NOT NULL,orden integer NOT NULL DEFAULT 0,activo boolean NOT NULL DEFAULT true);
ALTER TABLE public.talleres
 ADD COLUMN observaciones text NOT NULL DEFAULT '',ADD COLUMN activo boolean NOT NULL DEFAULT true,
 ADD COLUMN creado_por uuid,ADD COLUMN modificado_por uuid,
 ADD COLUMN version integer NOT NULL DEFAULT 1,ADD COLUMN creado_en timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN actualizado_en timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.centros_taller
 ADD COLUMN taller_id uuid REFERENCES public.talleres(id),ADD COLUMN direccion text NOT NULL DEFAULT '',
 ADD COLUMN poblacion text NOT NULL DEFAULT '',ADD COLUMN provincia text NOT NULL DEFAULT '',
 ADD COLUMN telefono text NOT NULL DEFAULT '',ADD COLUMN observaciones text NOT NULL DEFAULT '',
 ADD COLUMN activo boolean NOT NULL DEFAULT true,ADD COLUMN creado_por uuid,ADD COLUMN modificado_por uuid,
 ADD COLUMN version integer NOT NULL DEFAULT 1,ADD COLUMN creado_en timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN actualizado_en timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.trabajos_etapa_hotel ADD COLUMN cancelado_en timestamptz,ADD COLUMN cancelado_por uuid;
ALTER TABLE public.anotaciones_manuales_hotel
 ADD COLUMN clave_importacion text,ADD COLUMN autor_id uuid,ADD COLUMN modificado_por uuid,
 ADD COLUMN motivo_cancelacion text NOT NULL DEFAULT '',ADD COLUMN cancelada_en timestamptz,
 ADD COLUMN cancelada_por uuid,ADD COLUMN request_id text,
 ALTER COLUMN fecha_evento SET DEFAULT clock_timestamp(),
 ADD CONSTRAINT anotaciones_manuales_hotel_cancelacion_coherente CHECK(NOT cancelada AND cancelada_en IS NULL AND cancelada_por IS NULL OR cancelada AND cancelada_en IS NOT NULL AND cancelada_por IS NOT NULL AND btrim(motivo_cancelacion)<>''),
 ADD CONSTRAINT anotaciones_manuales_hotel_origen_check CHECK(origen=ANY(ARRAY['manual','importada'])),
 ADD CONSTRAINT anotaciones_manuales_hotel_texto_check CHECK(length(btrim(texto)) BETWEEN 1 AND 4000),
 ADD CONSTRAINT anotaciones_manuales_hotel_version_check CHECK(version>0);
ALTER TABLE public.hotel_edicion_piloto ADD COLUMN habilitado_en timestamptz DEFAULT now();
ALTER TABLE app_private.hotel_flujo_modelo ADD COLUMN creado_en timestamptz DEFAULT clock_timestamp();
ALTER TABLE app_private.manteniment_t_visitas
 ADD COLUMN grupo_entrada_id uuid,ADD COLUMN grupo_recogida_id uuid,ADD COLUMN taller text;
ALTER TABLE app_private.manteniment_t_trabajos
 ADD COLUMN id uuid DEFAULT gen_random_uuid(),ADD COLUMN visita_id uuid,
 ADD COLUMN trabajo_hotel_id uuid,ADD COLUMN tipo_trabajo text,ADD COLUMN designacion text,
 ADD COLUMN fecha_realizada date,ADD COLUMN fecha_recogida date;
-- Real existing version trigger now covers existing work and catalog edits.
CREATE TRIGGER trabajos_etapa_touch BEFORE UPDATE ON public.trabajos_etapa_hotel
 FOR EACH ROW EXECUTE FUNCTION app_private.tocar_actualizado_en_y_version();
CREATE TRIGGER talleres_touch BEFORE UPDATE ON public.talleres
 FOR EACH ROW EXECUTE FUNCTION app_private.tocar_actualizado_en_y_version();
CREATE TRIGGER centros_taller_touch BEFORE UPDATE ON public.centros_taller
 FOR EACH ROW EXECUTE FUNCTION app_private.tocar_actualizado_en_y_version();
-- Literal runtime MD5: fd6b6833e496f8f0696d5b125a5251cb (app_private.asegurar_reactivacion_historica(uuid))
CREATE OR REPLACE FUNCTION app_private.asegurar_reactivacion_historica(p_registro_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_source public.registros_hotel%rowtype;
  v_board_state text;
  v_current_board uuid;
  v_current_id uuid;
  v_actor uuid;
  v_new_record uuid;
  v_new_stage uuid;
  v_pos integer := 0;
  e public.etapas_hotel%rowtype;
  t public.trabajos_etapa_hotel%rowtype;
begin
  select * into v_source
  from public.registros_hotel
  where id = p_registro_id;
  if not found then return null; end if;

  select estado into v_board_state
  from public.pizarras
  where id = v_source.pizarra_id;

  if v_board_state <> 'archivada' then return null; end if;
  if v_source.cancelado then return null; end if;
  if v_source.estado in ('recuperado', 'reserva_liberada', 'anulado') then return null; end if;
  if not v_source.retirado_hotel_activo then return null; end if;

  select id into v_current_board
  from public.pizarras
  where estado = 'en_curso'
  order by fecha desc
  limit 1;
  if v_current_board is null then return null; end if;

  select r.id into v_current_id
  from public.registros_hotel r
  where r.pizarra_id = v_current_board
    and r.seguimiento_id = v_source.seguimiento_id
  order by r.actualizado_en desc
  limit 1;

  v_actor := coalesce(auth.uid(), v_source.modificado_por, v_source.creado_por);
  perform set_config('app.audit_origin', 'metrogestion-r1-history-reactivation', true);

  if v_current_id is not null then
    update public.registros_hotel
    set estado = v_source.estado,
        vehiculo_reserva = v_source.vehiculo_reserva,
        matricula_reserva = v_source.matricula_reserva,
        etiqueta_reserva = v_source.etiqueta_reserva,
        tipo_sustituto = v_source.tipo_sustituto,
        retirado_hotel_activo = false,
        fecha_retirado_hotel = null,
        cancelado = false,
        motivo_cancelacion = '',
        cancelado_en = null,
        cancelado_por = null,
        modificado_por = v_actor
    where id = v_current_id
      and (
        retirado_hotel_activo
        or cancelado
        or estado in ('recuperado', 'reserva_liberada', 'anulado')
      );

    perform app_private.reabrir_cierre_ficha_hotel(v_current_id, v_actor);
    return v_current_id;
  end if;

  perform set_config('app.clonando_pizarra', '1', true);
  perform set_config('app.reconciliando_etapas', '1', true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  insert into public.registros_hotel(
    pizarra_id, seguimiento_id, numero_parada,
    vehiculo_sustituido, matricula_sustituido,
    vehiculo_reserva, matricula_reserva, etiqueta_reserva,
    tipo_unidad, marca, tipo_motor, modelo, upc, telefono,
    prioridad, estado, lugar, fecha_parada, fecha_entrada, tipo_movimiento,
    causa, trabajos_reserva, incidencia, proximo, observaciones,
    sustitucion_temporal, motivo_sustitucion_temporal, fecha_limite_sustitucion,
    orden, retirado_hotel_activo, fecha_retirado_hotel,
    cancelado, motivo_cancelacion, cancelado_en, cancelado_por,
    creado_por, modificado_por, tipo_sustituto, trazo_marron, modalidad_operativa
  ) values (
    v_current_board, v_source.seguimiento_id, v_source.numero_parada,
    v_source.vehiculo_sustituido, v_source.matricula_sustituido,
    v_source.vehiculo_reserva, v_source.matricula_reserva, v_source.etiqueta_reserva,
    v_source.tipo_unidad, v_source.marca, v_source.tipo_motor, v_source.modelo, v_source.upc, v_source.telefono,
    v_source.prioridad, v_source.estado, v_source.lugar, v_source.fecha_parada, v_source.fecha_entrada, v_source.tipo_movimiento,
    v_source.causa, v_source.trabajos_reserva, v_source.incidencia, v_source.proximo, v_source.observaciones,
    v_source.sustitucion_temporal, v_source.motivo_sustitucion_temporal, v_source.fecha_limite_sustitucion,
    (select coalesce(max(r.orden), 0) + 1 from public.registros_hotel r where r.pizarra_id = v_current_board and not r.cancelado),
    false, null, false, '', null, null,
    v_actor, v_actor, v_source.tipo_sustituto, v_source.trazo_marron, v_source.modalidad_operativa
  ) returning id into v_new_record;

  insert into public.hotel_edicion_piloto(registro_hotel_id, activo, observaciones)
  values(v_new_record, true, 'Reactivada desde Historico')
  on conflict(registro_hotel_id) do update
    set activo = true, observaciones = 'Reactivada desde Historico';

  create temp table if not exists tmp_reactivar_stage_map(
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;
  truncate tmp_reactivar_stage_map;

  for e in
    select * from public.etapas_hotel
    where registro_hotel_id = p_registro_id
    order by cancelado, posicion, creado_en, id
  loop
    if not e.cancelado then v_pos := v_pos + 1; end if;

    insert into public.etapas_hotel(
      registro_hotel_id, seguimiento_id, nombre, posicion, estado, estado_catalogo_codigo, tipo_etapa,
      taller_id, centro_taller_id, lugar, fecha_prevista, fecha_inicio_real,
      fecha_fin_real, fecha_real, observaciones, cancelado, motivo_cancelacion,
      cancelado_en, cancelado_por, creado_por, modificado_por, accion_sistema, etapa_origen_id, grupo_documental_id
    ) values (
      v_new_record, e.seguimiento_id, e.nombre,
      case when e.cancelado then e.posicion else v_pos end,
      e.estado, e.estado_catalogo_codigo, e.tipo_etapa,
      e.taller_id, e.centro_taller_id, e.lugar, e.fecha_prevista, e.fecha_inicio_real,
      e.fecha_fin_real, e.fecha_real, e.observaciones, e.cancelado, e.motivo_cancelacion,
      e.cancelado_en, e.cancelado_por, v_actor, v_actor, e.accion_sistema, null, e.grupo_documental_id
    ) returning id into v_new_stage;

    insert into tmp_reactivar_stage_map(old_id, new_id) values(e.id, v_new_stage);

    for t in
      select * from public.trabajos_etapa_hotel
      where etapa_hotel_id = e.id
      order by creado_en, id
    loop
      insert into public.trabajos_etapa_hotel(
        etapa_hotel_id, tipo_trabajo, categoria_tecnica, motivo_entrada,
        diagnostico_real, km_averia, expediente, descripcion, peritaje_estado,
        observaciones, cancelado, motivo_cancelacion, cancelado_en, cancelado_por,
        creado_por, modificado_por
      ) values (
        v_new_stage, t.tipo_trabajo, t.categoria_tecnica, t.motivo_entrada,
        t.diagnostico_real, t.km_averia, t.expediente, t.descripcion, t.peritaje_estado,
        t.observaciones, t.cancelado, t.motivo_cancelacion, t.cancelado_en, t.cancelado_por,
        v_actor, v_actor
      );
    end loop;
  end loop;

  update public.etapas_hotel n
  set etapa_origen_id = m_origin.new_id
  from public.etapas_hotel e_old
  join tmp_reactivar_stage_map m on m.old_id = e_old.id
  join tmp_reactivar_stage_map m_origin on m_origin.old_id = e_old.etapa_origen_id
  where n.id = m.new_id;

  perform set_config('app.reconciliando_etapas', '0', true);
  perform set_config('app.clonando_pizarra', '0', true);
  perform app_private.reabrir_cierre_ficha_hotel(v_new_record, v_actor);
  return v_new_record;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.asegurar_reactivacion_historica(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.asegurar_reactivacion_historica(uuid) TO service_role;
-- Literal runtime MD5: 6059f56372cb3a28db5aeb6bcc1232e3 (app_private.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text))
CREATE OR REPLACE FUNCTION app_private.guardar_ficha_hotel_edicion_alpha71(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_saved jsonb;
  v_tracking uuid;
  v_tancament text;
  v_supervisado boolean;
  v_sync app_private.manteniment_parada_sync%rowtype;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;
  select seguimiento_id into v_tracking
  from public.registros_hotel
  where id = p_registro_id;
  if v_tracking is null then raise exception 'Ficha de Hotel no encontrada'; end if;

  v_saved := app_private.guardar_ficha_hotel_edicion_catalogos(
    p_registro_id, p_version, p_ficha, p_etapas, p_request_id
  );
  v_tancament := upper(btrim(coalesce(p_ficha->>'manteniment_tancament', '')));
  if v_tancament <> '' and v_tancament !~ '^TANCAMENT [0-9]{1,3}$' then
    raise exception 'TANCAMENT debe escribirse seguido del número de periodo, por ejemplo TANCAMENT 8';
  end if;

  select * into v_sync
  from app_private.manteniment_parada_sync
  where seguimiento_id = v_tracking
  for update;

  v_supervisado := coalesce((p_ficha->>'manteniment_tancament_supervisado')::boolean, false);
  if v_supervisado and not public.es_administrador_principal() then
    v_supervisado := coalesce(v_sync.tancament_supervisado, false);
  end if;

  insert into app_private.manteniment_parada_sync(
    seguimiento_id, fecha_programada_parada, fecha_corte, tancament,
    tancament_supervisado, tancament_supervisado_por, tancament_supervisado_en,
    dias_parada_manual, km_facturables_manual
  ) values (
    v_tracking,
    nullif(p_ficha->>'fecha_programada_parada', '')::date,
    nullif(p_ficha->>'manteniment_fecha_corte', '')::date,
    v_tancament,
    v_supervisado,
    case when v_supervisado then auth.uid() end,
    case when v_supervisado then clock_timestamp() end,
    nullif(p_ficha->>'manteniment_dias_parada_manual', '')::integer,
    nullif(p_ficha->>'manteniment_km_facturables_manual', '')::numeric
  )
  on conflict (seguimiento_id) do update
  set fecha_programada_parada = excluded.fecha_programada_parada,
      fecha_corte = excluded.fecha_corte,
      tancament = excluded.tancament,
      tancament_supervisado = case
        when excluded.tancament is distinct from app_private.manteniment_parada_sync.tancament
          or excluded.fecha_corte is distinct from app_private.manteniment_parada_sync.fecha_corte
        then false
        else excluded.tancament_supervisado
      end,
      tancament_supervisado_por = case
        when excluded.tancament_supervisado then auth.uid()
        else null
      end,
      tancament_supervisado_en = case
        when excluded.tancament_supervisado then clock_timestamp()
        else null
      end,
      dias_parada_manual = excluded.dias_parada_manual,
      km_facturables_manual = excluded.km_facturables_manual;

  v_saved := v_saved || jsonb_build_object(
    'detalle', app_private.obtener_ficha_hotel_edicion_alpha71(p_registro_id)
  );
  return v_saved;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text) TO authenticated,service_role;
-- Literal runtime MD5: 515e6e0aa3b998bf8ad0c4ba79aefab5 (app_private.guardar_ficha_hotel_edicion_catalogos(uuid,integer,jsonb,jsonb,text))
CREATE OR REPLACE FUNCTION app_private.guardar_ficha_hotel_edicion_catalogos(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_ficha_out jsonb:=p_ficha;
  v_ficha_estado_input text; v_ficha_estado_codigo text;
  v_stage jsonb; v_stage_out jsonb; v_work jsonb; v_work_out jsonb;
  v_stages_out jsonb:='[]'::jsonb; v_works_out jsonb;
  v_taller_id uuid; v_taller_nombre text; v_centro_id uuid; v_centro_nombre text;
  v_tipo_input text; v_tipo_codigo text; v_tipo_nombre text;
  v_estado_etapa_input text; v_estado_etapa_codigo text; v_estado_operativo text;
  v_tipo_etapa_input text; v_tipo_etapa_codigo text; v_saved jsonb;
  v_new_estados integer:=0; v_new_estados_etapa integer:=0; v_new_tipos_etapa integer:=0;
  v_new_talleres integer:=0; v_new_centros integer:=0; v_new_tipos integer:=0;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_editar_modulo('hotel') then raise exception 'No tienes permiso para modificar Hotel'; end if;
  if jsonb_typeof(p_ficha)<>'object' or jsonb_typeof(p_etapas)<>'array' then raise exception 'Formato de ficha o T no válido'; end if;

  v_ficha_estado_input:=btrim(coalesce(p_ficha->>'estado',''));
  if coalesce((p_ficha->>'cancelado')::boolean,false) then
    v_ficha_out:=jsonb_set(v_ficha_out,'{estado}',to_jsonb('anulado'::text),true);
  elsif v_ficha_estado_input<>'' then
    if char_length(v_ficha_estado_input)>120 then raise exception 'El estado de la ficha es demasiado largo'; end if;
    select c.codigo into v_ficha_estado_codigo from public.catalogo_estados_hotel c
    where c.activo=true and (lower(btrim(c.codigo))=lower(v_ficha_estado_input) or lower(btrim(c.nombre))=lower(v_ficha_estado_input))
    order by (lower(btrim(c.codigo))=lower(v_ficha_estado_input)) desc limit 1;
    if v_ficha_estado_codigo is null then
      begin
        insert into public.catalogo_estados_hotel(codigo,nombre,orden,color_semantico,activo)
        select v_ficha_estado_input,v_ficha_estado_input,coalesce(max(orden),0)+10,'neutral',true from public.catalogo_estados_hotel
        returning codigo into v_ficha_estado_codigo;
        v_new_estados:=v_new_estados+1;
      exception when unique_violation then
        select c.codigo into v_ficha_estado_codigo from public.catalogo_estados_hotel c
        where lower(btrim(c.codigo))=lower(v_ficha_estado_input) or lower(btrim(c.nombre))=lower(v_ficha_estado_input) limit 1;
      end;
    end if;
    v_ficha_out:=jsonb_set(v_ficha_out,'{estado}',to_jsonb(v_ficha_estado_codigo),true);
  end if;

  for v_stage in select value from jsonb_array_elements(p_etapas) loop
    v_stage_out:=v_stage;
    if coalesce((v_stage->>'cancelado')::boolean,false) then
      v_estado_operativo:='anulada'; v_estado_etapa_codigo:='anulada';
    else
      v_estado_operativo:=coalesce(nullif(v_stage->>'estado',''),'pendiente');
      if v_estado_operativo not in ('pendiente','programada','en_curso','realizada') then raise exception 'El estado operativo de una T no es válido'; end if;
      v_estado_etapa_input:=btrim(coalesce(v_stage->>'estado_catalogo_codigo',v_stage->>'estado',''));
      if v_estado_etapa_input='' then v_estado_etapa_input:=v_estado_operativo; end if;
      if char_length(v_estado_etapa_input)>120 then raise exception 'El estado visible de una T es demasiado largo'; end if;
      select c.codigo,c.estado_operativo into v_estado_etapa_codigo,v_estado_operativo from public.catalogo_estados_etapa_hotel c
      where c.activo=true and (lower(btrim(c.codigo))=lower(v_estado_etapa_input) or lower(btrim(c.nombre))=lower(v_estado_etapa_input))
      order by (lower(btrim(c.codigo))=lower(v_estado_etapa_input)) desc limit 1;
      if v_estado_etapa_codigo is null then
        v_estado_operativo:=coalesce(nullif(v_stage->>'estado',''),'pendiente');
        begin
          insert into public.catalogo_estados_etapa_hotel(codigo,nombre,estado_operativo,orden,activo)
          select v_estado_etapa_input,v_estado_etapa_input,v_estado_operativo,coalesce(max(orden),0)+10,true from public.catalogo_estados_etapa_hotel
          returning codigo into v_estado_etapa_codigo;
          v_new_estados_etapa:=v_new_estados_etapa+1;
        exception when unique_violation then
          select c.codigo,c.estado_operativo into v_estado_etapa_codigo,v_estado_operativo from public.catalogo_estados_etapa_hotel c
          where lower(btrim(c.codigo))=lower(v_estado_etapa_input) or lower(btrim(c.nombre))=lower(v_estado_etapa_input) limit 1;
        end;
      end if;
    end if;
    v_stage_out:=jsonb_set(v_stage_out,'{estado}',to_jsonb(v_estado_operativo),true);
    v_stage_out:=jsonb_set(v_stage_out,'{estado_catalogo_codigo}',to_jsonb(v_estado_etapa_codigo),true);

    v_tipo_etapa_input:=btrim(coalesce(v_stage->>'tipo_etapa','otro'));
    if v_tipo_etapa_input='' then v_tipo_etapa_input:='otro'; end if;
    if char_length(v_tipo_etapa_input)>120 then raise exception 'El tipo de T es demasiado largo'; end if;
    select c.codigo into v_tipo_etapa_codigo from public.catalogo_tipos_etapa_hotel c
    where c.activo=true and (lower(btrim(c.codigo))=lower(v_tipo_etapa_input) or lower(btrim(c.nombre))=lower(v_tipo_etapa_input))
    order by (lower(btrim(c.codigo))=lower(v_tipo_etapa_input)) desc limit 1;
    if v_tipo_etapa_codigo is null then
      begin
        insert into public.catalogo_tipos_etapa_hotel(codigo,nombre,orden,activo)
        select v_tipo_etapa_input,v_tipo_etapa_input,coalesce(max(orden),0)+10,true from public.catalogo_tipos_etapa_hotel
        returning codigo into v_tipo_etapa_codigo;
        v_new_tipos_etapa:=v_new_tipos_etapa+1;
      exception when unique_violation then
        select c.codigo into v_tipo_etapa_codigo from public.catalogo_tipos_etapa_hotel c
        where lower(btrim(c.codigo))=lower(v_tipo_etapa_input) or lower(btrim(c.nombre))=lower(v_tipo_etapa_input) limit 1;
      end;
    end if;
    v_stage_out:=jsonb_set(v_stage_out,'{tipo_etapa}',to_jsonb(v_tipo_etapa_codigo),true);

    v_taller_id:=nullif(v_stage->>'taller_id','')::uuid;
    v_taller_nombre:=btrim(coalesce(v_stage->>'taller_nombre',''));
    if char_length(v_taller_nombre)>160 then raise exception 'El nombre del taller es demasiado largo'; end if;
    if v_taller_id is null and v_taller_nombre<>'' then
      select t.id into v_taller_id from public.talleres t where t.activo=true and lower(btrim(t.nombre))=lower(v_taller_nombre) order by t.creado_en limit 1;
      if v_taller_id is null then
        begin
          insert into public.talleres(nombre,observaciones,activo,creado_por,modificado_por) values(v_taller_nombre,'Alta automática desde Hotel',true,auth.uid(),auth.uid()) returning id into v_taller_id;
          v_new_talleres:=v_new_talleres+1;
        exception when unique_violation then
          select t.id into v_taller_id from public.talleres t where lower(btrim(t.nombre))=lower(v_taller_nombre) limit 1;
        end;
      end if;
    end if;
    v_stage_out:=jsonb_set(v_stage_out,'{taller_id}',case when v_taller_id is null then '""'::jsonb else to_jsonb(v_taller_id::text) end,true);

    v_centro_id:=nullif(v_stage->>'centro_taller_id','')::uuid;
    v_centro_nombre:=btrim(coalesce(v_stage->>'centro_nombre',''));
    if char_length(v_centro_nombre)>160 then raise exception 'El nombre del centro es demasiado largo'; end if;
    if v_centro_id is null and v_centro_nombre<>'' then
      if v_taller_id is null then raise exception 'Para crear un centro nuevo primero debes indicar el taller'; end if;
      select c.id into v_centro_id from public.centros_taller c where c.activo=true and c.taller_id=v_taller_id and lower(btrim(c.nombre))=lower(v_centro_nombre) order by c.creado_en limit 1;
      if v_centro_id is null then
        begin
          insert into public.centros_taller(taller_id,nombre,direccion,poblacion,codigo_postal,plus_code,observaciones,activo,creado_por,modificado_por)
          values(v_taller_id,v_centro_nombre,'','','','','Alta automática desde Hotel',true,auth.uid(),auth.uid()) returning id into v_centro_id;
          v_new_centros:=v_new_centros+1;
        exception when unique_violation then
          select c.id into v_centro_id from public.centros_taller c where c.taller_id=v_taller_id and lower(btrim(c.nombre))=lower(v_centro_nombre) limit 1;
        end;
      end if;
    end if;
    v_stage_out:=jsonb_set(v_stage_out,'{centro_taller_id}',case when v_centro_id is null then '""'::jsonb else to_jsonb(v_centro_id::text) end,true);

    v_works_out:='[]'::jsonb;
    for v_work in select value from jsonb_array_elements(coalesce(v_stage->'trabajos','[]'::jsonb)) loop
      v_work_out:=v_work; v_tipo_input:=btrim(coalesce(v_work->>'tipo_trabajo','')); v_tipo_codigo:=null; v_tipo_nombre:=null;
      if v_tipo_input<>'' then
        select c.codigo,c.nombre into v_tipo_codigo,v_tipo_nombre from public.catalogo_tipos_trabajo c where c.activo=true and upper(c.codigo)=upper(v_tipo_input) limit 1;
        if v_tipo_codigo is null then select c.codigo,c.nombre into v_tipo_codigo,v_tipo_nombre from public.catalogo_tipos_trabajo c where c.activo=true and lower(btrim(c.nombre))=lower(v_tipo_input) limit 1; end if;
        if v_tipo_codigo is null then
          v_tipo_codigo:='USR_'||upper(substr(md5(lower(v_tipo_input)),1,8));
          begin
            insert into public.catalogo_tipos_trabajo(codigo,nombre,requiere_expediente,requiere_diagnostico,activo) values(v_tipo_codigo,v_tipo_input,false,false,true);
            v_new_tipos:=v_new_tipos+1;
          exception when unique_violation then null;
          end;
        end if;
      end if;
      if v_tipo_codigo is not null then v_work_out:=jsonb_set(v_work_out,'{tipo_trabajo}',to_jsonb(v_tipo_codigo),true); end if;
      v_works_out:=v_works_out||jsonb_build_array(v_work_out);
    end loop;
    v_stage_out:=jsonb_set(v_stage_out,'{trabajos}',v_works_out,true);
    v_stages_out:=v_stages_out||jsonb_build_array(v_stage_out);
  end loop;

  perform set_config('app.hotel_catalogos_registro_id',p_registro_id::text,true);
  perform set_config('app.hotel_catalogos_etapas',v_stages_out::text,true);
  v_saved:=public.guardar_ficha_hotel_edicion(p_registro_id,p_version,v_ficha_out,v_stages_out,p_request_id);
  return v_saved||jsonb_build_object('catalogos_nuevos',jsonb_build_object('estados',v_new_estados,'estados_etapa',v_new_estados_etapa,'tipos_etapa',v_new_tipos_etapa,'talleres',v_new_talleres,'centros',v_new_centros,'tipos_trabajo',v_new_tipos));
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.guardar_ficha_hotel_edicion_catalogos(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.guardar_ficha_hotel_edicion_catalogos(uuid,integer,jsonb,jsonb,text) TO authenticated,service_role;
-- Literal runtime MD5: 23e0b9424f6bcc87641b033e2be1ad59 (app_private.guardar_ficha_hotel_edicion_v2(uuid,integer,jsonb,jsonb,text))
CREATE OR REPLACE FUNCTION app_private.guardar_ficha_hotel_edicion_v2(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.guardar_ficha_hotel_edicion(p_registro_id,p_version,p_ficha,p_etapas,p_request_id);
$function$
;
REVOKE ALL ON FUNCTION app_private.guardar_ficha_hotel_edicion_v2(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.guardar_ficha_hotel_edicion_v2(uuid,integer,jsonb,jsonb,text) TO authenticated,service_role;
-- Literal runtime MD5: c98c2652f30902009aa6927ca5263fb5 (app_private.normalizar_orden_t_parada(uuid))
CREATE OR REPLACE FUNCTION app_private.normalizar_orden_t_parada(p_registro_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_follow uuid;
  rec record;
  v_count integer:=0;
  v_n integer:=0;
begin
  select seguimiento_id into v_follow from public.registros_hotel where id=p_registro_id;
  if v_follow is null then return 0; end if;

  perform set_config('app.audit_origin','metrogestion-r1-history-order-normalization',true);
  perform set_config('app.reconciliando_etapas','1',true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  create temp table if not exists tmp_norm_t_order(
    etapa_id uuid primary key,
    new_pos integer not null
  ) on commit drop;
  truncate tmp_norm_t_order;

  for rec in
    select r.id as registro_id
    from public.registros_hotel r
    where r.seguimiento_id=v_follow and not r.cancelado
  loop
    truncate tmp_norm_t_order;

    insert into tmp_norm_t_order(etapa_id,new_pos)
    select e.id,
           row_number() over(
             order by
               case when e.accion_sistema='recuperar_y_liberar' then 1 else 0 end,
               e.posicion,
               e.creado_en,
               e.id
           )::integer
    from public.etapas_hotel e
    where e.registro_hotel_id=rec.registro_id
      and not e.cancelado;

    update public.etapas_hotel e
    set posicion=1000+n.new_pos
    from tmp_norm_t_order n
    where e.id=n.etapa_id
      and e.posicion is distinct from 1000+n.new_pos;

    update public.etapas_hotel e
    set posicion=n.new_pos
    from tmp_norm_t_order n
    where e.id=n.etapa_id
      and e.posicion is distinct from n.new_pos;

    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;

  perform set_config('app.reconciliando_etapas','0',true);
  return v_count;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.normalizar_orden_t_parada(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.normalizar_orden_t_parada(uuid) TO authenticated,service_role;
-- Literal runtime MD5: 62388148414c29a6f2958ccf67f19848 (app_private.obtener_ficha_hotel_edicion_alpha71(uuid))
CREATE OR REPLACE FUNCTION app_private.obtener_ficha_hotel_edicion_alpha71(p_registro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_detail jsonb;
  v_tracking uuid;
  v_sync app_private.manteniment_parada_sync%rowtype;
begin
  v_detail := public.obtener_ficha_hotel_edicion(p_registro_id);
  select seguimiento_id into v_tracking from public.registros_hotel where id = p_registro_id;
  select * into v_sync from app_private.manteniment_parada_sync where seguimiento_id = v_tracking;

  v_detail := jsonb_set(
    v_detail,
    '{ficha}',
    coalesce(v_detail->'ficha', '{}'::jsonb) || jsonb_build_object(
      'fecha_programada_parada', v_sync.fecha_programada_parada,
      'manteniment_fecha_corte', v_sync.fecha_corte,
      'manteniment_tancament', coalesce(v_sync.tancament, ''),
      'manteniment_tancament_supervisado', coalesce(v_sync.tancament_supervisado, false),
      'manteniment_dias_parada_manual', v_sync.dias_parada_manual,
      'manteniment_km_facturables_manual', v_sync.km_facturables_manual,
      'manteniment_sync_id', v_sync.sync_id
    ),
    true
  );
  return v_detail;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.obtener_ficha_hotel_edicion_alpha71(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.obtener_ficha_hotel_edicion_alpha71(uuid) TO authenticated,service_role;
-- Literal runtime MD5: 3010c515ce57793e93a72b97f57cd8cd (app_private.obtener_ficha_hotel_edicion_alpha72(uuid))
CREATE OR REPLACE FUNCTION app_private.obtener_ficha_hotel_edicion_alpha72(p_registro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_detail jsonb;
  v_seguimiento_id uuid;
  v_modelo text;
  v_recovery boolean;
  v_complete boolean:=false;
  v_conflict text;
begin
  v_detail := app_private.obtener_ficha_hotel_edicion_alpha71(p_registro_id);
  v_seguimiento_id := nullif(v_detail #>> '{ficha,seguimiento_id}', '')::uuid;
  select m.modelo into v_modelo from app_private.hotel_flujo_modelo m where m.seguimiento_id=v_seguimiento_id;
  v_detail := jsonb_set(v_detail, '{ficha,modelo_flujo_taller}', to_jsonb(coalesce(v_modelo,'legacy')), true);
  v_detail := jsonb_set(v_detail, '{catalogos,modalidades_operativas}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'codigo', c.codigo,
      'nombre', c.nombre,
      'comportamiento', c.comportamiento,
      'orden', c.orden
    ) order by c.orden, c.nombre)
    from public.catalogo_modalidades_operativas_hotel c
    where c.activo = true
  ), '[]'::jsonb), true);
  begin
    v_recovery:=app_private.modalidad_hotel_requiere_recuperacion(p_registro_id);
    if not v_recovery then v_complete:=app_private.cierre_sin_recuperacion_completo_rec001(p_registro_id); end if;
  exception when check_violation then v_recovery:=null; v_conflict:=sqlerrm;
  end;
  v_detail:=jsonb_set(v_detail,'{ficha,rec001}',jsonb_build_object('regla','REC-001','registro_id',p_registro_id,'modalidad',v_detail#>>'{ficha,modalidad_operativa}','requiere_recuperacion',v_recovery,'cierre_confirmable',v_complete,'conflicto',v_conflict),true);
  return jsonb_set(
    v_detail,
    '{anotaciones_manuales}',
    app_private.anotaciones_manuales_hotel_json(v_seguimiento_id),
    true
  );
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.obtener_ficha_hotel_edicion_alpha72(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.obtener_ficha_hotel_edicion_alpha72(uuid) TO authenticated,service_role;
-- Literal runtime MD5: 71a1ec18ce7ae6c2e1dcc0f150c4917d (app_private.propagar_correcciones_globales_parada(uuid,jsonb))
CREATE OR REPLACE FUNCTION app_private.propagar_correcciones_globales_parada(p_registro_id uuid, p_antes jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_actual public.registros_hotel%rowtype;
  v_actor uuid;
  v_count integer := 0;
  c_numero boolean;
  c_vs boolean;
  c_ms boolean;
  c_tipo boolean;
  c_marca boolean;
  c_motor boolean;
  c_modelo boolean;
  c_upc boolean;
  c_tel boolean;
  c_causa boolean;
  c_inc boolean;
  c_fecha_parada boolean;
begin
  select * into v_actual from public.registros_hotel where id=p_registro_id;
  if not found then return 0; end if;

  v_actor := coalesce(auth.uid(),v_actual.modificado_por,v_actual.creado_por);

  c_numero := (p_antes->>'numero_parada') is distinct from v_actual.numero_parada;
  c_vs := (p_antes->>'vehiculo_sustituido') is distinct from v_actual.vehiculo_sustituido;
  c_ms := (p_antes->>'matricula_sustituido') is distinct from v_actual.matricula_sustituido;
  c_tipo := (p_antes->>'tipo_unidad') is distinct from v_actual.tipo_unidad;
  c_marca := (p_antes->>'marca') is distinct from v_actual.marca;
  c_motor := (p_antes->>'tipo_motor') is distinct from v_actual.tipo_motor;
  c_modelo := (p_antes->>'modelo') is distinct from v_actual.modelo;
  c_upc := (p_antes->>'upc') is distinct from v_actual.upc;
  c_tel := (p_antes->>'telefono') is distinct from v_actual.telefono;
  c_causa := (p_antes->>'causa') is distinct from v_actual.causa;
  c_inc := (p_antes->>'incidencia') is distinct from v_actual.incidencia;
  c_fecha_parada := (nullif(p_antes->>'fecha_parada','')::date) is distinct from v_actual.fecha_parada;

  if not (c_numero or c_vs or c_ms or c_tipo or c_marca or c_motor or c_modelo or c_upc or c_tel or c_causa or c_inc or c_fecha_parada) then
    return 0;
  end if;

  perform set_config('app.audit_origin','metrogestion-r1-history-propagation',true);

  update public.registros_hotel r
  set numero_parada = case when c_numero then v_actual.numero_parada else r.numero_parada end,
      vehiculo_sustituido = case when c_vs then v_actual.vehiculo_sustituido else r.vehiculo_sustituido end,
      matricula_sustituido = case when c_ms then v_actual.matricula_sustituido else r.matricula_sustituido end,
      tipo_unidad = case when c_tipo then v_actual.tipo_unidad else r.tipo_unidad end,
      marca = case when c_marca then v_actual.marca else r.marca end,
      tipo_motor = case when c_motor then v_actual.tipo_motor else r.tipo_motor end,
      modelo = case when c_modelo then v_actual.modelo else r.modelo end,
      upc = case when c_upc then v_actual.upc else r.upc end,
      telefono = case when c_tel then v_actual.telefono else r.telefono end,
      causa = case when c_causa then v_actual.causa else r.causa end,
      incidencia = case when c_inc then v_actual.incidencia else r.incidencia end,
      fecha_parada = case when c_fecha_parada then v_actual.fecha_parada else r.fecha_parada end,
      modificado_por = v_actor
  where r.seguimiento_id=v_actual.seguimiento_id
    and r.id<>p_registro_id
    and (
      (c_numero and r.numero_parada is distinct from v_actual.numero_parada) or
      (c_vs and r.vehiculo_sustituido is distinct from v_actual.vehiculo_sustituido) or
      (c_ms and r.matricula_sustituido is distinct from v_actual.matricula_sustituido) or
      (c_tipo and r.tipo_unidad is distinct from v_actual.tipo_unidad) or
      (c_marca and r.marca is distinct from v_actual.marca) or
      (c_motor and r.tipo_motor is distinct from v_actual.tipo_motor) or
      (c_modelo and r.modelo is distinct from v_actual.modelo) or
      (c_upc and r.upc is distinct from v_actual.upc) or
      (c_tel and r.telefono is distinct from v_actual.telefono) or
      (c_causa and r.causa is distinct from v_actual.causa) or
      (c_inc and r.incidencia is distinct from v_actual.incidencia) or
      (c_fecha_parada and r.fecha_parada is distinct from v_actual.fecha_parada)
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.propagar_correcciones_globales_parada(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.propagar_correcciones_globales_parada(uuid,jsonb) TO authenticated,service_role;
-- Literal runtime MD5: a570dd350618fa0258eec30eadd174ec (app_private.propagar_detalles_t_parada(uuid))
CREATE OR REPLACE FUNCTION app_private.propagar_detalles_t_parada(p_registro_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_reg public.registros_hotel%rowtype;
  s public.etapas_hotel%rowtype;
  tgt record;
  w public.trabajos_etapa_hotel%rowtype;
  v_new_stage uuid;
  v_origin_follow uuid;
  v_origin_target uuid;
  v_existing_pickup uuid;
  v_count integer := 0;
  v_n integer;
  v_actor uuid:=auth.uid();
begin
  select * into v_reg from public.registros_hotel where id=p_registro_id;
  if not found then return 0; end if;

  perform set_config('app.audit_origin','metrogestion-r1-history-propagation',true);
  perform set_config('app.clonando_pizarra','1',true);
  perform set_config('app.reconciliando_etapas','1',true);
  set constraints etapas_hotel_posicion_activa_uq deferred;

  for s in
    select * from public.etapas_hotel
    where registro_hotel_id=p_registro_id
    order by cancelado,posicion,creado_en,id
  loop
    -- TM, LKT, EXTINTOR y trámites no admiten recogida, tampoco al propagar
    -- días históricos ya existentes.
    if s.tipo_etapa='recogida_taller'
       and s.etapa_origen_id is not null
       and app_private.etapa_manteniment_sin_recogida_alpha74(s.etapa_origen_id) then
      continue;
    end if;

    -- Si la T ya existe en otros días, sincroniza sus datos descriptivos comunes.
    update public.etapas_hotel e
    set nombre=s.nombre,
        tipo_etapa=s.tipo_etapa,
        taller_id=s.taller_id,
        centro_taller_id=s.centro_taller_id,
        lugar=s.lugar,
        observaciones=s.observaciones,
        modificado_por=coalesce(v_actor,s.modificado_por,s.creado_por)
    where e.seguimiento_id=s.seguimiento_id
      and e.id<>s.id
      and (
        e.nombre is distinct from s.nombre or
        e.tipo_etapa is distinct from s.tipo_etapa or
        e.taller_id is distinct from s.taller_id or
        e.centro_taller_id is distinct from s.centro_taller_id or
        e.lugar is distinct from s.lugar or
        e.observaciones is distinct from s.observaciones
      );
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;

    -- Si es una T nueva y no existe en otro día de la misma parada, créala allí.
    for tgt in
      select r.id as registro_id,p.fecha
      from public.registros_hotel r
      join public.pizarras p on p.id=r.pizarra_id
      where r.seguimiento_id=v_reg.seguimiento_id
        and r.id<>p_registro_id
        and not r.cancelado
        and p.fecha>=coalesce(v_reg.fecha_parada,p.fecha)
        and not exists(
          select 1 from public.etapas_hotel e2
          where e2.registro_hotel_id=r.id
            and e2.seguimiento_id=s.seguimiento_id
        )
      order by p.fecha,r.id
    loop
      if not s.cancelado then
        -- Libera la posición deseada sin perder ninguna T existente.
        update public.etapas_hotel
        set posicion=posicion+1,
            modificado_por=coalesce(v_actor,modificado_por,creado_por)
        where registro_hotel_id=tgt.registro_id
          and not cancelado
          and posicion>=s.posicion;
      end if;

      v_origin_target:=null;
      if s.etapa_origen_id is not null then
        select seguimiento_id into v_origin_follow
        from public.etapas_hotel
        where id=s.etapa_origen_id;
        if v_origin_follow is not null then
          select id into v_origin_target
          from public.etapas_hotel
          where registro_hotel_id=tgt.registro_id
            and seguimiento_id=v_origin_follow
          order by creado_en,id
          limit 1;
        end if;
      end if;

      -- Una recogida se identifica por su Entrada de origen. Si el día
      -- histórico ya tiene una recogida activa para esa Entrada, se reutiliza
      -- y se alinea su seguimiento en lugar de insertar una duplicada.
      v_existing_pickup:=null;
      if not s.cancelado
         and s.tipo_etapa='recogida_taller'
         and v_origin_target is not null then
        select e.id into v_existing_pickup
        from public.etapas_hotel e
        where e.registro_hotel_id=tgt.registro_id
          and e.tipo_etapa='recogida_taller'
          and e.etapa_origen_id=v_origin_target
          and not e.cancelado
        order by e.creado_en,e.id
        limit 1;
      end if;

      if v_existing_pickup is not null then
        update public.etapas_hotel e
        set seguimiento_id=s.seguimiento_id,
            nombre=s.nombre,
            tipo_etapa=s.tipo_etapa,
            taller_id=s.taller_id,
            centro_taller_id=s.centro_taller_id,
            lugar=s.lugar,
            observaciones=s.observaciones,
            modificado_por=coalesce(v_actor,e.modificado_por,e.creado_por)
        where e.id=v_existing_pickup;
        get diagnostics v_n = row_count;
        v_count := v_count + v_n;
        continue;
      end if;

      insert into public.etapas_hotel(
        registro_hotel_id,seguimiento_id,nombre,posicion,estado,tipo_etapa,
        taller_id,centro_taller_id,lugar,fecha_prevista,fecha_inicio_real,
        fecha_fin_real,fecha_real,observaciones,cancelado,motivo_cancelacion,
        cancelado_en,cancelado_por,creado_por,modificado_por,accion_sistema,etapa_origen_id, grupo_documental_id
      ) values(
        tgt.registro_id,s.seguimiento_id,s.nombre,s.posicion,s.estado,s.tipo_etapa,
        s.taller_id,s.centro_taller_id,s.lugar,s.fecha_prevista,s.fecha_inicio_real,
        s.fecha_fin_real,s.fecha_real,s.observaciones,s.cancelado,s.motivo_cancelacion,
        s.cancelado_en,s.cancelado_por,coalesce(v_actor,s.creado_por),coalesce(v_actor,s.modificado_por,s.creado_por),s.accion_sistema,v_origin_target,s.grupo_documental_id
      ) returning id into v_new_stage;

      for w in
        select * from public.trabajos_etapa_hotel
        where etapa_hotel_id=s.id
        order by creado_en,id
      loop
        insert into public.trabajos_etapa_hotel(
          etapa_hotel_id,tipo_trabajo,categoria_tecnica,motivo_entrada,
          diagnostico_real,km_averia,expediente,descripcion,peritaje_estado,
          observaciones,cancelado,motivo_cancelacion,cancelado_en,cancelado_por,
          creado_por,modificado_por
        ) values(
          v_new_stage,w.tipo_trabajo,w.categoria_tecnica,w.motivo_entrada,
          w.diagnostico_real,w.km_averia,w.expediente,w.descripcion,w.peritaje_estado,
          w.observaciones,w.cancelado,w.motivo_cancelacion,w.cancelado_en,w.cancelado_por,
          coalesce(v_actor,w.creado_por),coalesce(v_actor,w.modificado_por,w.creado_por)
        );
      end loop;

      v_count := v_count + 1;
    end loop;
  end loop;

  perform set_config('app.reconciliando_etapas','0',true);
  perform set_config('app.clonando_pizarra','0',true);
  return v_count;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.propagar_detalles_t_parada(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.propagar_detalles_t_parada(uuid) TO service_role;
-- Literal runtime MD5: 4c7b7291dc685ad45eeff6e7a085e124 (app_private.sincronizar_anotaciones_manuales_hotel(uuid,jsonb))
CREATE OR REPLACE FUNCTION app_private.sincronizar_anotaciones_manuales_hotel(p_registro_id uuid, p_anotaciones jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_actor_nombre text;
  v_seguimiento_id uuid;
  v_item jsonb;
  v_id uuid;
  v_texto text;
  v_version integer;
  v_changed integer;
  v_total integer := 0;
begin
  if v_actor is null
    or not public.usuario_activo()
    or not public.dispositivo_autorizado()
    or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar las anotaciones de Hotel'
      using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_anotaciones, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_anotaciones, '[]'::jsonb)) > 100 then
    raise exception 'Las anotaciones deben ser una lista de hasta 100 elementos'
      using errcode = '22023';
  end if;

  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r
  where r.id = p_registro_id;
  if v_seguimiento_id is null then
    raise exception 'No se encuentra la ficha de Hotel'
      using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellidos)), ''), 'Usuario')
    into v_actor_nombre
  from public.usuarios u
  where u.id = v_actor and u.activo;
  if v_actor_nombre is null then
    raise exception 'El usuario no está activo' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_anotaciones, '[]'::jsonb)) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    v_texto := btrim(coalesce(v_item->>'texto', ''));
    v_version := greatest(coalesce(nullif(v_item->>'version', '')::integer, 1), 1);

    if v_id is null then
      if coalesce((v_item->>'eliminar')::boolean, false) or v_texto = '' then
        continue;
      end if;
      if length(v_texto) > 4000 then
        raise exception 'Cada anotación admite un máximo de 4.000 caracteres'
          using errcode = '22023';
      end if;
      insert into public.anotaciones_manuales_hotel (
        seguimiento_id, registro_origen_id, texto, autor_id, autor_nombre,
        modificado_por, modificador_nombre
      ) values (
        v_seguimiento_id, p_registro_id, v_texto, v_actor, v_actor_nombre,
        v_actor, v_actor_nombre
      );
      v_total := v_total + 1;
      continue;
    end if;

    if coalesce((v_item->>'eliminar')::boolean, false) then
      update public.anotaciones_manuales_hotel n
      set cancelada = true,
          motivo_cancelacion = 'Eliminada desde la edición de Hotel',
          cancelada_en = clock_timestamp(),
          cancelada_por = v_actor,
          modificado_por = v_actor,
          modificador_nombre = v_actor_nombre,
          version = n.version + 1,
          actualizado_en = clock_timestamp()
      where n.id = v_id
        and n.seguimiento_id = v_seguimiento_id
        and not n.cancelada
        and n.version = v_version;
    else
      if v_texto = '' or length(v_texto) > 4000 then
        raise exception 'La anotación debe contener entre 1 y 4.000 caracteres'
          using errcode = '22023';
      end if;
      update public.anotaciones_manuales_hotel n
      set texto = v_texto,
          modificado_por = v_actor,
          modificador_nombre = v_actor_nombre,
          version = n.version + 1,
          actualizado_en = clock_timestamp()
      where n.id = v_id
        and n.seguimiento_id = v_seguimiento_id
        and not n.cancelada
        and n.version = v_version
        and n.texto is distinct from v_texto;

      if not found then
        perform 1 from public.anotaciones_manuales_hotel n
        where n.id = v_id
          and n.seguimiento_id = v_seguimiento_id
          and not n.cancelada
          and n.version = v_version
          and n.texto = v_texto;
        if found then continue; end if;
      end if;
    end if;

    get diagnostics v_changed = row_count;
    if v_changed <> 1 then
      raise exception 'Otra sesión ha modificado esta anotación. Recarga la ficha antes de guardar.'
        using errcode = '40001';
    end if;
    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.sincronizar_anotaciones_manuales_hotel(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.sincronizar_anotaciones_manuales_hotel(uuid,jsonb) TO service_role;
-- Literal runtime MD5: b7da30bbbad7bd890d030de377344849 (public.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text))
CREATE OR REPLACE FUNCTION public.guardar_ficha_hotel_edicion_alpha71(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.guardar_ficha_hotel_edicion_alpha71($1, $2, $3, $4, $5);
$function$
;
REVOKE ALL ON FUNCTION public.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text) TO authenticated,service_role;
-- Literal runtime MD5: fa1af03c38800a597086f0e649ec0891 (public.guardar_ficha_hotel_edicion_catalogos(uuid,integer,jsonb,jsonb,text))
CREATE OR REPLACE FUNCTION public.guardar_ficha_hotel_edicion_catalogos(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.guardar_ficha_hotel_edicion_catalogos($1, $2, $3, $4, $5);
$function$
;
REVOKE ALL ON FUNCTION public.guardar_ficha_hotel_edicion_catalogos(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guardar_ficha_hotel_edicion_catalogos(uuid,integer,jsonb,jsonb,text) TO authenticated,service_role;
-- Literal runtime MD5: 093c9f6c9f2b9dd172ed640969c3464c (public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text))
CREATE OR REPLACE FUNCTION public.guardar_ficha_hotel_edicion_core(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actual public.registros_hotel%rowtype;
  v_cancelado boolean;
  v_retirado boolean;
  v_estado text;
  v_prioridad integer;
  v_orden integer;
  v_stage jsonb;
  v_stage_id uuid;
  v_stage_actual public.etapas_hotel%rowtype;
  v_stage_cancelado boolean;
  v_stage_posicion integer;
  v_stage_version integer;
  v_taller_id uuid;
  v_centro_id uuid;
  v_work jsonb;
  v_work_id uuid;
  v_work_actual public.trabajos_etapa_hotel%rowtype;
  v_work_cancelado boolean;
  v_work_version integer;
  v_saved_stages integer := 0;
  v_saved_works integer := 0;
  v_audit_count integer := 0;
  v_new_version integer;
begin
  if auth.uid() is null
     or not public.dispositivo_autorizado()
     or not public.puede_editar_modulo('hotel') then
    raise exception 'No tienes permiso para modificar Hotel';
  end if;

  if p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Identificador de guardado no válido';
  end if;

  perform set_config('app.request_id', p_request_id, true);
  perform set_config('app.audit_origin', 'metrogestion-r1-editor', true);

  if jsonb_typeof(p_ficha) <> 'object'
     or jsonb_typeof(p_etapas) <> 'array' then
    raise exception 'Formato de ficha no válido';
  end if;

  if octet_length(p_ficha::text) > 120000
     or octet_length(p_etapas::text) > 500000
     or jsonb_array_length(p_etapas) > 50 then
    raise exception 'La ficha supera el tamaño permitido';
  end if;

  if not exists (
    select 1
    from public.hotel_edicion_piloto h
    where h.registro_hotel_id = p_registro_id
      and h.activo = true
  ) then
    raise exception 'Esta ficha todavía no está habilitada para edición';
  end if;

  select * into v_actual
  from public.registros_hotel r
  where r.id = p_registro_id
  for update;

  if not found then
    raise exception 'Ficha de Hotel no encontrada';
  end if;

  if v_actual.version <> p_version then
    raise exception 'La ficha ha cambiado desde que la abriste. Recárgala antes de guardar.';
  end if;

  v_prioridad := coalesce(nullif(p_ficha->>'prioridad', '')::integer, 5);
  if v_prioridad < 0 or v_prioridad > 5 then
    raise exception 'La prioridad debe estar entre 0 y 5';
  end if;

  v_orden := coalesce(nullif(p_ficha->>'orden', '')::integer, 0);
  if v_orden < 0 or v_orden > 9999 then
    raise exception 'El orden no es válido';
  end if;

  v_cancelado := coalesce((p_ficha->>'cancelado')::boolean, false);
  v_retirado := coalesce((p_ficha->>'retirado_hotel_activo')::boolean, false);
  v_estado := coalesce(nullif(btrim(p_ficha->>'estado'), ''), 'pendiente_taller');

  if v_cancelado then
    v_estado := 'anulado';
    if btrim(coalesce(p_ficha->>'motivo_cancelacion', '')) = '' then
      raise exception 'Para cancelar la ficha debes indicar el motivo';
    end if;
  elsif not exists (
    select 1 from public.catalogo_estados_hotel c
    where c.codigo = v_estado and c.activo = true and c.codigo <> 'anulado'
  ) then
    raise exception 'El estado seleccionado no es válido';
  end if;

  if btrim(coalesce(p_ficha->>'vehiculo_sustituido', '')) = ''
     and btrim(coalesce(p_ficha->>'vehiculo_reserva', '')) = '' then
    raise exception 'La ficha debe identificar un vehículo o una reserva';
  end if;

  update public.registros_hotel
  set numero_parada = nullif(btrim(p_ficha->>'numero_parada'), ''),
      vehiculo_sustituido = btrim(coalesce(p_ficha->>'vehiculo_sustituido', '')),
      matricula_sustituido = upper(btrim(coalesce(p_ficha->>'matricula_sustituido', ''))),
      vehiculo_reserva = btrim(coalesce(p_ficha->>'vehiculo_reserva', '')),
      matricula_reserva = upper(btrim(coalesce(p_ficha->>'matricula_reserva', ''))),
      etiqueta_reserva = btrim(coalesce(p_ficha->>'etiqueta_reserva', '')),
      tipo_unidad = btrim(coalesce(p_ficha->>'tipo_unidad', '')),
      marca = upper(btrim(coalesce(p_ficha->>'marca', ''))),
      tipo_motor = btrim(coalesce(p_ficha->>'tipo_motor', '')),
      modelo = btrim(coalesce(p_ficha->>'modelo', '')),
      upc = upper(btrim(coalesce(p_ficha->>'upc', ''))),
      telefono = btrim(coalesce(p_ficha->>'telefono', '')),
      prioridad = v_prioridad,
      estado = v_estado,
      lugar = btrim(coalesce(p_ficha->>'lugar', '')),
      fecha_parada = nullif(p_ficha->>'fecha_parada', '')::date,
      fecha_entrada = case
        when nullif(p_ficha->>'fecha_entrada', '') is null then null
        else (p_ficha->>'fecha_entrada')::timestamp at time zone 'Europe/Madrid'
      end,
      tipo_movimiento = btrim(coalesce(p_ficha->>'tipo_movimiento', '')),
      causa = btrim(coalesce(p_ficha->>'causa', '')),
      trabajos_reserva = btrim(coalesce(p_ficha->>'trabajos_reserva', '')),
      incidencia = upper(btrim(coalesce(p_ficha->>'incidencia', ''))),
      proximo = btrim(coalesce(p_ficha->>'proximo', '')),
      observaciones = btrim(coalesce(p_ficha->>'observaciones', '')),
      sustitucion_temporal = coalesce((p_ficha->>'sustitucion_temporal')::boolean, false),
      motivo_sustitucion_temporal = btrim(coalesce(p_ficha->>'motivo_sustitucion_temporal', '')),
      fecha_limite_sustitucion = case
        when nullif(p_ficha->>'fecha_limite_sustitucion', '') is null then null
        else (p_ficha->>'fecha_limite_sustitucion')::timestamp at time zone 'Europe/Madrid'
      end,
      orden = v_orden,
      retirado_hotel_activo = v_retirado,
      fecha_retirado_hotel = case
        when v_retirado and not v_actual.retirado_hotel_activo then now()
        when not v_retirado then null
        else v_actual.fecha_retirado_hotel
      end,
      cancelado = v_cancelado,
      motivo_cancelacion = case when v_cancelado then btrim(p_ficha->>'motivo_cancelacion') else '' end,
      cancelado_en = case
        when v_cancelado and not v_actual.cancelado then now()
        when not v_cancelado then null
        else v_actual.cancelado_en
      end,
      cancelado_por = case
        when v_cancelado and not v_actual.cancelado then auth.uid()
        when not v_cancelado then null
        else v_actual.cancelado_por
      end,
      modificado_por = auth.uid()
  where id = p_registro_id
    and version = p_version
  returning version into v_new_version;

  if not found then
    raise exception 'La ficha ha cambiado antes de guardar. Recárgala.';
  end if;

  set constraints etapas_hotel_posicion_activa_uq deferred;

  for v_stage in
    select value from jsonb_array_elements(p_etapas)
  loop
    if jsonb_typeof(v_stage) <> 'object' then
      raise exception 'Una T contiene un formato no válido';
    end if;

    v_stage_id := nullif(v_stage->>'id', '')::uuid;
    v_stage_cancelado := coalesce((v_stage->>'cancelado')::boolean, false);
    v_stage_posicion := coalesce(nullif(v_stage->>'posicion', '')::integer, 0);
    v_stage_version := nullif(v_stage->>'version', '')::integer;
    v_taller_id := nullif(v_stage->>'taller_id', '')::uuid;
    v_centro_id := nullif(v_stage->>'centro_taller_id', '')::uuid;

    if v_stage_posicion < 1 or v_stage_posicion > 99 then
      raise exception 'La posición de cada T debe estar entre 1 y 99';
    end if;

    if btrim(coalesce(v_stage->>'nombre', '')) = '' then
      raise exception 'Todas las T deben tener nombre';
    end if;

    if v_stage_cancelado
       and btrim(coalesce(v_stage->>'motivo_cancelacion', '')) = '' then
      raise exception 'Indica el motivo para anular la T %', v_stage_posicion;
    end if;

    if v_taller_id is not null
       and not exists (select 1 from public.talleres where id = v_taller_id and activo = true) then
      raise exception 'El taller de la T % no es válido', v_stage_posicion;
    end if;

    if v_centro_id is not null
       and not exists (
         select 1 from public.centros_taller
         where id = v_centro_id and activo = true
           and (v_taller_id is null or taller_id = v_taller_id)
       ) then
      raise exception 'El centro de la T % no corresponde al taller seleccionado', v_stage_posicion;
    end if;

    if v_stage_id is null then
      if v_stage_cancelado then
        continue;
      end if;

      insert into public.etapas_hotel(
        registro_hotel_id, seguimiento_id, nombre, posicion, estado, tipo_etapa,
        taller_id, centro_taller_id, lugar, fecha_prevista, fecha_inicio_real,
        fecha_fin_real, fecha_real, observaciones, creado_por, modificado_por
      ) values (
        p_registro_id,
        gen_random_uuid(),
        btrim(v_stage->>'nombre'),
        v_stage_posicion,
        coalesce(nullif(v_stage->>'estado', ''), 'pendiente'),
        coalesce(nullif(v_stage->>'tipo_etapa', ''), 'otro'),
        v_taller_id,
        v_centro_id,
        btrim(coalesce(v_stage->>'lugar', '')),
        case when nullif(v_stage->>'fecha_prevista', '') is null then null else (v_stage->>'fecha_prevista')::timestamp at time zone 'Europe/Madrid' end,
        case when nullif(v_stage->>'fecha_inicio_real', '') is null then null else (v_stage->>'fecha_inicio_real')::timestamp at time zone 'Europe/Madrid' end,
        case when nullif(v_stage->>'fecha_fin_real', '') is null then null else (v_stage->>'fecha_fin_real')::timestamp at time zone 'Europe/Madrid' end,
        case when nullif(v_stage->>'fecha_real', '') is null then null else (v_stage->>'fecha_real')::timestamp at time zone 'Europe/Madrid' end,
        btrim(coalesce(v_stage->>'observaciones', '')),
        auth.uid(),
        auth.uid()
      ) returning id into v_stage_id;
    else
      select * into v_stage_actual
      from public.etapas_hotel e
      where e.id = v_stage_id
        and e.registro_hotel_id = p_registro_id
      for update;

      if not found then
        raise exception 'Una T ya no pertenece a esta ficha';
      end if;

      if v_stage_version is null or v_stage_actual.version <> v_stage_version then
        raise exception 'La T % ha cambiado desde que abriste la ficha', v_stage_actual.posicion;
      end if;

      update public.etapas_hotel
      set nombre = btrim(v_stage->>'nombre'),
          posicion = v_stage_posicion,
          estado = case
            when v_stage_cancelado then 'anulada'
            else coalesce(nullif(v_stage->>'estado', ''), 'pendiente')
          end,
          tipo_etapa = coalesce(nullif(v_stage->>'tipo_etapa', ''), 'otro'),
          taller_id = v_taller_id,
          centro_taller_id = v_centro_id,
          lugar = btrim(coalesce(v_stage->>'lugar', '')),
          fecha_prevista = case when nullif(v_stage->>'fecha_prevista', '') is null then null else (v_stage->>'fecha_prevista')::timestamp at time zone 'Europe/Madrid' end,
          fecha_inicio_real = case when nullif(v_stage->>'fecha_inicio_real', '') is null then null else (v_stage->>'fecha_inicio_real')::timestamp at time zone 'Europe/Madrid' end,
          fecha_fin_real = case when nullif(v_stage->>'fecha_fin_real', '') is null then null else (v_stage->>'fecha_fin_real')::timestamp at time zone 'Europe/Madrid' end,
          fecha_real = case when nullif(v_stage->>'fecha_real', '') is null then null else (v_stage->>'fecha_real')::timestamp at time zone 'Europe/Madrid' end,
          observaciones = btrim(coalesce(v_stage->>'observaciones', '')),
          cancelado = v_stage_cancelado,
          motivo_cancelacion = case when v_stage_cancelado then btrim(v_stage->>'motivo_cancelacion') else '' end,
          cancelado_en = case
            when v_stage_cancelado and not v_stage_actual.cancelado then now()
            when not v_stage_cancelado then null
            else v_stage_actual.cancelado_en
          end,
          cancelado_por = case
            when v_stage_cancelado and not v_stage_actual.cancelado then auth.uid()
            when not v_stage_cancelado then null
            else v_stage_actual.cancelado_por
          end,
          modificado_por = auth.uid()
      where id = v_stage_id
        and version = v_stage_version;

      if not found then
        raise exception 'La T cambió antes de guardarse';
      end if;
    end if;

    v_saved_stages := v_saved_stages + 1;

    if jsonb_typeof(coalesce(v_stage->'trabajos', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(v_stage->'trabajos', '[]'::jsonb)) > 50 then
      raise exception 'Los trabajos de una T no tienen un formato válido';
    end if;

    for v_work in
      select value from jsonb_array_elements(coalesce(v_stage->'trabajos', '[]'::jsonb))
    loop
      v_work_id := nullif(v_work->>'id', '')::uuid;
      v_work_cancelado := coalesce((v_work->>'cancelado')::boolean, false);
      v_work_version := nullif(v_work->>'version', '')::integer;

      if btrim(coalesce(v_work->>'tipo_trabajo', '')) = ''
         or not exists (
           select 1 from public.catalogo_tipos_trabajo
           where codigo = v_work->>'tipo_trabajo' and activo = true
         ) then
        raise exception 'Una T contiene un tipo de trabajo no válido';
      end if;

      if v_work_cancelado
         and btrim(coalesce(v_work->>'motivo_cancelacion', '')) = '' then
        raise exception 'Indica el motivo para cancelar el trabajo %', v_work->>'tipo_trabajo';
      end if;

      if v_work_id is null then
        if v_work_cancelado then
          continue;
        end if;

        insert into public.trabajos_etapa_hotel(
          etapa_hotel_id, tipo_trabajo, categoria_tecnica, motivo_entrada,
          diagnostico_real, km_averia, expediente, descripcion, peritaje_estado,
          observaciones, creado_por, modificado_por
        ) values (
          v_stage_id,
          v_work->>'tipo_trabajo',
          btrim(coalesce(v_work->>'categoria_tecnica', '')),
          btrim(coalesce(v_work->>'motivo_entrada', '')),
          btrim(coalesce(v_work->>'diagnostico_real', '')),
          nullif(v_work->>'km_averia', '')::integer,
          btrim(coalesce(v_work->>'expediente', '')),
          btrim(coalesce(v_work->>'descripcion', '')),
          btrim(coalesce(v_work->>'peritaje_estado', '')),
          btrim(coalesce(v_work->>'observaciones', '')),
          auth.uid(),
          auth.uid()
        );
      else
        select * into v_work_actual
        from public.trabajos_etapa_hotel t
        where t.id = v_work_id
          and t.etapa_hotel_id = v_stage_id
        for update;

        if not found then
          raise exception 'Un trabajo ya no pertenece a esta T';
        end if;

        if v_work_version is null or v_work_actual.version <> v_work_version then
          raise exception 'El trabajo % ha cambiado desde que abriste la ficha', v_work_actual.tipo_trabajo;
        end if;

        update public.trabajos_etapa_hotel
        set tipo_trabajo = v_work->>'tipo_trabajo',
            categoria_tecnica = btrim(coalesce(v_work->>'categoria_tecnica', '')),
            motivo_entrada = btrim(coalesce(v_work->>'motivo_entrada', '')),
            diagnostico_real = btrim(coalesce(v_work->>'diagnostico_real', '')),
            km_averia = nullif(v_work->>'km_averia', '')::integer,
            expediente = btrim(coalesce(v_work->>'expediente', '')),
            descripcion = btrim(coalesce(v_work->>'descripcion', '')),
            peritaje_estado = btrim(coalesce(v_work->>'peritaje_estado', '')),
            observaciones = btrim(coalesce(v_work->>'observaciones', '')),
            cancelado = v_work_cancelado,
            motivo_cancelacion = case when v_work_cancelado then btrim(v_work->>'motivo_cancelacion') else '' end,
            cancelado_en = case
              when v_work_cancelado and not v_work_actual.cancelado then now()
              when not v_work_cancelado then null
              else v_work_actual.cancelado_en
            end,
            cancelado_por = case
              when v_work_cancelado and not v_work_actual.cancelado then auth.uid()
              when not v_work_cancelado then null
              else v_work_actual.cancelado_por
            end,
            modificado_por = auth.uid()
        where id = v_work_id
          and version = v_work_version;

        if not found then
          raise exception 'El trabajo cambió antes de guardarse';
        end if;
      end if;

      v_saved_works := v_saved_works + 1;
    end loop;
  end loop;

  select count(*) into v_audit_count
  from public.auditoria_cambios a
  where a.request_id = p_request_id;

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'version', v_new_version,
    'etapas_guardadas', v_saved_stages,
    'trabajos_guardados', v_saved_works,
    'eventos_auditoria', v_audit_count,
    'detalle', public.obtener_ficha_hotel_edicion(p_registro_id)
  );
exception
  when unique_violation then
    raise exception 'Hay dos T activas con la misma posición. Corrige la numeración antes de guardar.';
end;
$function$
;
REVOKE ALL ON FUNCTION public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text) TO service_role;
-- Literal runtime MD5: ba5636a2d05ddcb731887de399e72094 (public.guardar_ficha_hotel_edicion_v2(uuid,integer,jsonb,jsonb,text))
CREATE OR REPLACE FUNCTION public.guardar_ficha_hotel_edicion_v2(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.guardar_ficha_hotel_edicion_v2($1, $2, $3, $4, $5);
$function$
;
REVOKE ALL ON FUNCTION public.guardar_ficha_hotel_edicion_v2(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guardar_ficha_hotel_edicion_v2(uuid,integer,jsonb,jsonb,text) TO authenticated,service_role;
-- Literal runtime MD5: 4c63357e2389df82e193bde8b3304417 (public.obtener_ficha_hotel_edicion(uuid))
CREATE OR REPLACE FUNCTION public.obtener_ficha_hotel_edicion(p_registro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.dispositivo_autorizado() or not public.puede_ver_modulo('hotel') then raise exception 'Acceso no autorizado a la ficha de Hotel'; end if;
  if not exists (select 1 from public.hotel_edicion_piloto h where h.registro_hotel_id=p_registro_id and h.activo=true) then raise exception 'Esta ficha todavía no está habilitada para edición'; end if;
  select jsonb_build_object(
    'ficha',to_jsonb(r),
    'etapas',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('trabajos',coalesce((select jsonb_agg(to_jsonb(t) order by t.creado_en,t.id) from public.trabajos_etapa_hotel t where t.etapa_hotel_id=e.id),'[]'::jsonb)) order by e.cancelado,e.posicion,e.creado_en,e.id) from public.etapas_hotel e where e.registro_hotel_id=r.id),'[]'::jsonb),
    'catalogos',jsonb_build_object(
      'estados',coalesce((select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'orden',c.orden,'color',c.color_semantico) order by c.orden,c.nombre) from public.catalogo_estados_hotel c where c.activo=true),'[]'::jsonb),
      'estados_etapa',coalesce((select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'estado_operativo',c.estado_operativo,'orden',c.orden) order by c.orden,c.nombre) from public.catalogo_estados_etapa_hotel c where c.activo=true),'[]'::jsonb),
      'tipos_etapa',coalesce((select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'orden',c.orden) order by c.orden,c.nombre) from public.catalogo_tipos_etapa_hotel c where c.activo=true),'[]'::jsonb),
      'tipos_trabajo',coalesce((select jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'requiere_expediente',c.requiere_expediente,'requiere_diagnostico',c.requiere_diagnostico) order by c.codigo) from public.catalogo_tipos_trabajo c where c.activo=true),'[]'::jsonb),
      'talleres',coalesce((select jsonb_agg(jsonb_build_object('id',tw.id,'nombre',tw.nombre,'observaciones',tw.observaciones,'centros',coalesce((select jsonb_agg(jsonb_build_object('id',ct.id,'nombre',ct.nombre,'direccion',ct.direccion,'poblacion',ct.poblacion) order by ct.nombre) from public.centros_taller ct where ct.taller_id=tw.id and ct.activo=true),'[]'::jsonb)) order by tw.nombre) from public.talleres tw where tw.activo=true),'[]'::jsonb)
    )
  ) into v_result from public.registros_hotel r where r.id=p_registro_id;
  if v_result is null then raise exception 'Ficha de Hotel no encontrada'; end if;
  return v_result;
end;
$function$
;
REVOKE ALL ON FUNCTION public.obtener_ficha_hotel_edicion(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.obtener_ficha_hotel_edicion(uuid) TO authenticated,service_role;
-- Literal runtime MD5: 291aaa87ec054dc5d64c501d6d753c9c (public.obtener_ficha_hotel_edicion_alpha71(uuid))
CREATE OR REPLACE FUNCTION public.obtener_ficha_hotel_edicion_alpha71(p_registro_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.obtener_ficha_hotel_edicion_alpha71($1);
$function$
;
REVOKE ALL ON FUNCTION public.obtener_ficha_hotel_edicion_alpha71(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.obtener_ficha_hotel_edicion_alpha71(uuid) TO authenticated,service_role;
-- Literal runtime MD5: 770cfe5b3429c7026e00cfa961b40d3c (public.obtener_ficha_hotel_edicion_alpha72(uuid))
CREATE OR REPLACE FUNCTION public.obtener_ficha_hotel_edicion_alpha72(p_registro_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.obtener_ficha_hotel_edicion_alpha72($1); $function$
;
REVOKE ALL ON FUNCTION public.obtener_ficha_hotel_edicion_alpha72(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.obtener_ficha_hotel_edicion_alpha72(uuid) TO authenticated,service_role;
-- Literal runtime MD5: dcf7912546121cac5a4ea8ffce096271 (app_private.anotaciones_manuales_hotel_json(uuid))
CREATE OR REPLACE FUNCTION app_private.anotaciones_manuales_hotel_json(p_seguimiento_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'texto', n.texto,
    'fecha_evento', n.fecha_evento,
    'origen', n.origen,
    'autor_nombre', n.autor_nombre,
    'modificador_nombre', n.modificador_nombre,
    'version', n.version,
    'creado_en', n.creado_en,
    'actualizado_en', n.actualizado_en
  ) order by n.fecha_evento, n.id), '[]'::jsonb)
  from public.anotaciones_manuales_hotel n
  where n.seguimiento_id = p_seguimiento_id
    and not n.cancelada;
$function$
;
REVOKE ALL ON FUNCTION app_private.anotaciones_manuales_hotel_json(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.anotaciones_manuales_hotel_json(uuid) TO service_role;
-- Literal runtime MD5: 77cc5f18d32d2d1a5af5533afacc93dd (app_private.cierre_sin_recuperacion_completo_rec001(uuid))
CREATE OR REPLACE FUNCTION app_private.cierre_sin_recuperacion_completo_rec001(p_registro_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
DECLARE v_reg public.registros_hotel%ROWTYPE; v_modelo text; v_e record; v_total integer:=0; v_entradas integer:=0;
BEGIN
 SELECT * INTO v_reg FROM public.registros_hotel WHERE id=p_registro_id AND NOT cancelado;
 IF NOT FOUND OR app_private.modalidad_hotel_requiere_recuperacion(p_registro_id) THEN RETURN false; END IF;
 v_modelo := CASE WHEN app_private.usa_flujo_taller_hitos(p_registro_id) THEN 'entrada_hitos_v1' ELSE 'legacy' END;
 FOR v_e IN SELECT e.* FROM public.etapas_hotel e WHERE e.registro_hotel_id=p_registro_id AND NOT e.cancelado AND e.estado<>'anulada' AND NOT app_private.es_recuperacion_rec001(to_jsonb(e)) LOOP
  v_total:=v_total+1; IF v_e.estado<>'realizada' THEN RETURN false; END IF;
  IF lower(v_e.tipo_etapa)='entrada_taller' THEN
   v_entradas:=v_entradas+1;
   IF v_modelo='entrada_hitos_v1' THEN
    IF v_e.fecha_inicio_real IS NULL OR v_e.fecha_fin_real IS NULL OR v_e.fecha_real IS NULL OR v_e.fecha_fin_real<v_e.fecha_inicio_real OR v_e.fecha_real<v_e.fecha_fin_real THEN RETURN false; END IF;
   ELSIF NOT app_private.etapa_manteniment_sin_recogida_alpha74(v_e.id) THEN
    IF NOT EXISTS(SELECT 1 FROM public.etapas_hotel pickup WHERE pickup.registro_hotel_id=p_registro_id AND NOT pickup.cancelado AND pickup.tipo_etapa='recogida_taller' AND pickup.estado='realizada' AND pickup.etapa_origen_id=v_e.id AND coalesce(pickup.fecha_real,pickup.fecha_fin_real) IS NOT NULL) THEN RETURN false; END IF;
   END IF;
  ELSIF lower(v_e.tipo_etapa) IN ('recogida_taller','24h') AND coalesce(v_e.fecha_real,v_e.fecha_fin_real) IS NULL THEN RETURN false;
  END IF;
 END LOOP;
 IF v_total=0 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=v_reg.seguimiento_id) AND a.estado='abierta') OR EXISTS(SELECT 1 FROM public.etapas_hotel e WHERE e.registro_hotel_id=p_registro_id AND NOT e.cancelado AND lower(e.tipo_etapa)='24h') THEN
  IF NOT EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=v_reg.seguimiento_id) AND a.estado<>'anulada') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.activaciones_24h a WHERE (a.registro_hotel_id=p_registro_id OR a.seguimiento_hotel_id=v_reg.seguimiento_id) AND a.estado<>'anulada' AND NOT ((coalesce(a.resultado,'')='operativo_reparado' AND coalesce(a.estado_operativo_confirmado,false) AND coalesce(a.reparado_carretera,false)) OR (coalesce(a.trasladado_taller,false) AND v_entradas>0))) THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $function$
;
REVOKE ALL ON FUNCTION app_private.cierre_sin_recuperacion_completo_rec001(uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Literal runtime MD5: 2b00b0376172ce3bc93faf6de3a016d1 (app_private.etapa_manteniment_sin_recogida_alpha74(uuid))
CREATE OR REPLACE FUNCTION app_private.etapa_manteniment_sin_recogida_alpha74(p_etapa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select
    exists (
      select 1
      from public.etapas_hotel e
      where e.id = p_etapa_id
        and app_private.usa_flujo_taller_hitos(e.registro_hotel_id)
    )
    or
    case when exists (
      select 1 from public.etapas_hotel e
      join app_private.manteniment_t_visitas v on v.grupo_entrada_id=e.grupo_documental_id
      join public.registros_hotel r on r.id=e.registro_hotel_id and r.seguimiento_id=v.seguimiento_id
      where e.id=p_etapa_id and v.modalidad='taller'
    ) then false else exists (
      select 1
      from public.etapas_hotel origen
      where origen.id = p_etapa_id
        and (
          exists (
            select 1
            from app_private.manteniment_t_visitas v
            where v.grupo_entrada_id = origen.grupo_documental_id
              and (
                v.modalidad in ('tramite', 'entrada_sin_recogida')
                or regexp_replace(upper(btrim(coalesce(v.taller, ''))), '[[:space:]]+', ' ', 'g') in ('TM', 'NAVE TM')
              )
          )
          or exists (
            select 1
            from public.trabajos_etapa_hotel t
            left join app_private.manteniment_t_trabajos w on w.trabajo_hotel_id = t.id
            where t.etapa_hotel_id = origen.id
              and not t.cancelado
              and (
                translate(upper(coalesce(w.tipo_trabajo, t.motivo_entrada, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') like '%TRAMITE%'
                or upper(btrim(coalesce(w.designacion, t.categoria_tecnica, ''))) in ('LKT', 'EXTINTOR')
              )
          )
          or translate(upper(coalesce(origen.nombre, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')
               ~ '(^|[^A-Z0-9])(TRAMITE|LKT|EXTINTOR)([^A-Z0-9]|$)'
          or regexp_replace(
               regexp_replace(upper(btrim(coalesce(origen.nombre, ''))), '[[:space:]]+', ' ', 'g'),
               '^ENTRADA( EN)?( TALLER)?[[:space:]·:.-]*', '', 'g'
             ) in ('TM', 'NAVE TM')
        )
    ) end;
$function$
;
REVOKE ALL ON FUNCTION app_private.etapa_manteniment_sin_recogida_alpha74(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.etapa_manteniment_sin_recogida_alpha74(uuid) TO service_role;
-- Literal runtime MD5: e05454f156f0231f6d112d7d72f8f4aa (app_private.reabrir_cierre_ficha_hotel(uuid,uuid))
CREATE OR REPLACE FUNCTION app_private.reabrir_cierre_ficha_hotel(p_registro_id uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_actor uuid;
  v_count integer := 0;
begin
  select coalesce(p_actor, auth.uid(), r.modificado_por, r.creado_por)
    into v_actor
  from public.registros_hotel r
  where r.id = p_registro_id
    and not r.cancelado
    and not r.retirado_hotel_activo
    and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
  for update;

  if not found then
    return 0;
  end if;
  if not app_private.modalidad_hotel_requiere_recuperacion(p_registro_id) then return 0; end if;

  if nullif(current_setting('app.request_id', true), '') is null then
    perform set_config(
      'app.request_id',
      'reactivar_' || replace(gen_random_uuid()::text, '-', ''),
      true
    );
  end if;
  perform set_config('app.audit_origin', 'metrogestion-r1-reactivacion-integridad', true);
  perform set_config(
    'app.audit_reason',
    'Reapertura atomica de la T final al reactivar la ficha',
    true
  );

  update public.etapas_hotel e
  set estado = case when e.fecha_prevista is null then 'pendiente' else 'programada' end,
      estado_catalogo_codigo = case when e.fecha_prevista is null then 'pendiente' else 'programada' end,
      fecha_inicio_real = null,
      fecha_fin_real = null,
      fecha_real = null,
      marcado_rapido = false,
      marcado_rapido_en = null,
      marcado_rapido_por = null,
      datos_pendientes = false,
      datos_completados_en = null,
      datos_completados_por = null,
      modificado_por = v_actor
  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.accion_sistema in ('recuperar_y_liberar', 'liberar_reserva')
    and (
      e.estado = 'realizada'
      or e.fecha_fin_real is not null
      or e.fecha_real is not null
      or e.marcado_rapido
      or e.marcado_rapido_en is not null
      or e.marcado_rapido_por is not null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.reabrir_cierre_ficha_hotel(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.reabrir_cierre_ficha_hotel(uuid,uuid) TO service_role;
-- Literal runtime MD5: 6efdf968c6c137d52ff714bd7bec2ba4 (public.guardar_ficha_hotel_edicion(uuid,integer,jsonb,jsonb,text))
CREATE OR REPLACE FUNCTION public.guardar_ficha_hotel_edicion(p_registro_id uuid, p_version integer, p_ficha jsonb, p_etapas jsonb, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.guardar_ficha_hotel_edicion($1, $2, $3, $4, $5);
$function$
;
REVOKE ALL ON FUNCTION public.guardar_ficha_hotel_edicion(uuid,integer,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guardar_ficha_hotel_edicion(uuid,integer,jsonb,jsonb,text) TO authenticated,service_role;
-- Literal runtime MD5: e4f6bd16ba5149480e3e26721107e792 (public.reconciliar_etapas_hotel(uuid,text))
CREATE OR REPLACE FUNCTION public.reconciliar_etapas_hotel(p_registro_id uuid, p_request_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
  select app_private.reconciliar_etapas_hotel($1, $2);
$function$
;
REVOKE ALL ON FUNCTION public.reconciliar_etapas_hotel(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reconciliar_etapas_hotel(uuid,text) TO authenticated,service_role;
-- Literal runtime MD5: 6901a4cb7a1ae9a7cac8ea18464ccf9e (app_private.manteniment_parada_sync_trigger())
CREATE OR REPLACE FUNCTION app_private.manteniment_parada_sync_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
begin
  new.actualizado_en := clock_timestamp();
  if coalesce(current_setting('app.manteniment_importando_paradas', true), '') <> '1' then
    perform app_private.manteniment_encolar_parada(new.seguimiento_id);
  end if;
  return new;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.manteniment_parada_sync_trigger() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.manteniment_parada_sync_trigger() TO service_role;
-- Literal runtime MD5: 43501c921217bda4b11e4f6bc40b2e10 (app_private.recalcular_fechas_manteniment_alpha75(uuid))
CREATE OR REPLACE FUNCTION app_private.recalcular_fechas_manteniment_alpha75(p_registro_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_seguimiento_id uuid;
  v_actualizados integer := 0;
  v_nuevo boolean := false;
begin
  select r.seguimiento_id into v_seguimiento_id
  from public.registros_hotel r
  where r.id = p_registro_id;

  if v_seguimiento_id is null then return 0; end if;
  v_nuevo := app_private.usa_flujo_taller_hitos(p_registro_id);

  if v_nuevo then
    with fechas as (
      select w.id,
             (
               select (e.fecha_fin_real at time zone 'Europe/Madrid')::date
               from public.etapas_hotel e
               where e.registro_hotel_id=p_registro_id
                 and not e.cancelado
                 and e.tipo_etapa='entrada_taller'
                 and e.grupo_documental_id=v.grupo_entrada_id
               order by e.actualizado_en desc,e.id desc
               limit 1
             ) as fecha_realizada_nueva,
             (
               select (e.fecha_real at time zone 'Europe/Madrid')::date
               from public.etapas_hotel e
               where e.registro_hotel_id=p_registro_id
                 and not e.cancelado
                 and e.tipo_etapa='entrada_taller'
                 and e.grupo_documental_id=v.grupo_entrada_id
               order by e.actualizado_en desc,e.id desc
               limit 1
             ) as fecha_recogida_nueva
      from app_private.manteniment_t_trabajos w
      join app_private.manteniment_t_visitas v on v.id=w.visita_id
      where v.seguimiento_id=v_seguimiento_id
        and v.modalidad='taller'
    )
    update app_private.manteniment_t_trabajos w
       set fecha_realizada=f.fecha_realizada_nueva,
           fecha_recogida=f.fecha_recogida_nueva,
           actualizado_en=clock_timestamp()
      from fechas f
     where w.id=f.id
       and (w.fecha_realizada is distinct from f.fecha_realizada_nueva
            or w.fecha_recogida is distinct from f.fecha_recogida_nueva);
    get diagnostics v_actualizados=row_count;
  else
    with fechas as (
      select w.id,
             case
               when v.modalidad = 'taller' then (
                 select (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                         at time zone 'Europe/Madrid')::date
                 from public.etapas_hotel e
                 join public.registros_hotel r on r.id = e.registro_hotel_id
                 where r.seguimiento_id = v_seguimiento_id
                   and not r.cancelado
                   and not e.cancelado
                   and e.estado = 'realizada'
                   and e.tipo_etapa = 'entrada_taller'
                   and e.grupo_documental_id = v.grupo_entrada_id
                 order by coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) desc nulls last,
                          e.actualizado_en desc, e.id desc
                 limit 1
               )
               when not coalesce(th.cancelado, true)
                    and not coalesce(e.cancelado, true)
                    and e.estado = 'realizada'
                    and e.tipo_etapa <> 'recogida_taller'
               then (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                     at time zone 'Europe/Madrid')::date
               else null
             end as fecha_realizada_nueva,
             case
               when v.modalidad = 'taller' then (
                 select (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                         at time zone 'Europe/Madrid')::date
                 from public.etapas_hotel e
                 join public.registros_hotel r on r.id = e.registro_hotel_id
                 where r.seguimiento_id = v_seguimiento_id
                   and not r.cancelado
                   and not e.cancelado
                   and e.estado = 'realizada'
                   and e.tipo_etapa = 'recogida_taller'
                   and e.grupo_documental_id = v.grupo_recogida_id
                 order by coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real) desc nulls last,
                          e.actualizado_en desc, e.id desc
                 limit 1
               )
               when not coalesce(th.cancelado, true)
                    and not coalesce(e.cancelado, true)
                    and e.estado = 'realizada'
                    and e.tipo_etapa not in ('entrada_taller', 'recogida_taller')
               then (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                     at time zone 'Europe/Madrid')::date
               when not coalesce(th.cancelado, true)
                    and not coalesce(e.cancelado, true)
                    and e.estado = 'realizada'
                    and e.tipo_etapa = 'recogida_taller'
               then (coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real)
                     at time zone 'Europe/Madrid')::date
               else null
             end as fecha_recogida_nueva
      from app_private.manteniment_t_trabajos w
      join app_private.manteniment_t_visitas v on v.id = w.visita_id
      left join public.trabajos_etapa_hotel th on th.id = w.trabajo_hotel_id
      left join public.etapas_hotel e on e.id = th.etapa_hotel_id
      where v.seguimiento_id = v_seguimiento_id
    )
    update app_private.manteniment_t_trabajos w
       set fecha_realizada = f.fecha_realizada_nueva,
           fecha_recogida = f.fecha_recogida_nueva,
           actualizado_en = clock_timestamp()
      from fechas f
     where w.id = f.id
       and (w.fecha_realizada is distinct from f.fecha_realizada_nueva
            or w.fecha_recogida is distinct from f.fecha_recogida_nueva);
    get diagnostics v_actualizados = row_count;
  end if;

  if exists (
    select 1 from app_private.manteniment_parada_sync s
    where s.seguimiento_id = v_seguimiento_id
  ) then
    perform app_private.manteniment_encolar_parada(v_seguimiento_id);
  end if;

  return v_actualizados;
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.recalcular_fechas_manteniment_alpha75(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.recalcular_fechas_manteniment_alpha75(uuid) TO service_role;
-- Literal runtime MD5: 692b14a9f283f210d87f077ab15c8f5a (app_private.reconciliar_dependencias_t_alpha75(uuid,uuid))
CREATE OR REPLACE FUNCTION app_private.reconciliar_dependencias_t_alpha75(p_registro_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_recogidas_anuladas integer := 0;
  v_recogidas_restauradas integer := 0;
begin
  update public.etapas_hotel recogida
     set cancelado = true,
         estado = 'anulada',
         estado_catalogo_codigo = 'anulada',
         motivo_cancelacion = 'Anulada automáticamente: la Entrada de taller vinculada ya no está activa.',
         cancelado_en = clock_timestamp(),
         cancelado_por = p_actor,
         modificado_por = p_actor
   where recogida.registro_hotel_id = p_registro_id
     and not recogida.cancelado
     and recogida.tipo_etapa = 'recogida_taller'
     and recogida.etapa_origen_id is not null
     and not exists (
       select 1
       from public.etapas_hotel entrada
       where entrada.id = recogida.etapa_origen_id
         and entrada.registro_hotel_id = recogida.registro_hotel_id
         and not entrada.cancelado
         and entrada.tipo_etapa = 'entrada_taller'
     );
  get diagnostics v_recogidas_anuladas = row_count;

  update public.etapas_hotel recogida
     set cancelado = false,
         estado = case when recogida.fecha_prevista is null then 'pendiente' else 'programada' end,
         estado_catalogo_codigo = case when recogida.fecha_prevista is null then 'pendiente' else 'programada' end,
         motivo_cancelacion = '',
         cancelado_en = null,
         cancelado_por = null,
         modificado_por = p_actor
   where recogida.registro_hotel_id = p_registro_id
     and recogida.cancelado
     and recogida.tipo_etapa = 'recogida_taller'
     and recogida.etapa_origen_id is not null
     and recogida.motivo_cancelacion = 'Anulada automáticamente: la Entrada de taller vinculada ya no está activa.'
     and exists (
       select 1
       from public.etapas_hotel entrada
       where entrada.id = recogida.etapa_origen_id
         and entrada.registro_hotel_id = recogida.registro_hotel_id
         and not entrada.cancelado
         and entrada.tipo_etapa = 'entrada_taller'
     )
     and not exists (
       select 1
       from public.etapas_hotel otra
       where otra.registro_hotel_id = recogida.registro_hotel_id
         and otra.etapa_origen_id = recogida.etapa_origen_id
         and otra.id <> recogida.id
         and not otra.cancelado
         and otra.tipo_etapa = 'recogida_taller'
     );
  get diagnostics v_recogidas_restauradas = row_count;

  return jsonb_build_object(
    'recogidas_anuladas', v_recogidas_anuladas,
    'recogidas_restauradas', v_recogidas_restauradas
  );
end;
$function$
;
REVOKE ALL ON FUNCTION app_private.reconciliar_dependencias_t_alpha75(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.reconciliar_dependencias_t_alpha75(uuid,uuid) TO service_role;
-- Same local PARADA queue trigger; it calls the candidate barrier-aware helper.
CREATE TRIGGER manteniment_parada_sync_encolar AFTER INSERT OR UPDATE ON app_private.manteniment_parada_sync
 FOR EACH ROW EXECUTE FUNCTION app_private.manteniment_parada_sync_trigger();

-- Exact catalog owner/grants for the two functions guarded by the timestamp
-- migration. Both are INVOKER; this does not grant login or alter existing roles.
DO $editor_owner$ BEGIN CREATE ROLE postgres NOLOGIN;
 EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $editor_owner$;
ALTER FUNCTION public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.obtener_ficha_hotel_edicion_alpha72(uuid) OWNER TO postgres;

DO $editor_runtime_check$
DECLARE f record;
BEGIN
 FOR f IN SELECT * FROM (VALUES
 ('app_private.asegurar_reactivacion_historica(uuid)','fd6b6833e496f8f0696d5b125a5251cb'),
 ('app_private.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text)','6059f56372cb3a28db5aeb6bcc1232e3'),
 ('app_private.guardar_ficha_hotel_edicion_catalogos(uuid,integer,jsonb,jsonb,text)','515e6e0aa3b998bf8ad0c4ba79aefab5'),
 ('app_private.guardar_ficha_hotel_edicion_v2(uuid,integer,jsonb,jsonb,text)','23e0b9424f6bcc87641b033e2be1ad59'),
 ('app_private.normalizar_orden_t_parada(uuid)','c98c2652f30902009aa6927ca5263fb5'),
 ('app_private.obtener_ficha_hotel_edicion_alpha71(uuid)','62388148414c29a6f2958ccf67f19848'),
 ('app_private.obtener_ficha_hotel_edicion_alpha72(uuid)','3010c515ce57793e93a72b97f57cd8cd'),
 ('app_private.propagar_correcciones_globales_parada(uuid,jsonb)','71a1ec18ce7ae6c2e1dcc0f150c4917d'),
 ('app_private.propagar_detalles_t_parada(uuid)','a570dd350618fa0258eec30eadd174ec'),
 ('app_private.sincronizar_anotaciones_manuales_hotel(uuid,jsonb)','4c7b7291dc685ad45eeff6e7a085e124'),
 ('public.guardar_ficha_hotel_edicion_alpha71(uuid,integer,jsonb,jsonb,text)','b7da30bbbad7bd890d030de377344849'),
 ('public.guardar_ficha_hotel_edicion_catalogos(uuid,integer,jsonb,jsonb,text)','fa1af03c38800a597086f0e649ec0891'),
 ('public.guardar_ficha_hotel_edicion_core(uuid,integer,jsonb,jsonb,text)','093c9f6c9f2b9dd172ed640969c3464c'),
 ('public.guardar_ficha_hotel_edicion_v2(uuid,integer,jsonb,jsonb,text)','ba5636a2d05ddcb731887de399e72094'),
 ('public.obtener_ficha_hotel_edicion(uuid)','4c63357e2389df82e193bde8b3304417'),
 ('public.obtener_ficha_hotel_edicion_alpha71(uuid)','291aaa87ec054dc5d64c501d6d753c9c'),
 ('public.obtener_ficha_hotel_edicion_alpha72(uuid)','770cfe5b3429c7026e00cfa961b40d3c'),
 ('app_private.anotaciones_manuales_hotel_json(uuid)','dcf7912546121cac5a4ea8ffce096271'),
 ('app_private.cierre_sin_recuperacion_completo_rec001(uuid)','77cc5f18d32d2d1a5af5533afacc93dd'),
 ('app_private.etapa_manteniment_sin_recogida_alpha74(uuid)','2b00b0376172ce3bc93faf6de3a016d1'),
 ('app_private.reabrir_cierre_ficha_hotel(uuid,uuid)','e05454f156f0231f6d112d7d72f8f4aa'),
 ('public.guardar_ficha_hotel_edicion(uuid,integer,jsonb,jsonb,text)','6efdf968c6c137d52ff714bd7bec2ba4'),
 ('public.reconciliar_etapas_hotel(uuid,text)','e4f6bd16ba5149480e3e26721107e792'),
 ('app_private.manteniment_parada_sync_trigger()','6901a4cb7a1ae9a7cac8ea18464ccf9e'),
 ('app_private.recalcular_fechas_manteniment_alpha75(uuid)','43501c921217bda4b11e4f6bc40b2e10'),
 ('app_private.reconciliar_dependencias_t_alpha75(uuid,uuid)','692b14a9f283f210d87f077ab15c8f5a')) v(signature,definition_md5) LOOP
  IF md5(pg_get_functiondef(f.signature::regprocedure))<>f.definition_md5 THEN
   RAISE EXCEPTION 'Editor fixture runtime drift: %',f.signature;
  END IF;
 END LOOP;
END $editor_runtime_check$;
COMMIT;
