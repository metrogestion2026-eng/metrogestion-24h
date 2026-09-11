import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const hotel = await readFile('r1-alpha75/src/hotel-native.js', 'utf8');

test('Alpha75 añade el filtro de sustituciones momentáneas sin modificar el catálogo compartido', () => {
  assert.match(hotel, /HOTEL_FILTERS as BASE_HOTEL_FILTERS/);
  assert.match(hotel, /key:\s*'momentary-substitutions'/);
  assert.match(hotel, /label:\s*'Sustituciones momentáneas'/);
  assert.match(hotel, /states:\s*new Set\(\['sustitucion_momentanea'\]\)/);
});

test('el contador y la visibilidad usan el estado operativo unificado', () => {
  assert.match(hotel, /rows\.filter\(row => filter\.states\.has\(row\.estado\)\)\.length/);
  assert.match(hotel, /selected\.states\.has\(card\.dataset\.state \|\| ''\)/);
  assert.match(hotel, /data-hotel-filter="momentary-substitutions"/);
});
