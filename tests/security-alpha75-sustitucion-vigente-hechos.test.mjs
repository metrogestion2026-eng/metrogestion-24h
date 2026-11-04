import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL(
    '../supabase/migrations/20261104091228_alpha75_sustitucion_vigente_por_hechos.sql',
    import.meta.url,
  ),
  'utf8',
);

test('una cabecera histórica no acredita por sí sola una sustitución vigente', () => {
  assert.match(migration, /evidencia_sustitucion_vigente_alpha75/);
  assert.match(migration, /sustitucion_vigente_por_hechos_alpha75/);
  assert.match(migration, /a\.estado = 'abierta'/);
  assert.match(migration, /es_recuperacion_rec001\(to_jsonb\(e\)\)/);
  assert.match(migration, /e\.estado in \('pendiente', 'programada', 'en_curso'\)/);
  assert.match(migration, /continuidad_confirmada_sin_recuperacion/);
  assert.match(migration, /v_recuperacion_realizada/);
  assert.match(migration, /sustitucion_vigente_evidencia/);
});

test('la corrección conserva la identidad histórica del sustituto', () => {
  assert.doesNotMatch(
    migration,
    /set[\s\S]{0,160}vehiculo_reserva\s*=\s*(?:''|null)/i,
  );
  assert.doesNotMatch(
    migration,
    /set[\s\S]{0,160}matricula_reserva\s*=\s*(?:''|null)/i,
  );
  assert.match(migration, /solo corrige la clasificación Activa/i);
});

test('la reparación es general, autocorrige la Pizarra y no contiene excepciones por vehículo', () => {
  assert.match(migration, /sincronizar_situacion_operativa_hotel_alpha75/);
  assert.match(migration, /sustitucion_hechos_20261104/);
  assert.match(migration, /queda una ficha cerrada dentro de Activas/);
  assert.match(migration, /queda una sustitución vigente sin hecho operativo/);
  assert.doesNotMatch(migration, /\b(?:2489|2500|2527|2548|2554|2633|2637|2726|2746)\b/);
});
