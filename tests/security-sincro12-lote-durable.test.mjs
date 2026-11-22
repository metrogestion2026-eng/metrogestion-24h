import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../sql/sincro12_lote_durable_setup_20261118.sql',import.meta.url),'utf8');
const teardown=readFileSync(new URL('../sql/sincro12_lote_durable_teardown_20261118.sql',import.meta.url),'utf8');
const pg=readFileSync(new URL('./integration-sincro12-lote-durable.pg.test.mjs',import.meta.url),'utf8');
test('el SQL se niega a instalar fuera de la BD aislada sincro11_lab',()=>{
 assert.match(sql,/current_database\(\)\s*<>\s*'sincro11_lab'/);
 assert.match(teardown,/current_database\(\)\s*<>\s*'sincro11_lab'/);
 assert.match(pg,/process\.env\.PGDATABASE,'sincro11_lab'/);
 assert.match(pg,/process\.env\.PGUSER,'laboratorio'/);
});
test('solo crea objetos s12_lab sin tocar los esquemas de Metroges',()=>{
 assert.match(sql,/CREATE SCHEMA s12_lab;/);
 for(const word of [/CREATE TABLE (?:public|app_private)\./i,
  /UPDATE (?:public|app_private)\./i,/DELETE FROM (?:public|app_private)\./i,
  /INSERT INTO (?:public|app_private)\./i,/DROP SCHEMA (?:public|app_private)/i,
  /GRANT .+ TO (?:anon|authenticated|public)/i])
  assert.doesNotMatch(sql,word);
 assert.match(teardown,/DROP SCHEMA s12_lab CASCADE;/);
});
test('reutilización concurrente de request se reconsulta tras bloquear lote',()=>{
 const text=sql.slice(sql.indexOf('CREATE FUNCTION s12_lab.confirmar_lote_ficticio('));
 assert.match(text,/SELECT \* INTO v_lote FROM s12_lab\.lotes WHERE lote_id=p_lote FOR UPDATE;/);
 assert.equal((text.match(/SELECT \* INTO v_rec FROM s12_lab\.recibos_inmutables WHERE request_id=p_request;/g)||[]).length,2);
 assert.match(text,/S12_REPLAY_PAYLOAD_DISTINTO/);
});
test('nonce único, hash por lote y recibos inmutables en BD',()=>{
 assert.match(sql,/nonce uuid NOT NULL UNIQUE/);
 assert.match(sql,/CREATE TRIGGER s12_recibo_no_update_delete/);
 assert.match(sql,/sha256\(convert_to\(v_json::text,'UTF8'\)\)/);
 assert.match(sql,/UNIQUE\(lote_id,id_fila,columna\)/);
 assert.match(sql,/UNIQUE\(id_fila,columna,revision_nueva\)/);
});
test('la sesión ficticia no suplanta la autenticación de persona real',()=>{
 assert.match(sql,/sesiones_ficticias/);
 assert.match(sql,/segundo_factor_simulado/);
 assert.match(sql,/permiso_produccion',false/);
 assert.match(sql,/autor_edicion_hoja_acreditado',false/);
});
test('retiene cambio antiguo, exclusión y clase sin mapa',()=>{
 assert.match(sql,/S12_LOTE_ANTES_DEL_CORTE/);
 assert.match(sql,/S12_EVENTO_O_VINCULO_NO_ACREDITADO_LAB/);
 assert.match(sql,/i\.excluida/);
 assert.match(sql,/e\.columna<>'K'/);
 assert.match(sql,/v\.campo_destino<>'fecha_recogida'/);
});
test('lectura posterior por T y campo no escribe el destino',()=>{
 const func=sql.slice(sql.indexOf('CREATE FUNCTION s12_lab.candidatos_del_lote_ficticio('),
 sql.indexOf('-- Fixtures inventadas'));
 assert.match(func,/h\.leido_en<l\.aprobado_en/);
 assert.match(func,/h\.hash_vigente<>e\.hash_nuevo/);
 assert.match(func,/false::boolean AS autoriza_sincronizar/);
 for(const word of [/\bUPDATE\b/i,/\bINSERT\b/i,/\bDELETE\b/i])assert.doesNotMatch(func,word);
});
test('dos sesiones PostgreSQL y los datos ficticios no son pruebas sobre la hoja',()=>{
 assert.match(pg,/pg_advisory_xact_lock/);
 assert.match(pg,/Dos sesiones|dos conexiones/);
 assert.match(sql,/LIBRO_FICTICIO/);
 assert.doesNotMatch(sql,/1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU/);
});
test('encabezado confirmado se bloquea para cualquier mutación posterior',()=>{
 assert.match(sql,/CREATE TRIGGER s12_no_mutar_lotes_confirmados/);
 assert.match(sql,/S12_LOTE_CONFIRMADO_INMUTABLE/);
 assert.match(sql,/S12_LOTE_NO_NACE_CONFIRMADO/);
});
test('el CAS requiere revisión y huella de origen y destino exactas',()=>{
 assert.match(sql,/revision_destino_base bigint NOT NULL/);
 assert.match(sql,/hash_destino_base text NOT NULL/);
 assert.match(sql,/h\.revision<>e\.revision_nueva/);
 assert.match(sql,/d\.revision<>e\.revision_destino_base/);
 assert.match(sql,/d\.hash_vigente<>e\.hash_destino_base/);
 assert.match(sql,/S12_DESTINO_OBSOLETO_AL_SELLAR/);
});
