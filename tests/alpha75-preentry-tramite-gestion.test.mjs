import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../r1-alpha75/src/hotel-editor-main.js', import.meta.url), 'utf8');

test('Situación previa incluye Trámite y Gestión', () => {
  assert.match(source, /'planificado', 'pendiente_taller', 'tramite', 'gestion'/);
});
