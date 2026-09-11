import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const hotel = await readFile('r1-alpha75/src/hotel-native.js', 'utf8');
const panel = await readFile('r1-alpha75/src/panel-native.js', 'utf8');

const expectedHotelTones = [
  ["all", "main"],
  ["planned", "yellow"],
  ["pending-workshop", "neutral"],
  ["procedures", "neutral"],
  ["management", "neutral"],
  ["assistance-24h", "neutral"],
  ["workshop", "lilac"],
  ["pickup", "blue"],
  ["recover", "orange"],
  ["momentary-substitutions", "brown"],
];

test('Hotel asigna a cada filtro el color de su estado operativo', () => {
  for (const [key, tone] of expectedHotelTones) {
    const pattern = new RegExp(`(?:'${key}'|${key}):\\s*'${tone}'`);
    assert.match(hotel, pattern, `${key} debe usar ${tone}`);
  }
  assert.match(hotel, /node\.dataset\.hotelTone = HOTEL_FILTER_TONES\[filter\.key\]/);
  for (const tone of ['main', 'yellow', 'neutral', 'lilac', 'blue', 'orange', 'brown']) {
    assert.match(hotel, new RegExp(`data-hotel-tone=\\"${tone}\\"`));
  }
});

test('Panel conserva exactamente la misma correspondencia visual', () => {
  const expectedPanel = [
    ['Fichas activas', 'main'],
    ['Pendientes de parar', 'yellow'],
    ['Pendientes de taller', 'neutral'],
    ['Trámites', 'neutral'],
    ['Gestiones', 'neutral'],
    ['24H en curso', 'neutral'],
    ['Sustituciones momentáneas', 'brown'],
    ['En taller', 'lilac'],
    ['Pendientes de recoger', 'blue'],
    ['Pendientes de recuperar', 'orange'],
  ];
  for (const [label, tone] of expectedPanel) {
    assert.match(panel, new RegExp(`label: '${label}',[^\\n]*tone: '${tone}'`), `${label} debe usar ${tone}`);
  }
});
