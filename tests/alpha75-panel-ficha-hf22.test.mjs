import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panel = await readFile('r1-alpha75/src/panel-native-hf22.js', 'utf8');
const html = await readFile('r1-alpha75/index.html', 'utf8');

test('cada parada sin media abre su ficha concreta', () => {
  assert.match(panel, /module: 'hotel'/);
  assert.match(panel, /recordId: hotel\?\.id \|\| null/);
  assert.match(panel, /Abrir ficha del vehículo/);
});

test('con varios resultados no hay botón superior genérico', () => {
  assert.match(panel, /missingMedia\.length === 1/);
  assert.doesNotMatch(panel, /moduleLabel: missingMedia\.length === 1 \? 'Abrir ficha del vehículo' : 'Abrir Hotel'/);
});

test('el bloque sin media ya no remite a Listados', () => {
  const start = panel.indexOf("{ label: 'Sin media km'");
  const end = panel.indexOf("];", start);
  const block = panel.slice(start, end);
  assert.doesNotMatch(block, /Abrir Listados/);
  assert.doesNotMatch(block, /module: 'listados'/);
});

test('hf22 usa un archivo físico nuevo de Panel para romper caché', () => {
  assert.match(html, /panel-native-hf22\.js/);
  assert.doesNotMatch(html, /panel-native\.js\?v=75\.23-hf21/);
});
