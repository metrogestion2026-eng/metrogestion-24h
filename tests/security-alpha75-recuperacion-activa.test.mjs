import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveHotelOperationalState } from '../r1-alpha75/src/hotel-operational-state.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('recuperación activa sin taller físico proyecta Pendiente de recuperar', () => {
  const ficha = { estado:'t_pendientes', modelo_flujo_taller:'entrada_hitos_v1' };
  const stages = [{
    id:'rec',
    nombre:'Recuperar ruta y liberar reserva',
    posicion:2,
    estado:'en_curso',
    tipo_etapa:'recuperar_ruta',
    accion_sistema:'recuperar_y_liberar',
    fecha_inicio_real:'2026-11-10T17:22:00Z',
    cancelado:false,
  }];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'recogido_pendiente_ruta');
});

test('sin sustitución no convierte una recuperación heredada en Pendiente de recuperar', () => {
  const ficha = {
    estado:'t_pendientes',
    modelo_flujo_taller:'entrada_hitos_v1',
    modalidad_operativa:'sin_sustitucion',
    vehiculo_reserva:'',
  };
  const stages = [{
    id:'rec-legacy',
    posicion:2,
    nombre:'Recuperar ruta y liberar reserva',
    tipo_etapa:'otro',
    estado:'pendiente',
    cancelado:false,
  }];
  assert.equal(deriveHotelOperationalState(ficha, stages), 't_pendientes');
});

test('taller físico activo conserva prioridad sobre recuperación activa', () => {
  const ficha = { estado:'en_taller', modelo_flujo_taller:'entrada_hitos_v1' };
  const stages = [
    {
      id:'taller',
      posicion:1,
      estado:'en_curso',
      tipo_etapa:'entrada_taller',
      taller_id:'taller',
      fecha_inicio_real:'2026-11-06T05:00:00Z',
      cancelado:false,
    },
    {
      id:'rec',
      posicion:2,
      estado:'en_curso',
      tipo_etapa:'otro',
      accion_sistema:'recuperar_y_liberar',
      fecha_inicio_real:'2026-11-06T05:56:00Z',
      cancelado:false,
    }
  ];
  assert.equal(deriveHotelOperationalState(ficha, stages), 'en_taller');
});

test('la migración reconoce recuperación en curso antes de otra T genérica', async () => {
  const sql = await read('supabase/migrations/20261110174000_alpha75_recuperacion_activa_estado.sql');
  assert.match(sql, /recuperacion_en_curso/);
  assert.match(sql, /recogido_pendiente_ruta/);
  assert.match(sql, /accion_sistema='recuperar_y_liberar'/);
  assert.match(sql, /sin_sustitucion/);
  assert.match(sql, /reparado_en_ruta/);
  assert.match(sql, /reserva_en_reparacion/);
});
