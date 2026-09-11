import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260911114500_alpha74_tipo_t_asistencia_24h.sql', import.meta.url),
  'utf8'
);

test('Asistencia 24H aparece como tipo de T propio', () => {
  assert.match(migration, /values \('24H', 'Asistencia 24H', 5, true\)/);
  assert.match(migration, /set tipo_etapa = '24H'/);
});

test('las activaciones nuevas y existentes quedan clasificadas', () => {
  assert.match(migration, /after insert or update of registro_hotel_id on public\.activaciones_24h/);
  assert.match(migration, /from public\.activaciones_24h a/);
  assert.match(migration, /in \('24H', '24HAVERIA', 'AVERIA24H', 'ASISTENCIA24H'\)/);
});
