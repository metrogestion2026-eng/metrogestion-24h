import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../sql/sincro12_diagnostico_capacidades_solo_lectura_20261118.sql',import.meta.url),'utf8');
const cleaned=sql.replace(/--[^\n]*/g,'');
test('SINCRO12: un único WITH/SELECT sin SQL dinámico',()=>{
 assert.match(cleaned,/^\s*WITH\s+datos\s+AS/i);
 assert.match(cleaned,/FROM\s+datos\s+CROSS JOIN\s+estructura\s*;\s*$/i);
 assert.equal((cleaned.match(/;/g)||[]).length,1);
});
test('diagnóstico SQL no contiene comandos de escritura',()=>{
 for(const rx of [/\bINSERT\b/i,/\bUPDATE\b/i,/\bDELETE\b/i,/\bMERGE\b/i,/\bTRUNCATE\b/i,
  /\bCREATE\b/i,/\bDROP\b/i,/\bALTER\b/i,/\bGRANT\b/i,/\bREVOKE\b/i,
  /\bEXECUTE\b/i,/\bCALL\b/i,/\bCOPY\b/i,/\bSELECT\s+INTO\b/i])
  assert.doesNotMatch(cleaned,rx);
});
test('consulta solo cuenta estados y capacidades sin divulgar filas',()=>{
 assert.match(cleaned,/count\(\*\)/i);
 assert.doesNotMatch(cleaned,/SELECT\s+id_fila\s*,/i);
 assert.doesNotMatch(cleaned,/SELECT\s+usuario_id\s*,/i);
 assert.doesNotMatch(cleaned,/SELECT\s+permisos\s*,/i);
 assert.doesNotMatch(cleaned,/SELECT\s+valor_nuevo\s*,/i);
});
test('esquemas y tablas corresponden al servidor de pruebas',()=>{
 for(const name of ['app_private.mg9_filas_identidad',
  'app_private.mg9_cambios_recibidos','app_private.mg9_entregas_registradas',
  'app_private.manteniment_t_trabajos','public.usuarios','auth'])
  assert.match(cleaned,new RegExp(name.replace('.','\\.'),'i'));
});
test('muestra el bloqueo de outbox sin T+columna',()=>{
 assert.match(cleaned,/manteniment_parada_outbox/);
 assert.match(cleaned,/column_name IN \('id_fila','columna'\)/);
 assert.match(cleaned,/outbox_identifica_t_y_campo/);
});
test('la lectura no intenta acreditar evento, autor ni nonce',()=>{
 assert.match(cleaned,/false AS evento_manual_real_acreditado/);
 assert.match(cleaned,/false AS vinculo_t_objeto_real_acreditado_por_esta_consulta/);
 assert.match(cleaned,/false AS nonce_consumido_en_transaccion/);
 assert.match(cleaned,/false AS autoriza_sincronizar/);
});
