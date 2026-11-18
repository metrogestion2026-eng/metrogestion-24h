-- METROGES SINCRO12. REGISTRO DURADERO DE LOTES EN PG17 AISLADO.
-- NUNCA EJECUTAR EN SUPABASE NI MANTENIMENT.
-- SOLO BD ficticia sincro11_lab; datos y sesiones SIMULADOS.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '25s';
DO $guard$
BEGIN
 IF current_database() <> 'sincro11_lab' THEN
  RAISE EXCEPTION 'S12_LAB_SOLO_SINCRO11_LAB';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='s12_lab') THEN
  RAISE EXCEPTION 'S12_LAB_YA_EXISTE_NO_SOBRESCRIBIR';
 END IF;
END $guard$;
CREATE SCHEMA s12_lab;
REVOKE ALL ON SCHEMA s12_lab FROM PUBLIC;
CREATE TABLE s12_lab.identidades(
 id_fila bigint PRIMARY KEY CHECK(id_fila>0),
 spreadsheet_id text NOT NULL CHECK(spreadsheet_id='LIBRO_FICTICIO'),
 clase text NOT NULL CHECK(clase IN('TRABAJO','PARADA')),
 objeto_id uuid NOT NULL, vinculo_positivo_ficticio boolean NOT NULL,
 excluida boolean NOT NULL DEFAULT false
);
CREATE TABLE s12_lab.vinculos(
 id_fila bigint NOT NULL REFERENCES s12_lab.identidades(id_fila),
 columna text NOT NULL, objeto_id uuid NOT NULL,
 clase text NOT NULL, significado text NOT NULL,
 campo_destino text NOT NULL, revision_mapa bigint NOT NULL CHECK(revision_mapa>0),
 confirmado_ficticio boolean NOT NULL,
 PRIMARY KEY(id_fila,columna)
);
CREATE TABLE s12_lab.sesiones_ficticias(
 sesion_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 aal text NOT NULL CHECK(aal IN('aal1','aal2')),
 segundo_factor_simulado boolean NOT NULL,
 permiso_lote_simulado boolean NOT NULL,
 revocada boolean NOT NULL DEFAULT false
);
CREATE TABLE s12_lab.lotes(
 lote_id uuid PRIMARY KEY,
 tipo text NOT NULL CHECK(tipo IN('CONTROLADO_LAB','ADOPTAR_ACTUAL_LAB')),
 estado text NOT NULL DEFAULT 'BORRADOR'
   CHECK(estado IN('BORRADOR','CONFIRMADO_FICTICIO')),
 creado_en timestamptz NOT NULL,
 aprobado_en timestamptz,
 session_id uuid, request_id uuid, huella text,
 CONSTRAINT estado_sin_permiso_prod CHECK(
   estado='BORRADOR' OR (aprobado_en IS NOT NULL AND huella IS NOT NULL))
);
CREATE TABLE s12_lab.eventos(
 evento_id uuid PRIMARY KEY,
 lote_id uuid NOT NULL REFERENCES s12_lab.lotes(lote_id),
 id_fila bigint NOT NULL REFERENCES s12_lab.identidades(id_fila),
 columna text NOT NULL CHECK(columna IN('J','K')),
 significado text NOT NULL,
 origen text NOT NULL CHECK(origen IN('CONTROLADO_FICTICIO','OBSERVACION_FICTICIA')),
 revision_base bigint NOT NULL CHECK(revision_base>0),
 revision_nueva bigint NOT NULL CHECK(revision_nueva=revision_base+1),
 hash_anterior text NOT NULL CHECK(hash_anterior ~ '^[0-9a-f]{64}$'),
 hash_nuevo text NOT NULL CHECK(hash_nuevo ~ '^[0-9a-f]{64}$'),
 observado_en timestamptz NOT NULL,
 UNIQUE(lote_id,id_fila,columna),
 UNIQUE(id_fila,columna,revision_nueva),
 CHECK(hash_anterior<>hash_nuevo)
);
CREATE TABLE s12_lab.lecturas_hoja(
 id_fila bigint NOT NULL, columna text NOT NULL,
 revision bigint NOT NULL, hash_vigente text NOT NULL
   CHECK(hash_vigente ~ '^[0-9a-f]{64}$'),
 leido_en timestamptz NOT NULL,
 PRIMARY KEY(id_fila,columna)
);
CREATE TABLE s12_lab.destinos(
 objeto_id uuid NOT NULL, campo_destino text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 hash_vigente text NOT NULL CHECK(hash_vigente ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(objeto_id,campo_destino)
);
CREATE TABLE s12_lab.recibos_inmutables(
 request_id uuid PRIMARY KEY,
 lote_id uuid NOT NULL UNIQUE REFERENCES s12_lab.lotes(lote_id),
 nonce uuid NOT NULL UNIQUE,
 sesion_id uuid NOT NULL,
 huella text NOT NULL CHECK(huella ~ '^[0-9a-f]{64}$'),
 respuesta jsonb NOT NULL,
 confirmado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION s12_lab.no_mutar_recibo() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,s12_lab AS $f$
BEGIN
 IF current_database()<>'sincro11_lab' THEN
  RAISE EXCEPTION 'S12_LAB_NO_AUTORIZADO';
 END IF;
 RAISE EXCEPTION 'S12_RECIBO_INMUTABLE';
END $f$;
CREATE TRIGGER s12_recibo_no_update_delete BEFORE UPDATE OR DELETE
 ON s12_lab.recibos_inmutables FOR EACH ROW EXECUTE FUNCTION s12_lab.no_mutar_recibo();
CREATE FUNCTION s12_lab.proteger_evento_confirmado()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,s12_lab AS $f$
DECLARE v_lote uuid; v_estado text;
BEGIN
 IF current_database()<>'sincro11_lab' THEN
  RAISE EXCEPTION 'S12_LAB_NO_AUTORIZADO';
 END IF;
 v_lote:=CASE WHEN TG_OP='DELETE' THEN OLD.lote_id ELSE NEW.lote_id END;
 SELECT estado INTO v_estado FROM s12_lab.lotes WHERE lote_id=v_lote FOR SHARE;
 IF v_estado IS DISTINCT FROM 'BORRADOR' THEN
  RAISE EXCEPTION 'S12_LOTE_SELLADO_NO_MODIFICAR_EVENTOS';
 END IF;
 IF TG_OP='UPDATE' AND OLD.lote_id<>NEW.lote_id THEN
  RAISE EXCEPTION 'S12_EVENTO_NO_CAMBIAR_LOTE';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $f$;
CREATE TRIGGER s12_evento_no_cambiar_confirmado BEFORE INSERT OR UPDATE OR DELETE
 ON s12_lab.eventos FOR EACH ROW EXECUTE FUNCTION s12_lab.proteger_evento_confirmado();
CREATE FUNCTION s12_lab.huella_lote_ficticia(p_lote uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER
 SET search_path=pg_catalog,s12_lab AS $f$
DECLARE v_json jsonb;
BEGIN
 IF current_database()<>'sincro11_lab' THEN
  RAISE EXCEPTION 'S12_LAB_NO_AUTORIZADO';
 END IF;
 SELECT coalesce(jsonb_agg(
  jsonb_build_array(evento_id::text,id_fila,columna,significado,origen,
    revision_base,revision_nueva,hash_anterior,hash_nuevo,observado_en)
  ORDER BY id_fila,columna,evento_id::text),'[]'::jsonb)
 INTO v_json FROM s12_lab.eventos WHERE lote_id=p_lote;
 RETURN encode(sha256(convert_to(v_json::text,'UTF8')),'hex');
END $f$;
-- La función comprueba un actor en la tabla de SESIONES FICTICIAS.
-- No comprueba Google, Supabase Auth, MFA real ni autoría de edición.
CREATE FUNCTION s12_lab.confirmar_lote_ficticio(
 p_lote uuid,p_request uuid,p_sesion uuid,p_nonce uuid,p_huella text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,s12_lab AS $f$
DECLARE v_lote record; v_sesion record; v_rec record; v_count int;
        v_actual text; v_result jsonb; v_mal bigint;
BEGIN
 IF current_database()<>'sincro11_lab' THEN
  RAISE EXCEPTION 'S12_LAB_NO_AUTORIZADO';
 END IF;
 IF p_lote IS NULL OR p_request IS NULL OR p_sesion IS NULL OR p_nonce IS NULL
  OR p_huella IS NULL OR p_huella !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'S12_SOLICITUD_INVALIDA';
 END IF;
 SELECT * INTO v_rec FROM s12_lab.recibos_inmutables WHERE request_id=p_request;
 IF FOUND THEN
  IF v_rec.lote_id<>p_lote OR v_rec.sesion_id<>p_sesion
   OR v_rec.nonce<>p_nonce OR v_rec.huella<>p_huella THEN
   RAISE EXCEPTION 'S12_REPLAY_PAYLOAD_DISTINTO';
  END IF;
  RETURN v_rec.respuesta||jsonb_build_object('reintento',true);
 END IF;
 SELECT * INTO v_lote FROM s12_lab.lotes WHERE lote_id=p_lote FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'S12_LOTE_INEXISTENTE'; END IF;
 -- Repetir la consulta una vez adquirido el bloqueo: segunda sesión
 -- pudo empezar antes del COMMIT de la primera.
 SELECT * INTO v_rec FROM s12_lab.recibos_inmutables WHERE request_id=p_request;
 IF FOUND THEN
  IF v_rec.lote_id<>p_lote OR v_rec.sesion_id<>p_sesion
   OR v_rec.nonce<>p_nonce OR v_rec.huella<>p_huella THEN
   RAISE EXCEPTION 'S12_REPLAY_PAYLOAD_DISTINTO';
  END IF;
  RETURN v_rec.respuesta||jsonb_build_object('reintento',true);
 END IF;
 IF v_lote.estado<>'BORRADOR' THEN RAISE EXCEPTION 'S12_LOTE_YA_CONFIRMADO'; END IF;
 IF v_lote.creado_en<='2026-11-15 23:00:00+00'::timestamptz
   OR v_lote.creado_en>clock_timestamp() THEN
  RAISE EXCEPTION 'S12_LOTE_ANTES_DEL_CORTE';
 END IF;
 SELECT * INTO v_sesion FROM s12_lab.sesiones_ficticias
  WHERE sesion_id=p_sesion FOR SHARE;
 IF NOT FOUND OR v_sesion.aal<>'aal2' OR NOT v_sesion.segundo_factor_simulado
  OR NOT v_sesion.permiso_lote_simulado OR v_sesion.revocada THEN
  RAISE EXCEPTION 'S12_SESION_FICTICIA_NO_ADMITIDA';
 END IF;
 SELECT count(*) INTO v_count FROM s12_lab.eventos WHERE lote_id=p_lote;
 IF v_count<1 OR v_count>100 THEN RAISE EXCEPTION 'S12_LOTE_VACIO_O_EXCESIVO'; END IF;
 SELECT e.id_fila INTO v_mal FROM s12_lab.eventos e
 LEFT JOIN s12_lab.identidades i ON i.id_fila=e.id_fila
 LEFT JOIN s12_lab.vinculos v ON v.id_fila=e.id_fila AND v.columna=e.columna
 WHERE e.lote_id=p_lote AND (
  i.id_fila IS NULL OR i.spreadsheet_id<>'LIBRO_FICTICIO'
  OR i.clase<>'TRABAJO' OR NOT i.vinculo_positivo_ficticio OR i.excluida
  OR v.id_fila IS NULL OR NOT v.confirmado_ficticio
  OR v.objeto_id<>i.objeto_id OR v.clase<>i.clase
  OR e.columna<>'K' OR v.columna<>'K'
  OR e.significado<>'RECOGIDA_REAL_TALLER'
  OR v.significado<>e.significado OR v.campo_destino<>'fecha_recogida'
  OR (v.revision_mapa<1)
  OR (v_lote.tipo='CONTROLADO_LAB' AND e.origen<>'CONTROLADO_FICTICIO')
  OR (v_lote.tipo='ADOPTAR_ACTUAL_LAB' AND e.origen<>'OBSERVACION_FICTICIA')
  OR e.observado_en<='2026-11-15 23:00:00+00'::timestamptz
  OR e.observado_en>clock_timestamp()
 ) LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'S12_EVENTO_O_VINCULO_NO_ACREDITADO_LAB'; END IF;
 v_actual:=s12_lab.huella_lote_ficticia(p_lote);
 IF v_actual<>p_huella THEN RAISE EXCEPTION 'S12_HUELLA_LOTE_DISTINTA'; END IF;
 UPDATE s12_lab.lotes SET estado='CONFIRMADO_FICTICIO',
  aprobado_en=clock_timestamp(), session_id=p_sesion,
  request_id=p_request, huella=p_huella
  WHERE lote_id=p_lote;
 v_result=jsonb_build_object('estado','CONFIRMADO_FICTICIO',
  'lote',p_lote,'cantidad',v_count,'permiso_produccion',false,
  'autor_edicion_hoja_acreditado',false,'vinculo_productivo_acreditado',false);
 INSERT INTO s12_lab.recibos_inmutables(
  request_id,lote_id,nonce,sesion_id,huella,respuesta)
 VALUES(p_request,p_lote,p_nonce,p_sesion,p_huella,v_result);
 RETURN v_result;
END $f$;
-- Después de sellar, solo coteja relecturas, sin UPDATE de destinos.
CREATE FUNCTION s12_lab.candidatos_del_lote_ficticio(p_lote uuid)
 RETURNS TABLE(id_fila bigint,columna text,resultado text,
   autoriza_sincronizar boolean)
 LANGUAGE sql STABLE SECURITY INVOKER
 SET search_path=pg_catalog,s12_lab AS $f$
 SELECT e.id_fila,e.columna,
  CASE
   WHEN l.estado<>'CONFIRMADO_FICTICIO' THEN 'LOTE_NO_CONFIRMADO'
   WHEN h.id_fila IS NULL OR h.revision<e.revision_nueva
     OR h.hash_vigente<>e.hash_nuevo OR h.leido_en<l.aprobado_en
     THEN 'HOJA_NO_RELEIDA_O_CAMBIADA'
   WHEN d.objeto_id IS NULL THEN 'DESTINO_NO_ENCONTRADO'
   WHEN d.hash_vigente=e.hash_nuevo THEN 'DESTINO_YA_COINCIDE'
   ELSE 'CANDIDATO_LAB_NO_AUTORIZADO'
  END::text AS resultado,
  false::boolean AS autoriza_sincronizar
 FROM s12_lab.eventos e
 JOIN s12_lab.lotes l ON l.lote_id=e.lote_id
 JOIN s12_lab.vinculos v ON v.id_fila=e.id_fila AND v.columna=e.columna
 LEFT JOIN s12_lab.lecturas_hoja h
   ON h.id_fila=e.id_fila AND h.columna=e.columna
 LEFT JOIN s12_lab.destinos d
   ON d.objeto_id=v.objeto_id AND d.campo_destino=v.campo_destino
 WHERE e.lote_id=p_lote
 ORDER BY e.id_fila,e.columna
$f$;
-- Fixtures inventadas, no datos reales.
INSERT INTO s12_lab.sesiones_ficticias VALUES
 ('a1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','aal2',true,true,false),
 ('a2222222-2222-4222-8222-222222222222','b2222222-2222-4222-8222-222222222222','aal1',false,true,false),
 ('a3333333-3333-4333-8333-333333333333','b3333333-3333-4333-8333-333333333333','aal2',true,true,true);
INSERT INTO s12_lab.identidades(id_fila,spreadsheet_id,clase,objeto_id,vinculo_positivo_ficticio,excluida) VALUES
 (90001,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000001',true,false),
 (90002,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000002',true,false),
 (90003,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000003',false,false),
 (90004,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000004',true,true),
 (90005,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000005',true,false),
 (90006,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000006',true,false),
 (90007,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000007',true,false),
 (90008,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000008',true,false),
 (90009,'LIBRO_FICTICIO','TRABAJO','e0000000-0000-4000-8000-000000000009',true,false);
INSERT INTO s12_lab.vinculos
 SELECT i.id_fila,'K',i.objeto_id,i.clase,'RECOGIDA_REAL_TALLER','fecha_recogida',1,true
 FROM s12_lab.identidades i WHERE i.id_fila<>90003;
INSERT INTO s12_lab.lotes(lote_id,tipo,creado_en) VALUES
 ('c0000000-0000-4000-8000-000000000001','CONTROLADO_LAB',clock_timestamp()-interval '5 minutes'),
 ('c0000000-0000-4000-8000-000000000002','ADOPTAR_ACTUAL_LAB',clock_timestamp()-interval '5 minutes'),
 ('c0000000-0000-4000-8000-000000000003','CONTROLADO_LAB',clock_timestamp()-interval '5 minutes'),
 ('c0000000-0000-4000-8000-000000000004','CONTROLADO_LAB',clock_timestamp()-interval '5 minutes'),
 ('c0000000-0000-4000-8000-000000000005','CONTROLADO_LAB',clock_timestamp()-interval '5 minutes'),
 ('c0000000-0000-4000-8000-000000000006','CONTROLADO_LAB',clock_timestamp()-interval '5 minutes'),
 ('c0000000-0000-4000-8000-000000000007','CONTROLADO_LAB',clock_timestamp()-interval '5 minutes'),
 ('c0000000-0000-4000-8000-000000000008','CONTROLADO_LAB',clock_timestamp()-interval '5 minutes');
INSERT INTO s12_lab.eventos(
 evento_id,lote_id,id_fila,columna,significado,origen,
 revision_base,revision_nueva,hash_anterior,hash_nuevo,observado_en)
VALUES
 ('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',90001,'K','RECOGIDA_REAL_TALLER','CONTROLADO_FICTICIO',6,7,repeat('a',64),repeat('b',64),clock_timestamp()-interval '4 minutes'),
 ('d0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',90002,'K','RECOGIDA_REAL_TALLER','OBSERVACION_FICTICIA',3,4,repeat('c',64),repeat('d',64),clock_timestamp()-interval '4 minutes'),
 ('d0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',90003,'K','RECOGIDA_REAL_TALLER','CONTROLADO_FICTICIO',2,3,repeat('e',64),repeat('f',64),clock_timestamp()-interval '4 minutes'),
 ('d0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000004',90004,'K','RECOGIDA_REAL_TALLER','CONTROLADO_FICTICIO',2,3,repeat('e',64),repeat('f',64),clock_timestamp()-interval '4 minutes'),
 ('d0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000005',90005,'K','RECOGIDA_REAL_TALLER','CONTROLADO_FICTICIO',2,3,repeat('e',64),repeat('f',64),'2026-11-15T22:59:59+00'::timestamptz),
 ('d0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000006',90006,'J','ENTRADA_REAL_TALLER','CONTROLADO_FICTICIO',2,3,repeat('e',64),repeat('f',64),clock_timestamp()-interval '4 minutes'),
 ('d0000000-0000-4000-8000-000000000007','c0000000-0000-4000-8000-000000000007',90007,'K','RECOGIDA_REAL_TALLER','CONTROLADO_FICTICIO',2,3,repeat('1',64),repeat('2',64),clock_timestamp()-interval '4 minutes'),
 ('d0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000007',90008,'K','RECOGIDA_REAL_TALLER','CONTROLADO_FICTICIO',2,3,repeat('3',64),repeat('4',64),clock_timestamp()-interval '4 minutes'),
 ('d0000000-0000-4000-8000-000000000009','c0000000-0000-4000-8000-000000000008',90009,'K','RECOGIDA_REAL_TALLER','CONTROLADO_FICTICIO',2,3,repeat('5',64),repeat('6',64),clock_timestamp()-interval '4 minutes');
INSERT INTO s12_lab.destinos(objeto_id,campo_destino,revision,hash_vigente)
 SELECT i.objeto_id,'fecha_recogida',4,repeat('a',64)
 FROM s12_lab.identidades i WHERE i.id_fila<>90003;
COMMIT;
