import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260911133000_alpha74_estado_24h_unificado.sql', import.meta.url),
  'utf8',
);
const hotelUtils = await readFile(
  new URL('../r1-alpha53/src/hotel-utils.js', import.meta.url),
  'utf8',
);

test('el estado general 24H no usa los estados internos de taller', () => {
  assert.match(migration, /new\.estado in \([\s\S]*?'pendiente_repuestos'[\s\S]*?\)/);
  assert.match(migration, /e\.tipo_etapa = 'entrada_taller'[\s\S]*?e\.estado = 'realizada'/);
  assert.match(migration, /new\.estado := 'asistencia_24h'/);
});

test('realizar o reabrir Entrada sincroniza el estado común', () => {
  assert.match(migration, /sincronizar_estado_24h_desde_entrada_alpha74/);
  assert.match(migration, /after insert or delete or update of estado, cancelado, tipo_etapa/);
  assert.match(migration, /set estado = coalesce\(v_estado_taller, 'en_taller'\)/);
  assert.match(migration, /set estado = 'asistencia_24h'/);
});

test('Hotel ofrece el mismo bloque 24H en curso que Panel', () => {
  assert.match(hotelUtils, /asistencia_24h:'24H en curso'/);
  assert.match(hotelUtils, /label:'24H en curso',states:new Set\(\['asistencia_24h'\]\)/);
});
