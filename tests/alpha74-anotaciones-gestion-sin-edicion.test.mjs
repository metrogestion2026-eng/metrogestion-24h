import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('Alpha74 modifica y anula anotaciones sin activar la edición completa', async () => {
  const [native, card, annotations] = await Promise.all([
    read('r1-alpha74/src/hotel-native.js'),
    read('r1-alpha74/src/hotel-card.js'),
    read('r1-alpha74/src/annotations.js'),
  ]);

  assert.match(native, /canManageNotes:\s*access\.editFicha/);
  assert.doesNotMatch(native, /canManageNotes:\s*access\.editFicha\s*&&\s*editMode/);
  assert.match(native, /actualizar_anotacion_hotel_alpha74/);
  assert.match(native, /eliminar_anotacion_hotel_alpha74/);
  assert.match(native, /Puedes añadir, modificar o anular anotaciones directamente/);
  assert.match(card, /onEditNote\(row\.id, note\)/);
  assert.match(card, /onDeleteNote\(row\.id, note\)/);
  assert.match(annotations, /text: 'Modificar'/);
  assert.match(annotations, /text: 'Anular'/);
  assert.match(annotations, /window\.confirm/);
  assert.match(annotations, /seguirá conservada en la auditoría/i);
});

test('Alpha74 permite anular una anotación generada sin modificar la T', async () => {
  const [native, historyNative, card, historyCard, annotations, migration] = await Promise.all([
    read('r1-alpha74/src/hotel-native.js'),
    read('r1-alpha74/src/history-native.js'),
    read('r1-alpha74/src/hotel-card.js'),
    read('r1-alpha74/src/history-card.js'),
    read('r1-alpha74/src/annotations.js'),
    read('supabase/migrations/20260907050000_alpha74_anular_anotaciones_generadas.sql'),
  ]);

  assert.match(native, /anular_anotacion_generada_hotel_alpha74/);
  assert.match(historyNative, /anular_anotacion_generada_hotel_alpha74/);
  assert.match(native, /anotaciones_generadas_hotel_anuladas/);
  assert.match(historyNative, /anotaciones_generadas_hotel_anuladas/);
  assert.match(card, /onAnnulGenerated/);
  assert.match(historyCard, /onAnnulGenerated/);
  assert.match(annotations, /Anular anotación generada/);
  assert.match(annotations, /La T realizada seguirá intacta/);
  assert.match(annotations, /cancelledStageTrackings/);

  assert.match(migration, /public\.es_administrador_principal\(\)/);
  assert.match(migration, /insert into public\.anotaciones_generadas_hotel_anuladas/);
  assert.doesNotMatch(migration, /update\s+public\.etapas_hotel/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.etapas_hotel/i);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.anotaciones_generadas_hotel_anuladas/);
  assert.match(migration, /revoke all on function public\.anular_anotacion_generada_hotel_alpha74[\s\S]*from public, anon, authenticated/);
});

test('las operaciones directas protegen identidad, concurrencia, auditoría y permisos', async () => {
  const migration = await read(
    'supabase/migrations/20260906043000_alpha74_gestion_anotaciones_sin_modo_edicion.sql'
  );

  assert.match(migration, /public\.usuario_activo\(\)/);
  assert.match(migration, /public\.dispositivo_autorizado\(\)/);
  assert.match(migration, /public\.puede_editar_modulo\('hotel'\)/);
  assert.match(migration, /n\.seguimiento_id = v_seguimiento_id/);
  assert.match(migration, /n\.version = p_version/);
  assert.match(migration, /version = n\.version \+ 1/);
  assert.match(migration, /set cancelada = true/);
  assert.match(migration, /motivo_cancelacion/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.anotaciones_manuales_hotel/i);
  assert.doesNotMatch(migration, /update\s+public\.registros_hotel/i);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.actualizar_anotacion_hotel_alpha74[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.eliminar_anotacion_hotel_alpha74[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.actualizar_anotacion_hotel_alpha74[\s\S]*to authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.eliminar_anotacion_hotel_alpha74[\s\S]*to authenticated, service_role/);
});
