import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('r1-alpha75/src/reservas-create.js', 'utf8');

test('cada reserva editable recibe acceso a su ficha interactiva', () => {
  assert.match(source, /async function ensureInteractiveReserveCards\(\)/);
  assert.match(source, /\.select\('id,vehiculo_codigo,matricula,etiqueta,estado,ubicacion,pendientes,activo,version'\)/);
  assert.match(source, /edit\.textContent = '✏ Modificar ficha'/);
  assert.match(source, /openEditModal\(row, profile\)/);
});

test('la ficha permite editar datos sin alterar directamente su identidad ni estado', () => {
  assert.match(source, /Código \$\{row\.vehiculo_codigo\} protegido como identidad/);
  assert.match(source, /matricula: clean\(values\.matricula\)/);
  assert.match(source, /etiqueta: clean\(values\.etiqueta\)/);
  assert.match(source, /ubicacion: clean\(values\.ubicacion\)/);
  assert.doesNotMatch(source, /\.update\(\{[^}]*vehiculo_codigo/s);
  assert.doesNotMatch(source, /\.update\(\{[^}]*estado/s);
});

test('los pendientes se pueden realizar individualmente con guardado protegido', () => {
  assert.match(source, /done\.textContent = '✓ Dar por realizado'/);
  assert.match(source, /current\.filter\(\(_, currentIndex\) => currentIndex !== index\)\.join\(' \+ '\)/);
  assert.match(source, /\.eq\('id', row\.id\)/);
  assert.match(source, /\.eq\('version', row\.version\)/);
  assert.match(source, /La ficha ha cambiado desde que la abriste/);
});
