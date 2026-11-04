import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projection = await readFile(
  new URL('../supabase/migrations/20261104063000_alpha75_situacion_operativa_proyeccion.sql', import.meta.url),
  'utf8',
);
const sync = await readFile(
  new URL('../supabase/migrations/20261104063100_alpha75_situacion_operativa_sincronizacion.sql', import.meta.url),
  'utf8',
);
const rollover = await readFile(
  new URL('../supabase/migrations/20261104063200_alpha75_rollover_situacion_prearchivo.sql', import.meta.url),
  'utf8',
);

const combined = `${projection}\n${sync}\n${rollover}`;

test('la situación operativa del Hotel se deriva de las T y no de una cabecera paralela', () => {
  assert.match(projection, /proyectar_situacion_operativa_hotel_alpha75/);
  assert.match(sync, /sincronizar_situacion_operativa_hotel_alpha75/);
  assert.match(projection, /tipo_etapa = 'entrada_taller'[\s\S]*estado = 'en_curso'/);
  assert.match(projection, /v_estado := 'en_taller'/);
  assert.match(projection, /v_estado := 'tramite'/);
  assert.match(projection, /v_estado := 'gestion'/);
  assert.match(projection, /v_estado := 'terminado_pendiente_recogida'/);
  assert.match(projection, /v_estado := 'recogido_pendiente_ruta'/);
  assert.match(projection, /elsif v_sustitucion_vigente then\s+v_activa := true/);
  assert.match(sync, /zzzzzz_etapas_hotel_situacion_operativa_alpha75/);
  assert.match(sync, /zzzzzz_registros_hotel_situacion_operativa_alpha75/);
});

test('el rollover sincroniza antes de archivar y después de copiar', () => {
  const preSync = rollover.indexOf('for v_registro_id in');
  const legacyCall = rollover.indexOf('v_destino_id := app_private.crear_pizarra_diaria_sin_situacion_alpha75');
  assert.ok(preSync >= 0, 'falta sincronizar la pizarra origen');
  assert.ok(legacyCall > preSync, 'la sincronización debe ejecutarse antes del rollover original');
  assert.match(rollover, /metrogestion-r1-rollover-preflight/);
  assert.match(rollover, /not r\.retirado_hotel_activo/);
  assert.match(rollover, /sincronizar_situacion_operativa_hotel_alpha75\([\s\S]*true/);
  assert.equal((rollover.match(/for v_registro_id in/g) || []).length, 2);
});

test('la corrección es general y no contiene excepciones por DFM', () => {
  assert.doesNotMatch(combined, /\b(?:2489|2548|2554|2625|2611|2781)\b/);
  assert.match(sync, /terminada sin sustitución dentro de Activas/);
  assert.match(sync, /entrada de taller activa con estado de cabecera incoherente/);
});
