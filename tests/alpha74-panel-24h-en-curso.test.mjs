import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panel = await readFile(new URL('../r1-alpha74/src/panel-native.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../r1-alpha74/src/app.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../r1-alpha74/index.html', import.meta.url), 'utf8');

test('el Panel distingue 24H en curso de En taller', () => {
  assert.match(panel, /tipo_sustituto,tipo_movimiento,estado/);
  assert.match(panel, /asistencia_24h: '24H en curso'/);
  assert.match(panel, /const assistance24h = hotelRows\.filter\(row => row\.estado === 'asistencia_24h'\)/);
  assert.match(panel, /label: '24H en curso', value: assistance24h\.length/);
});

test('Panel confía en el estado general compartido con Hotel', () => {
  assert.match(panel, /const inWorkshop = hotelRows\.filter\(row => workshopStates\.has\(row\.estado\)\)/);
  assert.doesNotMatch(panel, /enteredWorkshopHotelIds/);
});

test('la versión visible avanza a alpha 74.25', () => {
  assert.match(app, /r1\.0\.0-alpha\.74\.25/);
  assert.match(index, /panel-native\.js\?v=74\.25/);
  assert.match(index, /hotel-native\.js\?v=74\.25/);
});
