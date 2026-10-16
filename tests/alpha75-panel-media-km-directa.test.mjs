import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panel = await readFile('r1-alpha75/src/panel-native-hf23.js', 'utf8');
const hotel = await readFile('r1-alpha75/src/hotel-native.js', 'utf8');
const card = await readFile('r1-alpha75/src/hotel-card.js', 'utf8');
const html = await readFile('r1-alpha75/index.html', 'utf8');

test('Panel marca las paradas sin media para abrir el bloque de km, no edición', () => {
  assert.match(panel, /focusBilling: true/);
  assert.match(panel, /Introducir media km/);
  assert.match(panel, /metrogestion:hotel-billing-focus/);
  assert.match(panel, /openModule\('hotel'\)/);
});

test('Hotel recibe el destino y enfoca Media km día manual', () => {
  assert.match(hotel, /pendingHotelBillingFocus/);
  assert.match(hotel, /metrogestion:hotel-billing-focus/);
  assert.match(hotel, /querySelector\('\[data-alpha75-billing\]'\)/);
  assert.match(hotel, /a66-manual-editor input\[type="number"\]/);
  assert.match(hotel, /scrollIntoView/);
  assert.match(hotel, /input\.focus/);
});

test('cada tarjeta Hotel expone su registro para el salto directo', () => {
  assert.match(card, /recordId: row\.id \|\| ''/);
});

test('hf23 usa Panel físico nuevo y Hotel recargado', () => {
  assert.match(html, /panel-native-hf23\.js/);
  assert.match(html, /hotel-native\.js\?v=75\.23-hf23/);
});
