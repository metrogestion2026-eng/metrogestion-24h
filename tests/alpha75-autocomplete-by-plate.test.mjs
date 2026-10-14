import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../r1-alpha75/src/hotel-editor-main.js', import.meta.url), 'utf8');

test('Identificación permite autocompletar por matrícula además de DFM', () => {
  assert.match(source, /normaliseVehicleKey\(item\.dfm\) === key \|\| normaliseVehicleKey\(item\.matricula\) === key/);
  assert.match(source, /controls\.matricula_sustituido\.addEventListener\('change'/);
  assert.match(source, /controls\.matricula_sustituido\.addEventListener\('blur'/);
});

test('UPC no se usa como criterio de búsqueda', () => {
  const exactVehicleBlock = source.match(/function exactVehicle\([\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(exactVehicleBlock, /upc/i);
});
