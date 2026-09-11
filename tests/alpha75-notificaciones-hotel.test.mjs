import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const hotel = await readFile('r1-alpha75/src/hotel-native.js', 'utf8');
const card = await readFile('r1-alpha75/src/hotel-card.js', 'utf8');
const panel = await readFile('r1-alpha75/src/panel-native.js', 'utf8');

test('cada ficha de Hotel oculta sus notificaciones por defecto y tiene su propio botón', () => {
  assert.match(card, /chronology\.hidden = true/);
  assert.match(card, /className: 'button secondary compact a75-card-notifications-toggle'/);
  assert.match(card, /text: 'Desplegar notificaciones'/);
  assert.match(card, /chronology\.hidden = !chronology\.hidden/);
  assert.match(card, /: 'Ocultar notificaciones'/);
  assert.match(card, /'aria-expanded'/);
  assert.doesNotMatch(hotel, /a75-notifications-toggle|notificationsExpanded/);
});

test('el control de notificaciones pertenece solo a Hotel', () => {
  assert.doesNotMatch(panel, /Desplegar notificaciones|Ocultar notificaciones|notificationsExpanded/);
});
