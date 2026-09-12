import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('T pendientes identifica la caducidad de MANTENIMENT columna I', async () => {
  const source = await readFile(path.join(root, 'r1-alpha75', 'src', 'pending-stages.js'), 'utf8');
  assert.match(source, /Fecha de caducidad \(MANTENIMENT · columna I\)/);
  assert.match(source, /row\.source === 'manteniment'/);
  assert.match(source, /formatDate\(date\)/);
  assert.match(source, /a74-pending-date/);
});

test('la exportación separa la fecha del Hotel y la caducidad de MANTENIMENT', async () => {
  const source = await readFile(path.join(root, 'r1-alpha75', 'src', 'pending-stages.js'), 'utf8');
  assert.match(source, /'Fecha prevista Hotel', 'Caducidad MANTENIMENT \(I\)'/);
  assert.match(source, /row\.source === 'manteniment' \? formatDate\(row\.fecha_referencia\) : ''/);
});

test('Apps Script toma la fecha de necesidad de la columna I', async () => {
  const source = await readFile(path.join(root, 'r1-alpha75', 'google-apps-script', 'sincronizar_manteniment.gs'), 'utf8');
  assert.match(source, /fechaNecesidad\s*=\s*metrogestionFechaIso_\(row\[8\]/);
  assert.match(source, /fecha_necesidad:\s*fechaNecesidad/);
});
