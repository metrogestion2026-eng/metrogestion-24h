import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migration = await readFile(path.join(
  root,
  'supabase/migrations/20260905123000_alpha72_cronologia_anotaciones.sql'
), 'utf8');
const annotations = await readFile(path.join(root, 'r1-alpha72/src/annotations.js'), 'utf8');
const css = await readFile(path.join(root, 'r1-alpha72/annotations.css'), 'utf8');
const editor = await readFile(path.join(root, 'r1-alpha72/src/hotel-editor.js'), 'utf8');
const create = await readFile(path.join(root, 'r1-alpha72/src/hotel-create.js'), 'utf8');
const hotel = await readFile(path.join(root, 'r1-alpha72/src/hotel-native.js'), 'utf8');
const history = await readFile(path.join(root, 'r1-alpha72/src/history-native.js'), 'utf8');
const card = await readFile(path.join(root, 'r1-alpha72/src/hotel-card.js'), 'utf8');
const historyCard = await readFile(path.join(root, 'r1-alpha72/src/history-card.js'), 'utf8');

assert.match(migration, /create table if not exists public\.anotaciones_manuales_hotel/);
assert.match(migration, /alter table public\.anotaciones_manuales_hotel enable row level security/);
assert.match(migration, /grant select on table public\.anotaciones_manuales_hotel to authenticated/);
assert.match(migration, /revoke all on table public\.anotaciones_manuales_hotel from public, anon, authenticated/);
assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*anotaciones_manuales_hotel[^;]*authenticated/i);
assert.match(migration, /after insert or update on public\.anotaciones_manuales_hotel[\s\S]*?auditar_cambio_fila/);
assert.match(migration, /public\.dispositivo_autorizado\(\)/);
assert.match(migration, /public\.puede_editar_modulo\('hotel'\)/);
assert.match(migration, /n\.version = v_version/);
assert.match(migration, /Otra sesión ha modificado esta anotación/);
assert.match(migration, /cancelada = true/);
assert.match(migration, /distinct on \(r\.seguimiento_id\)/);
assert.match(migration, /regexp_split_to_table/);
assert.match(migration, /on conflict \(clave_importacion\)/);
assert.match(migration, /app_private\.anotaciones_manuales_hotel_json/);
assert.match(migration, /p_ficha->'anotaciones_manuales'/);
assert.match(migration, /security definer/);
assert.doesNotMatch(migration, /create or replace function public\.[\s\S]{0,200}security definer/i);

assert.match(annotations, /stage\.estado === 'realizada'/);
assert.match(annotations, /stage\.seguimiento_id \|\| stage\.id/);
assert.match(annotations, /Anotaciones y pasos realizados/);
assert.match(annotations, /Cada anotación se guarda como una línea independiente con fecha y autor/);
assert.match(annotations, /manualAnnotationsPayload/);
assert.match(annotations, /Otra sesión|eliminar/);
assert.doesNotMatch(annotations, /disabled:\s*note\.eliminar/);
assert.match(annotations, /textarea\.disabled\s*=\s*note\.eliminar/);
assert.match(css, /font-family:Georgia/);
assert.match(css, /font-style:italic/);
assert.match(css, /@media\(max-width:640px\)/);

assert.match(editor, /renderManualAnnotationsEditor/);
assert.match(editor, /anotaciones_manuales: manualAnnotationsPayload\(detail\)/);
assert.match(create, /renderManualAnnotationsEditor/);
assert.match(create, /anotaciones_manuales: \[\]/);
assert.match(hotel, /from\('anotaciones_manuales_hotel'\)/);
assert.match(hotel, /notesByTracking/);
assert.match(history, /from\('anotaciones_manuales_hotel'\)/);
assert.match(history, /\.ilike\('texto'/);
assert.match(card, /renderAnnotationsChronology/);
assert.match(historyCard, /renderAnnotationsChronology/);

console.log('Alpha72: cronología automática y anotaciones manuales auditadas verificadas.');
