import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('r1-alpha75/src/pending-stages.js', 'utf8');
const app = await readFile('r1-alpha75/src/app.js', 'utf8');
const html = await readFile('r1-alpha75/index.html', 'utf8');

test('Pendientes MANTENIMENT se deduplican por identidad física', () => {
  assert.match(source, /function maintenanceIdentity\(row = \{\}\)/);
  assert.match(source, /row\.fila_origen/);
  assert.match(source, /normalize\(row\.dfm\)/);
  assert.match(source, /normalize\(row\.designacion\)/);
  assert.match(source, /String\(row\.fecha_referencia \|\| ''\)\.slice\(0, 10\)/);
  assert.match(source, /maintenanceIdentity\(row\)/);
});

test('la identidad no depende solo del UUID generado', () => {
  assert.match(source, /return parts\.length > 1[\s\S]*String\(row\.necesidad_id \|\| ''\)/);
});

test('hf16 fuerza la recarga del listado de pendientes', () => {
  assert.match(app, /pending-stages\.js\?v=75\.23-hf16/);
  assert.match(html, /app\.js\?v=75\.23-hf16/);
});
