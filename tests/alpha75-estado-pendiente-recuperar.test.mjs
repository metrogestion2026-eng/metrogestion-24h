import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260912114000_estado_pendiente_recuperar_sin_recogido.sql', import.meta.url),
  'utf8',
);

test('el catálogo muestra únicamente Pendiente de recuperar', () => {
  assert.match(migration, /where codigo = 'recogido_pendiente_ruta'/);
  assert.match(migration, /set nombre = 'Pendiente de recuperar'/);
  assert.doesNotMatch(migration, /set nombre = 'Recogido/i);
});
