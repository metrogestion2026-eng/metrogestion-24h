import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../r1-alpha75/src/hotel-editor-stages.js', import.meta.url), 'utf8');

test('trabajo nuevo nace sin tipo seleccionado', () => {
  assert.match(source, /stage\.trabajos\.push\(makeNewWork\(\)\)/);
  assert.doesNotMatch(source, /tipos_trabajo\[0\]/);
  assert.doesNotMatch(source, /makeNewWork\([^)]*'AV'/);
});
