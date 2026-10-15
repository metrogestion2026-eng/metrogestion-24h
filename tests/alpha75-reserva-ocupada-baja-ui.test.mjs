import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('r1-alpha17/src/modules/reservas.js', 'utf8');

test('una reserva ocupada muestra la baja bloqueada', () => {
  assert.match(source, /row\.activo && row\.estado === 'ocupada'/);
  assert.match(source, /text:occupied\?'Baja bloqueada'/);
  assert.match(source, /btn\.disabled=true/);
  assert.match(source, /no puede darse de baja mientras siga asignada/);
});

test('las reservas no ocupadas conservan alta y baja normales', () => {
  assert.match(source, /row\.activo\?'Dar de baja':'Dar de alta'/);
  assert.match(source, /toggleReserve\(row,btn,message\)/);
});
