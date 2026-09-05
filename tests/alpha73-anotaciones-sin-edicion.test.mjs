import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('Alpha73 permite añadir una anotación sin activar la edición completa', async () => {
  const [native, card, annotations] = await Promise.all([
    read('r1-alpha73/src/hotel-native.js'),
    read('r1-alpha73/src/hotel-card.js'),
    read('r1-alpha73/src/annotations.js'),
  ]);

  assert.match(native, /canAddNotes:\s*access\.editFicha/);
  assert.match(native, /crear_anotacion_hotel_alpha73/);
  assert.doesNotMatch(native, /canAddNotes:\s*access\.editFicha\s*&&\s*editMode/);
  assert.match(native, /Puedes añadir anotaciones directamente/);
  assert.match(card, /if \(canAddNotes && typeof onAddNote === 'function'\)/);
  assert.match(annotations, /Añadir anotación/);
  assert.match(annotations, /Guardar anotación/);
  assert.match(annotations, /maxLength:\s*4000/);
});

test('el alta independiente solo inserta la nota y conserva los controles de seguridad', async () => {
  const migration = await read('supabase/migrations/20260905190000_alpha73_anotaciones_sin_modo_edicion.sql');

  assert.match(migration, /security definer/);
  assert.match(migration, /public\.usuario_activo\(\)/);
  assert.match(migration, /public\.dispositivo_autorizado\(\)/);
  assert.match(migration, /public\.puede_editar_modulo\('hotel'\)/);
  assert.match(migration, /insert into public\.anotaciones_manuales_hotel/);
  assert.doesNotMatch(migration, /update public\.registros_hotel/i);
  assert.doesNotMatch(migration, /insert into public\.etapas_hotel/i);
  assert.match(migration, /p\.estado = 'en_curso'/);
  assert.match(migration, /on conflict \(request_id\).*do nothing/);
  assert.match(migration, /revoke all on function public\.crear_anotacion_hotel_alpha73[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.crear_anotacion_hotel_alpha73[\s\S]*to authenticated, service_role/);
});
