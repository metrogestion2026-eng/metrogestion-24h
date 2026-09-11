import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panel = await readFile(new URL('../r1-alpha74/src/panel-native.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../r1-alpha74/src/app.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../r1-alpha74/index.html', import.meta.url), 'utf8');

test('el Panel distingue 24H en curso de En taller', () => {
  assert.match(panel, /tipo_sustituto,tipo_movimiento,estado/);
  assert.match(panel, /function is24hRecord\(row\)/);
  assert.match(panel, /const assistance24h = hotelRows\.filter/);
  assert.match(panel, /label: '24H en curso', value: assistance24h\.length/);
});

test('una asistencia solo entra en En taller al realizar su T de entrada', () => {
  assert.match(panel, /stage\.tipo_etapa === 'entrada_taller' && stage\.estado === 'realizada'/);
  assert.match(panel, /const inWorkshop = hotelRows\.filter\(row => is24hRecord\(row\)[\s\S]*?enteredWorkshopHotelIds\.has\(row\.id\)/);
});

test('la versión visible avanza a alpha 74.23', () => {
  assert.match(app, /r1\.0\.0-alpha\.74\.23/);
  assert.match(index, /panel-native\.js\?v=74\.23/);
});
