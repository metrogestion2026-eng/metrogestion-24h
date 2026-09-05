import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const alpha71 = path.join(root, 'r1-alpha71');
const alpha72 = path.join(root, 'r1-alpha72');

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

const files71 = await filesUnder(alpha71);
const files72 = await filesUnder(alpha72);
const alpha72Additions = ['annotations.css', path.join('src', 'annotations.js')];
assert.deepEqual(
  files72,
  [...files71, ...alpha72Additions].sort(),
  'Alpha72 solo puede añadir los archivos propios autorizados'
);

for (const file of files71) {
  if (
    file === 'VERSION'
    || file === 'index.html'
    || file === path.join('src', 'app.js')
    || file === path.join('src', 'reservas-create.js')
    || file === path.join('src', 'hotel-create.js')
    || file === path.join('src', 'hotel-editor-main.js')
    || file === path.join('src', 'hotel-editor.js')
    || file === path.join('src', 'hotel-native.js')
    || file === path.join('src', 'history-native.js')
    || file === path.join('src', 'hotel-card.js')
    || file === path.join('src', 'history-card.js')
  ) continue;
  const [content71, content72] = await Promise.all([
    readFile(path.join(alpha71, file)),
    readFile(path.join(alpha72, file)),
  ]);
  assert.deepEqual(content72, content71, `El archivo heredado ${file} debe permanecer idéntico`);
}

assert.equal((await readFile(path.join(alpha72, 'VERSION'), 'utf8')).trim(), 'r1.0.0-alpha.72');
const app72 = await readFile(path.join(alpha72, 'src', 'app.js'), 'utf8');
assert.match(app72, /const VERSION = 'r1\.0\.0-alpha\.72';/);

const normalized71 = (await readFile(path.join(alpha71, 'src', 'app.js'), 'utf8'))
  .replace("r1.0.0-alpha.71", "r1.0.0-alpha.72");
assert.equal(app72, normalized71, 'app.js solo debe cambiar el identificador visible de versión');

console.log('Alpha72: herencia de Alpha71 e identidad de versión verificadas.');
