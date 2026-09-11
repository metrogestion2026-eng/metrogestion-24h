import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260911073000_alpha74_ficha_pizarra_automatica_24h.sql', import.meta.url),
  'utf8'
);

test('la activación 24H crea ficha, T de avería y recuperación sin duplicarlas', () => {
  assert.match(migration, /crear_ficha_hotel_con_etapas_alpha72/);
  assert.match(migration, /'24H · Avería'/);
  assert.match(migration, /'Recuperar ruta y liberar reserva'/);
  assert.match(migration, /if v_registro_id is null then/);
  assert.match(migration, /registro_hotel_id = v_registro_id/);
});

test('la cronología reúne las horas y el diagnóstico del seguimiento', () => {
  assert.match(migration, /ACTIVACIÓN 24H:/);
  assert.match(migration, /LLEGADA PREVISTA DEL MECÁNICO:/);
  assert.match(migration, /LLEGADA REAL DEL MECÁNICO:/);
  assert.match(migration, /DIAGNÓSTICO:/);
  assert.match(migration, /HORA REAL DE FIN:/);
});

test('la T de avería se realiza al cerrar y la grúa sigue en el reconciliador existente', () => {
  assert.match(migration, /new\.resultado in \('operativo_reparado', 'trasladado_taller'\)/);
  assert.match(migration, /estado = case when v_cerrada then 'realizada'/);
  assert.doesNotMatch(migration, /'Entrada[^']*taller'/i);
  assert.doesNotMatch(migration, /'Recogida[^']*taller'/i);
});
