import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../sql/sincro11_concurrencia_setup_20261117.sql',import.meta.url),'utf8');
const teardown = readFileSync(new URL('../sql/sincro11_concurrencia_teardown_20261117.sql',import.meta.url),'utf8');
const workflow = readFileSync(new URL('../.github/workflows/sincro11-cas-laboratorio.yml',import.meta.url),'utf8');
test('SQL niega ejecutar fuera de base ficticia antes de crear schema',()=>{
 assert.match(source,/BEGIN;[\s\S]*current_database\(\) <> 'sincro11_lab'[\s\S]*CREATE SCHEMA s11_ci/);
 assert.match(source,/RAISE EXCEPTION 'SINCRO11-LAB: BD distinta/);
 assert.match(teardown,/current_database\(\)<>'sincro11_lab'/);
});
test('el experimento usa esquema autónomo, ninguna tabla real ni conector',()=>{
 for(const expr of [/\bapp_private\./i,/\bpublic\.(?!\s*\))/,/\bUrlFetchApp\b/,/https?:\/\//,/fetch\(/])assert.doesNotMatch(source,expr);
 assert.match(source,/CREATE SCHEMA s11_ci/);
 assert.match(source,/REVOKE ALL ON SCHEMA s11_ci FROM PUBLIC/);
});
test('ID_FILA identifica T y nunca PA, DFM ni posición física',()=>{
 assert.match(source,/id_fila bigint PRIMARY KEY/);
 assert.match(source,/PRIMARY KEY \(id_fila,columna\)/);
 assert.match(source,/WHERE id_fila=p_id_fila AND columna=p_columna/);
 assert.doesNotMatch(source,/WHERE[^\n]*\bdfm\b/i);
});
test('campo J y K usan mapeos semánticos diferentes',()=>{
 assert.match(source,/p_columna='J'[\s\S]*FECHA_REALIZADA/);
 assert.match(source,/p_columna='K'[\s\S]*FECHA_RECOGIDA/);
 assert.match(source,/IF v_i.clase <> 'TRABAJO' THEN RAISE EXCEPTION 'S11_CI_CLASE_SIN_MAPEO'/);
});
test('CAS bloquea escritura si cambia revisión/valor vigente',()=>{
 assert.match(source,/FOR UPDATE/);
 assert.match(source,/v_dst.revision<>p_revision_destino/);
 assert.match(source,/v_dst.valor IS DISTINCT FROM v_evt.valor_base/);
 assert.match(source,/v_i.revision_hoja <> p_revision_hoja/);
});
test('propuesta obsoleta se retiene solo mismo campo e identidad',()=>{
 assert.match(source,/WHERE id_fila=p_id_fila AND columna=p_columna AND estado='PENDIENTE'/);
 assert.match(source,/AND revision_destino<=p_revision_destino/);
 assert.match(source,/INSERT INTO s11_ci.auditoria/);
 assert.match(source,/INSERT INTO s11_ci.recibos/);
});
test('mismas peticiones son idempotentes, no abren permiso prod',()=>{
 assert.match(source,/SELECT \* INTO v_rec FROM s11_ci.recibos WHERE request_id=p_request_id FOR UPDATE/);
 assert.match(source,/S11_CI_REINTENTO_PAYLOAD_DISTINTO/);
 assert.match(source,/FICCION_NO_ACREDITA_HUMANO/);
 assert.match(source,/'permiso_produccion',false/);
});
test('workflow PG17 usa servicio ficticio, limpia con trap y no emplea secretos',()=>{
 assert.match(workflow,/image: postgres:17/);
 assert.match(workflow,/POSTGRES_DB: sincro11_lab/);
 assert.match(workflow,/test "\$\(psql -X -Atc 'SELECT current_database\(\)'\)" = 'sincro11_lab'/);
 assert.match(workflow,/trap cleanup EXIT/);
 assert.match(workflow,/sql\/sincro11_concurrencia_teardown_20261117.sql/);
 assert.doesNotMatch(workflow,/supabase\/|service_role|secrets\./i);
});