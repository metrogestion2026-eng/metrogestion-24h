import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261109095500_alpha75_cierre_fisico_tramites_posteriores.sql', import.meta.url),
  'utf8',
);

test('la recuperación cierra el bloque físico antes de las T administrativas posteriores', () => {
  assert.match(migration, /etapa_es_administrativa_alpha75/);
  assert.match(migration, /ultima_fisica::numeric \+ 0\.5/);
  assert.match(migration, /perform app_private\.normalizar_orden_t_parada\(p_registro_id\)/);
  assert.doesNotMatch(migration, /2147483000::bigint/);
});

test('un cierre físico puede convivir con T administrativas pendientes', () => {
  assert.match(migration, /cierre_fisico_con_t_administrativas_pendientes_alpha75/);
  assert.match(migration, /v_fisicas_abiertas = 0/);
  assert.match(migration, /v_admin_abiertas > 0/);
  assert.match(migration, /recuperacion_realizada/);
  assert.match(migration, /flujo_fisico_cerrado_t_administrativas_pendientes/);
  assert.match(migration, /v_activa := false/);
});

test('T pendientes conserva trámites históricos después de retirar la ficha', () => {
  assert.match(migration, /registros_rankeados/);
  assert.match(migration, /partition by coalesce\(r\.seguimiento_id,r\.id\)/);
  assert.match(migration, /not h\.retirado_hotel_activo\s+or app_private\.etapa_es_administrativa_alpha75\(e\.id\)/);
});

test('la regla es general y no contiene excepciones por DFM o PA', () => {
  assert.doesNotMatch(migration, /\b(?:R1448|2600245|2633|2709|2660)\b/);
});
