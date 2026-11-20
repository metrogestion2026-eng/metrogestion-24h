-- SINCRO 11 / RECEPTOR CAS LABORATORIO 2026-11-17.
-- PELIGRO EVITADO: este fichero SE NIEGA a ejecutar fuera de la BD ficticia sincro11_lab.
-- No instala una función, trigger, RPC ni tabla permanente en Metroges.
-- No usa app_private ni public ni toca Google Sheets. TODAS las tablas son TEMP.
-- Se ejecuta una transacción que se revierte ENTERA con ROLLBACK.
-- Las evidencias aquí SON SINTÉTICAS y no acreditan a ninguna persona real.

BEGIN;
SET LOCAL statement_timeout = '35s';
SET LOCAL lock_timeout = '3s';
DO $verificacion_laboratorio$
BEGIN
  IF current_database() <> 'sincro11_lab' THEN
    RAISE EXCEPTION 'SINCRO11: prohibido ejecutar fuera de la BD ficticia sincro11_lab';
  END IF;
END
$verificacion_laboratorio$;

-- Forma reducida de las tres tablas de STAGING reales, pero SIN sus datos.
CREATE TEMP TABLE s11_identidades (
 spreadsheet_id text NOT NULL, id_fila bigint NOT NULL CHECK (id_fila > 0),
 dfm text NOT NULL, clase text NOT NULL,
 sync_id uuid NOT NULL, trabajo_sync_id uuid,
 estado text NOT NULL, revision bigint NOT NULL CHECK (revision>0),
 vector_sha256 text NOT NULL CHECK (vector_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY (spreadsheet_id,id_fila)
) ON COMMIT DROP;
CREATE TEMP TABLE s11_eventos (
 id uuid PRIMARY KEY, spreadsheet_id text NOT NULL, id_fila bigint NOT NULL,
 columna text NOT NULL CHECK (columna IN ('J','K','I')),
 operacion text NOT NULL CHECK (operacion IN ('ASIGNAR','BORRAR')),
 valor_base date, valor_nuevo date, estado text NOT NULL,
 revision bigint NOT NULL CHECK (revision>0),
 FOREIGN KEY(spreadsheet_id,id_fila) REFERENCES s11_identidades(spreadsheet_id,id_fila),
 CHECK (valor_base IS DISTINCT FROM valor_nuevo),
 CHECK ((operacion='BORRAR' AND valor_nuevo IS NULL) OR (operacion='ASIGNAR' AND valor_nuevo IS NOT NULL))
) ON COMMIT DROP;
CREATE TEMP TABLE s11_entregas (
 request_id uuid PRIMARY KEY, evento_id uuid NOT NULL, payload_sha256 text NOT NULL
   CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
 respuesta jsonb NOT NULL
) ON COMMIT DROP;

-- En producción estas dos estructuras no están implementadas de esta forma.
-- Se simulan para probar una revisión CAS del DESTINO y procedencia externa.
CREATE TEMP TABLE s11_trabajos_destino (
 trabajo_sync_id uuid PRIMARY KEY, revision bigint NOT NULL,
 fecha_realizada date, fecha_recogida date,
 actualizado_por text NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE s11_evidencias_externas_verificadas (
 evento_id uuid PRIMARY KEY, id_fila bigint NOT NULL, columna text NOT NULL,
 trabajo_sync_id uuid NOT NULL, capturada_en timestamptz NOT NULL,
 verificada_en timestamptz NOT NULL, nuevo_valor date,
 agente_de_prueba text NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE s11_outbox_ficticio (
 id uuid PRIMARY KEY, id_fila bigint NOT NULL, columna text NOT NULL,
 revision bigint NOT NULL, estado text NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE s11_auditoria (
 evento_id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
 id_fila bigint NOT NULL, columna text NOT NULL, trabajo_sync_id uuid NOT NULL,
 revision_antes bigint NOT NULL, revision_despues bigint NOT NULL,
 propuestas_obsoletas integer NOT NULL, registrado_en timestamptz NOT NULL DEFAULT clock_timestamp()
) ON COMMIT DROP;

-- SOLO una equivalencia demostrada en LABORATORIO:
-- clase TRABAJO, columna J, significado FECHA_REALIZADA -> fecha_realizada.
-- Las TANCAMENT, NOTAS, I, K, carretera/visita y demás clases SE RETIENEN.
CREATE FUNCTION pg_temp.s11_aplicar_cas_laboratorio(
  p_spreadsheet_id text, p_id_fila bigint, p_evento_id uuid,
  p_request_id uuid, p_payload_sha256 text,
  p_revision_identidad_esperada bigint, p_vector_esperado text,
  p_revision_destino_esperada bigint
) RETURNS jsonb LANGUAGE plpgsql AS $func$
DECLARE
 v_entrega record; v_id record; v_evento record; v_evidencia record; v_destino record;
 v_antiguas integer; v_respuesta jsonb;
BEGIN
 IF current_database() <> 'sincro11_lab' THEN
   RAISE EXCEPTION 'SINCRO11: receptor ficticio no instalable en producción';
 END IF;
 IF p_spreadsheet_id IS DISTINCT FROM 'SINCRO11_LIBRO_FICTICIO'
   OR p_evento_id IS NULL OR p_request_id IS NULL
   OR p_id_fila IS NULL OR p_id_fila<=0
   OR p_revision_identidad_esperada IS NULL OR p_revision_identidad_esperada<=0
   OR p_revision_destino_esperada IS NULL OR p_revision_destino_esperada<=0
   OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
   OR p_vector_esperado IS NULL OR p_vector_esperado !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'SINCRO11: contrato de entrada inválido';
 END IF;

 -- Idempotencia de entrega por request_id; conflicto con hash diferente = error.
 SELECT * INTO v_entrega FROM pg_temp.s11_entregas WHERE request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
   IF v_entrega.payload_sha256 <> p_payload_sha256 OR v_entrega.evento_id <> p_evento_id THEN
     RAISE EXCEPTION 'SINCRO11: request_id reutilizado con otro contenido';
   END IF;
   RETURN v_entrega.respuesta || jsonb_build_object('reintento',true);
 END IF;

 IF EXISTS (SELECT 1 FROM pg_temp.s11_auditoria WHERE evento_id=p_evento_id) THEN
   RAISE EXCEPTION 'SINCRO11: evento ya aplicado; no rejuvenecer ni duplicar';
 END IF;
 SELECT * INTO v_id FROM pg_temp.s11_identidades
  WHERE spreadsheet_id=p_spreadsheet_id AND id_fila=p_id_fila FOR UPDATE;
 IF NOT FOUND OR v_id.estado <> 'ACREDITADA' THEN
   RAISE EXCEPTION 'SINCRO11: identidad T ausente o no acreditada';
 END IF;
 IF v_id.dfm='R1515' THEN
   RAISE EXCEPTION 'SINCRO11: identidad expresamente excluida del operador';
 END IF;
 IF v_id.clase <> 'TRABAJO' OR v_id.trabajo_sync_id IS NULL THEN
   RAISE EXCEPTION 'SINCRO11: clase sin mapeo seguro de destino';
 END IF;
 IF v_id.revision <> p_revision_identidad_esperada
  OR v_id.vector_sha256 <> p_vector_esperado THEN
   RAISE EXCEPTION 'SINCRO11: la revisión manual actual no coincide con la captura';
 END IF;
 SELECT * INTO v_evento FROM pg_temp.s11_eventos
  WHERE id=p_evento_id AND spreadsheet_id=p_spreadsheet_id AND id_fila=p_id_fila FOR UPDATE;
 IF NOT FOUND OR v_evento.estado <> 'PENDIENTE' THEN
   RAISE EXCEPTION 'SINCRO11: cambio fuente no disponible o ya consumido';
 END IF;
 IF v_evento.columna<>'J' THEN
   RAISE EXCEPTION 'SINCRO11: falta equivalencia de campo y significado';
 END IF;
 IF v_evento.revision<>v_id.revision THEN
   RAISE EXCEPTION 'SINCRO11: cambio y vínculo difieren de revisión';
 END IF;
 SELECT * INTO v_evidencia FROM pg_temp.s11_evidencias_externas_verificadas
  WHERE evento_id=p_evento_id FOR UPDATE;
 IF NOT FOUND OR v_evidencia.id_fila<>p_id_fila OR v_evidencia.columna<>'J'
  OR v_evidencia.trabajo_sync_id<>v_id.trabajo_sync_id
  OR v_evidencia.nuevo_valor IS DISTINCT FROM v_evento.valor_nuevo
  OR v_evidencia.capturada_en<'2026-11-15T23:00:00Z'::timestamptz
  OR v_evidencia.verificada_en<v_evidencia.capturada_en
  OR v_evidencia.agente_de_prueba<>'SIMULADO_NO_ES_PERSONA' THEN
   RAISE EXCEPTION 'SINCRO11: evento posterior al corte y origen no acreditados en el laboratorio';
 END IF;
 SELECT * INTO v_destino FROM pg_temp.s11_trabajos_destino
  WHERE trabajo_sync_id=v_id.trabajo_sync_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SINCRO11: objeto destino no existe'; END IF;
 IF v_destino.revision<>p_revision_destino_esperada
  OR v_destino.fecha_realizada IS DISTINCT FROM v_evento.valor_base THEN
   RAISE EXCEPTION 'SINCRO11: CAS rechazado; destino cambió antes de aplicar';
 END IF;

 -- Una sola unidad transaccional: únicamente J -> fecha_realizada, no K.
 UPDATE pg_temp.s11_trabajos_destino
 SET fecha_realizada=v_evento.valor_nuevo, revision=revision+1,
     actualizado_por='CAPTURA_VERIFICADA_SOLO_TEST'
 WHERE trabajo_sync_id=v_id.trabajo_sync_id;
 -- BARRERA IMPORTANTE: nunca emitir ACK de la propuesta anterior.
 UPDATE pg_temp.s11_outbox_ficticio
 SET estado='RETENIDA_OBSOLETA'
 WHERE id_fila=p_id_fila AND columna='J' AND estado='PENDIENTE';
 GET DIAGNOSTICS v_antiguas = ROW_COUNT;
 UPDATE pg_temp.s11_eventos SET estado='APLICADA'
 WHERE id=p_evento_id;
 INSERT INTO pg_temp.s11_auditoria(evento_id,request_id,id_fila,columna,trabajo_sync_id,
  revision_antes,revision_despues,propuestas_obsoletas)
 VALUES(p_evento_id,p_request_id,p_id_fila,'J',v_id.trabajo_sync_id,
  p_revision_destino_esperada,p_revision_destino_esperada+1,v_antiguas);
 v_respuesta=jsonb_build_object('resultado','APLICADA_SOLO_LAB','id_fila',p_id_fila,
  'columna','J','revision_destino',p_revision_destino_esperada+1,
  'propuestas_antiguas_retenidas',v_antiguas,'autoriza_produccion',false);
 INSERT INTO pg_temp.s11_entregas(request_id,evento_id,payload_sha256,respuesta)
 VALUES(p_request_id,p_evento_id,p_payload_sha256,v_respuesta);
 RETURN v_respuesta;
END;
$func$;

-- Fixture sintética. Fila ID 90001 no corresponde a ningún camión real.
INSERT INTO s11_identidades VALUES(
 'SINCRO11_LIBRO_FICTICIO',90001,'TEST-DFM','TRABAJO',
 '11111111-1111-4111-8111-111111111111'::uuid,
 '22222222-2222-4222-8222-222222222222'::uuid,
 'ACREDITADA',4,repeat('a',64));
INSERT INTO s11_trabajos_destino VALUES(
 '22222222-2222-4222-8222-222222222222'::uuid,7,
 '2024-09-18'::date,'2024-09-21'::date,'TEST_ORIGINAL');
INSERT INTO s11_eventos VALUES(
 '33333333-3333-4333-8333-333333333333'::uuid,
 'SINCRO11_LIBRO_FICTICIO',90001,'J','ASIGNAR',
 '2024-09-18'::date,'2024-09-19'::date,'PENDIENTE',4);
INSERT INTO s11_evidencias_externas_verificadas VALUES(
 '33333333-3333-4333-8333-333333333333'::uuid,90001,'J',
 '22222222-2222-4222-8222-222222222222'::uuid,
 '2026-11-17T05:10:00Z'::timestamptz,
 '2026-11-17T05:11:00Z'::timestamptz,
 '2024-09-19'::date,'SIMULADO_NO_ES_PERSONA');
INSERT INTO s11_outbox_ficticio VALUES
 ('44444444-4444-4444-8444-444444444444',90001,'J',6,'PENDIENTE'),
 ('55555555-5555-4555-8555-555555555555',90001,'K',6,'PENDIENTE');

-- Las pruebas se ejecutan en DO; si una fallara, ON_ERROR_STOP detiene psql.
DO $tests$
DECLARE r jsonb; n integer; v date; rv bigint; o text; st text;
BEGIN
  r:=pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90001,
   '33333333-3333-4333-8333-333333333333'::uuid,
   '66666666-6666-4666-8666-666666666666'::uuid,repeat('b',64),4,repeat('a',64),7);
  IF r->>'resultado'<>'APLICADA_SOLO_LAB' OR r->>'autoriza_produccion'<>'false' THEN
   RAISE EXCEPTION 'TEST FAIL: aplicación J no confirmada'; END IF;
  SELECT fecha_recogida,revision INTO v,rv FROM s11_trabajos_destino;
  IF v<>'2024-09-21'::date OR rv<>8 THEN
   RAISE EXCEPTION 'TEST FAIL: cambió K o versión incorrecta'; END IF;
  SELECT fecha_realizada INTO v FROM s11_trabajos_destino;
  IF v<>'2024-09-19'::date THEN RAISE EXCEPTION 'TEST FAIL: J no volvió a Metroges test'; END IF;
  SELECT estado INTO o FROM s11_outbox_ficticio WHERE columna='J';
  SELECT estado INTO st FROM s11_outbox_ficticio WHERE columna='K';
  IF o<>'RETENIDA_OBSOLETA' OR st<>'PENDIENTE' THEN
   RAISE EXCEPTION 'TEST FAIL: outbox obsoleto o campo independiente'; END IF;
  SELECT estado INTO st FROM s11_eventos LIMIT 1;
  IF st<>'APLICADA' THEN RAISE EXCEPTION 'TEST FAIL: evento no marcado'; END IF;
  SELECT count(*) INTO n FROM s11_auditoria;
  IF n<>1 THEN RAISE EXCEPTION 'TEST FAIL: falta auditoría'; END IF;

  -- Mismo request, mismos bytes => recibo idempotente, no segunda edición.
  r:=pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90001,
   '33333333-3333-4333-8333-333333333333'::uuid,
   '66666666-6666-4666-8666-666666666666'::uuid,repeat('b',64),4,repeat('a',64),7);
  IF r->>'reintento'<>'true' THEN RAISE EXCEPTION 'TEST FAIL: idempotencia'; END IF;
  SELECT count(*) INTO n FROM s11_auditoria;
  IF n<>1 THEN RAISE EXCEPTION 'TEST FAIL: duplicó auditoría'; END IF;

  -- Request antiguo con payload alterado: rechazo, sin cambios ni ACK.
  BEGIN
   PERFORM pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90001,
    '33333333-3333-4333-8333-333333333333'::uuid,
    '66666666-6666-4666-8666-666666666666'::uuid,repeat('c',64),4,repeat('a',64),7);
   RAISE EXCEPTION 'TEST FAIL: se aceptó replay con payload distinto';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'SINCRO11: request_id reutilizado%' THEN RAISE; END IF;
  END;

  -- Otro request para evento ya consumido: no rejuvenecer.
  BEGIN
   PERFORM pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90001,
    '33333333-3333-4333-8333-333333333333'::uuid,
    '77777777-7777-4777-8777-777777777777'::uuid,repeat('b',64),4,repeat('a',64),8);
   RAISE EXCEPTION 'TEST FAIL: se aceptó el evento otra vez';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'SINCRO11: evento ya aplicado%' THEN RAISE; END IF;
  END;

  -- ID_FILA no existente nunca se resuelve por PA/DFM/fila física.
  BEGIN
   PERFORM pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90002,
    '88888888-8888-4888-8888-888888888888'::uuid,
    '99999999-9999-4999-8999-999999999999'::uuid,repeat('b',64),4,repeat('a',64),8);
   RAISE EXCEPTION 'TEST FAIL: ID_FILA ausente aceptada';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'SINCRO11: identidad T ausente%' THEN RAISE; END IF;
  END;

  -- Dos sesiones / dos cambios simultáneos requieren prueba adicional.
  -- Aquí sí se comprueba CAS por revisión de destino y estado del origen.
  INSERT INTO s11_eventos VALUES(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
   'SINCRO11_LIBRO_FICTICIO',90001,'J','ASIGNAR',
   '2024-09-19'::date,'2024-09-20'::date,'PENDIENTE',4);
  INSERT INTO s11_evidencias_externas_verificadas VALUES(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,90001,'J',
   '22222222-2222-4222-8222-222222222222'::uuid,
   '2026-11-17T05:12:00Z','2026-11-17T05:13:00Z',
   '2024-09-20'::date,'SIMULADO_NO_ES_PERSONA');
  BEGIN
   PERFORM pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90001,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,repeat('d',64),4,repeat('a',64),7);
   RAISE EXCEPTION 'TEST FAIL: CAS destino viejo aceptado';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'SINCRO11: CAS rechazado%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n FROM s11_entregas;
  IF n<>1 THEN RAISE EXCEPTION 'TEST FAIL: recibió evento rechazado'; END IF;

  -- Sin equivalencia para clase TANCAMENT o campo K -> retener.
  UPDATE s11_identidades SET clase='TANCAMENT' WHERE id_fila=90001;
  BEGIN
   PERFORM pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90001,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,repeat('d',64),4,repeat('a',64),8);
   RAISE EXCEPTION 'TEST FAIL: TANCAMENT se mapeó como TRABAJO';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'SINCRO11: clase sin mapeo%' THEN RAISE; END IF;
  END;
  UPDATE s11_identidades SET clase='TRABAJO',dfm='R1515' WHERE id_fila=90001;
  BEGIN
   PERFORM pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90001,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,repeat('d',64),4,repeat('a',64),8);
   RAISE EXCEPTION 'TEST FAIL: exclusión R1515 ignorada';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'SINCRO11: identidad expresamente excluida%' THEN RAISE; END IF;
  END;
  UPDATE s11_identidades SET dfm='TEST-DFM' WHERE id_fila=90001;

  -- Edición de hoja posterior al evento fuente: origen CAS no coincide.
  UPDATE s11_identidades SET revision=revision+1 WHERE id_fila=90001;
  BEGIN
   PERFORM pg_temp.s11_aplicar_cas_laboratorio('SINCRO11_LIBRO_FICTICIO',90001,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,repeat('d',64),4,repeat('a',64),8);
   RAISE EXCEPTION 'TEST FAIL: se ignoró una corrección manual posterior';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'SINCRO11: la revisión manual actual%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n FROM s11_auditoria;
  IF n<>1 THEN RAISE EXCEPTION 'TEST FAIL: se registró un intento fallido'; END IF;
  SELECT fecha_realizada INTO v FROM s11_trabajos_destino;
  IF v<>'2024-09-19'::date THEN RAISE EXCEPTION 'TEST FAIL: cambió J tras fallo'; END IF;

  RAISE NOTICE 'SINCRO 11 CAS SOLO LAB: 11 comprobaciones; 1 aplicación ficticia; reintentos, CAS y conflictos protegidos';
END
$tests$;

-- CERO datos de producción; incluso las tablas TEMP y función desaparecen.
ROLLBACK;