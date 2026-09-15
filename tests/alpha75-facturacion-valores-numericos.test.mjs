import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(source, ctx, { filename: 'sincronizar_manteniment.gs' });

function leer({ rawKm = 14490, rawDays = 21, displayKm = '14.490', k = '', estado = 'PARADA' } = {}) {
  const row = Array(17).fill('');
  Object.assign(row, { 0: '2721', 4: 'PA-2600126', 7: estado, 9: '24/08/2026', 10: k, 11: '21', 15: displayKm, 16: 'TANCAMENT 9' });
  return ctx.metrogestionLeerParadasVinculadas_(
    [Array(17).fill(''), row],
    [[''], ['METROGESTION_PARADA:11111111-1111-4111-8111-111111111111']],
    [Array(5).fill(''), [rawDays, '', '', '', rawKm]],
  )[0];
}

test('preserva miles numéricos aunque la hoja los muestre con punto', () => {
  assert.equal(leer().km_facturables, 14490);
  assert.equal(leer({ rawKm: 29150, displayKm: '29.150' }).km_facturables, 29150);
});

test('preserva decimales y cero reales sin adivinar separadores', () => {
  assert.equal(leer({ rawKm: 14.49, displayKm: '14,49' }).km_facturables, 14.49);
  assert.equal(leer({ rawKm: 14490.5, displayKm: '14.490,50' }).km_facturables, 14490.5);
  assert.equal(leer({ rawKm: 0, rawDays: 0 }).km_facturables, 0);
  assert.equal(leer({ rawKm: 0, rawDays: 0 }).dias_parada, 0);
});

test('distingue celda vacía y controles OK/KO de cantidades', () => {
  for (const rawKm of ['', 'OK', 'KO']) assert.equal(leer({ rawKm }).km_facturables, '');
  assert.equal(leer({ rawDays: '' }).dias_parada, '');
});

test('mantiene la protección de fórmulas negativas en periodos abiertos', () => {
  const result = leer({ rawKm: -11240451, rawDays: -46257 });
  assert.equal(result.km_facturables, '');
  assert.equal(result.dias_parada, '');
  assert.throws(() => leer({ rawKm: -1, k: '15/09/2026' }), /no contiene un número válido/);
});

test('no interpreta cifras de una parada anulada', () => {
  const result = leer({ estado: 'ANULADA', rawKm: 'no válido' });
  assert.equal(result.estado, 'ANULADA');
  assert.equal('km_facturables' in result, false);
});
