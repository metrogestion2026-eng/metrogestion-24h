-- METROGES SINCRO 11 / DOS SESIONES PG17 / LABORATORIO EXCLUSIVO.
-- PROHIBIDO UTILIZAR EN SUPABASE. Solo base vacía 'sincro11_lab' en CI.
-- Esquema descartable con valores ficticios, SIN links a MANTENIMENT.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '25s';
DO $guard$
BEGIN
  IF current_database() <> 'sincro11_lab' THEN
    RAISE EXCEPTION 'SINCRO11-LAB: BD distinta de sincro11_lab, abortar antes de crear objetos';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 's11_ci') THEN
    RAISE EXCEPTION 'SINCRO11-LAB: el esquema de prueba ya existe, detener sin sobrescribir';
  END IF;
END $guard$;
CREATE SCHEMA s11_ci;
REVOKE ALL ON SCHEMA s11_ci FROM PUBLIC;
CREATE TABLE s11_ci.identidades (
  id_fila bigint PRIMARY KEY CHECK (id_fila > 0),
  clase text NOT NULL CHECK (clase IN ('TRABAJO','TANCAMENT','OTRA')),
  trabajo_sync_id uuid NOT NULL,
  revision_hoja bigint NOT NULL CHECK (revision_hoja > 0),
  estado text NOT NULL CHECK (estado IN ('ACREDITADA','PENDIENTE')),
  excluida_por_operador boolean NOT NULL DEFAULT false
);
CREATE TABLE s11_ci.mapeos (
  id_fila bigint NOT NULL REFERENCES s11_ci.identidades(id_fila),
  columna text NOT NULL CHECK (columna IN ('J','K')),
  clase text NOT NULL,
  significado text NOT NULL,
  trabajo_sync_id uuid NOT NULL,
  campo_destino text NOT NULL CHECK (campo_destino IN ('fecha_realizada','fecha_recogida')),
  revision_mapa bigint NOT NULL CHECK (revision_mapa > 0),
  confirmado boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id_fila,columna)
);
CREATE TABLE s11_ci.destinos (
  trabajo_sync_id uuid NOT NULL,
  campo_destino text NOT NULL CHECK (campo_destino IN ('fecha_realizada','fecha_recogida')),
  valor date,
  revision bigint NOT NULL CHECK (revision > 0),
  PRIMARY KEY (trabajo_sync_id,campo_destino)
);
CREATE TABLE s11_ci.eventos (
  evento_id uuid PRIMARY KEY,
  id_fila bigint NOT NULL REFERENCES s11_ci.identidades(id_fila),
  columna text NOT NULL,
  significado text NOT NULL,
  trabajo_sync_id uuid NOT NULL,
  revision_fuente bigint NOT NULL,
  valor_base date,
  valor_nuevo date,
  capturada_en timestamptz NOT NULL,
  origen text NOT NULL CHECK (origen = 'FICCION_NO_ACREDITA_HUMANO'),
  estado text NOT NULL CHECK (estado IN ('PENDIENTE','APLICADO')),
  CHECK (valor_base IS DISTINCT FROM valor_nuevo)
);
CREATE TABLE s11_ci.outbox (
  propuesta_id uuid PRIMARY KEY,
  id_fila bigint NOT NULL,
  columna text NOT NULL,
  revision_destino bigint NOT NULL,
  estado text NOT NULL CHECK (estado IN ('PENDIENTE','RETENIDA_OBSOLETA'))
);
CREATE TABLE s11_ci.auditoria (
  evento_id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  id_fila bigint NOT NULL,
  columna text NOT NULL,
  campo_destino text NOT NULL,
  revision_anterior bigint NOT NULL,
  revision_actual bigint NOT NULL,
  retenidas integer NOT NULL,
  registrado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE s11_ci.recibos (
  request_id uuid PRIMARY KEY,
  evento_id uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  respuesta jsonb NOT NULL
);

-- OJO: el receptor real NO ESTÁ INSTALADO. Esta función solo tiene sentido en
-- el esquema que se borra al finalizar el job. Nunca usar con datos de flota.
CREATE FUNCTION s11_ci.aplicar_correccion_ficticia(
 p_id_fila bigint, p_columna text, p_evento_id uuid, p_request_id uuid,
 p_payload_sha256 text, p_revision_hoja bigint, p_revision_mapa bigint,
 p_revision_destino bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, s11_ci
AS $f$
DECLARE v_i record; v_map record; v_evt record; v_dst record; v_rec record;
        v_previas integer; v_resultado jsonb;
BEGIN
 IF current_database()<>'sincro11_lab' THEN
   RAISE EXCEPTION 'S11_CI_BD_NO_LAB';
 END IF;
 IF p_id_fila IS NULL OR p_id_fila<=0 OR p_columna NOT IN ('J','K')
   OR p_columna IS NULL OR p_evento_id IS NULL OR p_request_id IS NULL OR p_revision_hoja IS NULL
   OR p_revision_hoja<=0 OR p_revision_mapa IS NULL OR p_revision_mapa<=0
   OR p_revision_destino IS NULL OR p_revision_destino<=0
   OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'S11_CI_ENTRADA_INVALIDA';
 END IF;
 SELECT * INTO v_rec FROM s11_ci.recibos WHERE request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
   IF v_rec.evento_id <> p_evento_id OR v_rec.payload_sha256 <> p_payload_sha256 THEN
     RAISE EXCEPTION 'S11_CI_REINTENTO_PAYLOAD_DISTINTO';
   END IF;
   RETURN v_rec.respuesta || jsonb_build_object('reintento',true);
 END IF;
 SELECT * INTO v_i FROM s11_ci.identidades WHERE id_fila=p_id_fila FOR SHARE;
 IF NOT FOUND OR v_i.estado<>'ACREDITADA' THEN RAISE EXCEPTION 'S11_CI_T_SIN_ACREDITAR'; END IF;
 IF v_i.excluida_por_operador THEN RAISE EXCEPTION 'S11_CI_T_EXCLUIDA'; END IF;
 IF v_i.clase <> 'TRABAJO' THEN RAISE EXCEPTION 'S11_CI_CLASE_SIN_MAPEO'; END IF;
 IF v_i.revision_hoja <> p_revision_hoja THEN RAISE EXCEPTION 'S11_CI_CAS_HOJA'; END IF;
 SELECT * INTO v_map FROM s11_ci.mapeos
  WHERE id_fila=p_id_fila AND columna=p_columna FOR SHARE;
 IF NOT FOUND OR v_map.confirmado IS NOT TRUE OR v_map.clase<>v_i.clase
  OR v_map.trabajo_sync_id<>v_i.trabajo_sync_id
  OR v_map.revision_mapa<>p_revision_mapa
  OR (p_columna='J' AND (v_map.significado<>'FECHA_REALIZADA' OR v_map.campo_destino<>'fecha_realizada'))
  OR (p_columna='K' AND (v_map.significado<>'FECHA_RECOGIDA' OR v_map.campo_destino<>'fecha_recogida')) THEN
    RAISE EXCEPTION 'S11_CI_MAPEO_NO_ACREDITADO';
 END IF;
 SELECT * INTO v_evt FROM s11_ci.eventos WHERE evento_id=p_evento_id FOR UPDATE;
 IF NOT FOUND OR v_evt.id_fila<>p_id_fila OR v_evt.columna<>p_columna
  OR v_evt.significado<>v_map.significado OR v_evt.trabajo_sync_id<>v_map.trabajo_sync_id
  OR v_evt.revision_fuente<>p_revision_hoja
  OR v_evt.capturada_en<'2026-11-15T23:00:00+00'::timestamptz
  OR v_evt.origen<>'FICCION_NO_ACREDITA_HUMANO' THEN
  RAISE EXCEPTION 'S11_CI_EVENTO_NO_ACREDITADO';
 END IF;
 IF v_evt.estado <> 'PENDIENTE' THEN
   -- Dos sesiones pudieron entrar antes de que se registrara la primera.
   -- Devolver el MISMO recibo únicamente para el MISMO request y payload.
   SELECT * INTO v_rec FROM s11_ci.recibos WHERE request_id=p_request_id FOR UPDATE;
   IF FOUND AND v_rec.evento_id=p_evento_id AND v_rec.payload_sha256=p_payload_sha256 THEN
     RETURN v_rec.respuesta || jsonb_build_object('reintento',true);
   END IF;
   RAISE EXCEPTION 'S11_CI_EVENTO_YA_APLICADO';
 END IF;
 SELECT * INTO v_dst FROM s11_ci.destinos
 WHERE trabajo_sync_id=v_i.trabajo_sync_id AND campo_destino=v_map.campo_destino
 FOR UPDATE;
 IF NOT FOUND OR v_dst.revision<>p_revision_destino
  OR v_dst.valor IS DISTINCT FROM v_evt.valor_base THEN
   RAISE EXCEPTION 'S11_CI_CAS_DESTINO';
 END IF;
 UPDATE s11_ci.destinos SET valor=v_evt.valor_nuevo,revision=revision+1
 WHERE trabajo_sync_id=v_dst.trabajo_sync_id AND campo_destino=v_dst.campo_destino;
 -- Solo propuestas OBSOLETAS del mismo ID T y MISMO campo. Una propuesta
 -- más reciente nunca se invalida solo por compartir DFM, PA o vehículo.
 UPDATE s11_ci.outbox SET estado='RETENIDA_OBSOLETA'
 WHERE id_fila=p_id_fila AND columna=p_columna AND estado='PENDIENTE'
   AND revision_destino<=p_revision_destino;
 GET DIAGNOSTICS v_previas = ROW_COUNT;
 UPDATE s11_ci.eventos SET estado='APLICADO' WHERE evento_id=p_evento_id;
 INSERT INTO s11_ci.auditoria(evento_id,request_id,id_fila,columna,campo_destino,
   revision_anterior,revision_actual,retenidas)
 VALUES(p_evento_id,p_request_id,p_id_fila,p_columna,v_map.campo_destino,
   p_revision_destino,p_revision_destino+1,v_previas);
 v_resultado=jsonb_build_object('resultado','APLICADA_FICCION','id_fila',p_id_fila,
 'columna',p_columna,'revision_destino',p_revision_destino+1,
 'propuestas_retenidas',v_previas,'permiso_produccion',false);
 INSERT INTO s11_ci.recibos(request_id,evento_id,payload_sha256,respuesta)
 VALUES(p_request_id,p_evento_id,p_payload_sha256,v_resultado);
 RETURN v_resultado;
END $f$;

-- Datos SOLO inventados. T=90001: dos propuestas rivales a la misma J.
-- T=90002: dos campos independientes J y K de un mismo objeto.
-- T=90003: TANCAMENT expresamente sin mapeo. T=90004 excluida por flag.
INSERT INTO s11_ci.identidades(id_fila,clase,trabajo_sync_id,revision_hoja,estado,excluida_por_operador) VALUES
 (90001,'TRABAJO','11111111-1111-4111-8111-111111111111',4,'ACREDITADA',false),
 (90002,'TRABAJO','22222222-2222-4222-8222-222222222222',8,'ACREDITADA',false),
 (90003,'TANCAMENT','33333333-3333-4333-8333-333333333333',2,'ACREDITADA',false),
 (90004,'TRABAJO','44444444-4444-4444-8444-444444444444',3,'ACREDITADA',true),
 (90005,'TRABAJO','22222222-2222-4222-8222-222222222222',8,'PENDIENTE',false);
INSERT INTO s11_ci.mapeos VALUES
 (90001,'J','TRABAJO','FECHA_REALIZADA','11111111-1111-4111-8111-111111111111','fecha_realizada',1,true),
 (90002,'J','TRABAJO','FECHA_REALIZADA','22222222-2222-4222-8222-222222222222','fecha_realizada',2,true),
 (90002,'K','TRABAJO','FECHA_RECOGIDA','22222222-2222-4222-8222-222222222222','fecha_recogida',3,true);
INSERT INTO s11_ci.destinos VALUES
 ('11111111-1111-4111-8111-111111111111','fecha_realizada','2024-09-18',7),
 ('22222222-2222-4222-8222-222222222222','fecha_realizada','2024-10-08',3),
 ('22222222-2222-4222-8222-222222222222','fecha_recogida','2024-10-10',5);
INSERT INTO s11_ci.eventos VALUES
 ('a1111111-1111-4111-8111-111111111111',90001,'J','FECHA_REALIZADA','11111111-1111-4111-8111-111111111111',4,'2024-09-18','2024-09-19','2026-11-17T07:00:00Z','FICCION_NO_ACREDITA_HUMANO','PENDIENTE'),
 ('a2222222-2222-4222-8222-222222222222',90001,'J','FECHA_REALIZADA','11111111-1111-4111-8111-111111111111',4,'2024-09-18','2024-09-20','2026-11-17T07:01:00Z','FICCION_NO_ACREDITA_HUMANO','PENDIENTE'),
 ('a3333333-3333-4333-8333-333333333333',90002,'J','FECHA_REALIZADA','22222222-2222-4222-8222-222222222222',8,'2024-10-08','2024-10-09','2026-11-17T07:02:00Z','FICCION_NO_ACREDITA_HUMANO','PENDIENTE'),
 ('a4444444-4444-4444-8444-444444444444',90002,'K','FECHA_RECOGIDA','22222222-2222-4222-8222-222222222222',8,'2024-10-10','2024-10-11','2026-11-17T07:03:00Z','FICCION_NO_ACREDITA_HUMANO','PENDIENTE');
INSERT INTO s11_ci.outbox VALUES
 ('b1111111-1111-4111-8111-111111111111',90001,'J',7,'PENDIENTE'),
 ('b2222222-2222-4222-8222-222222222222',90001,'J',10,'PENDIENTE'),
 ('b3333333-3333-4333-8333-333333333333',90001,'K',1,'PENDIENTE'),
 ('b4444444-4444-4444-8444-444444444444',90002,'J',3,'PENDIENTE'),
 ('b5555555-5555-4555-8555-555555555555',90002,'K',5,'PENDIENTE');
COMMIT;
-- El job CI destruirá la base PostgreSQL de servicio al terminar y antes
-- borrará el esquema s11_ci; NO ejecutar la fase CI en otro destino.