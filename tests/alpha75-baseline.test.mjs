import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const alpha74 = path.join(root, 'r1-alpha74');
const alpha75 = path.join(root, 'r1-alpha75');

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

function normalizeVersionSpecificText(source) {
  return source
    .replaceAll('r1.0.0-alpha.75.12', 'r1.0.0-alpha.74.26')
    .replaceAll('v=75.12', 'v=74.26')
    .replaceAll('v=75.1', 'v=74.26')
    .replaceAll('alpha75-2026.09.11.8', 'alpha74-2026.09.11.31')
    .replaceAll('alpha75-2026.09.11.7', 'alpha74-2026.09.11.31')
    .replaceAll('alpha75-2026.09.11.6', 'alpha74-2026.09.11.31')
    .replaceAll('alpha75-2026.09.11.4', 'alpha74-2026.09.11.31')
    .replaceAll('alpha75-2026.09.11.3', 'alpha74-2026.09.11.31')
    .replaceAll('alpha75-2026.09.11.2', 'alpha74-2026.09.11.31')
    .replaceAll('alpha75-2026.09.11.1', 'alpha74-2026.09.11.31')
    .replaceAll('Alpha75', 'Alpha74');
}

test('Alpha75 nace como copia funcional exacta de Alpha74 validada', async () => {
  const files74 = await filesUnder(alpha74);
  const files75 = await filesUnder(alpha75);
  assert.deepEqual(files75, files74.filter(file => file !== path.join('src', 'redirect-alpha76.js')));

  const alpha75Changes = new Set([
    'VERSION',
    'index.html',
    path.join('src', 'app.js'),
    path.join('src', 'hotel-native.js'),
    path.join('src', 'hotel-card.js'),
    path.join('src', 'history-card.js'),
    path.join('src', 'panel-native.js'),
    path.join('src', 'reservas-create.js'),
    path.join('src', 'hotel-editor.js'),
    path.join('src', 'hotel-editor-stages.js'),
    path.join('src', 'pending-stages.js'),
    path.join('google-apps-script', 'README.md'),
    path.join('google-apps-script', 'sincronizar_manteniment.gs'),
    'panel-native.css',
    'editor-validation.css',
  ]);

  for (const file of files75) {
    if (alpha75Changes.has(file)) continue;
    const [source74, source75] = await Promise.all([
      readFile(path.join(alpha74, file)),
      readFile(path.join(alpha75, file)),
    ]);
    const isText = !source75.includes(0);
    if (!isText) {
      assert.deepEqual(source75, source74, file);
      continue;
    }
    assert.equal(normalizeVersionSpecificText(source75.toString()), source74.toString(), file);
  }
});

test('Alpha75 muestra y carga su identificador independiente', async () => {
  assert.equal((await readFile(path.join(alpha75, 'VERSION'), 'utf8')).trim(), 'r1.0.0-alpha.75.12');
  const app = await readFile(path.join(alpha75, 'src', 'app.js'), 'utf8');
  const html = await readFile(path.join(alpha75, 'index.html'), 'utf8');
  assert.match(app, /r1\.0\.0-alpha\.75\.12/);
  assert.match(html, /\.\/src\/app\.js\?v=75\.12/);
  assert.doesNotMatch(html, /r1-alpha74/);
});
