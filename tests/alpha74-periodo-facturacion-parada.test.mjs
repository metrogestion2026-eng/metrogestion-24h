import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(
  new URL('../r1-alpha74/google-apps-script/sincronizar_manteniment.gs', import.meta.url),
  'utf8'
);
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260909150000_alpha74_periodo_facturacion_parada.sql', import.meta.url),
  'utf8'
);

const context = vm.createContext({ console, Date, Number, String, JSON, Math, RegExp, Object, Array });
vm.runInContext(script, context, { filename: 'sincronizar_manteniment.gs' });

function fakeSheet(initialQ = '') {
  const row = Array(17).fill('');
  row[16] = initialQ;
  return {
    row,
    getRange(_row, column, _rowCount = 1, columnCount = 1) {
      return {
        getValues: () => [row.slice(column - 1, column - 1 + columnCount)],
        getDisplayValue: () => String(row[column - 1] ?? ''),
        setValues(values) {
          values[0].forEach((value, index) => { row[column - 1 + index] = value; });
          return this;
        },
        setValue(value) { row[column - 1] = value; return this; },
        clearContent() { row[column - 1] = ''; return this; },
        setNumberFormat() { return this; },
        setNote() { return this; },
        getBackground() { return '#cfe2f3'; },
        setBackground() { return this; },
      };
    },
  };
}

test('el payload de PARADA propone el período de facturación abierto', () => {
  assert.match(migration, /from public\.cierres_facturacion c/);
  assert.match(migration, /clock_timestamp\(\) at time zone 'Europe\/Madrid'/);
  assert.match(migration, /'TANCAMENT ' \|\| \(split_part\(c\.periodo, '-', 2\)::integer\)::text/);
  assert.match(migration, /'tancament', v_tancament_payload/);
});

test('Q se completa si está vacía y nunca sobrescribe un período existente', () => {
  const blank = fakeSheet();
  context.metrogestionEscribirFilaParada_(blank, 1, {
    estado: 'PARADA',
    tancament: 'TANCAMENT 9',
  }, '11111111-1111-4111-8111-111111111111', false);
  assert.equal(blank.row[16], 'TANCAMENT 9');

  const informed = fakeSheet('TANCAMENT 8');
  context.metrogestionEscribirFilaParada_(informed, 1, {
    estado: 'PARADA',
    tancament: 'TANCAMENT 9',
  }, '22222222-2222-4222-8222-222222222222', false);
  assert.equal(informed.row[16], 'TANCAMENT 8');
});

console.log('Alpha74: la línea PARADA recibe el período abierto en Q sin sobrescrituras.');
