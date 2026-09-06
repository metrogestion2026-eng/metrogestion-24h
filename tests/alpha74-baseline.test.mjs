import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const alpha73 = path.join(root, 'r1-alpha73');
const alpha74 = path.join(root, 'r1-alpha74');

async function filesUnder(directory, relative = '') {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(directory, child));
    else files.push(child);
  }
  return files.sort();
}

const files73 = await filesUnder(alpha73);
const files74 = await filesUnder(alpha74);
const expectedExtra = ['annotation-management.css'];
assert.deepEqual(
  files74.filter(file => !expectedExtra.includes(file)),
  files73,
  'Alpha74 debe conservar el árbol completo de Alpha73'
);

const alpha74Changes = new Set([
  'VERSION',
  'index.html',
  path.join('src', 'annotations.js'),
  path.join('src', 'app.js'),
  path.join('src', 'hotel-card.js'),
  path.join('src', 'hotel-native.js'),
  path.join('src', 'panel-native.js'),
]);

for (const file of files73) {
  if (alpha74Changes.has(file)) continue;
  const [content73, content74] = await Promise.all([
    readFile(path.join(alpha73, file)),
    readFile(path.join(alpha74, file)),
  ]);
  assert.deepEqual(content74, content73, `El archivo heredado ${file} debe permanecer idéntico`);
}

assert.equal((await readFile(path.join(alpha74, 'VERSION'), 'utf8')).trim(), 'r1.0.0-alpha.74');
assert.match(
  await readFile(path.join(alpha74, 'src', 'app.js'), 'utf8'),
  /const VERSION = 'r1\.0\.0-alpha\.74';/
);

console.log('Alpha74: herencia protegida de Alpha73 e identidad de versión verificadas.');
