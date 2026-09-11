import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260911113000_alpha74_evitar_t_infinitas_2523.sql', import.meta.url),
  'utf8'
);

test('una visita que recibe taller fija sus grupos de entrada y recogida una sola vez', () => {
  assert.match(migration, /coalesce\(grupo_entrada_id, v_legacy_entry_group, gen_random_uuid\(\)\)/);
  assert.match(migration, /coalesce\(grupo_recogida_id, v_legacy_pickup_group, gen_random_uuid\(\)\)/);
  assert.match(migration, /order by e\.posicion, e\.creado_en, e\.id/);
});

test('la reparación de 2600137 conserva una entrada, su recogida y recuperación', () => {
  assert.match(migration, /numero_parada\)\), '\^PA\[- \]\*', ''\) = '2600137'/);
  assert.match(migration, /create temp table tmp_alpha74_2523_etapas_eliminar/);
  assert.match(migration, /delete from public\.etapas_hotel e/);
  assert.match(migration, /delete from public\.auditoria_cambios a/);
  assert.doesNotMatch(migration, /Corrección automática: T duplicada/);
});

test('ACT queda como trabajo de Entrada ODEXAN y mantiene su vínculo', () => {
  assert.match(migration, /set etapa_hotel_id = c\.entrada_id/);
  assert.match(migration, /clave_visita = 'TALLER\|F:ODEXAN'/);
  assert.match(migration, /clave_trabajo = 'F:ODEXAN\|H:ACT'/);
  assert.match(migration, /trabajo_hotel_id = j\.trabajo_hotel_id/);
});
