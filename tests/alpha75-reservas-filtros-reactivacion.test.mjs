import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const enhancement = await readFile('r1-alpha75/src/reservas-create.js', 'utf8');
const base = await readFile('r1-alpha17/src/modules/reservas.js', 'utf8');
const app = await readFile('r1-alpha75/src/app.js', 'utf8');
const html = await readFile('r1-alpha75/index.html', 'utf8');

test('los tres contadores de Reservas se convierten en filtros interactivos', () => {
  assert.match(enhancement, /ensureReserveSummaryFilters/);
  assert.match(enhancement, /Reservas registradas/);
  assert.match(enhancement, /En alta/);
  assert.match(enhancement, /En baja/);
  assert.match(enhancement, /setAttribute\('role', 'button'\)/);
  assert.match(enhancement, /setAttribute\('tabindex', '0'\)/);
  assert.match(enhancement, /aria-pressed/);
  assert.match(enhancement, /\['Enter', ' '\]/);
});

test('En baja abre el grupo de bajas y oculta las altas', () => {
  assert.match(enhancement, /activeGrid\.hidden = reserveSummaryFilter === 'inactive'/);
  assert.match(enhancement, /inactiveDetails\.hidden = reserveSummaryFilter === 'active'/);
  assert.match(enhancement, /inactiveDetails\.open = true/);
});

test('una reserva dada de baja conserva una acción explícita para volver a darla de alta', () => {
  assert.match(base, /row\.activo\?'Dar de baja':'Dar de alta'/);
  assert.match(base, /p_activo:!row\.activo/);
});

test('una reserva ocupada sigue sin poder darse de baja', () => {
  assert.match(base, /row\.activo && row\.estado === 'ocupada'/);
  assert.match(base, /Baja bloqueada/);
  assert.match(base, /btn\.disabled=true/);
});

test('hf14 fuerza la carga del nuevo comportamiento de Reservas', () => {
  assert.match(app, /reservas-create\.js\?v=75\.23-hf14/);
  assert.match(html, /app\.js\?v=75\.23-hf14/);
});
