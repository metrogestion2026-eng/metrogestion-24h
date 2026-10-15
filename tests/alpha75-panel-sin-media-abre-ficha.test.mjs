import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panel = await readFile('r1-alpha75/src/panel-native.js', 'utf8');
const html = await readFile('r1-alpha75/index.html', 'utf8');

test('las paradas sin media enlazan con la ficha Hotel concreta', () => {
  assert.match(panel, /hotel_actual_detalle'\)\.select\('id,seguimiento_id,numero_parada/);
  assert.match(panel, /const hotelByTracking = new Map/);
  assert.match(panel, /const missingMediaItem = row =>/);
  assert.match(panel, /module: 'hotel'/);
  assert.match(panel, /recordId: hotel\?\.id \|\| null/);
  assert.match(panel, /Abrir ficha del vehículo/);
});

test('el botón superior usa el registro concreto cuando solo hay una parada', () => {
  assert.match(panel, /recordId: missingMedia\.length === 1 \? missingMediaItem\(missingMedia\[0\]\)\.recordId : null/);
  assert.match(panel, /moduleButton\.addEventListener\('click', \(\) => activatePanelItem\(spec, spec\)\)/);
});

test('el bloque sin media ya no remite a Listados', () => {
  const start = panel.indexOf("{ label: 'Sin media km'");
  const end = panel.indexOf("];", start);
  const block = panel.slice(start, end);
  assert.match(block, /module: 'hotel'/);
  assert.doesNotMatch(block, /module: 'listados'/);
  assert.doesNotMatch(block, /Abrir Listados/);
});

test('hf17 fuerza la recarga del Panel corregido', () => {
  assert.match(html, /panel-native\.js\?v=75\.23-hf17/);
});
