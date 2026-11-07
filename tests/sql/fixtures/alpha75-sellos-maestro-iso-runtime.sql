-- Synthetic boundary for master-stamp tests; no operational rows or stamps.
-- The two arbitration functions below are literal schema-only runtime captures
-- read on 07/11/2026. The candidate never changes either function or trigger.
-- Fleet validation outside arbitration is a labelled double at the end.
ALTER TABLE public.vehiculos
  ADD COLUMN IF NOT EXISTS matricula text DEFAULT '',
  ADD COLUMN IF NOT EXISTS tipo_manteniment text DEFAULT '',
  ADD COLUMN IF NOT EXISTS upc text DEFAULT '',
  ADD COLUMN IF NOT EXISTS telefono text DEFAULT '',
  ADD COLUMN IF NOT EXISTS contrato_texto text DEFAULT '',
  ADD COLUMN IF NOT EXISTS fecha_matriculacion date,
  ADD COLUMN IF NOT EXISTS fecha_alta_manteniment date,
  ADD COLUMN IF NOT EXISTS asignacion_manteniment text DEFAULT '',
  ADD COLUMN IF NOT EXISTS marca text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bastidor text DEFAULT '';

CREATE TABLE app_private.vehiculo_campo_maestro(
  vehiculo_id uuid NOT NULL REFERENCES public.vehiculos(id),
  campo text NOT NULL,
  valor_manteniment text,
  manteniment_cambio_en timestamptz,
  registro_cambio_en timestamptz,
  ganador text NOT NULL,
  ganador_en timestamptz,
  actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(vehiculo_id,campo)
);

