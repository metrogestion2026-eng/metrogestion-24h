import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const hotel = await readFile('r1-alpha75/src/hotel-native.js', 'utf8');
const panel = await readFile('r1-alpha75/src/panel-native.js', 'utf8');

test('Hotel oculta las notificaciones por defecto y permite desplegarlas', () => {
  assert.match(hotel, /notificationsExpanded: false/);
  assert.match(hotel, /text: 'Desplegar notificaciones'/);
  assert.match(hotel, /chronology\.hidden = !hotelViewState\.notificationsExpanded/);
  assert.match(hotel, /\? 'Ocultar notificaciones'/);
  assert.match(hotel, /'aria-expanded'/);
});

test('el control de notificaciones pertenece solo a Hotel', () => {
  assert.doesNotMatch(panel, /Desplegar notificaciones|Ocultar notificaciones|notificationsExpanded/);
});
