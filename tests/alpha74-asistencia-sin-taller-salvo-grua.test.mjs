import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260909183000_alpha74_asistencia_sin_taller_salvo_grua.sql', import.meta.url),
  'utf8'
);

test('una asistencia reconoce el traslado solo desde Activar 24H', () => {
  assert.match(migration, /manteniment_reconciliar_asistencia_alpha74/);
  assert.match(migration, /a\.trasladado_taller/);
  assert.match(migration, /a\.resultado[\s\S]*trasladado_taller/);
  assert.match(migration, /v_traslado := coalesce\(v_traslado, false\)/);
});

test('sin grúa se anulan únicamente Entrada y Recogida pendientes', () => {
  assert.match(migration, /Asistencia 24H sin traslado en grúa a taller\./);
  assert.match(migration, /grupo_documental_id in \(v_visit\.grupo_entrada_id, v_visit\.grupo_recogida_id\)/);
  assert.match(migration, /and e\.estado <> 'realizada'/);
  assert.match(migration, /set etapa_hotel_id = v_asistencia_id/);
});

test('con grúa se conservan Entrada, Recogida y el trabajo en la Entrada', () => {
  assert.match(migration, /if v_visit\.grupo_recogida_id is null then/);
  assert.match(migration, /'Entrada ' \|\| v_visit\.taller/);
  assert.match(migration, /'Recogida ' \|\| v_visit\.taller/);
  assert.match(migration, /set etapa_hotel_id = v_entry_id/);
});

test('la T de recuperar ruta nunca se cancela y vuelve a quedar al final', () => {
  assert.match(migration, /accion_sistema = 'recuperar_y_liberar'/);
  assert.match(migration, /where id = v_recovery_id/);
  assert.doesNotMatch(
    migration,
    /accion_sistema = 'recuperar_y_liberar'[\s\S]{0,220}cancelado = true/
  );
});

console.log('Alpha74: asistencia en carretera sin Entrada/Recogida y recuperación preservada.');
