import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260911123000_alpha74_24h_aislada_de_manteniment.sql', import.meta.url),
  'utf8'
);
const cleanup = readFileSync(
  new URL('../supabase/migrations/20260911123500_alpha74_limpiar_24h_2552_2625.sql', import.meta.url),
  'utf8'
);
const cleanup2625 = readFileSync(
  new URL('../supabase/migrations/20260911124000_alpha74_completar_limpieza_24h_2625.sql', import.meta.url),
  'utf8'
);
const accentedNameFix = readFileSync(
  new URL('../supabase/migrations/20260911124500_alpha74_reconocer_averia_24h_acentuada.sql', import.meta.url),
  'utf8'
);
const normalize2552 = readFileSync(
  new URL('../supabase/migrations/20260911125000_alpha74_normalizar_recuperacion_24h_2552.sql', import.meta.url),
  'utf8'
);

test('MANTENIMENT no importa necesidades en la parada activa 24H', () => {
  assert.match(migration, /manteniment_dfm_bloqueado_por_24h_alpha74/);
  assert.match(migration, /where not app_private\.manteniment_dfm_bloqueado_por_24h_alpha74/);
  assert.doesNotMatch(migration, /delete from public\.etapas_hotel/);
});

test('la limpieza se limita a 44TN, ITV y EDT y elimina su auditoría', () => {
  assert.match(cleanup, /delete from app_private\.manteniment_t_trabajos/);
  assert.match(cleanup, /delete from app_private\.manteniment_t_visitas/);
  assert.match(cleanup, /delete from public\.trabajos_etapa_hotel/);
  assert.match(cleanup, /delete from public\.etapas_hotel/);
  assert.match(cleanup, /delete from public\.auditoria_cambios/);
  assert.match(cleanup, /a\.dfm[\s\S]*?= '2625'[\s\S]*?'44TN', 'ITV'/);
  assert.match(cleanup, /a\.dfm[\s\S]*?= '2552'[\s\S]*?= 'EDT'/);
});

test('la segunda pasada del 2625 usa claves de negocio y no UUID fijos', () => {
  assert.match(cleanup2625, /a\.dfm[\s\S]*?= '2625'/);
  assert.match(cleanup2625, /t\.tipo_trabajo[\s\S]*?in \('44TN', 'ITV'\)/);
  assert.match(cleanup2625, /delete from public\.auditoria_cambios/);
  assert.doesNotMatch(cleanup2625, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test('el reconciliador reconoce también 24H · Avería con la Í eliminada', () => {
  assert.match(accentedNameFix, /24HAVERA/);
  assert.match(accentedNameFix, /manteniment_reconciliar_asistencia_alpha74/);
});

test('la recuperación histórica del 2552 queda tipificada como recuperar ruta', () => {
  assert.match(normalize2552, /a\.dfm[\s\S]*?= '2552'/);
  assert.match(normalize2552, /tipo_etapa = 'recuperar_ruta'/);
  assert.match(normalize2552, /accion_sistema = 'recuperar_y_liberar'/);
});

test('24H conserva avería y recuperación sin convertirse en taller', () => {
  assert.match(migration, /set nombre = '24H · Avería'/);
  assert.match(migration, /if v_tipo_movimiento = '24H' then\s+return true;/);
  assert.match(migration, /normalizar_estado_taller_24h_alpha74/);
  assert.match(migration, /and not exists \([\s\S]*?e\.tipo_etapa = 'entrada_taller'/);
});

test('solo la grúa confirmada y su taller crean entrada y recogida', () => {
  assert.match(migration, /v_traslado := coalesce\(v_activacion\.trasladado_taller, false\)/);
  assert.match(migration, /v_taller := btrim\(coalesce\(v_activacion\.taller_traslado, ''\)\)/);
  assert.match(migration, /if v_traslado and v_taller <> '' then/);
  assert.match(migration, /'entrada_taller'/);
  assert.match(migration, /'recogida_taller'/);
});
