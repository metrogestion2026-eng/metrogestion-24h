import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migration = await readFile(path.join(
  root,
  'supabase/migrations/20260905064733_alpha72_cierre_automatico_pendientes_reserva.sql'
), 'utf8');
const reservations = await readFile(path.join(root, 'r1-alpha72/src/reservas-create.js'), 'utf8');
const alpha71Reservations = await readFile(path.join(root, 'r1-alpha71/src/reservas-create.js'), 'utf8');

assert.match(migration, /create table if not exists public\.reservas_pendientes_resueltos/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /grant select on table public\.reservas_pendientes_resueltos to authenticated/i);
assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*authenticated/i);
assert.match(migration, /before update or delete on public\.reservas_pendientes_resueltos/i);
assert.match(migration, /unique \(reserva_id, etapa_hotel_id, pendiente_codigo\)/i);

assert.match(migration, /resolver_pendientes_reserva_por_etapa/i);
assert.match(migration, /t\.tipo_trabajo\) = v_codigo/i);
assert.match(migration, /e\.estado = 'realizada'/i);
assert.match(migration, /on conflict \(reserva_id, etapa_hotel_id, pendiente_codigo\) do nothing/i);
assert.match(migration, /array_to_string\(v_restantes, ' \+ '\)/i);
assert.match(migration, /alpha72:cierre_automatico_pendiente/i);

assert.match(migration, /R1187/);
assert.match(migration, /2600142/);
assert.match(migration, /'MB'/);
assert.match(migration, /'correccion_validada'/);

assert.match(reservations, /reservas_pendientes_resueltos/);
assert.match(reservations, /Pendientes resueltos/);
assert.match(reservations, /Conservado en el histórico; no se puede borrar\./);
assert.doesNotMatch(reservations, /borrar pendiente|eliminar pendiente/i);
assert.notEqual(reservations, alpha71Reservations, 'La mejora solo debe existir en Alpha72');

console.log('Alpha72: cierre automático e histórico inmutable de pendientes verificados.');
