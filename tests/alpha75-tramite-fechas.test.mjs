import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../r1-alpha75/src/hotel-editor-stages.js', import.meta.url), 'utf8');

test('T de trámite muestra sus tres hitos temporales', () => {
  assert.match(source, /Fecha inicio trámite/);
  assert.match(source, /Fin del trámite/);
  assert.match(source, /Asunto arreglado/);
});
