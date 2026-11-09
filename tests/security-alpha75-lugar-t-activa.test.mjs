import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261109084500_alpha75_lugar_desde_t_en_curso.sql', import.meta.url),
  'utf8',
);

test('Toda T en curso con lugar proyecta ese lugar a la ficha', () => {
  assert.match(migration, /e\.estado = 'en_curso'/);
  assert.match(migration, /select e\.id, e\.tipo_etapa, e\.lugar/);
  assert.match(migration, /v_lugar := coalesce\(nullif\(btrim\(v_stage\.lugar\), ''\), v_r\.lugar\)/);
  assert.match(migration, /otra_t_en_curso/);
  assert.match(migration, /queda una ficha cuyo Lugar no coincide con su T en curso/);
});

test('La regla es general y no contiene excepciones por unidad o parada', () => {
  assert.doesNotMatch(migration, /\b(?:2709|2600279|2489|2548|2554|2625)\b/);
});
