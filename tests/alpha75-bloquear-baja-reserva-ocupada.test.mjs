import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  'supabase/migrations/20261015060700_alpha75_bloquear_baja_reserva_ocupada.sql',
  'utf8'
);

test('la protección solo bloquea la transición alta -> baja', () => {
  assert.match(sql, /old\.activo = true and new\.activo = false/);
  assert.match(sql, /before update of activo/);
});

test('una reserva asignada en la Pizarra en curso se considera ocupada', () => {
  assert.match(sql, /p\.estado = 'en_curso'/);
  assert.match(sql, /not h\.cancelado/);
  assert.match(sql, /not h\.retirado_hotel_activo/);
  assert.match(sql, /h\.estado not in \('reserva_liberada','recuperado','anulado'\)/);
  assert.match(sql, /h\.vehiculo_reserva/);
});

test('el intento de baja ocupada falla de forma explícita y auditable', () => {
  assert.match(sql, /no puede darse de baja mientras siga asignada/);
  assert.match(sql, /errcode = '23514'/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.reservas_hotel/i);
});
