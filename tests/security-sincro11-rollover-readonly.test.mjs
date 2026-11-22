import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const full = readFileSync(new URL('../docs/sincro11-auditoria-rollover-20261116.sql', import.meta.url),'utf8');
const sql = full.replace(/--[^\n]*/g,'').trim();

test('auditoría es un único SELECT con CTE sin vías de escritura', () => {
 assert.match(sql, /^WITH\s+dates\s+AS\s*\(/i);
 assert.equal((sql.match(/;/g)||[]).length,1);
 assert.match(sql,/FROM dates;\s*$/);
 assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|EXECUTE|DO|PERFORM|VACUUM|LOCK|SET|COPY)\b/i);
 assert.doesNotMatch(sql,/\b(RETURNING|FOR\s+UPDATE|FOR\s+SHARE|NEXTVAL|Dblink|pg_sleep|set_config)\b/i);
});
test('consulta fechas acotadas: no intenta crear ni archivar Pizarras',()=>{
 assert.match(sql,/DATE '2026-11-15'/);
 assert.match(sql,/DATE '2026-11-16'/);
 assert.match(sql,/public\.pizarras p ON p\.id=r\.pizarra_id JOIN dates d ON p\.fecha=d\.(src|dst)/);
 assert.doesNotMatch(sql,/\bcrear_pizarra_diaria\s*\(/i);
});
test('fichas se casan por seguimiento estable, no por lugar ni DFM',()=>{
 assert.match(sql,/d\.seguimiento_id=s\.seguimiento_id/);
 assert.match(sql,/GROUP BY seguimiento_id HAVING count\(\*\)>1/);
 assert.doesNotMatch(sql,/JOIN\s+dst\s+ON\s+.*vehiculo_sustituido/i);
});
test('etapas se casan por identidad dentro de ficha, no por posición',()=>{
 assert.match(sql,/a\.ficha=b\.ficha AND a\.etapa=b\.etapa/);
 assert.match(sql,/SELECT s\.seguimiento_id AS ficha,e\.seguimiento_id AS etapa/);
 assert.match(sql,/etapas_perdidas/);
 assert.match(sql,/duplicados_etapa/);
});
test('trabajos se comprueban por etapa y no se presumen iguales',()=>{
 assert.match(sql,/public\.trabajos_etapa_hotel/);
 assert.match(sql,/b\.n AS destino_n/);
});
test('altas, retiradas y modificaciones humanas no se tratan como pérdida o corrección automática',()=>{
 assert.match(sql,/WHERE NOT r\.cancelado AND NOT r\.retirado_hotel_activo/);
 assert.match(sql,/FROM dst WHERE retirado_hotel_activo/);
 assert.match(sql,/cambios_nombre_u_orden_observados/);
});
test('2633 queda sujeto a alarma de reactivación; R1515 se consulta sin intervenir',()=>{
 assert.match(sql,/vehiculo_sustituido='2633' AND NOT cancelado AND NOT retirado_hotel_activo/);
 assert.match(sql,/vehiculo_sustituido='R1515'/);
});
test('no usa TANCAMENT, A1, PR ni fecha del hecho para casar identidades',()=>{
 assert.doesNotMatch(sql,/\b(ID_FILA|MANTENIMENT|TANCAMENT|PR-260|PA-260)\b/);
 assert.doesNotMatch(sql,/\b(fila_fisica|numero_fila|row_number)\b/i);
});
