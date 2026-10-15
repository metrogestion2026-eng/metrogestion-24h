import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  'supabase/migrations/20261014124900_alpha75_importador_no_confundir_sin_recogida_con_conflicto.sql',
  'utf8'
);

test('el importador consulta la regla sin recogida antes de insertar', () => {
  assert.match(sql, /etapa_manteniment_sin_recogida_alpha74\(v_entry_id\)/);
  assert.match(sql, /grupo_recogida_id = null/);
});

test('un bloqueo esperado no se traduce en conflicto', () => {
  const ruleIndex = sql.indexOf('if app_private.etapa_manteniment_sin_recogida_alpha74(v_entry_id) then');
  const insertIndex = sql.indexOf("insert into public.etapas_hotel(", ruleIndex);
  assert.ok(ruleIndex >= 0);
  assert.ok(insertIndex > ruleIndex);
  assert.match(sql, /No debe\s+-- interpretarse el bloqueo del trigger como un conflicto/);
});

test('el conflicto real sigue protegido', () => {
  assert.match(sql, /La entrada ya tiene una etapa activa incompatible; no se ha duplicado/);
  assert.match(sql, /md5\(v_ddl\) <> 'fedf69806c3896275b291817a0ae389b'/);
});
