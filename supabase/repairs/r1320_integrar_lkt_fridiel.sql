-- R1320 / PA-2600121: integrar MANTENIMIENTO B+LKT como trabajo de Fridiel.
-- Conserva identidad y contenido del trabajo, visita de origen y recogida única.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select set_config('app.audit_origin','r1320-integrar-trabajo-fridiel',true);
select set_config('app.audit_reason','Solicitud: incluir la T de LKT como otro trabajo de la entrada de Fridiel.',true);
select set_config('app.request_id','r1320_integrar_lkt_fridiel_20260915',true);
do $repair$
declare
  v_reg public.registros_hotel%rowtype;
  v_entry public.etapas_hotel%rowtype;
  v_source public.etapas_hotel%rowtype;
  v_pickup public.etapas_hotel%rowtype;
  v_count integer;
begin
  select * into strict v_reg from public.registros_hotel
  where id='b2a4893f-9f69-4b82-8d4c-2f0dbff6c0f2' for update;
  perform 1 from public.etapas_hotel where registro_hotel_id=v_reg.id order by id for update;
  select * into strict v_entry from public.etapas_hotel where id='359c4832-1356-4f8d-bb67-2d37da55286c';
  select * into strict v_source from public.etapas_hotel where id='16fbcfbd-e107-435d-9bb9-71b5613cc592';
  select * into strict v_pickup from public.etapas_hotel
    where etapa_origen_id=v_entry.id and tipo_etapa='recogida_taller' and not cancelado;
  if v_reg.version<>2 or v_reg.vehiculo_sustituido<>'R1320' or v_reg.estado<>'en_taller'
     or v_reg.cancelado or v_reg.retirado_hotel_activo
     or v_entry.registro_hotel_id<>v_reg.id or v_source.registro_hotel_id<>v_reg.id
     or v_entry.version<>11 or v_entry.tipo_etapa<>'entrada_taller'
     or v_entry.cancelado or v_entry.estado<>'realizada'
     or v_entry.taller_id<>'3144d0f4-af73-4c74-be5c-9771cc6dfc05'
     or v_source.version<>10 or v_source.cancelado or v_source.estado<>'pendiente'
     or v_source.nombre<>'Pendiente de taller · MCD · MANTENIMIENTO B+LKT'
     or v_pickup.estado<>'pendiente'
  then raise exception 'La ficha cambió desde la revisión; volver a comprobar antes de integrar.'; end if;
  if not exists (select 1 from public.pizarras where id=v_reg.pizarra_id and estado='en_curso')
     or exists (select 1 from public.documentos_gestion
       where etapa_hotel_id=v_source.id or grupo_etapa_id=v_source.grupo_documental_id)
  then raise exception 'La pizarra o la documentación requiere otra revisión.'; end if;

  -- Mover el trabajo existente evita crear otra copia con el mismo contenido.
  update public.trabajos_etapa_hotel set etapa_hotel_id=v_entry.id
  where id='977af1f8-24e3-438b-a172-5c63fbb19e72'
    and etapa_hotel_id=v_source.id and version=1 and not cancelado;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'El trabajo B+LKT cambió.'; end if;
  if exists (select 1 from public.trabajos_etapa_hotel where etapa_hotel_id=v_source.id and not cancelado)
  then raise exception 'Quedan otros trabajos activos en la T de origen.'; end if;

  -- Ambas necesidades utilizan la entrada y recogida reales de esta visita,
  -- conservando sus distintas identidades de MANTENIMENT.
  update app_private.manteniment_t_visitas
  set modalidad='taller', taller='FRIDIEL ABRERA',
      grupo_entrada_id=v_entry.grupo_documental_id,
      grupo_recogida_id=v_pickup.grupo_documental_id, actualizado_en=clock_timestamp()
  where id='4cd16bcd-c211-4126-8729-75a0d095785f'
    and seguimiento_id=v_reg.seguimiento_id and modalidad='pendiente_taller'
    and grupo_entrada_id is null and grupo_recogida_id is null;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'La visita de B+LKT cambió.'; end if;
  update app_private.manteniment_t_trabajos
  set trabajo_hotel_id='977af1f8-24e3-438b-a172-5c63fbb19e72',
      fecha_realizada=(v_entry.fecha_real at time zone 'Europe/Madrid')::date,
      fecha_recogida=null, actualizado_en=clock_timestamp()
  where id='3db8075f-631d-4dfa-80da-c96c71c672de'
    and visita_id='4cd16bcd-c211-4126-8729-75a0d095785f'
    and seguimiento_id=v_reg.seguimiento_id
    and sync_id='4ff0b94c-97cc-4739-8f7a-ad6630a51367';
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'El vínculo de MANTENIMENT cambió.'; end if;

  update public.etapas_hotel
  set cancelado=true, estado='anulada', estado_catalogo_codigo='anulada',
      motivo_cancelacion='Trabajo MANTENIMIENTO B+LKT integrado en la entrada activa de Fridiel; conserva su identidad y sincronización.',
      cancelado_en=clock_timestamp()
  where id=v_source.id;
  with orden as (
    select id,row_number() over(order by posicion,id)::integer as posicion
    from public.etapas_hotel where registro_hotel_id=v_reg.id and not cancelado
  )
  update public.etapas_hotel e set posicion=o.posicion
  from orden o where e.id=o.id and e.posicion<>o.posicion;
  -- Invalida formularios abiertos antes del traslado del trabajo.
  update public.registros_hotel set actualizado_en=clock_timestamp() where id=v_reg.id;
  perform app_private.manteniment_encolar_parada(v_reg.seguimiento_id);

  if not exists (select 1 from public.hotel_actual_detalle
       where id=v_reg.id and estado='en_taller' and lugar='Fridiel · Abrera')
     or app_private.etapa_manteniment_sin_recogida_alpha74(v_entry.id)
     or (select count(*) from public.etapas_hotel where etapa_origen_id=v_entry.id and not cancelado)<>1
     or (select count(*) from public.trabajos_etapa_hotel
         where etapa_hotel_id=v_entry.id and not cancelado and motivo_entrada='MANTENIMIENTO B+LKT')<>1
     or not exists (select 1 from public.etapas_hotel where id=v_pickup.id and estado='pendiente' and not cancelado)
     or (select vehiculo_reserva from public.registros_hotel where id=v_reg.id) is distinct from v_reg.vehiculo_reserva
  then raise exception 'La integración no conserva el trabajo único, estado, reserva o recogida.'; end if;
end;
$repair$;
set constraints all immediate;
commit;
