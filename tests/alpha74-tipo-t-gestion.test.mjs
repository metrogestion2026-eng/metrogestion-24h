import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  'supabase/migrations/20260909094500_alpha74_tipo_t_gestion.sql',
  'utf8'
);
const editor = await readFile('r1-alpha74/src/hotel-editor-stages.js', 'utf8');
const create = await readFile('r1-alpha74/src/hotel-create.js', 'utf8');

assert.match(migration, /insert into public\.catalogo_tipos_etapa_hotel/i);
assert.match(migration, /values \('GESTIÓN', 'GESTIÓN', 60, true\)/);
assert.match(migration, /on conflict \(codigo\) do update/i);
assert.match(editor, /createEditableCatalogueField\('Tipo de T'/);
assert.match(create, /from\('catalogo_tipos_etapa_hotel'\)/);

console.log('Alpha74: GESTIÓN disponible en el selector Tipo de T.');