CREATE OR REPLACE FUNCTION app_private.arbitrar_campo_vehiculo(p_vehiculo_id uuid, p_campo text, p_anterior text, p_nuevo text, p_importando_manteniment boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_estado app_private.vehiculo_campo_maestro%rowtype;
  v_ahora timestamptz := clock_timestamp();
  v_dfm text;
  v_cambio_real timestamptz;
begin
  select * into v_estado
  from app_private.vehiculo_campo_maestro
  where vehiculo_id=p_vehiculo_id and campo=p_campo
  for update;

  if not found then
    if p_importando_manteniment then
      insert into app_private.vehiculo_campo_maestro(
        vehiculo_id,campo,valor_manteniment,ganador,ganador_en,actualizado_en
      ) values (
        p_vehiculo_id,p_campo,p_nuevo,'baseline',null,v_ahora
      );
      return p_anterior;
    end if;
    insert into app_private.vehiculo_campo_maestro(
      vehiculo_id,campo,registro_cambio_en,ganador,ganador_en,actualizado_en
    ) values (
      p_vehiculo_id,p_campo,v_ahora,'registro',v_ahora,v_ahora
    );
    return p_nuevo;
  end if;

  if not p_importando_manteniment then
    if p_anterior is distinct from p_nuevo then
      update app_private.vehiculo_campo_maestro
      set registro_cambio_en=v_ahora,
          ganador='registro',
          ganador_en=v_ahora,
          actualizado_en=v_ahora
      where vehiculo_id=p_vehiculo_id and campo=p_campo;
    end if;
    return p_nuevo;
  end if;

  select dfm into v_dfm from public.vehiculos where id=p_vehiculo_id;
  if to_regclass('pg_temp.tmp_manteniment_cambios_maestro') is not null then
    execute 'select cambio_en from pg_temp.tmp_manteniment_cambios_maestro where dfm=$1 and campo=$2'
      into v_cambio_real using v_dfm,p_campo;
  end if;

  -- Sin sello de edición real, la lectura/sincronización no tiene autoridad
  -- para pisar una corrección hecha desde Registro.
  if v_cambio_real is null then
    if v_estado.valor_manteniment is distinct from p_nuevo then
      update app_private.vehiculo_campo_maestro
      set valor_manteniment=p_nuevo,
          actualizado_en=v_ahora
      where vehiculo_id=p_vehiculo_id and campo=p_campo;
    end if;
    return p_anterior;
  end if;

  -- Reintentar una edición ya observada no rejuvenece el dato.
  if v_estado.manteniment_cambio_en is not null
     and v_cambio_real <= v_estado.manteniment_cambio_en then
    return p_anterior;
  end if;

  update app_private.vehiculo_campo_maestro
  set valor_manteniment=p_nuevo,
      manteniment_cambio_en=v_cambio_real,
      actualizado_en=v_ahora
  where vehiculo_id=p_vehiculo_id and campo=p_campo;

  if v_estado.registro_cambio_en is null
     or v_cambio_real > v_estado.registro_cambio_en then
    update app_private.vehiculo_campo_maestro
    set ganador='manteniment_alta',
        ganador_en=v_cambio_real,
        actualizado_en=v_ahora
    where vehiculo_id=p_vehiculo_id and campo=p_campo;
    return p_nuevo;
  end if;

  return p_anterior;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.vehiculos_arbitrar_maestro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_importando boolean :=
    coalesce(current_setting('app.manteniment_importando_altas',true),'')='1';
begin
  if tg_op='INSERT' then
    if v_importando then
      insert into app_private.vehiculo_campo_maestro(
        vehiculo_id,campo,valor_manteniment,manteniment_cambio_en,
        ganador,ganador_en,actualizado_en
      )
      select new.id,x.campo,x.valor,clock_timestamp(),
             'manteniment_alta',clock_timestamp(),clock_timestamp()
      from (values
        ('matricula',new.matricula::text),
        ('tipo_manteniment',new.tipo_manteniment::text),
        ('upc',new.upc::text),
        ('telefono',new.telefono::text),
        ('contrato_texto',new.contrato_texto::text),
        ('fecha_matriculacion',new.fecha_matriculacion::text),
        ('fecha_alta_manteniment',new.fecha_alta_manteniment::text),
        ('asignacion_manteniment',new.asignacion_manteniment::text),
        ('marca',new.marca::text),
        ('bastidor',new.bastidor::text)
      ) x(campo,valor)
      on conflict (vehiculo_id,campo) do nothing;
    else
      insert into app_private.vehiculo_campo_maestro(
        vehiculo_id,campo,registro_cambio_en,ganador,ganador_en,actualizado_en
      )
      select new.id,x.campo,clock_timestamp(),
             'registro',clock_timestamp(),clock_timestamp()
      from (values
        ('matricula'),('tipo_manteniment'),('upc'),('telefono'),('contrato_texto'),
        ('fecha_matriculacion'),('fecha_alta_manteniment'),('asignacion_manteniment'),
        ('marca'),('bastidor')
      ) x(campo)
      on conflict (vehiculo_id,campo) do nothing;
    end if;
    return new;
  end if;

  new.matricula := app_private.arbitrar_campo_vehiculo(new.id,'matricula',old.matricula::text,new.matricula::text,v_importando);
  new.tipo_manteniment := app_private.arbitrar_campo_vehiculo(new.id,'tipo_manteniment',old.tipo_manteniment::text,new.tipo_manteniment::text,v_importando);
  new.upc := app_private.arbitrar_campo_vehiculo(new.id,'upc',old.upc::text,new.upc::text,v_importando);
  new.telefono := app_private.arbitrar_campo_vehiculo(new.id,'telefono',old.telefono::text,new.telefono::text,v_importando);
  new.contrato_texto := app_private.arbitrar_campo_vehiculo(new.id,'contrato_texto',old.contrato_texto::text,new.contrato_texto::text,v_importando);
  new.fecha_matriculacion := nullif(app_private.arbitrar_campo_vehiculo(new.id,'fecha_matriculacion',old.fecha_matriculacion::text,new.fecha_matriculacion::text,v_importando),'')::date;
  new.fecha_alta_manteniment := nullif(app_private.arbitrar_campo_vehiculo(new.id,'fecha_alta_manteniment',old.fecha_alta_manteniment::text,new.fecha_alta_manteniment::text,v_importando),'')::date;
  new.asignacion_manteniment := app_private.arbitrar_campo_vehiculo(new.id,'asignacion_manteniment',old.asignacion_manteniment::text,new.asignacion_manteniment::text,v_importando);
  new.marca := app_private.arbitrar_campo_vehiculo(new.id,'marca',old.marca::text,new.marca::text,v_importando);
  new.bastidor := app_private.arbitrar_campo_vehiculo(new.id,'bastidor',old.bastidor::text,new.bastidor::text,v_importando);
  return new;
end;
$function$;

CREATE TRIGGER vehiculos_aa_arbitrar_maestro
BEFORE UPDATE OF matricula,tipo_manteniment,upc,telefono,contrato_texto,
  fecha_matriculacion,fecha_alta_manteniment,asignacion_manteniment,marca,bastidor
ON public.vehiculos FOR EACH ROW
EXECUTE FUNCTION app_private.vehiculos_arbitrar_maestro();
CREATE TRIGGER vehiculos_aa_inicializar_maestro
AFTER INSERT ON public.vehiculos FOR EACH ROW
EXECUTE FUNCTION app_private.vehiculos_arbitrar_maestro();

-- Explicit boundary double: proposes a bastidor UPDATE just as the real base
-- importer does; master validation/counting is not the subject of this fixture.
-- Stamp ingestion stays in the literal real wrapper. The real BEFORE UPDATE
-- trigger and real arbiter decide whether this proposed value can be stored.
CREATE OR REPLACE FUNCTION app_private.aplicar_snapshot_manteniment_base(
  jsonb,text,uuid,text
) RETURNS jsonb LANGUAGE plpgsql AS $fixture_base$
DECLARE v_run uuid;
BEGIN
  INSERT INTO public.manteniment_sync_ejecuciones DEFAULT VALUES
    RETURNING id INTO v_run;
  UPDATE public.vehiculos v
     SET bastidor=CASE WHEN coalesce(x.bastidor,'')<>'' THEN x.bastidor ELSE v.bastidor END
    FROM jsonb_to_recordset($1->'filas') AS x(dfm text,bastidor text)
   WHERE v.dfm=x.dfm;
  RETURN jsonb_build_object('ok',true,'ejecucion_id',v_run,
    'mensaje','Synthetic master boundary; real stamp ingestion and arbitration');
END;
$fixture_base$;
