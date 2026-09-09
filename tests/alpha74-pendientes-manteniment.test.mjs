import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleSource = await readFile('r1-alpha74/src/pending-stages.js', 'utf8');
const migration = await readFile('supabase/migrations/20260909113000_alpha74_pendientes_manteniment.sql', 'utf8');

assert.match(moduleSource, /listar_necesidades_manteniment_pendientes_alpha74/);
assert.match(moduleSource, /T del Hotel \(\$\{hotelRows\.length\}\)/);
assert.match(moduleSource, /Pendientes MANTENIMENT \(\$\{maintenanceRows\.length\}\)/);
assert.match(moduleSource, /buildSpreadsheetXlsx/);
assert.match(moduleSource, /createDetailPdf/);
assert.match(moduleSource, /navigator\.share/);
assert.match(moduleSource, /window\.print/);
assert.match(moduleSource, /Guardar vista/);
assert.match(moduleSource, /Solo DFM/);
assert.match(moduleSource, /Todos los talleres/);
assert.match(moduleSource, /type: 'date'/);

assert.match(migration, /create or replace function app_private\.listar_necesidades_manteniment_pendientes_alpha74\(\)/i);
assert.match(migration, /mt\.fecha_realizada is null/i);
assert.match(migration, /mt\.fuentes -> 0 ->> 'clave_fila'/i);
assert.match(migration, /public\.usuario_activo\(\)/i);
assert.match(migration, /public\.dispositivo_autorizado\(\)/i);
assert.match(migration, /public\.puede_ver_modulo\('t_programadas'\)/i);
assert.match(migration, /security invoker/i);
assert.match(migration, /revoke all on function public\.listar_necesidades_manteniment_pendientes_alpha74\(\)/i);
assert.match(migration, /limit 1000/i);

console.log('Alpha74: T pendientes separa Hotel y necesidades MANTENIMENT, con filtros y exportación.');
