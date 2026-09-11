import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const alpha75 = path.join(root, 'r1-alpha75');
const alpha76 = path.join(root, 'r1-alpha76');

async function filesUnder(directory, prefix = '') {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(directory, relative));
    else files.push(relative);
  }
  return files.sort();
}

test('Alpha76 conserva Alpha75 y añade únicamente su experiencia de consulta', async () => {
  const files75 = await filesUnder(alpha75);
  const files76 = await filesUnder(alpha76);
  assert.deepEqual(files76.filter(file => !['consulta-mode.css', path.join('src', 'read-only-mode.js')].includes(file)), files75);

  const allowedChanges = new Set([
    'VERSION',
    'index.html',
    path.join('src', 'app.js'),
    path.join('src', 'hotel-native.js'),
    path.join('src', 'history-card.js'),
    path.join('src', 'panel-native.js'),
  ]);
  for (const file of files75) {
    if (allowedChanges.has(file)) continue;
    assert.deepEqual(await readFile(path.join(alpha76, file)), await readFile(path.join(alpha75, file)), file);
  }
});

test('Alpha76 muestra y carga su identificador independiente', async () => {
  assert.equal((await readFile(path.join(alpha76, 'VERSION'), 'utf8')).trim(), 'r1.0.0-alpha.76.0');
  const app = await readFile(path.join(alpha76, 'src', 'app.js'), 'utf8');
  const html = await readFile(path.join(alpha76, 'index.html'), 'utf8');
  assert.match(app, /r1\.0\.0-alpha\.76\.0/);
  assert.match(html, /\.\/src\/read-only-mode\.js\?v=76\.0/);
  assert.match(html, /\.\/consulta-mode\.css/);
});
