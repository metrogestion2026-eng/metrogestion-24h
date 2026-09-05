import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const alpha72 = path.join(root, 'r1-alpha72');
const alpha73 = path.join(root, 'r1-alpha73');

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

const files72 = await filesUnder(alpha72);
const files73 = await filesUnder(alpha73);
assert.deepEqual(files73, files72, 'Alpha73 debe partir del mismo árbol funcional que Alpha72');

for (const file of files72) {
  if (file === 'VERSION' || file === path.join('src', 'app.js')) continue;
  const [content72, content73] = await Promise.all([
    readFile(path.join(alpha72, file)),
    readFile(path.join(alpha73, file)),
  ]);
  assert.deepEqual(content73, content72, `El archivo heredado ${file} debe permanecer idéntico`);
}

assert.equal((await readFile(path.join(alpha73, 'VERSION'), 'utf8')).trim(), 'r1.0.0-alpha.73');
const app73 = await readFile(path.join(alpha73, 'src', 'app.js'), 'utf8');
assert.match(app73, /const VERSION = 'r1\.0\.0-alpha\.73';/);

const normalized72 = (await readFile(path.join(alpha72, 'src', 'app.js'), 'utf8'))
  .replace('r1.0.0-alpha.72', 'r1.0.0-alpha.73');
assert.equal(app73, normalized72, 'app.js solo debe cambiar el identificador visible de versión');

console.log('Alpha73: herencia íntegra de Alpha72 e identidad de versión verificadas.');
