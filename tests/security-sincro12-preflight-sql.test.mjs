import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../sql/sincro12_preflight_puente_t_solo_lectura_20261117.sql',import.meta.url),'utf8');
const clean=sql.replace(/--[^\n]*/g,'');
test('preflight S12 es una sola consulta WITH/SELECT',()=>{
 assert.match(clean,/^\s*WITH\s+t_registradas\s+AS/i);
 assert.match(clean,/\)\s*SELECT[\s\S]+FROM\s+resumen\s*;\s*$/i);
});
test('sin sentencias mutadoras ni SQL dinámico',()=>{
 for(const rx of [/\bINSERT\b/i,/\bUPDATE\b/i,/\bDELETE\b/i,/\bUPSERT\b/i,/\bMERGE\b/i,/\bTRUNCATE\b/i,
 /\bCREATE\b/i,/\bALTER\b/i,/\bDROP\b/i,/\bGRANT\b/i,/\bREVOKE\b/i,/\bEXECUTE\b/i,
 /\bPERFORM\b/i,/\bCALL\b/i,/\bCOPY\b/i,/\bSELECT\s+INTO\b/i])assert.doesNotMatch(clean,rx);
});
test('identidad T canónica por staging, no por fila física',()=>{
 assert.match(clean,/f\.id_fila/);
 assert.match(clean,/ON\s+t\.sync_id\s*=\s*f\.trabajo_sync_id/i);
 assert.doesNotMatch(clean,/fila_manteniment/i);
});
test('trabajo de mantenimiento a trabajo de Hotel, por ID exacta',()=>{
 assert.match(clean,/LEFT JOIN\s+public\.trabajos_etapa_hotel/i);
 assert.match(clean,/ON\s+h\.id\s*=\s*t\.trabajo_hotel_id/i);
});
test('sin DFM, PA, número de fila, posición ni nota como llave',()=>{
 for(const rx of [/\bf\.dfm\b/i,/\bf\.pa\b/i,/\bnumero_fila\b/i,/\bposicion\b/i,/\bonEdit\b/i,/\bnota_uuid\b/i])
  assert.doesNotMatch(clean,rx);
});
test('no declara sincronización autorizada por staging',()=>{
 assert.match(clean,/false\s+AS\s+autoriza_sincronizar/i);
 assert.match(clean,/SOLO_DIAGNOSTICO_PUENTE_T_NO_EVENTO_HUMANO/);
 assert.match(clean,/candidatos_esquema_no_autorizados/);
});
test('SELECT * únicamente del resumen agregado, nunca de filas de T',()=>{
 assert.equal((clean.match(/SELECT\s+\*/gi)||[]).length,1);
 assert.match(clean,/SELECT\s+\*,[\s\S]+FROM\s+resumen\s*;/i);
});
