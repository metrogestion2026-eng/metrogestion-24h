import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../r1-alpha71/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
const context = vm.createContext({
  console,
  Date,
  Number,
  String,
  JSON,
  Math,
  RegExp,
  Object,
  Array,
});
vm.runInContext(source, context, { filename: 'sincronizar_manteniment.gs' });

assert.equal(context.metrogestionFechaIso_('01/09/2026', 'prueba'), '2026-09-01');
assert.equal(context.metrogestionFechaIso_('2026-09-02', 'prueba'), '2026-09-02');
assert.equal(context.metrogestionNumero_('5.200,50', 'km'), 5200.5);

const values = [
  ['DFM','MATRI','TIPO','UPC/INC','','LUGAR/TALLER/TEL','PEDIDO/NOTA/FIN CONTRA','MANTENIMENT','PROGRAMAT','FET','RECOLLIT','R / CON','','ASSIGNAT','MARCA','KM / HORES','ALBARÀ / ENTRADA'],
  ['2726','2741NHC','TR','JEYSON','','','2804','PARADA','02/09/2026','01/09/2026','23/09/2026','23','','','IVECO','5200','TANCAMENT 9'],
];
const notes = [[''], ['METROGESTION_PARADA:11111111-1111-4111-8111-111111111111']];
const rows = context.metrogestionLeerParadasVinculadas_(values, notes);
assert.equal(rows.length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(rows[0])), {
  fila: 2,
  sync_id: '11111111-1111-4111-8111-111111111111',
  dfm: '2726',
  matricula: '2741NHC',
  tipo: 'TR',
  upc: 'JEYSON',
  sustituto: '2804',
  estado: 'PARADA',
  fecha_programada: '2026-09-02',
  fecha_parada: '2026-09-01',
  fecha_k: '2026-09-23',
  dias_parada: 23,
  marca: 'IVECO',
  km_facturables: 5200,
  tancament: 'TANCAMENT 9',
});

const sheetData = [Array(17).fill(''), Array(17).fill('')];
const writtenNotes = new Map();
const fakeSheet = {
  getRange(row, column, rowCount = 1, columnCount = 1) {
    return {
      getValues() {
        return Array.from({ length: rowCount }, (_, rowOffset) =>
          sheetData[row - 1 + rowOffset].slice(column - 1, column - 1 + columnCount)
        );
      },
      setValues(next) {
        next.forEach((source, rowOffset) => source.forEach((value, columnOffset) => {
          sheetData[row - 1 + rowOffset][column - 1 + columnOffset] = value;
        }));
        return this;
      },
      setNumberFormat() { return this; },
      setNote(note) { writtenNotes.set(`${row}:${column}`, note); return this; },
      setBackground() { return this; },
    };
  },
};
context.metrogestionEscribirFilaAlta_(fakeSheet, 2, {
  dfm: '3000', matricula: '1234ABC', tipo: 'TR', upc: 'VARGAS', telefono: '600000000',
  contrato: '550000', estado: 'ALTA', fecha_matriculacion: '2025-01-01',
  fecha_alta: '2026-01-01', asignacion: 'FLOTA', marca: 'IVECO', bastidor: 'VIN3000',
}, '22222222-2222-4222-8222-222222222222');
assert.equal(sheetData[1][7], 'ALTA');
assert.equal(sheetData[1][8].getFullYear(), 2025);
assert.equal(sheetData[1][9].getFullYear(), 2026);
assert.equal(sheetData[1][16], 'VIN3000');
assert.equal(writtenNotes.get('2:1'), 'METROGESTION_ALTA:22222222-2222-4222-8222-222222222222');

console.log('OK: ALTA I/J, PARADA, TANCAMENT, días, kilómetros y escritura de Activos.');
