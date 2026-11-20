import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../docs/sincro11-auditoria-rollover-20261117.sql', import.meta.url),'utf8')
 .replace(/--[^\n]*/g,'').trim();

test('consulta replica solo lectura, una SELECT con CTE acotada 16 a 17',()=>{
 assert.match(sql,/^WITH fechas AS \(/i);
 assert.match(sql,/DATE '2026-11-16'/);
 assert.match(sql,/DATE '2026-11-17'/);
 assert.equal((sql.match(/;/g)||[]).length,1);
 assert.match(sql,/FROM fechas;$/);
 assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|MERGE|GRANT|REVOKE|CALL|EXECUTE|DO|LOCK|COPY|SET|VACUUM|PERFORM|NEXTVAL|FOR UPDATE|FOR SHARE)\b/i);
 assert.doesNotMatch(sql,/app_private\.|set_config\s*\(|\bpg_sleep\b/i);
});
test('coteja ficha por seguimiento persistente y protege 2633 y R1515',()=>{
 assert.match(sql,/s\.seguimiento_id=d\.seguimiento_id/);
 assert.match(sql,/HAVING count\(\*\)>1/);
 assert.match(sql,/vehiculo_sustituido='2633'/);
 assert.match(sql,/vehiculo_sustituido='R1515'/);
});
test('no interpreta orden, DFM, TANCAMENT ni fila fisica como identidad',()=>{
 assert.match(sql,/a\.ficha=b\.ficha AND a\.etapa=b\.etapa/);
 assert.doesNotMatch(sql,/\b(ID_FILA|TANCAMENT|fila_fisica|numero_fila|row_number)\b/i);
});
test('comprueba etapas y trabajos sin atribuir diferencias al clonador',()=>{
 assert.match(sql,/etapas_perdidas/);
 assert.match(sql,/etapas_duplicadas/);
 assert.match(sql,/trabajos_origen/);
 assert.match(sql,/trabajos_destino/);
 assert.match(sql,/etapas_con_recuento_trabajos_distinto/);
});
test('documentos se cotejan por grupo estable, notas por seguimiento',()=>{
 assert.match(sql,/dg\.grupo_etapa_id IN \(SELECT grupo_origen FROM etapas\)/);
 assert.match(sql,/dg\.grupo_etapa_id IN \(SELECT grupo_destino FROM etapas\)/);
 assert.match(sql,/docs_en_grupos_cambiados_origen/);
 assert.match(sql,/n\.seguimiento_id IN \(SELECT seguimiento_id FROM src\)/);
 assert.match(sql,/anotaciones_de_ficha_en_destino/);
});
