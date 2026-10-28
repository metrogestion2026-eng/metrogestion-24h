import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260911133000_alpha75_t_modificacion_operativa.sql', import.meta.url), 'utf8');
const guard = "La parada tiene una entrada de taller activa: no puede quedar Recuperado ni Reserva liberada";

test('2556: el guardado protege la entrada abierta antes de propagar datos', () => {
  const start = sql.indexOf('create or replace function app_private.guardar_ficha_hotel_edicion(');
  const body = sql.slice(start);
  const core = body.indexOf('v_saved:=public.guardar_ficha_hotel_edicion_core(');
  const check = body.indexOf(guard);
  const propagation = body.indexOf('v_prop_rows:=app_private.propagar_correcciones_globales_parada(');
  assert.ok(core >= 0 && check > core && propagation > check);
  assert.match(body.slice(core, propagation), /e\.tipo_etapa = 'entrada_taller'/);
  assert.match(body.slice(core, propagation), /e\.fecha_inicio_real is not null/);
  assert.match(body.slice(core, propagation), /e\.fecha_real is null/);
});

test('2556: la reconciliación protege también la pizarra en curso', () => {
  const start = sql.indexOf('create or replace function app_private.reconciliar_etapas_hotel(');
  const end = sql.indexOf('create or replace function app_private.guardar_ficha_hotel_edicion(', start);
  const body = sql.slice(start, end);
  assert.match(body, /La parada tiene una entrada de taller activa/);
  assert.match(body, /r\.estado in \('recuperado','reserva_liberada'\)/);
});
