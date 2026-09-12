import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const redirect = await readFile('r1-alpha74/src/redirect-alpha76.js', 'utf8');
const html = await readFile('r1-alpha74/index.html', 'utf8');

test('Alpha74 envía las cuentas normales a Alpha76 conservando la sesión', () => {
  assert.match(redirect, /supabase\.auth\.getUser\(\)/);
  assert.match(redirect, /\.from\('usuarios'\)/);
  assert.match(redirect, /profile\.tipo_usuario === 'administrador_principal'/);
  assert.match(redirect, /new URL\('\.\.\/r1-alpha76\/'/);
  assert.match(redirect, /window\.location\.replace\(TARGET\.href\)/);
  assert.match(html, /\.\/src\/redirect-alpha76\.js\?v=74\.27/);
});

test('el puente no altera permisos ni escribe en Supabase', () => {
  assert.doesNotMatch(redirect, /\.(insert|update|delete|upsert|rpc)\s*\(/);
  assert.match(redirect, /profileError \|\| !profile\?\.activo/);
});
