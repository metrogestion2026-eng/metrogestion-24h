import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const history = fs.readFileSync(new URL('../r1-alpha75/src/history-native.js', import.meta.url), 'utf8');
const query = fs.readFileSync(new URL('../shared/history-query.mjs', import.meta.url), 'utf8');

test('Histórico permite buscar por periodo', () => {
  assert.match(history, /aria-label': 'Desde'/);
  assert.match(history, /aria-label': 'Hasta'/);
  assert.match(history, /\{ from, to \}/);
});

test('la consulta central filtra por fecha de pizarra', () => {
  assert.match(query, /function searchHistoricalRecords|searchHistoricalRecords/);
  assert.match(query, /const inPeriod = board/);
  assert.match(query, /!inPeriod\(board\)/);
});
