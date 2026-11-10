import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('una T física en curso con taller asignado proyecta En taller aunque sea tipo otro', () => {
  const ficha = {
    estado: 't_pendientes',
    modelo_flujo_taller: 'entrada_hitos_v1',
    modalidad_operativa: '',
  };
  const stages = [{
    id: 'stage-macman',
    tipo_etapa: 'otro',
    taller_id: 'taller-macman',
    centro_taller_id: 'centro-macman',
    estado: 'en_curso',
    fecha_inicio_real: '2026-11-09T05:45',
    fecha_fin_real: '',
    fecha_real: '',
    cancelado: false,
    posicion: 1,
  }];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});

test('un trámite en curso con taller asignado sigue siendo trámite, no En taller', () => {
  const ficha = {
    estado: 'tramite',
    modelo_flujo_taller: 'entrada_hitos_v1',
    modalidad_operativa: '',
  };
  const stages = [{
    id: 'stage-itv',
    tipo_etapa: 'TRÁMITE',
    taller_id: 'applus',
    estado: 'en_curso',
    fecha_inicio_real: '2026-11-06T11:22',
    fecha_fin_real: '',
    fecha_real: '',
    cancelado: false,
    posicion: 1,
  }];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'tramite');
});

test('la cabecera de edición avanza Entrada / movimiento con el último hito real', async () => {
  const main = await read('r1-alpha75/src/hotel-editor-main.js');
  assert.match(main, /function latestStageMovement/);
  assert.match(main, /stage\.fecha_inicio_real, stage\.fecha_fin_real, stage\.fecha_real/);
  assert.match(main, /isLaterMovement\(latestMovement, detail\.ficha\.fecha_entrada\)/);
  assert.doesNotMatch(main, /detail\.ficha\.fecha_entrada = latestMovement/);
  assert.match(main, /controls\.fecha_entrada\.value = latestMovement/);
  assert.match(main, /Previsualización únicamente/);
  assert.match(main, /controls\[key\] = control/);
});

test('el servidor conserva fecha de parada y avanza movimiento de forma monótona', async () => {
  const sql = await read('supabase/migrations/20261110063000_alpha75_movimiento_fecha_estancia_taller.sql');
  assert.match(sql, /No se altera Fecha real de parada/);
  assert.match(sql, /fecha_entrada < v_movimiento/);
  assert.match(sql, /fecha_entrada < u\.movimiento/);
  assert.match(sql, /taller_id is not null or e\.centro_taller_id is not null/);
  assert.match(sql, /not in \(\s*'tramite','gestion','24h'/);
  assert.match(sql, /actualizar_fecha_movimiento_hotel_alpha75/);
});
