import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(source, ctx, { filename: 'sincronizar_manteniment.gs' });

const parse = (value, open = false) => ctx.metrogestionNumero_(value, 'Cantidad de prueba', open);

function snapshot({ days = '10', km = '12.345', end = '10/01/2026', status = 'PARADA' } = {}) {
  const row = Array(17).fill('');
  Object.assign(row, {
    0: 'TEST-NUM', 4: 'PA-TEST-NUM', 7: status,
    9: '01/01/2026', 10: end, 11: days, 15: km, 16: 'TANCAMENT 1',
  });
  return {
    values: [Array(17).fill(''), row],
    notes: [[''], ['METROGESTION_PARADA:11111111-1111-4111-8111-111111111111']],
  };
}

const readers = [
  'metrogestionLeerParadasVinculadas_',
  'metrogestionLeerCierresFacturacion_',
];

test('interpreta puntos de miles y coma decimal del resultado mostrado por Sheets', () => {
  assert.equal(parse('3.228'), 3228);
  assert.equal(parse('12.345.678'), 12345678);
  assert.equal(parse('3.228,50'), 3228.5);
  assert.equal(parse('1\u00a0234,50'), 1234.5);
  assert.equal(parse('12,50'), 12.5);
  assert.equal(parse('12.5'), 12.5);
});

test('conserva los números nativos sin reinterpretar sus decimales ni perder el cero', () => {
  assert.equal(parse(3.228), 3.228);
  assert.equal(parse(1234.567), 1234.567);
  assert.equal(parse(0), 0);
  assert.equal(parse('0'), 0);
  assert.equal(parse(''), '');
  assert.equal(parse(null), '');
  assert.equal(parse(undefined), '');
});

test('los negativos provisionales de un tramo abierto quedan vacíos tras interpretar miles', () => {
  assert.equal(parse('-12.345.678', true), '');
  assert.equal(parse('-12345678', true), '');
  assert.equal(parse(-12345678, true), '');
});

test('un tramo cerrado sigue rechazando negativos y cantidades no numéricas', () => {
  for (const value of ['-12.345.678', -12345678, '1.23.45', '#VALUE!', NaN, Infinity]) {
    assert.throws(() => parse(value), /no contiene un número válido/);
  }
  assert.throws(() => parse('#VALUE!', true), /no contiene un número válido/);
});

test('los feeds operativo y contable conservan la misma cantidad positiva', () => {
  const { values, notes } = snapshot();
  for (const reader of readers) {
    const result = ctx[reader](values, notes)[0];
    assert.equal(result.dias_parada, 10);
    assert.equal(result.km_facturables, 12345);
    assert.equal(result.fecha_k, '2026-01-10');
  }
});

test('ambos feeds omiten el resultado negativo de una fórmula abierta sin tocar la fotografía', () => {
  const { values, notes } = snapshot({ days: '-40.000', km: '-12.345.678', end: '' });
  const before = JSON.stringify({ values, notes });
  for (const reader of readers) {
    const result = ctx[reader](values, notes)[0];
    assert.equal(result.dias_parada, '');
    assert.equal(result.km_facturables, '');
    assert.equal(result.fecha_k, '');
  }
  assert.equal(JSON.stringify({ values, notes }), before);
});

test('ambos feeds conservan vacíos y controles OK/KO, y rechazan negativos cerrados', () => {
  for (const reader of readers) {
    for (const km of ['', 'OK', 'KO']) {
      const { values, notes } = snapshot({ km });
      assert.equal(ctx[reader](values, notes)[0].km_facturables, '');
    }
    const { values, notes } = snapshot({ km: '-12.345.678' });
    assert.throws(() => ctx[reader](values, notes), /no contiene un número válido/);
  }
});

test('una parada anulada no se convierte en kilometraje facturable', () => {
  const { values, notes } = snapshot({ status: 'ANULADA', km: '#VALUE!' });
  const result = ctx.metrogestionLeerParadasVinculadas_(values, notes)[0];
  assert.equal(result.estado, 'ANULADA');
  assert.equal('km_facturables' in result, false);
  assert.equal(ctx.metrogestionLeerCierresFacturacion_(values, notes).length, 0);
});
