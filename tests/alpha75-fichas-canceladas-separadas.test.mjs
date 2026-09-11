import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('r1-alpha75/src/hotel-native.js', 'utf8');

test('la edición normal mantiene las fichas canceladas fuera de la lista activa', () => {
  assert.match(source, /supabase\.from\('hotel_actual_detalle'\)/);
  assert.match(source, /text: 'Acceder a fichas canceladas'/);
  assert.match(source, /cancelledButton\.hidden = !editMode/);
});

test('las fichas canceladas se cargan aparte y se pueden editar o restaurar', () => {
  assert.match(source, /async function openCancelledCardsDialog\(boardId, access, container\)/);
  assert.match(source, /\.from\('hotel_por_dia'\)/);
  assert.match(source, /\.eq\('pizarra_id', boardId\)/);
  assert.match(source, /\.eq\('cancelado', true\)/);
  assert.match(source, /text: 'Editar o restaurar ficha'/);
  assert.match(source, /openHotelEditor\(row\.id/);
});
