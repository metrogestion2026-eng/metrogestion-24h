import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../sql/sincro11_receptor_cas_laboratorio_20261117.sql',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/sincro11-cas-laboratorio.yml',import.meta.url),'utf8');
// Eliminar comentarios antes de comprobar nombres y sentencias ejecutables.
const code=sql.replace(/--[^\n]*/g,'');

test('la SQL niega por nombre cualquier base distinta de sincro11_lab',()=>{
  assert.match(code,/current_database\(\) <> 'sincro11_lab'/);
  assert.match(workflow,/POSTGRES_DB: sincro11_lab/);
  assert.match(workflow,/PGHOST: 127\.0\.0\.1/);
  assert.match(workflow,/PGDATABASE: sincro11_lab/);
  assert.doesNotMatch(workflow,/supabase\.co|aemoouldgguyjsxrfuwo|secrets\./);
});
test('transaccion reversible obligatoria de principio a fin',()=>{
  assert.match(code,/^\s*BEGIN\s*;/m);
  assert.match(code,/ROLLBACK\s*;\s*$/);
  assert.match(workflow,/grep -q '\^ROLLBACK\$'/);
});
test('solo tablas TEMP y funcion de pg_temp, sin objetos permanentes',()=>{
  assert.equal((code.match(/CREATE TEMP TABLE\s+s11_/g)||[]).length,7);
  assert.match(code,/CREATE FUNCTION pg_temp\.s11_aplicar_cas_laboratorio\(/);
  assert.doesNotMatch(code,/CREATE (?:SCHEMA|EXTENSION|TABLE|MATERIALIZED VIEW|TRIGGER)\b/);
  assert.doesNotMatch(code.replace(/ON COMMIT DROP/g,''),/\b(?:ALTER|DROP|GRANT|REVOKE|SECURITY DEFINER|TRUNCATE|DELETE FROM)\b/i);
});
test('no hay operaciones sobre app_private, public o infraestructura exterior',()=>{
  assert.doesNotMatch(code, /\b(?:app_private|public|auth|storage)\s*\./i);
  assert.doesNotMatch(sql,/1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU|aemoouldgguyjsxrfuwo/);
  assert.doesNotMatch(code,/https?:\/\/|dblink|COPY\s+|pg_read_file/i);
  assert.match(workflow,/permissions:\s*\n\s*contents: read/);
});
test('identidad y precedencia: T, revision y vector, nunca PA ni fila fisica',()=>{
  assert.match(code,/PRIMARY KEY \(spreadsheet_id,id_fila\)/);
  assert.match(code,/v_id\.revision <> p_revision_identidad_esperada/);
  assert.match(code,/v_id\.vector_sha256 <> p_vector_esperado/);
  assert.doesNotMatch(code,/WHERE\s+pa\s*=|WHERE\s+dfm\s*=/i);
  assert.match(code,/v_id\.dfm='R1515'/);
});
test('CAS del destino impide reintentos obsoletos',()=>{
  assert.match(code,/FOR UPDATE/);
  assert.match(code,/v_destino\.revision<>p_revision_destino_esperada/);
  assert.match(code,/v_destino\.fecha_realizada IS DISTINCT FROM v_evento\.valor_base/);
  assert.match(code,/request_id reutilizado con otro contenido/);
  assert.match(code,/evento ya aplicado; no rejuvenecer ni duplicar/);
});
test('una unica transaccion incluye correccion, outbox, auditoria y acuse',()=>{
  assert.match(code,/UPDATE pg_temp\.s11_trabajos_destino/);
  assert.match(code,/SET fecha_realizada=v_evento\.valor_nuevo/);
  assert.match(code,/UPDATE pg_temp\.s11_outbox_ficticio/);
  assert.match(code,/estado='RETENIDA_OBSOLETA'/);
  assert.match(code,/INSERT INTO pg_temp\.s11_auditoria/);
  assert.match(code,/INSERT INTO pg_temp\.s11_entregas/);
  assert.match(code,/AND columna='J' AND estado='PENDIENTE'/);
});
test('el mapa de clases es conservador, no aplica facturacion ni notas por deduccion',()=>{
  assert.match(code,/v_id\.clase <> 'TRABAJO'/);
  assert.match(code,/v_evento\.columna<>'J'/);
  assert.match(code,/capturada_en<'2026-11-15T23:00:00Z'/);
  assert.match(code,/SIMULADO_NO_ES_PERSONA/);
  assert.match(code,/autoriza_produccion',false/);
});