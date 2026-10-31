import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261027100000_alpha75_25_registro_crea_reserva.sql', import.meta.url),
  'utf8'
);
const reservesUi = fs.readFileSync(
  new URL('../r1-alpha75/src/reservas-create.js', import.meta.url),
  'utf8'
);

test('Registro garantiza la ficha de Reserva sin duplicar', () => {
  assert.match(migration, /create or replace function app_private\.vehiculo_asegurar_ficha_reserva/i);
  assert.match(migration, /after insert or update of dfm,matricula,reserva,asignacion_manteniment,activo,fecha_alta_manteniment/i);
  assert.match(migration, /on conflict \(vehiculo_codigo\) do update/i);
});

test('la creación automática no pisa campos manuales de Reserva', () => {
  const updateSection = migration.match(/on conflict \(vehiculo_codigo\) do update([\s\S]*?)where public\.reservas_hotel/i)?.[1] || '';
  assert.doesNotMatch(updateSection, /etiqueta\s*=/i);
  assert.doesNotMatch(updateSection, /ubicacion\s*=/i);
  assert.doesNotMatch(updateSection, /pendientes\s*=/i);
});

test('los huecos existentes se recuperan sin duplicar fichas presentes', () => {
  assert.match(migration, /insert into public\.reservas_hotel[\s\S]*from public\.vehiculos v/i);
  assert.match(migration, /on conflict \(vehiculo_codigo\) do nothing/i);
});

test('Reservas deja de ofrecer un alta paralela desde su pantalla', () => {
  assert.doesNotMatch(reservesUi, /button\.textContent = '\+ Crear nueva reserva'/);
  assert.match(reservesUi, /Las reservas nacen desde Registro/);
  assert.match(reservesUi, /Aquí se gestiona su ficha operativa, estado, ubicación y pendientes/);
});

console.log('Alpha75.25: Registro crea la identidad de Reserva y Reservas solo la gestiona.');
