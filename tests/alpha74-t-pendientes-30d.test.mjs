import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleSource = await readFile('r1-alpha74/src/pending-stages.js', 'utf8');
const appSource = await readFile('r1-alpha74/src/app.js', 'utf8');
const migration = await readFile('supabase/migrations/20260909073000_alpha74_t_pendientes_30d.sql', 'utf8');

assert.match(appSource, /import '\.\/pending-stages\.js'/);
assert.match(moduleSource, /button\.textContent = '📅 T pendientes'/);
assert.match(moduleSource, /metric\('Pendientes 30d', counts\.next30/);
assert.match(moduleSource, /function isRUnit\(row\)/);
assert.match(moduleSource, /if \(scope === 'next30'\) return isRUnit\(row\)/);
assert.match(moduleSource, /\['ITV', 'ITV'\]/);
assert.match(moduleSource, /\['AVERIA', 'Averías'\]/);
assert.match(moduleSource, /\['MANTENIMIENTO', 'Mantenimientos'\]/);
assert.match(moduleSource, /\['EXTINTOR', 'Extintores'\]/);
assert.match(moduleSource, /\['TRAMITE', 'Trámites'\]/);
assert.match(moduleSource, /new Map\(\(hotelResult\.data \|\| \[\]\)[\s\S]*?\.map\(row => \[row\.etapa_id, \{ \.\.\.row, source: 'hotel' \}\]\)/);
assert.match(moduleSource, /openStageDetail\(\{/);

assert.match(migration, /create or replace function app_private\.listar_t_pendientes_30d_alpha74\(\)/i);
assert.match(migration, /auth\.uid\(\) is null/i);
assert.match(migration, /public\.dispositivo_autorizado\(\)/i);
assert.match(migration, /public\.puede_ver_modulo\('t_programadas'\)/i);
assert.match(migration, /mw\.fecha_necesidad/i);
assert.match(migration, /e\.estado in \('pendiente', 'programada', 'en_curso'\)/i);
assert.match(migration, /group by[\s\S]*?e\.id/i);
assert.match(migration, /limit 500/i);
assert.match(migration, /security invoker/i);
assert.match(migration, /revoke all on function app_private\.listar_t_pendientes_30d_alpha74\(\)[\s\S]*?from public, anon, authenticated/i);

console.log('Alpha74: Pendientes 30d integrado en la pestaña T pendientes sin duplicados.');
