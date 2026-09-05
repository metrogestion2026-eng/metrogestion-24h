import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migration = await readFile(path.join(
  root,
  'supabase/migrations/20260905151320_alpha72_reactivacion_atomica_hotel.sql'
), 'utf8');
const editor = await readFile(path.join(root, 'r1-alpha72/src/hotel-editor.js'), 'utf8');

assert.match(migration, /registros_hotel_reserva_activa_pizarra_uq/);
assert.match(migration, /pizarra_id, upper\(btrim\(vehiculo_reserva\)\)/);
assert.match(migration, /app_private\.reabrir_cierre_ficha_hotel/);
assert.match(migration, /app_private\.preparar_etapas_reactivacion_hotel/);
assert.match(migration, /app_private\.asegurar_reactivacion_historica/);
assert.match(migration, /ficha_hotel_activa_sin_cierre_realizado/);
assert.match(migration, /deferrable initially deferred/);
assert.match(migration, /reactivacion_coherente/);
assert.match(migration, /v_ficha_out := jsonb_set\(v_ficha_out, '\{retirado_hotel_activo\}', 'true'::jsonb/);
assert.match(migration, /perform app_private\.reabrir_cierre_ficha_hotel\(v_reactivated_id, auth\.uid\(\)\)/);
assert.match(migration, /e\.accion_sistema in \('recuperar_y_liberar', 'liberar_reserva'\)/);
assert.match(migration, /fecha_fin_real = null/);
assert.match(migration, /marcado_rapido = false/);
assert.doesNotMatch(migration, /join[\s\S]{0,120}vehiculo_reserva[\s\S]{0,120}etapas_hotel/i);

assert.match(editor, /reactivación completa: ficha, T final y reserva sincronizadas/);

console.log('Alpha72: reactivación atómica e integridad de reserva verificadas.');
