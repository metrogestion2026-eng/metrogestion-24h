import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Pendiente de parar se conserva antes de una entrada aún no programada', () => {
  const ficha = { estado:'planificado', modelo_flujo_taller:'entrada_hitos_v1' };
  const stages = [
    { id:'e1', posicion:1, tipo_etapa:'entrada_taller', estado:'pendiente', cancelado:false },
    { id:'r1', posicion:2, tipo_etapa:'otro', accion_sistema:'recuperar_y_liberar', estado:'pendiente', cancelado:false },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'planificado');
});

test('un trámite pendiente antes de recuperar manda sobre la recuperación futura', () => {
  const ficha = { estado:'pendiente_taller', modelo_flujo_taller:'entrada_hitos_v1', vehiculo_reserva:'2781' };
  const stages = [
    { id:'done', posicion:1, tipo_etapa:'entrada_taller', estado:'realizada', fecha_real:'2026-11-11T11:57:00Z', cancelado:false },
    { id:'itv', posicion:2, tipo_etapa:'TRÁMITE', estado:'pendiente', nombre:'ITV', cancelado:false },
    { id:'rec', posicion:3, tipo_etapa:'otro', accion_sistema:'recuperar_y_liberar', estado:'pendiente', cancelado:false },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'tramite');
});

test('TM pendiente no sustituye Pendiente de taller cuando hay una entrada posterior pendiente', () => {
  const ficha = { estado:'pendiente_taller', modelo_flujo_taller:'entrada_hitos_v1', vehiculo_reserva:'2610' };
  const stages = [
    { id:'itv', posicion:1, tipo_etapa:'TRÁMITE', estado:'realizada', nombre:'ITV', fecha_real:'2026-11-04T05:50:00Z', cancelado:false },
    { id:'tm', posicion:2, tipo_etapa:'TRÁMITE', estado:'pendiente', nombre:'TM', cancelado:false },
    { id:'taller', posicion:3, tipo_etapa:'entrada_taller', estado:'pendiente', nombre:'ENTRADA AUTODIS', cancelado:false },
    { id:'rec', posicion:4, tipo_etapa:'otro', accion_sistema:'recuperar_y_liberar', estado:'pendiente', cancelado:false },
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'pendiente_taller');
});

test('una entrada acabada y no recogida proyecta Terminado pendiente de recoger', () => {
  const ficha = { estado:'t_pendientes', modelo_flujo_taller:'entrada_hitos_v1' };
  const stages = [{
    id:'taller',
    posicion:1,
    tipo_etapa:'entrada_taller',
    estado:'en_curso',
    fecha_inicio_real:'2026-11-09T12:09:00Z',
    fecha_fin_real:'2026-11-10T17:23:00Z',
    fecha_real:null,
    cancelado:false,
  }];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'terminado_pendiente_recogida');
});

test('el servidor ya no recoloca Recuperar por tipo', async () => {
  const sql = await read('supabase/migrations/20261111165000_alpha75_estado_real_orden_t.sql');
  assert.match(sql, /order by e\.posicion,e\.creado_en,e\.id/);
  const normalizer = sql.slice(
    sql.indexOf('create or replace function app_private.normalizar_orden_t_parada'),
    sql.indexOf('create or replace function app_private.estado_t_pendiente_por_orden_alpha75')
  );
  assert.doesNotMatch(normalizer, /es_recuperacion/);
  assert.doesNotMatch(normalizer, /ultima_fisica/);
  assert.doesNotMatch(normalizer, /\+ 0\.5/);
});

test('la caché activa apunta a la revisión de estado real y orden', async () => {
  const html = await read('r1-alpha75/index.html');
  const main = await read('r1-alpha75/src/hotel-editor-main.js');
  assert.match(html, /boot75\.js\?v=75\.26-taller-hitos-001/);
  assert.match(main, /hotel-operational-state\.js\?v=75\.26-taller-hitos-001/);
});
