import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20260908123000_alpha74_estados_tramite_gestion.sql', 'utf8');
const hotelUtils = await readFile('r1-alpha53/src/hotel-utils.js', 'utf8');
const panel = await readFile('r1-alpha74/src/panel-native.js', 'utf8');
const history = await readFile('r1-alpha74/src/history-card.js', 'utf8');

assert.match(migration, /\('tramite', 'Trámite', 26, 'blanco', true\)/);
assert.match(migration, /\('gestion', 'Gestión', 27, 'blanco', true\)/);
assert.match(migration, /on conflict \(codigo\) do update/);

assert.match(hotelUtils, /tramite:'Trámite',gestion:'Gestión'/);
assert.match(hotelUtils, /key:'procedures'.*states:new Set\(\['tramite'\]\)/);
assert.match(hotelUtils, /key:'management'.*states:new Set\(\['gestion'\]\)/);

assert.match(panel, /tramite: 'Trámite'/);
assert.match(panel, /gestion: 'Gestión'/);
assert.match(panel, /const procedures = hotelRows\.filter\(row => row\.estado === 'tramite'\)/);
assert.match(panel, /const management = hotelRows\.filter\(row => row\.estado === 'gestion'\)/);
assert.match(panel, /label: 'Trámites', value: procedures\.length/);
assert.match(panel, /label: 'Gestiones', value: management\.length/);

assert.match(history, /STATE_LABELS\[row\.estado\] \|\| row\.estado/);

console.log('Alpha74: Trámite y Gestión disponibles y visibles en Operativa.');
