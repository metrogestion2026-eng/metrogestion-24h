import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260906155819_alpha74_f_manda_prioridad_amarilla_y_enlazar_visita_existente.sql', import.meta.url),
  'utf8'
);

test('F con taller prevalece sobre G y agrupa todos los H como trabajos', () => {
  assert.match(
    migration,
    /v_modalidad := case\s+when coalesce\(v_group\.taller_norm, ''\) <> '' then 'taller'[\s\S]*?GESTION[\s\S]*?TRAMITE/
  );
  assert.match(migration, /F manda sobre G/);
});

test('la ventana de un mes es móvil y no se salta por escribir la parada en E', () => {
  assert.match(
    migration,
    /x\.fecha_necesidad <= \(\s*\(clock_timestamp\(\) at time zone 'Europe\/Madrid'\)::date \+ interval '1 month'/
  );
  assert.doesNotMatch(migration, /a\.fecha_generacion \+ interval '1 month'/);
});

test('el fondo amarillo de A fuerza la inclusión sin alterar la agrupación', () => {
  assert.match(migration, /prioridad_fondo_amarillo boolean/);
  assert.match(migration, /or x\.prioridad_fondo_amarillo\s+or x\.fecha_necesidad/);
  assert.match(migration, /x\.pendiente_fondo_blanco\s+or x\.prioridad_fondo_amarillo/);
});

test('una visita predictiva reutiliza una única entrada de taller existente', () => {
  assert.match(migration, /e\.tipo_etapa = 'entrada_taller'/);
  assert.match(migration, /concat_ws\(' ', e\.nombre, e\.lugar\)/);
  assert.match(migration, /v_legacy_entry_count > 1/);
  assert.match(migration, /e\.tipo_etapa = 'recogida_taller'/);
  assert.match(migration, /e\.etapa_origen_id = v_entry_id/);
  assert.match(migration, /coalesce\(v_legacy_entry_group, gen_random_uuid\(\)\)/);
  assert.match(migration, /coalesce\(v_legacy_pickup_group, gen_random_uuid\(\)\)/);
});
