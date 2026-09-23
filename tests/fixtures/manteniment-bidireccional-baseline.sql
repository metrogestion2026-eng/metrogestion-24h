-- Sanitized schema/function baseline for bidirectional sync regression tests.
-- No operational rows. External auth/hash and queue IO are isolated below.
create schema app_private;create schema auth;create schema extensions;
create role anon;create role authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function extensions.digest(text,text) returns bytea language sql as $$select decode(md5($1),'hex')$$;
create table public.catalogo_tipos_trabajo (
"codigo" text,
"nombre" text,
"requiere_expediente" bool default false,
"requiere_diagnostico" bool default false,
"activo" bool default true);
create table public.centros_taller (
"id" uuid default gen_random_uuid(),
"taller_id" uuid,
"nombre" text,
"direccion" text default ''::text,
"poblacion" text default ''::text,
"codigo_postal" text default ''::text,
"plus_code" text default ''::text,
"observaciones" text default ''::text,
"activo" bool default true,
"version" int4 default 1,
"creado_por" uuid,
"modificado_por" uuid,
"creado_en" timestamptz default now(),
"actualizado_en" timestamptz default now());
create table public.etapas_hotel (
"id" uuid default gen_random_uuid(),
"registro_hotel_id" uuid,
"seguimiento_id" uuid default gen_random_uuid(),
"nombre" text,
"posicion" int4,
"estado" text default 'pendiente'::text,
"tipo_etapa" text default 'otro'::text,
"taller_id" uuid,
"centro_taller_id" uuid,
"lugar" text default ''::text,
"fecha_prevista" timestamptz,
"fecha_inicio_real" timestamptz,
"fecha_fin_real" timestamptz,
"fecha_real" timestamptz,
"observaciones" text default ''::text,
"cancelado" bool default false,
"motivo_cancelacion" text default ''::text,
"cancelado_en" timestamptz,
"cancelado_por" uuid,
"version" int4 default 1,
"creado_por" uuid,
"modificado_por" uuid,
"creado_en" timestamptz default now(),
"actualizado_en" timestamptz default now(),
"posicion_activa" int4,
"accion_sistema" text default ''::text,
"etapa_origen_id" uuid,
"grupo_documental_id" uuid default gen_random_uuid(),
"marcado_rapido" bool default false,
"marcado_rapido_en" timestamptz,
"marcado_rapido_por" uuid,
"datos_pendientes" bool default false,
"datos_completados_en" timestamptz,
"datos_completados_por" uuid,
"estado_catalogo_codigo" text default 'pendiente'::text,
"reabierta_en" timestamptz,
"reabierta_por" uuid,
"motivo_reapertura" text default ''::text,
"reaperturas" int4 default 0,
"estado_registro_antes_realizar" text,
"retirado_hotel_antes_realizar" bool,
"fecha_retirado_hotel_antes_realizar" timestamptz);
create table public.pizarras (
"id" uuid default gen_random_uuid(),
"fecha" date,
"estado" text default 'borrador'::text,
"origen" text default 'sistema'::text,
"creado_por" uuid,
"modificado_por" uuid,
"creado_en" timestamptz default now(),
"actualizado_en" timestamptz default now());
create table public.registros_hotel (
"id" uuid default gen_random_uuid(),
"pizarra_id" uuid,
"seguimiento_id" uuid default gen_random_uuid(),
"numero_parada" text,
"vehiculo_sustituido" text default ''::text,
"matricula_sustituido" text default ''::text,
"vehiculo_reserva" text default ''::text,
"matricula_reserva" text default ''::text,
"etiqueta_reserva" text default ''::text,
"tipo_unidad" text default ''::text,
"marca" text default ''::text,
"tipo_motor" text default ''::text,
"modelo" text default ''::text,
"upc" text default ''::text,
"telefono" text default ''::text,
"prioridad" int4 default 5,
"estado" text default 'pendiente_taller'::text,
"lugar" text default ''::text,
"fecha_parada" date,
"fecha_entrada" timestamptz,
"tipo_movimiento" text default ''::text,
"causa" text default ''::text,
"trabajos_reserva" text default ''::text,
"incidencia" text default ''::text,
"proximo" text default ''::text,
"observaciones" text default ''::text,
"sustitucion_temporal" bool default false,
"motivo_sustitucion_temporal" text default ''::text,
"fecha_limite_sustitucion" timestamptz,
"orden" int4 default 0,
"retirado_hotel_activo" bool default false,
"fecha_retirado_hotel" timestamptz,
"cancelado" bool default false,
"motivo_cancelacion" text default ''::text,
"cancelado_en" timestamptz,
"cancelado_por" uuid,
"version" int4 default 1,
"creado_por" uuid,
"modificado_por" uuid,
"creado_en" timestamptz default now(),
"actualizado_en" timestamptz default now(),
"tipo_sustituto" text default ''::text,
"trazo_marron" bool default false,
"modalidad_operativa" text default ''::text);
create table public.talleres (
"id" uuid default gen_random_uuid(),
"nombre" text,
"observaciones" text default ''::text,
"activo" bool default true,
"version" int4 default 1,
"creado_por" uuid,
"modificado_por" uuid,
"creado_en" timestamptz default now(),
"actualizado_en" timestamptz default now());
create table public.trabajos_etapa_hotel (
"id" uuid default gen_random_uuid(),
"etapa_hotel_id" uuid,
"tipo_trabajo" text,
"categoria_tecnica" text default ''::text,
"motivo_entrada" text default ''::text,
"diagnostico_real" text default ''::text,
"km_averia" int4,
"expediente" text default ''::text,
"descripcion" text default ''::text,
"peritaje_estado" text default ''::text,
"observaciones" text default ''::text,
"cancelado" bool default false,
"motivo_cancelacion" text default ''::text,
"cancelado_en" timestamptz,
"cancelado_por" uuid,
"version" int4 default 1,
"creado_por" uuid,
"modificado_por" uuid,
"creado_en" timestamptz default now(),
"actualizado_en" timestamptz default now());
create table public.vehiculos (
"id" uuid default gen_random_uuid(),
"dfm" text,
"matricula" text,
"categoria" text default ''::text,
"clase_vehiculo" text default ''::text,
"tipo_motor" text default ''::text,
"marca" text default ''::text,
"modelo" text default ''::text,
"bastidor" text default ''::text,
"upc" text default ''::text,
"telefono" text default ''::text,
"fecha_matriculacion" date,
"fin_contrato_fecha" date,
"fin_contrato_km" int4,
"km_actual" int4,
"reserva" bool default false,
"activo" bool default true,
"creado_en" timestamptz default now(),
"actualizado_en" timestamptz default now(),
"tipo_manteniment" text default ''::text,
"contrato_texto" text default ''::text,
"asignacion_manteniment" text default ''::text,
"fuente_manteniment_fila" int4,
"fuente_manteniment_actualizado_en" timestamptz,
"fecha_alta_manteniment" date,
"version" int4 default 1,
"alta_manual_en" timestamptz,
"alta_manual_por" uuid,
"baja_manual_en" timestamptz,
"baja_manual_por" uuid,
"motivo_baja" text default ''::text,
"baja_manual_bloquea_sync" bool default false,
"proxima_itv_fecha" date);
create table app_private.manteniment_activo_outbox (
"vehiculo_id" uuid,
"revision" int4 default 1,
"estado" text default 'pendiente'::text,
"payload" jsonb,
"intentos" int4 default 0,
"creado_en" timestamptz default clock_timestamp(),
"actualizado_en" timestamptz default clock_timestamp(),
"confirmado_en" timestamptz,
"ultimo_error" text default ''::text);
create table app_private.manteniment_parada_outbox (
"seguimiento_id" uuid,
"sync_id" uuid,
"revision" int4 default 1,
"estado" text default 'pendiente'::text,
"payload" jsonb,
"intentos" int4 default 0,
"creado_en" timestamptz default clock_timestamp(),
"actualizado_en" timestamptz default clock_timestamp(),
"confirmado_en" timestamptz,
"ultimo_error" text default ''::text);
create table app_private.manteniment_parada_sync (
"seguimiento_id" uuid,
"sync_id" uuid default gen_random_uuid(),
"fecha_programada_parada" date,
"fecha_corte" date,
"tancament" text default ''::text,
"tancament_supervisado" bool default false,
"tancament_supervisado_por" uuid,
"tancament_supervisado_en" timestamptz,
"dias_parada_manual" int4,
"km_facturables_manual" numeric,
"fila_manteniment" int4,
"ultimo_payload_confirmado" jsonb default '{}'::jsonb,
"creado_en" timestamptz default clock_timestamp(),
"actualizado_en" timestamptz default clock_timestamp(),
"fecha_inicio_parada_origen" date,
"fecha_inicio_tramo" date,
"calculo_periodo_automatico" bool default true);
create table app_private.manteniment_sync_config (
"id" int2 default 1,
"spreadsheet_id" text,
"spreadsheet_name" text default 'MANTENIMIENTOS'::text,
"sheet_name" text default 'MANTENIMENT'::text,
"token_hash" text default ''::text,
"token_activo" bool default false,
"token_creado_en" timestamptz,
"token_creado_por" uuid,
"minimo_filas" int4 default 50,
"proporcion_minima" numeric default 0.7500,
"antiguedad_alerta_horas" int4 default 26,
"correo_alerta" text default 'test@example.invalid'::text,
"creado_en" timestamptz default now(),
"actualizado_en" timestamptz default now(),
"token_rotado_en" timestamptz,
"token_rotado_por" uuid,
"intervalo_objetivo_horas" int4 default 6,
"hoja_nombre" text default 'MANTENIMENT'::text);
create table app_private.manteniment_t_trabajos (
"id" uuid default gen_random_uuid(),
"seguimiento_id" uuid,
"visita_id" uuid,
"sync_id" uuid default gen_random_uuid(),
"clave_trabajo" text,
"taller" text default ''::text,
"tipo_trabajo" text default ''::text,
"designacion" text,
"fecha_necesidad" date,
"fecha_realizada" date,
"fecha_recogida" date,
"grupo_etapa_id" uuid default gen_random_uuid(),
"trabajo_hotel_id" uuid,
"fuentes" jsonb default '[]'::jsonb,
"creado_en" timestamptz default clock_timestamp(),
"actualizado_en" timestamptz default clock_timestamp());
create table app_private.manteniment_t_visitas (
"id" uuid default gen_random_uuid(),
"seguimiento_id" uuid,
"clave_visita" text,
"modalidad" text,
"taller" text default ''::text,
"fecha_necesidad" date,
"grupo_entrada_id" uuid,
"grupo_recogida_id" uuid,
"creado_en" timestamptz default clock_timestamp(),
"actualizado_en" timestamptz default clock_timestamp());
alter table public.catalogo_tipos_trabajo add constraint "catalogo_tipos_trabajo_pkey" PRIMARY KEY (codigo);
alter table public.centros_taller add constraint "centros_taller_pkey" PRIMARY KEY (id);
alter table public.centros_taller add constraint "centros_taller_taller_id_nombre_key" UNIQUE (taller_id, nombre);
alter table public.etapas_hotel add constraint "etapas_hotel_pkey" PRIMARY KEY (id);
alter table public.etapas_hotel add constraint "etapas_hotel_posicion_activa_uq" UNIQUE (registro_hotel_id, posicion_activa) DEFERRABLE INITIALLY DEFERRED;
alter table public.pizarras add constraint "pizarras_fecha_key" UNIQUE (fecha);
alter table public.pizarras add constraint "pizarras_pkey" PRIMARY KEY (id);
alter table public.registros_hotel add constraint "registros_hotel_pkey" PRIMARY KEY (id);
alter table public.talleres add constraint "talleres_nombre_key" UNIQUE (nombre);
alter table public.talleres add constraint "talleres_pkey" PRIMARY KEY (id);
alter table public.trabajos_etapa_hotel add constraint "trabajos_etapa_hotel_pkey" PRIMARY KEY (id);
alter table public.vehiculos add constraint "vehiculos_dfm_key" UNIQUE (dfm);
alter table public.vehiculos add constraint "vehiculos_pkey" PRIMARY KEY (id);
alter table app_private.manteniment_activo_outbox add constraint "manteniment_activo_outbox_pkey" PRIMARY KEY (vehiculo_id);
alter table app_private.manteniment_parada_outbox add constraint "manteniment_parada_outbox_pkey" PRIMARY KEY (seguimiento_id);
alter table app_private.manteniment_parada_sync add constraint "manteniment_parada_sync_pkey" PRIMARY KEY (seguimiento_id);
alter table app_private.manteniment_parada_sync add constraint "manteniment_parada_sync_sync_id_key" UNIQUE (sync_id);
alter table app_private.manteniment_sync_config add constraint "manteniment_sync_config_pkey" PRIMARY KEY (id);
alter table app_private.manteniment_t_trabajos add constraint "manteniment_t_trabajos_clave_uq" UNIQUE (seguimiento_id, clave_trabajo);
alter table app_private.manteniment_t_trabajos add constraint "manteniment_t_trabajos_pkey" PRIMARY KEY (id);
alter table app_private.manteniment_t_trabajos add constraint "manteniment_t_trabajos_sync_id_key" UNIQUE (sync_id);
alter table app_private.manteniment_t_visitas add constraint "manteniment_t_visitas_clave_uq" UNIQUE (seguimiento_id, clave_visita);
alter table app_private.manteniment_t_visitas add constraint "manteniment_t_visitas_pkey" PRIMARY KEY (id);
create table public.catalogo_modalidades_operativas_hotel(codigo text,comportamiento text,activo boolean);
CREATE OR REPLACE FUNCTION app_private.manteniment_etapa_actual(p_seguimiento_id uuid, p_etapa_origen_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select actual.id
  from public.etapas_hotel origen
  join public.registros_hotel original on original.id = origen.registro_hotel_id
  cross join lateral (
    select r.id from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where r.seguimiento_id = p_seguimiento_id
    order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
    limit 1
  ) ficha
  join public.etapas_hotel actual
    on actual.registro_hotel_id = ficha.id
   and (actual.seguimiento_id = origen.seguimiento_id
     or (actual.grupo_documental_id = origen.grupo_documental_id
       and not exists (
         select 1 from public.etapas_hotel identidad
         where identidad.registro_hotel_id = ficha.id
           and identidad.seguimiento_id = origen.seguimiento_id
       )))
  where origen.id = p_etapa_origen_id
    and original.seguimiento_id = p_seguimiento_id
  order by actual.cancelado, actual.creado_en, actual.id
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_fecha_cierre_necesidad(p_tipo text, p_j date, p_k date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when upper(btrim(p_tipo)) in ('REPUESTOS','ACT','CV','LINDEP')
    then p_k else p_j end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_requiere_recogida_alpha75(p_designacion text, p_tipo text, p_taller text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when upper(btrim(coalesce(p_designacion,''))) in ('REPUESTOS','ACT','LINDEP','CV') then true
    else btrim(coalesce(p_taller,'')) <> ''
      and upper(btrim(p_taller)) <> 'TM'
      and upper(btrim(coalesce(p_designacion,''))) not in
        ('ITV','44TN','RT','TMG','LKT','SG','EXT','EXTINTOR','ATP','OTA')
      and translate(upper(coalesce(p_tipo,'')), 'ÁÉÍÓÚÜ', 'AEIOUU') not like '%TRAMITE%'
      and translate(upper(coalesce(p_tipo,'')), 'ÁÉÍÓÚÜ', 'AEIOUU') not like '%GESTION%'
  end;
$function$;

CREATE OR REPLACE FUNCTION app_private.modalidad_hotel_requiere_recuperacion(p_registro_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_codigo text;
  v_comportamiento text;
  v_fecha_parada date;
  v_seguimiento_id uuid;
  v_tipo_movimiento text;
  v_total integer := 0;
  v_pendientes integer := 0;
  v_ultima_fecha date;
  v_hoy date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
begin
  v_codigo := nullif(btrim(coalesce(current_setting('app.hotel_modalidad_operativa', true), '')), '');
  select coalesce(v_codigo, nullif(btrim(r.modalidad_operativa), '')),
         r.fecha_parada, r.seguimiento_id, upper(btrim(coalesce(r.tipo_movimiento, '')))
    into v_codigo, v_fecha_parada, v_seguimiento_id, v_tipo_movimiento
  from public.registros_hotel r
  where r.id = p_registro_id;

  if v_tipo_movimiento = '24H' then
    return true;
  end if;

  if exists (
       select 1 from app_private.manteniment_t_visitas v
       where v.seguimiento_id = v_seguimiento_id
     )
     and not exists (
       select 1 from app_private.manteniment_t_visitas v
       where v.seguimiento_id = v_seguimiento_id
         and v.modalidad not in ('tramite', 'gestion')
     ) then
    return false;
  end if;

  if v_codigo is null then return true; end if;
  select c.comportamiento into v_comportamiento
  from public.catalogo_modalidades_operativas_hotel c
  where c.codigo = v_codigo and c.activo = true;

  if v_comportamiento is null or v_comportamiento = 'manual' then return true; end if;
  if v_comportamiento in ('reparado_en_ruta', 'reserva_en_reparacion') then return false; end if;
  if v_comportamiento <> 'sin_sustitucion' then return true; end if;

  select count(*),
         count(*) filter (where e.estado not in ('realizada', 'anulada')),
         max(coalesce(e.fecha_real, e.fecha_fin_real, e.fecha_inicio_real, e.fecha_prevista)::date)
    into v_total, v_pendientes, v_ultima_fecha
  from public.etapas_hotel e
  where e.registro_hotel_id = p_registro_id
    and not e.cancelado
    and e.accion_sistema <> 'recuperar_y_liberar';

  if v_total = 0 then return false; end if;
  if v_fecha_parada is null then return true; end if;
  if v_pendientes > 0 then
    return greatest(coalesce(v_ultima_fecha, v_fecha_parada), v_hoy) > v_fecha_parada;
  end if;
  return coalesce(v_ultima_fecha, v_fecha_parada) > v_fecha_parada;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.manteniment_importar_trabajos_alpha74_base(p_trabajos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_group record;
  v_follow record;
  v_visit app_private.manteniment_t_visitas%rowtype;
  v_work app_private.manteniment_t_trabajos%rowtype;
  v_current_work app_private.manteniment_t_trabajos%rowtype;
  v_visit_stage record;
  v_stage_id uuid;
  v_job_id uuid;
  v_fecha_cierre_grupo date;
  v_entry_id uuid;
  v_pickup_id uuid;
  v_legacy_entry_count integer := 0;
  v_legacy_entry_group uuid;
  v_legacy_pickup_group uuid;
  v_pickup_date date;
  v_taller_id uuid;
  v_centro_id uuid;
  v_tipo_codigo text;
  v_modalidad text;
  v_clave_visita text;
  v_clave_trabajo text;
  v_pos integer;
  v_actor uuid;
  v_raw_count integer := 0;
  v_candidate_count integer := 0;
  v_created_stages integer := 0;
  v_created_works integer := 0;
  v_ambiguous integer := 0;
begin
  if p_trabajos is null then
    return jsonb_build_object('recibidos', 0, 'seleccionados', 0, 't_creadas', 0, 'trabajos_creados', 0, 'ambiguos', 0);
  end if;
  if jsonb_typeof(p_trabajos) <> 'array' or jsonb_array_length(p_trabajos) > 10000 then
    raise exception 'El bloque de necesidades de MANTENIMENT no tiene un formato válido';
  end if;

  create temp table if not exists tmp_alpha74_manteniment_raw (
    fila integer,
    trabajo_sync_id uuid,
    clave_fila text,
    dfm text,
    matricula text,
    numero_parada text,
    taller text,
    taller_norm text,
    tipo_trabajo text,
    tipo_norm text,
    designacion text,
    designacion_norm text,
    fecha_necesidad date,
    fecha_realizada date,
    fecha_recogida date,
    pendiente_fondo_blanco boolean,
    prioridad_fondo_amarillo boolean
  ) on commit drop;
  truncate tmp_alpha74_manteniment_raw;

  if exists (
    select 1
    from jsonb_array_elements(p_trabajos) item(value)
    where coalesce(item.value->>'fila', '') !~ '^[0-9]{1,6}$'
       or (coalesce(item.value->>'trabajo_sync_id', '') <> ''
           and item.value->>'trabajo_sync_id' !~* '^[0-9a-f-]{36}$')
       or coalesce(item.value->>'fecha_necesidad', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or (coalesce(item.value->>'fecha_realizada', '') <> ''
           and item.value->>'fecha_realizada' !~ '^\d{4}-\d{2}-\d{2}$')
       or (coalesce(item.value->>'fecha_recogida', '') <> ''
           and item.value->>'fecha_recogida' !~ '^\d{4}-\d{2}-\d{2}$')
       or coalesce(item.value->>'pendiente_fondo_blanco', 'false') not in ('true', 'false')
       or coalesce(item.value->>'prioridad_fondo_amarillo', 'false') not in ('true', 'false')
  ) then
    raise exception 'Una necesidad de MANTENIMENT contiene fila, identificador o fecha no válidos';
  end if;

  insert into tmp_alpha74_manteniment_raw(
    fila, trabajo_sync_id, clave_fila, dfm, matricula, numero_parada,
    taller, taller_norm, tipo_trabajo, tipo_norm, designacion,
    designacion_norm, fecha_necesidad, fecha_realizada, fecha_recogida,
    pendiente_fondo_blanco, prioridad_fondo_amarillo
  )
  select
    (item.value->>'fila')::integer,
    nullif(item.value->>'trabajo_sync_id', '')::uuid,
    left(coalesce(item.value->>'clave_fila', ''), 1000),
    regexp_replace(upper(btrim(coalesce(item.value->>'dfm', ''))), '[[:space:]]+', '', 'g'),
    upper(btrim(coalesce(item.value->>'matricula', ''))),
    regexp_replace(upper(btrim(coalesce(item.value->>'numero_parada', ''))), '^PA[- ]*', ''),
    left(btrim(coalesce(item.value->>'taller', '')), 160),
    regexp_replace(upper(btrim(coalesce(item.value->>'taller', ''))), '[[:space:]]+', ' ', 'g'),
    left(btrim(coalesce(item.value->>'tipo_trabajo', '')), 160),
    regexp_replace(upper(btrim(coalesce(item.value->>'tipo_trabajo', ''))), '[[:space:]]+', ' ', 'g'),
    left(btrim(coalesce(item.value->>'designacion', '')), 160),
    regexp_replace(upper(btrim(coalesce(item.value->>'designacion', ''))), '[[:space:]]+', ' ', 'g'),
    (item.value->>'fecha_necesidad')::date,
    nullif(item.value->>'fecha_realizada', '')::date,
    nullif(item.value->>'fecha_recogida', '')::date,
    coalesce((item.value->>'pendiente_fondo_blanco')::boolean, false),
    coalesce((item.value->>'prioridad_fondo_amarillo')::boolean, false)
  from jsonb_array_elements(p_trabajos) item(value);

  select count(*) into v_raw_count from tmp_alpha74_manteniment_raw;

  -- Una nota técnica nunca puede trasladar una T a otro vehículo. Ante cualquier
  -- discrepancia se aborta el lote completo sin crear ni modificar etapas.
  if exists (
    select 1
    from tmp_alpha74_manteniment_raw x
    join app_private.manteniment_t_trabajos w on w.sync_id = x.trabajo_sync_id
    join lateral (
      select regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g') as dfm
      from public.registros_hotel r
      join public.pizarras p on p.id = r.pizarra_id
      where r.seguimiento_id = w.seguimiento_id
      order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
      limit 1
    ) ficha on true
    where x.dfm is distinct from ficha.dfm
  ) then
    raise exception 'Una necesidad vinculada no coincide con el vehículo de su seguimiento';
  end if;

  for v_follow in
    select distinct r.seguimiento_id
    from public.registros_hotel r
    join tmp_alpha74_manteniment_raw x on x.dfm =
      regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g')
    order by r.seguimiento_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('manteniment-visita:' || v_follow.seguimiento_id::text, 0));
  end loop;

  create temp table tmp_alpha74_manteniment_candidates on commit drop as
  with ranked_active as (
    select
      r.id as registro_id,
      r.seguimiento_id,
      regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g') as dfm,
      regexp_replace(upper(btrim(r.numero_parada)), '^PA[- ]*', '') as numero_parada,
      min((r.creado_en at time zone 'Europe/Madrid')::date)
        over (partition by r.seguimiento_id) as fecha_generacion,
      coalesce(r.modificado_por, r.creado_por) as actor_id,
      row_number() over (
        partition by r.seguimiento_id
        order by (p.estado = 'en_curso') desc, p.fecha desc, r.actualizado_en desc, r.id desc
      ) as rn
    from public.registros_hotel r
    join public.pizarras p on p.id = r.pizarra_id
    where not r.cancelado
      and not r.retirado_hotel_activo
      and r.estado not in ('recuperado', 'reserva_liberada', 'anulado')
      and btrim(coalesce(r.numero_parada, '')) <> ''
  ),
  active as (
    select * from ranked_active where rn = 1
  ),
  matched as (
    select
      x.*,
      a.registro_id,
      a.seguimiento_id,
      a.numero_parada as numero_parada_activa,
      a.fecha_generacion,
      a.actor_id,
      coalesce(sync_work.id, key_work.id) as existing_work_id,
      count(*) over (partition by x.fila, x.clave_fila) as match_count
    from tmp_alpha74_manteniment_raw x
    join active a on a.dfm = x.dfm
      and (x.numero_parada = '' or x.numero_parada = a.numero_parada)
    left join app_private.manteniment_t_trabajos sync_work
      on sync_work.sync_id = x.trabajo_sync_id
     and sync_work.seguimiento_id = a.seguimiento_id
    left join app_private.manteniment_t_trabajos key_work
      on key_work.seguimiento_id = a.seguimiento_id
     and key_work.clave_trabajo = 'F:' || x.taller_norm || '|H:' || x.designacion_norm
    where x.dfm <> ''
      and x.designacion_norm <> ''
      and x.designacion_norm not in ('ALTA', 'BAJA', 'PARADA', 'ANULADA', 'FIN', 'ARCHIVO', 'CARPETA', 'PRIMITIVA')
      -- Las notas copiadas y las T anuladas son histórico, no permiso de reapertura.
      and (x.trabajo_sync_id is null
        or (sync_work.id is not null
          and translate(upper(btrim(sync_work.designacion)), 'ÁÉÍÓÚÜ', 'AEIOUU')
            = translate(x.designacion_norm, 'ÁÉÍÓÚÜ', 'AEIOUU')))
      and (coalesce(sync_work.id,key_work.id) is null or exists (
        select 1 from app_private.manteniment_t_trabajos existing
        join public.trabajos_etapa_hotel job on job.id=existing.trabajo_hotel_id
        join public.etapas_hotel stage on stage.id=app_private.manteniment_etapa_actual(
          existing.seguimiento_id,job.etapa_hotel_id)
        where existing.id=coalesce(sync_work.id,key_work.id)
          and not job.cancelado and not stage.cancelado and stage.estado<>'anulada'
      ))
      and (
        sync_work.id is not null
        or key_work.id is not null
        or x.prioridad_fondo_amarillo
        or x.fecha_necesidad <= (
          (clock_timestamp() at time zone 'Europe/Madrid')::date + interval '1 month'
        )::date
      )
      and (
        x.pendiente_fondo_blanco
        or sync_work.id is not null or key_work.id is not null
        or (x.numero_parada <> '' and x.fecha_recogida is null
            and (x.fecha_realizada is null or app_private.manteniment_requiere_recogida_alpha75(
              x.designacion_norm, x.tipo_norm, x.taller_norm)))
      )
      -- Las realizadas solo vuelven a entrar una vez si su fecha de realización
      -- o recogida todavía no ha llegado a la vinculación. Después se ignoran.
      and (
        x.fecha_realizada is null
        or (x.fecha_recogida is null and (
          x.designacion_norm in ('REPUESTOS', 'ACT', 'LINDEP', 'CV')
          or ((x.numero_parada <> '' or sync_work.id is not null or key_work.id is not null)
              and app_private.manteniment_requiere_recogida_alpha75(
                x.designacion_norm, x.tipo_norm, x.taller_norm))
        ))
        or (
          sync_work.id is not null
          and (
            sync_work.fecha_realizada is distinct from x.fecha_realizada
            or sync_work.fecha_recogida is distinct from x.fecha_recogida
          )
        )
        or (
          sync_work.id is null
          and key_work.id is not null
          and (
            key_work.fecha_realizada is distinct from x.fecha_realizada
            or key_work.fecha_recogida is distinct from x.fecha_recogida
          )
        )
      )
  )
  select * from matched where match_count = 1;

  with ranked_active as (
    select r.seguimiento_id,
      regexp_replace(upper(btrim(r.vehiculo_sustituido)), '[[:space:]]+', '', 'g') as dfm,
      regexp_replace(upper(btrim(r.numero_parada)), '^PA[- ]*', '') as numero_parada,
      row_number() over (partition by r.seguimiento_id order by (p.estado='en_curso') desc,p.fecha desc,r.actualizado_en desc,r.id desc) rn
    from public.registros_hotel r join public.pizarras p on p.id=r.pizarra_id
    where not r.cancelado and not r.retirado_hotel_activo
      and r.estado not in ('recuperado','reserva_liberada','anulado')
      and btrim(coalesce(r.numero_parada,''))<>''
  ), matches as (
    select x.fila,x.clave_fila,count(*) as n
    from tmp_alpha74_manteniment_raw x
    join ranked_active a on a.rn=1 and a.dfm=x.dfm
      and (x.numero_parada='' or x.numero_parada=a.numero_parada)
    left join app_private.manteniment_t_trabajos sync_work
      on sync_work.sync_id=x.trabajo_sync_id
     and sync_work.seguimiento_id=a.seguimiento_id
    left join app_private.manteniment_t_trabajos key_work
      on key_work.seguimiento_id=a.seguimiento_id
     and key_work.clave_trabajo='F:' || x.taller_norm || '|H:' || x.designacion_norm
    where x.pendiente_fondo_blanco
    group by x.fila,x.clave_fila
  )
  select count(*) into v_ambiguous from matches where n>1;

  select count(*) into v_candidate_count from tmp_alpha74_manteniment_candidates;
  create temp table if not exists tmp_alpha75_visitas_del_lote (
    id uuid primary key
  ) on commit drop;
  truncate tmp_alpha75_visitas_del_lote;

  -- Primero se fijan los grupos lógicos. F manda sobre G: si hay taller en F,
  -- el par F + H identifica un trabajo dentro de una única visita de taller.
  for v_group in
    select
      c.seguimiento_id,
      c.registro_id,
      c.numero_parada_activa,
      c.existing_work_id,
      'F:' || c.taller_norm || '|H:' || c.designacion_norm as clave_trabajo,
      min(c.taller) filter (where c.taller <> '') as taller,
      min(c.taller_norm) as taller_norm,
      min(c.tipo_trabajo) filter (where c.tipo_trabajo <> '') as tipo_trabajo,
      min(c.tipo_norm) filter (where c.tipo_norm <> '') as tipo_norm,
      min(c.designacion) as designacion,
      min(c.designacion_norm) as designacion_norm,
      min(c.fecha_necesidad) as fecha_necesidad,
      max(c.fecha_realizada) as fecha_realizada,
      max(c.fecha_recogida) as fecha_recogida,
      jsonb_agg(
        jsonb_build_object(
          'fila', c.fila,
          'clave_fila', c.clave_fila
        ) order by c.fila
      ) as fuentes
    from tmp_alpha74_manteniment_candidates c
    group by c.seguimiento_id, c.registro_id, c.numero_parada_activa,
      c.existing_work_id, c.taller_norm, c.designacion_norm
    order by min(c.fecha_necesidad), min(c.fila)
  loop
    v_clave_trabajo := v_group.clave_trabajo;
    v_modalidad := case
      when v_group.designacion_norm = 'REPUESTOS' then 'gestion'
      when v_group.designacion_norm = 'LKT' and translate(coalesce(v_group.tipo_norm, ''), 'Ó', 'O') like '%GESTION%' then 'gestion'
      when v_group.designacion_norm in ('LKT', 'EXTINTOR', 'LINDEP') then 'tramite'
      when translate(coalesce(v_group.tipo_norm, ''), 'Á', 'A') like '%TRAMITE%' then 'tramite'
      when translate(coalesce(v_group.tipo_norm, ''), 'Ó', 'O') like '%GESTION%' then 'gestion'
      when v_group.taller_norm = 'TM' then 'entrada_sin_recogida'
      when coalesce(v_group.taller_norm, '') <> '' then 'taller'
      else 'pendiente_taller'
    end;
    v_clave_visita := case
      when coalesce(v_group.taller_norm, '') <> '' then 'LUGAR|F:' || v_group.taller_norm
      else 'PENDIENTE|' || v_clave_trabajo
    end;

    -- Una nota METROGESTION_T identifica de forma inmutable la visita histórica.
    -- Si después se simplifica F (p. ej. AUTODIS PDF6 -> AUTODIS), no se mueve
    -- el trabajo a otra entrada ni se mezclan visitas ya realizadas.
    v_current_work := null;
    v_visit := null;
    if v_group.existing_work_id is not null then
      select * into v_current_work
      from app_private.manteniment_t_trabajos
      where id = v_group.existing_work_id
        and seguimiento_id = v_group.seguimiento_id
      for update;
    end if;

    if v_current_work.id is not null then
      select * into v_visit
      from app_private.manteniment_t_visitas
      where id = v_current_work.visita_id
        and seguimiento_id = v_group.seguimiento_id
      for update;
      if not found then
        raise exception 'Una necesidad vinculada no conserva una visita válida';
      end if;
    else
      select * into v_visit
      from app_private.manteniment_t_visitas
      where seguimiento_id = v_group.seguimiento_id
        and (clave_visita = v_clave_visita
          or (coalesce(v_group.taller_norm, '') <> '' and
            regexp_replace(upper(btrim(taller)), '[[:space:]]+', ' ', 'g') = v_group.taller_norm))
      order by (clave_visita = v_clave_visita) desc, creado_en, id
      limit 1 for update;
    end if;

    if v_current_work.id is not null and coalesce(v_group.taller_norm, '') = '' then
      v_modalidad := v_visit.modalidad;
    elsif v_visit.modalidad in ('taller', 'entrada_sin_recogida') then
      v_modalidad := v_visit.modalidad;
    end if;
    if coalesce(v_group.taller_norm, '') <> '' and exists (
      select 1 from tmp_alpha74_manteniment_candidates c
      where c.seguimiento_id = v_group.seguimiento_id and c.taller_norm = v_group.taller_norm
        and c.designacion_norm not in ('REPUESTOS', 'LKT', 'EXTINTOR', 'LINDEP')
        and translate(c.tipo_norm, 'ÁÉÍÓÚ', 'AEIOU') not like '%TRAMITE%'
        and translate(c.tipo_norm, 'ÁÉÍÓÚ', 'AEIOU') not like '%GESTION%'
    ) then
      v_modalidad := case when v_group.taller_norm = 'TM' then 'entrada_sin_recogida' else 'taller' end;
    end if;

    -- Cuando un trabajo se agrupó manualmente en otra entrada, su enlace
    -- real manda sobre los grupos antiguos de la visita, incluso si ya se realizó.
    if v_current_work.trabajo_hotel_id is not null
       and v_visit.id is not null
       then
      select e.id, e.grupo_documental_id
        into v_entry_id, v_legacy_entry_group
      from public.trabajos_etapa_hotel t
      join public.etapas_hotel e on e.id = app_private.manteniment_etapa_actual(
        v_group.seguimiento_id, t.etapa_hotel_id)
      where t.id = v_current_work.trabajo_hotel_id;
      if v_entry_id is not null then
        v_legacy_pickup_group := null;
        select e.grupo_documental_id into v_legacy_pickup_group
        from public.etapas_hotel e
        where e.registro_hotel_id = v_group.registro_id
          and e.tipo_etapa = 'recogida_taller'
          and e.etapa_origen_id = v_entry_id
        order by e.cancelado, e.posicion, e.creado_en, e.id
        limit 1;
        update app_private.manteniment_t_visitas
        set grupo_entrada_id = v_legacy_entry_group,
            grupo_recogida_id = case when v_modalidad = 'taller'
              then coalesce(v_legacy_pickup_group, grupo_recogida_id) else null end
        where id = v_visit.id
        returning * into v_visit;
      end if;
    end if;

    if v_visit.id is null then
      v_entry_id := null;
      v_pickup_id := null;
      v_legacy_entry_group := null;
      v_legacy_pickup_group := null;

      -- Las fichas creadas antes de Alpha74 ya pueden tener la entrada y la
      -- recogida. Se reutiliza la entrada sin realizar o la entrada cuya fecha
      -- real coincide con J; el taller debe coincidir exactamente con F.
      -- AUTODIS no coincide con
      -- AUTODIS PDF1/PDF3: son visitas distintas.
      if coalesce(v_group.taller_norm, '') <> '' then
        select count(*) into v_legacy_entry_count
        from public.etapas_hotel e
        where e.registro_hotel_id = v_group.registro_id
          and not e.cancelado
          and e.tipo_etapa in ('entrada_taller', 'otro')
            and coalesce(e.accion_sistema, '') = ''
          and e.estado <> 'anulada'
          and (
            (e.estado <> 'realizada' and e.fecha_real is null and e.fecha_fin_real is null)
            or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'
                and v_group.fecha_realizada is not null
                and (coalesce(e.fecha_real, e.fecha_inicio_real, e.fecha_fin_real)
                  at time zone 'Europe/Madrid')::date = v_group.fecha_realizada)
          )
          and (
            regexp_replace(upper(btrim(coalesce(e.lugar, ''))), '[[:space:]]+', ' ', 'g')
              = v_group.taller_norm
            or regexp_replace(
                 regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[[:space:]]+', ' ', 'g'),
                 '^ENTRADA( EN)?( TALLER)?[[:space:]·:.-]*', '', 'g'
               ) = v_group.taller_norm
          );

        if v_legacy_entry_count > 1 then
          raise exception 'La ficha contiene varias entradas compatibles con el taller %; no se ha modificado ninguna T',
            v_group.taller;
        end if;

        if v_legacy_entry_count = 1 then
          select e.id, e.grupo_documental_id
          into v_entry_id, v_legacy_entry_group
          from public.etapas_hotel e
          where e.registro_hotel_id = v_group.registro_id
            and not e.cancelado
            and e.tipo_etapa in ('entrada_taller', 'otro')
            and coalesce(e.accion_sistema, '') = ''
            and e.estado <> 'anulada'
            and (
              (e.estado <> 'realizada' and e.fecha_real is null and e.fecha_fin_real is null)
              or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'
                  and v_group.fecha_realizada is not null
                  and (coalesce(e.fecha_real, e.fecha_inicio_real, e.fecha_fin_real)
                    at time zone 'Europe/Madrid')::date = v_group.fecha_realizada)
            )
            and (
              regexp_replace(upper(btrim(coalesce(e.lugar, ''))), '[[:space:]]+', ' ', 'g')
                = v_group.taller_norm
              or regexp_replace(
                   regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[[:space:]]+', ' ', 'g'),
                   '^ENTRADA( EN)?( TALLER)?[[:space:]·:.-]*', '', 'g'
                 ) = v_group.taller_norm
            )
          limit 1;

          select e.id, e.grupo_documental_id
          into v_pickup_id, v_legacy_pickup_group
          from public.etapas_hotel e
          where e.registro_hotel_id = v_group.registro_id
            and not e.cancelado
            and e.tipo_etapa = 'recogida_taller'
            and e.etapa_origen_id = v_entry_id
          order by e.posicion, e.creado_en
          limit 1;
        end if;
      end if;

      -- Una entrada ya informada no autoriza a inventar una segunda visita.
      if v_modalidad = 'taller' and v_group.fecha_realizada is not null
         and v_entry_id is null then
        raise exception 'La necesidad de % tiene entrada en J, pero no existe una única T compatible en la actuación; revise el enlace antes de continuar',
          v_group.taller;
      end if;

      insert into app_private.manteniment_t_visitas(
        seguimiento_id, clave_visita, modalidad, taller, fecha_necesidad,
        grupo_entrada_id, grupo_recogida_id
      ) values (
        v_group.seguimiento_id, v_clave_visita, v_modalidad,
        coalesce(v_group.taller, ''), v_group.fecha_necesidad,
        case when v_modalidad in ('taller', 'entrada_sin_recogida', 'tramite', 'gestion')
          then coalesce(v_legacy_entry_group, gen_random_uuid()) end,
        case when v_modalidad = 'taller'
          then coalesce(v_legacy_pickup_group, gen_random_uuid()) end
      ) returning * into v_visit;
    else
      -- Un LKT/LINDEP ya incorporado a una visita conserva sus trabajos y
      -- documentos. La regla clasifica las nuevas necesidades, no traslada
      -- las visitas históricas ni elimina su entrada/recogida compartida.
      if v_current_work.id is not null
         and v_group.designacion_norm in ('LKT', 'LINDEP')
         and v_visit.modalidad in ('taller', 'entrada_sin_recogida') then
        v_modalidad := v_visit.modalidad;
      end if;
      -- Una necesidad puede nacer sin F y recibir el taller después. En ese
      -- cambio se adoptan los grupos de la Entrada/Recogida ya existentes; si
      -- no existen, se crean identificadores una sola vez y quedan estables.
      v_entry_id := null;
      v_legacy_entry_group := null;
      v_legacy_pickup_group := null;
      if v_visit.grupo_entrada_id is null
         and v_modalidad in ('taller', 'entrada_sin_recogida') then
        select e.id, e.grupo_documental_id
          into v_entry_id, v_legacy_entry_group
        from public.etapas_hotel e
        where e.registro_hotel_id = v_group.registro_id
          and not e.cancelado
          and e.tipo_etapa = 'entrada_taller'
          and e.estado <> 'anulada'
          and (
            (e.estado <> 'realizada' and e.fecha_real is null and e.fecha_fin_real is null)
            or (v_modalidad = 'taller' and e.tipo_etapa = 'entrada_taller'
                and v_group.fecha_realizada is not null
                and (coalesce(e.fecha_real, e.fecha_inicio_real, e.fecha_fin_real)
                  at time zone 'Europe/Madrid')::date = v_group.fecha_realizada)
          )
          and (
            regexp_replace(upper(btrim(coalesce(e.lugar, ''))), '[[:space:]]+', ' ', 'g')
              = v_group.taller_norm
            or regexp_replace(
                 regexp_replace(upper(btrim(coalesce(e.nombre, ''))), '[[:space:]]+', ' ', 'g'),
                 '^ENTRADA( EN)?( TALLER)?[[:space:]·:.-]*', '', 'g'
               ) = v_group.taller_norm
          )
        order by e.posicion, e.creado_en, e.id
        limit 1;

        if v_entry_id is not null then
          select e.grupo_documental_id
            into v_legacy_pickup_group
          from public.etapas_hotel e
          where e.registro_hotel_id = v_group.registro_id
            and not e.cancelado
            and e.tipo_etapa = 'recogida_taller'
            and e.etapa_origen_id = v_entry_id
          order by e.posicion, e.creado_en, e.id
          limit 1;
        end if;
      end if;

      update app_private.manteniment_t_visitas
      set modalidad = v_modalidad,
          taller = coalesce(v_group.taller, taller),
          fecha_necesidad = least(fecha_necesidad, v_group.fecha_necesidad),
          grupo_entrada_id = case
            when v_modalidad in ('taller', 'entrada_sin_recogida', 'tramite', 'gestion')
              then coalesce(grupo_entrada_id, v_legacy_entry_group, gen_random_uuid())
            else null
          end,
          grupo_recogida_id = case
            when v_modalidad = 'taller'
              then coalesce(grupo_recogida_id, v_legacy_pickup_group, gen_random_uuid())
            else null
          end,
          actualizado_en = clock_timestamp()
      where id = v_visit.id
      returning * into v_visit;
    end if;

    -- En trámites/gestiones del mismo lugar, conservar la T donde ya se
    -- agruparon sus trabajos. El grupo sirve también para nuevas H de la visita.
    if v_modalidad in ('tramite', 'gestion') and coalesce(v_group.taller_norm, '') <> '' then
      v_legacy_entry_group := null;
      if v_current_work.trabajo_hotel_id is not null then
        select e.grupo_documental_id into v_legacy_entry_group
        from public.trabajos_etapa_hotel t
        join public.etapas_hotel e on e.id = app_private.manteniment_etapa_actual(
          v_group.seguimiento_id, t.etapa_hotel_id)
        where t.id = v_current_work.trabajo_hotel_id;
      end if;
      update app_private.manteniment_t_visitas
      set grupo_entrada_id = coalesce(v_legacy_entry_group, grupo_entrada_id, gen_random_uuid())
      where id = v_visit.id returning * into v_visit;
    end if;

    if v_current_work.id is null then
      select * into v_current_work
      from app_private.manteniment_t_trabajos
      where seguimiento_id = v_group.seguimiento_id and clave_trabajo = v_clave_trabajo
      for update;
    end if;

    if v_current_work.id is null then
      insert into app_private.manteniment_t_trabajos(
        seguimiento_id, visita_id, clave_trabajo, taller, tipo_trabajo,
        designacion, fecha_necesidad, fecha_realizada, fecha_recogida, fuentes
      ) values (
        v_group.seguimiento_id, v_visit.id, v_clave_trabajo,
        coalesce(v_group.taller, ''), coalesce(v_group.tipo_trabajo, ''),
        v_group.designacion, v_group.fecha_necesidad, v_group.fecha_realizada,
        v_group.fecha_recogida, v_group.fuentes
      ) returning * into v_current_work;
    else
      -- La identidad y la visita del trabajo se conservan. MANTENIMENT sigue
      -- gobernando sus fechas y las filas de origen sin reescribir el histórico.
      update app_private.manteniment_t_trabajos
      set taller = coalesce(v_group.taller, taller),
          clave_trabajo = case when coalesce(v_group.taller_norm, '') = '' then clave_trabajo
            when not exists (select 1 from app_private.manteniment_t_trabajos otro
              where otro.seguimiento_id = v_group.seguimiento_id and otro.clave_trabajo = v_clave_trabajo
                and otro.id <> v_current_work.id) then v_clave_trabajo else clave_trabajo end,
          fecha_necesidad = least(fecha_necesidad, v_group.fecha_necesidad),
          fecha_realizada = v_group.fecha_realizada,
          fecha_recogida = v_group.fecha_recogida,
          fuentes = v_group.fuentes,
          actualizado_en = clock_timestamp()
      where id = v_current_work.id;
    end if;
    if v_visit.grupo_entrada_id is not null then
      update app_private.manteniment_t_trabajos
      set grupo_etapa_id = v_visit.grupo_entrada_id
      where id = v_current_work.id and grupo_etapa_id is distinct from v_visit.grupo_entrada_id;
    end if;
    insert into tmp_alpha75_visitas_del_lote(id) values (v_visit.id)
    on conflict do nothing;
  end loop;

  -- Se materializan únicamente las T que todavía no existen. Una reprogramación
  -- manual conserva posicion y fecha_prevista porque esta función no las actualiza.
  for v_follow in
    select distinct c.seguimiento_id, c.registro_id, c.actor_id
    from tmp_alpha74_manteniment_candidates c
  loop
    v_actor := v_follow.actor_id;
    perform set_config('app.reconciliando_etapas', '1', true);
    perform set_config('app.audit_origin', 'manteniment-alpha74-predictivo', true);
    set constraints etapas_hotel_posicion_activa_uq deferred;

    update public.etapas_hotel
    set posicion = posicion + 10000,
        modificado_por = coalesce(v_actor, modificado_por)
    where registro_hotel_id = v_follow.registro_id
      and not cancelado
      and accion_sistema = 'recuperar_y_liberar';

    select coalesce(max(e.posicion), 0) into v_pos
    from public.etapas_hotel e
    where e.registro_hotel_id = v_follow.registro_id
      and not e.cancelado
      and e.accion_sistema is distinct from 'recuperar_y_liberar';

    for v_visit_stage in
      select v.*
      from app_private.manteniment_t_visitas v
      where v.seguimiento_id = v_follow.seguimiento_id
        and exists (select 1 from tmp_alpha75_visitas_del_lote lote where lote.id = v.id)
      order by v.fecha_necesidad, v.creado_en, v.id
    loop
      v_entry_id := null;
      v_pickup_id := null;
      v_taller_id := null;
      v_centro_id := null;

      update public.etapas_hotel
      set lugar = v_visit_stage.taller,
          nombre = case
            when nombre like 'Entrada %' and tipo_etapa='entrada_taller' then 'Entrada ' || v_visit_stage.taller
            when nombre like 'Recogida %' and tipo_etapa='recogida_taller' then 'Recogida ' || v_visit_stage.taller
            else nombre end
      where registro_hotel_id=v_follow.registro_id
        and grupo_documental_id in (v_visit_stage.grupo_entrada_id,v_visit_stage.grupo_recogida_id)
        and not cancelado and estado <> 'realizada'
        and fecha_real is null and fecha_inicio_real is null and fecha_fin_real is null
        and btrim(v_visit_stage.taller) <> '' and lugar is distinct from v_visit_stage.taller
        and (observaciones like 'Generada desde las necesidades pendientes de MANTENIMENT.%'
          or observaciones like 'Necesidad detectada en MANTENIMENT%');

      if v_visit_stage.modalidad in ('taller', 'entrada_sin_recogida') then
        update public.etapas_hotel
        set tipo_etapa = 'entrada_taller'
        where registro_hotel_id = v_follow.registro_id
          and grupo_documental_id = v_visit_stage.grupo_entrada_id
          and tipo_etapa = 'otro' and not cancelado
          and estado <> 'realizada' and fecha_real is null and fecha_fin_real is null;
      end if;

      if v_visit_stage.modalidad in ('taller', 'entrada_sin_recogida') then
        select t.id into v_taller_id
        from public.talleres t
        where t.activo
          and (
            regexp_replace(upper(btrim(t.nombre)), '[[:space:]]+', ' ', 'g') = regexp_replace(upper(btrim(v_visit_stage.taller)), '[[:space:]]+', ' ', 'g')
            or regexp_replace(upper(btrim(v_visit_stage.taller)), '[[:space:]]+', ' ', 'g') like regexp_replace(upper(btrim(t.nombre)), '[[:space:]]+', ' ', 'g') || ' %'
          )
        order by char_length(t.nombre) desc, t.creado_en
        limit 1;

        if v_taller_id is not null then
          select c.id into v_centro_id
          from public.centros_taller c
          where c.activo and c.taller_id = v_taller_id
            and regexp_replace(upper(btrim(v_visit_stage.taller)), '[[:space:]]+', ' ', 'g')
                like '%' || regexp_replace(upper(btrim(c.nombre)), '[[:space:]]+', ' ', 'g') || '%'
          order by char_length(c.nombre) desc, c.creado_en
          limit 1;
        end if;

        select e.id into v_entry_id
        from public.etapas_hotel e
        where e.registro_hotel_id = v_follow.registro_id
          and e.grupo_documental_id = v_visit_stage.grupo_entrada_id
        order by e.cancelado, e.creado_en
        limit 1;
        if v_entry_id is null then
          v_pos := v_pos + 1;
          insert into public.etapas_hotel(
            registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
            posicion, estado, estado_catalogo_codigo, tipo_etapa, taller_id,
            centro_taller_id, lugar, fecha_prevista, observaciones, cancelado,
            creado_por, modificado_por
          ) values (
            v_follow.registro_id, gen_random_uuid(), v_visit_stage.grupo_entrada_id,
            'Entrada ' || v_visit_stage.taller, v_pos, 'pendiente', 'pendiente',
            'entrada_taller', v_taller_id, v_centro_id, v_visit_stage.taller,
            null, 'Generada desde las necesidades pendientes de MANTENIMENT.',
            false, v_actor, v_actor
          ) returning id into v_entry_id;
          v_created_stages := v_created_stages + 1;
        end if;
      end if;

      for v_work in
        select * from app_private.manteniment_t_trabajos w
        where w.visita_id = v_visit_stage.id
        order by w.fecha_necesidad, w.creado_en, w.id
      loop
        -- En una visita de taller, F identifica una única T operativa de entrada.
        -- Cada H diferente es un trabajo dentro de esa misma T, nunca otra T.
        if v_visit_stage.modalidad in ('taller', 'entrada_sin_recogida') then
          v_stage_id := v_entry_id;
        else
          -- Solo se cierra una T compartida cuando todas sus necesidades
          -- tienen una fecha de cierre. La fecha conjunta es la última.
          select case when bool_and(app_private.manteniment_fecha_cierre_necesidad(
              w.designacion, w.fecha_realizada, w.fecha_recogida) is not null)
            then max(app_private.manteniment_fecha_cierre_necesidad(
              w.designacion, w.fecha_realizada, w.fecha_recogida)) end
            into v_fecha_cierre_grupo
          from app_private.manteniment_t_trabajos w
          where w.seguimiento_id = v_work.seguimiento_id
            and w.grupo_etapa_id = v_work.grupo_etapa_id;
          select e.id into v_stage_id
          from public.etapas_hotel e
          where e.registro_hotel_id = v_follow.registro_id
            and e.grupo_documental_id = v_work.grupo_etapa_id
          order by e.cancelado, e.creado_en
          limit 1;

          if v_stage_id is null then
            v_pos := v_pos + 1;
            insert into public.etapas_hotel(
              registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
              posicion, estado, estado_catalogo_codigo, tipo_etapa, lugar,
              fecha_prevista, fecha_fin_real, fecha_real, observaciones,
              cancelado, creado_por, modificado_por
            ) values (
              v_follow.registro_id, gen_random_uuid(), v_work.grupo_etapa_id,
              case v_visit_stage.modalidad
                when 'gestion' then 'Gestión · ' || (select string_agg(distinct w.designacion, ' + ' order by w.designacion) from app_private.manteniment_t_trabajos w where w.seguimiento_id=v_work.seguimiento_id and w.grupo_etapa_id=v_work.grupo_etapa_id)
                when 'tramite' then 'Trámite · ' || (select string_agg(distinct w.designacion, ' + ' order by w.designacion) from app_private.manteniment_t_trabajos w where w.seguimiento_id=v_work.seguimiento_id and w.grupo_etapa_id=v_work.grupo_etapa_id)
                else 'Pendiente de taller · ' || v_work.designacion
              end,
              v_pos,
              case when v_fecha_cierre_grupo is null then 'pendiente' else 'realizada' end,
              case when v_fecha_cierre_grupo is null then 'pendiente' else 'realizada' end,
              'otro', v_work.taller, null,
              case when v_fecha_cierre_grupo is null then null else v_fecha_cierre_grupo::timestamp at time zone 'Europe/Madrid' end,
              case when v_fecha_cierre_grupo is null then null else v_fecha_cierre_grupo::timestamp at time zone 'Europe/Madrid' end,
              'Necesidad detectada en MANTENIMENT el ' || to_char(v_work.fecha_necesidad, 'DD/MM/YYYY') || '.',
              false, v_actor, v_actor
            ) returning id into v_stage_id;
            v_created_stages := v_created_stages + 1;
          end if;
        end if;

        v_job_id := null;
        if v_work.trabajo_hotel_id is not null then
          select t.id into v_job_id
          from public.trabajos_etapa_hotel t
          where t.id = v_work.trabajo_hotel_id
          limit 1;
        end if;

        if v_job_id is null then
          select c.codigo into v_tipo_codigo
          from public.catalogo_tipos_trabajo c
          where (
            upper(btrim(c.codigo)) = upper(btrim(v_work.designacion))
            or upper(btrim(c.nombre)) = upper(btrim(v_work.designacion))
          )
          order by (upper(btrim(c.codigo)) = upper(btrim(v_work.designacion))) desc
          limit 1;
          if v_tipo_codigo is null then
            v_tipo_codigo := 'MNT_' || upper(substr(md5(upper(btrim(v_work.designacion))), 1, 12));
            insert into public.catalogo_tipos_trabajo(
              codigo, nombre, requiere_expediente, requiere_diagnostico, activo
            ) values (v_tipo_codigo, v_work.designacion, false, false, true)
            on conflict (codigo) do nothing;
          end if;

          insert into public.trabajos_etapa_hotel(
            etapa_hotel_id, tipo_trabajo, categoria_tecnica, motivo_entrada,
            descripcion, observaciones, cancelado, creado_por, modificado_por
          ) values (
            v_stage_id, v_tipo_codigo, v_work.designacion, v_work.tipo_trabajo,
            concat_ws(' · ', nullif(v_work.tipo_trabajo, ''), nullif(v_work.designacion, '')),
            'Generado automáticamente desde MANTENIMENT.', false, v_actor, v_actor
          ) returning id into v_job_id;
          update app_private.manteniment_t_trabajos
          set trabajo_hotel_id = v_job_id,
              actualizado_en = clock_timestamp()
          where id = v_work.id;
          v_created_works := v_created_works + 1;
        end if;

        -- Una gestión o un trámite sí son una T propia y su fecha puede cerrarla.
        -- Completar un trabajo de taller no completa toda la visita de taller.
        if v_visit_stage.modalidad not in ('taller', 'entrada_sin_recogida')
           and v_fecha_cierre_grupo is not null then
          update public.etapas_hotel
          set estado = 'realizada',
              estado_catalogo_codigo = 'realizada',
              fecha_fin_real = coalesce(fecha_fin_real, v_fecha_cierre_grupo::timestamp at time zone 'Europe/Madrid'),
              fecha_real = coalesce(fecha_real, v_fecha_cierre_grupo::timestamp at time zone 'Europe/Madrid'),
              modificado_por = coalesce(v_actor, modificado_por)
          where id = v_stage_id and not cancelado and estado <> 'realizada';
        end if;
      end loop;

      if v_visit_stage.modalidad = 'taller' then
        select e.id into v_pickup_id
        from public.etapas_hotel e
        where e.registro_hotel_id = v_follow.registro_id
          and e.grupo_documental_id = v_visit_stage.grupo_recogida_id
        order by e.cancelado, e.creado_en
        limit 1;
        if v_pickup_id is null then
          v_pos := v_pos + 1;
          insert into public.etapas_hotel(
            registro_hotel_id, seguimiento_id, grupo_documental_id, nombre,
            posicion, estado, estado_catalogo_codigo, tipo_etapa, taller_id,
            centro_taller_id, lugar, fecha_prevista, observaciones, cancelado,
            creado_por, modificado_por, etapa_origen_id
          ) values (
            v_follow.registro_id, gen_random_uuid(), v_visit_stage.grupo_recogida_id,
            'Recogida ' || v_visit_stage.taller, v_pos, 'pendiente', 'pendiente',
            'recogida_taller', v_taller_id, v_centro_id, v_visit_stage.taller,
            null, 'Generada desde las necesidades pendientes de MANTENIMENT.',
            false, v_actor, v_actor, v_entry_id
          ) returning id into v_pickup_id;
          v_created_stages := v_created_stages + 1;
        end if;

        select max(w.fecha_recogida) into v_pickup_date
        from app_private.manteniment_t_trabajos w
        where w.visita_id = v_visit_stage.id;
        if v_pickup_date is not null then
          update public.etapas_hotel
          set estado = 'realizada', estado_catalogo_codigo = 'realizada',
              fecha_fin_real = coalesce(fecha_fin_real, v_pickup_date::timestamp at time zone 'Europe/Madrid'),
              fecha_real = coalesce(fecha_real, v_pickup_date::timestamp at time zone 'Europe/Madrid'),
              modificado_por = coalesce(v_actor, modificado_por)
          where id = v_pickup_id and not cancelado and estado <> 'realizada';
        end if;
      end if;
    end loop;

    if app_private.modalidad_hotel_requiere_recuperacion(v_follow.registro_id) then
      select e.id into v_stage_id
      from public.etapas_hotel e
      where e.registro_hotel_id = v_follow.registro_id
        and not e.cancelado and e.accion_sistema = 'recuperar_y_liberar'
      order by e.creado_en limit 1;
      v_pos := v_pos + 1;
      if v_stage_id is null then
        insert into public.etapas_hotel(
          registro_hotel_id, seguimiento_id, nombre, posicion, estado,
          estado_catalogo_codigo, tipo_etapa, lugar, observaciones, cancelado,
          creado_por, modificado_por, accion_sistema
        ) values (
          v_follow.registro_id, gen_random_uuid(), 'Recuperar ruta y liberar reserva',
          v_pos, 'pendiente', 'pendiente', 'otro', '',
          'Generada automáticamente como T final de cierre.', false,
          v_actor, v_actor, 'recuperar_y_liberar'
        );
        v_created_stages := v_created_stages + 1;
      else
        update public.etapas_hotel
        set posicion = v_pos, modificado_por = coalesce(v_actor, modificado_por)
        where id = v_stage_id;
      end if;
    end if;

    if (select count(*) from public.etapas_hotel e where e.registro_hotel_id=v_follow.registro_id and not e.cancelado) > 99 then
      raise exception 'La generación predictiva supera el máximo de 99 T activas';
    end if;
    perform set_config('app.reconciliando_etapas', '0', true);
    perform app_private.manteniment_encolar_parada(v_follow.seguimiento_id);
  end loop;

  return jsonb_build_object(
    'recibidos', v_raw_count,
    'seleccionados', v_candidate_count,
    't_creadas', v_created_stages,
    'trabajos_creados', v_created_works,
    'ambiguos', v_ambiguous
  );
exception when others then
  perform set_config('app.reconciliando_etapas', '0', true);
  raise;
end;
$function$;


create function app_private.manteniment_encolar_parada(p_id uuid) returns void language plpgsql as $$
begin
 insert into app_private.manteniment_parada_outbox(seguimiento_id,sync_id,revision,estado,payload)
 select p_id,s.sync_id,1,'pendiente',jsonb_build_object('trabajos_asignados',app_private.manteniment_trabajos_asignados(p_id)) from app_private.manteniment_parada_sync s where s.seguimiento_id=p_id
 on conflict(seguimiento_id) do update set payload=excluded.payload,revision=manteniment_parada_outbox.revision+1,estado='pendiente';
end;$$;
