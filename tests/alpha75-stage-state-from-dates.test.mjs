import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogueCodeForOperationalState,
  deriveStageOperationalState,
} from '../r1-alpha75/src/stage-operational-state.js';

test('fecha programada convierte una T pendiente en programada', () => {
  assert.equal(
    deriveStageOperationalState({ fecha_prevista: '2026-10-14T18:36' }),
    'programada'
  );
});

test('los hitos posteriores tienen prioridad sobre la programación', () => {
  assert.equal(
    deriveStageOperationalState({
      fecha_prevista: '2026-10-14T18:36',
      fecha_inicio_real: '2026-10-14T18:42',
    }),
    'en_curso'
  );
  assert.equal(
    deriveStageOperationalState({
      fecha_prevista: '2026-10-14T18:36',
      fecha_inicio_real: '2026-10-14T18:42',
      fecha_fin_real: '2026-10-14T19:30',
    }),
    'realizada'
  );
});

test('anulación tiene prioridad y sin hitos queda pendiente', () => {
  assert.equal(deriveStageOperationalState({}), 'pendiente');
  assert.equal(
    deriveStageOperationalState({ cancelado: true, fecha_prevista: '2026-10-14T18:36' }),
    'anulada'
  );
});

test('usa el código de catálogo asociado al estado operativo', () => {
  const catalogue = [
    { codigo: 'pendiente', estado_operativo: 'pendiente' },
    { codigo: 'programada', estado_operativo: 'programada' },
  ];
  assert.equal(catalogueCodeForOperationalState(catalogue, 'programada'), 'programada');
});
