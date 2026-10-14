import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20261014114000_alpha75_solo_gestion_tramite_sin_recuperacion.sql',
  'utf8'
);

test('GESTIÓN/TRÁMITE solitarios se detectan por las T reales y no por su origen', () => {
  assert.match(migration, /from public\.etapas_hotel e/);
  assert.match(migration, /not in \('gestion', 'tramite'\)/);
  assert.match(migration, /v_total_operativas > 0 and v_no_administrativas = 0/);
});

test('24H mantiene explícitamente el flujo de recuperación', () => {
  assert.match(migration, /if v_tipo_movimiento = '24H' then/);
  assert.match(migration, /return true/);
});

test('las recuperaciones indebidas se anulan, no se borran', () => {
  assert.match(migration, /update public\.etapas_hotel recovery/);
  assert.match(migration, /estado = 'anulada'/);
  assert.match(migration, /GESTIÓN\/TRÁMITE solitario: no corresponde recuperación de tractora\/ruta/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.etapas_hotel/i);
});
