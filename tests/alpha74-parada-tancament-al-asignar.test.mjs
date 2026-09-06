import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const script = fs.readFileSync(new URL('../r1-alpha74/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260906073154_alpha74_parada_tancament_al_asignar_numero.sql', import.meta.url), 'utf8');
const proposalDateMigration = fs.readFileSync(new URL('../supabase/migrations/20260906073453_alpha74_fecha_propuesta_al_generar_parada.sql', import.meta.url), 'utf8');
const context = vm.createContext({ console, Date, Number, String, JSON, Math, RegExp, Object, Array });
vm.runInContext(script, context, { filename: 'sincronizar_manteniment.gs' });

const headers = ['DFM','MATRI','TIPO','UPC/INC','','LUGAR/TALLER/TEL','PEDIDO/NOTA/FIN CONTRA','MANTENIMENT','PROGRAMAT','FET','RECOLLIT','R / CON','','ASSIGNAT','MARCA','KM / HORES','ALBARÀ / ENTRADA'];
const values = [
  headers,
  ['2489','6779MJM','TR','JUAN','PA-2600200','','2600','PARADA','07/09/2026','','','','','','IVECO','',''],
  ['2490','1234ABC','TR','JUAN','PA-2600201','','2601','ANULADA','','','','','','','IVECO','',''],
];
const notes = [
  [''],
  ['METROGESTION_PARADA:11111111-1111-4111-8111-111111111111'],
  ['METROGESTION_PARADA:22222222-2222-4222-8222-222222222222'],
];
const rows = context.metrogestionLeerParadasVinculadas_(values, notes);
assert.equal(rows.length, 2);
assert.equal(rows[0].estado, 'PARADA');
assert.equal(rows[0].fecha_parada, '');
assert.deepEqual(JSON.parse(JSON.stringify(rows[1])), {
  fila: 3,
  sync_id: '22222222-2222-4222-8222-222222222222',
  estado: 'ANULADA',
});

const sheetData = [Array(17).fill(''), values[1].slice()];
const backgrounds = new Map([['2:1', '#d9e2e3']]);
const fakeSheet = {
  getRange(row, column, rowCount = 1, columnCount = 1) {
    return {
      getValues() {
        return Array.from({ length: rowCount }, (_, r) => sheetData[row - 1 + r].slice(column - 1, column - 1 + columnCount));
      },
      getDisplayValue() { return String(sheetData[row - 1][column - 1] ?? ''); },
      setValues(next) {
        next.forEach((source, r) => source.forEach((value, c) => { sheetData[row - 1 + r][column - 1 + c] = value; }));
        return this;
      },
      setValue(value) { sheetData[row - 1][column - 1] = value; return this; },
      setNumberFormat() { return this; },
      setNote() { return this; },
      getBackground() { return backgrounds.get(`${row}:${column}`) || '#d9e2e3'; },
      setBackground(value) { backgrounds.set(`${row}:${column}`, value); return this; },
    };
  },
};

const operationalBefore = [8, 9, 10, 11, 15, 16].map(index => sheetData[1][index]);
context.metrogestionEscribirFilaParada_(fakeSheet, 2, {
  dfm: '2489', matricula: '6779MJM', tipo: 'TR', upc: 'JUAN', numero_parada: 'PA-2600200',
  sustituto: '2600', marca: 'IVECO', estado: 'ANULADA'
}, '11111111-1111-4111-8111-111111111111', false);
assert.equal(sheetData[1][7], 'ANULADA');
assert.deepEqual([8, 9, 10, 11, 15, 16].map(index => sheetData[1][index]), operationalBefore);
assert.equal(backgrounds.get('2:8'), '#f4cccc');

const existingRows = [
  ['2489','','','','PA-2600200','','','PARADA','','','','','','','','',''],
  ['2489','','','','PA-2600200','','','PARADA','','','','','','','','','TANCAMENT 9'],
];
const existingSheet = {
  getLastRow() { return existingRows.length + 1; },
  getRange() { return { getDisplayValues() { return existingRows; } }; },
};
assert.equal(context.metrogestionBuscarFilaParadaExistente_(existingSheet, {
  dfm: '2489', numero_parada: 'PA-2600200', tancament: 'TANCAMENT 9'
}), 3);
assert.throws(() => context.metrogestionBuscarFilaParadaExistente_(existingSheet, {
  dfm: '2489', numero_parada: 'PA-2600200', tancament: ''
}), /coincide con varias filas/);

assert.match(migration, /if btrim\(coalesce\(v_payload->>'numero_parada', ''\)\) = '' then return/);
assert.match(migration, /'estado', case when v_anulada then 'ANULADA' else 'PARADA' end/);
assert.match(migration, /v_estado not in \('PARADA', 'ANULADA'\)/);
assert.match(migration, /J puede estar vacía mientras la sustitución sea solo una propuesta/);
assert.doesNotMatch(migration, /La fecha de parada de la columna J es obligatoria/);
assert.match(migration, /if v_cancelada then[\s\S]*continue;/);
assert.match(proposalDateMigration, /clock_timestamp\(\) at time zone 'Europe\/Madrid'/);
assert.match(proposalDateMigration, /fecha_programada_parada = coalesce/);
assert.match(proposalDateMigration, /and s\.fecha_programada_parada is null/);

console.log('OK: número asignado crea PARADA pendiente y la anulación conserva la misma fila.');
