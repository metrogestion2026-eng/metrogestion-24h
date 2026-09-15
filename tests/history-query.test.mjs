import assert from 'node:assert/strict';
import test from 'node:test';
import { safeHistorySearch, searchHistoricalRecords } from '../shared/history-query.mjs';

const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
function fixture() {
  const records = [
    { id: id(1), pizarra_id: id(101), seguimiento_id: id(201), vehiculo_sustituido: 'R1320', numero_parada: '2600121', orden: 5, marca: 'CARRIER', actualizado_en: '2026-09-14T09:00:00Z' },
    { id: id(2), pizarra_id: id(102), seguimiento_id: id(201), vehiculo_sustituido: 'R1320', numero_parada: '2600121', orden: 5, marca: 'CARRIER', actualizado_en: '2026-09-15T09:00:00Z' },
    { id: id(3), pizarra_id: id(102), seguimiento_id: id(202), vehiculo_sustituido: 'R1487', numero_parada: '2600152', orden: 3, marca: 'CARRIER', cancelado: true },
    { id: id(4), pizarra_id: id(102), seguimiento_id: id(203), vehiculo_sustituido: '2489', matricula_sustituido: 'TEST-d793df72', numero_parada: '2600133', orden: 1, marca: 'IVECO' },
  ];
  return {
    registros_hotel: records,
    hotel_por_dia: records.map(row => ({ ...row, fecha_pizarra: row.pizarra_id === id(101) ? '2026-09-14' : '2026-09-15' })),
    pizarras: [{ id: id(101), fecha: '2026-09-14' }, { id: id(102), fecha: '2026-09-15' }],
    etapas_hotel: [
      ...Array.from({ length: 205 }, (_, index) => ({ id: id(1000 + index), registro_hotel_id: id(1), grupo_documental_id: id(2000 + index), nombre: 'Trabajo ordinario' })),
      { id: id(1300), registro_hotel_id: id(1), grupo_documental_id: id(2300), nombre: 'Inyección extrema', cancelado: true },
      { id: id(1301), registro_hotel_id: id(2), grupo_documental_id: id(2300), nombre: 'TMG' },
      { id: id(1302), registro_hotel_id: id(4), grupo_documental_id: id(2301), nombre: 'Entrada taller' },
    ],
    trabajos_etapa_hotel: [{ id: id(3000), etapa_hotel_id: id(1302), expediente: 'EXP-999888', diagnostico_real: 'Bomba hidráulica' }],
    documentos_gestion: [{ id: id(4000), grupo_etapa_id: id(2300), nombre_original: 'Certificado fugas.pdf' }],
    anotaciones_manuales_hotel: [
      { id: id(5000), seguimiento_id: id(203), texto: 'Avisar a la plataforma', cancelada: false },
      { id: id(5001), seguimiento_id: id(203), texto: 'Nota retirada', cancelada: true },
    ],
  };
}

function fakeClient(tables, failTable) {
  const calls = [];
  let active = 0;
  let maximum = 0;
  return {
    calls,
    get maximum() { return maximum; },
    from(table) {
      const request = { table, filters: [] };
      const builder = {
        select(columns) { request.columns = columns; return this; },
        order(column) { request.order = column; return this; },
        gt(column, value) { request.after = { column, value }; return this; },
        eq(column, value) { request.filters.push({ column, value }); return this; },
        in(column, values) { request.ids = { column, values }; return this; },
        limit(value) { request.limit = value; return this; },
        then(resolve, reject) {
          return (async () => {
            calls.push(request);
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise(done => setTimeout(done, 0));
            active -= 1;
            if (table === failTable) return { error: { message: 'Error de conexión de prueba' } };
            let rows = [...(tables[table] || [])];
            if (request.order) rows.sort((a, b) => String(a[request.order]).localeCompare(String(b[request.order])));
            if (request.after) rows = rows.filter(row => row[request.after.column] > request.after.value);
            for (const filter of request.filters) rows = rows.filter(row => row[filter.column] === filter.value);
            if (request.ids) rows = rows.filter(row => request.ids.values.includes(row[request.ids.column]));
            if (request.limit) rows = rows.slice(0, request.limit);
            return { data: request.ids ? rows.reverse() : rows, error: null };
          })().then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('encuentra la ficha más reciente, una vez por seguimiento, sin depender del día elegido', async () => {
  const client = fakeClient(fixture());
  const result = await searchHistoricalRecords(client, 'r1320');
  assert.deepEqual(result.rows.map(row => row.id), [id(2)]);
  assert.equal(result.total, 1);
  assert.equal(result.truncated, false);
  assert.ok(client.maximum <= 2);
  for (const query of client.calls.filter(query => query.table !== 'hotel_por_dia')) assert.equal(query.limit, 200);
  assert.deepEqual(client.calls.find(query => query.table === 'hotel_por_dia').ids.values, [id(2)]);
});

test('recorre páginas posteriores de T y conduce a la ficha actual de una coincidencia antigua', async () => {
  const client = fakeClient(fixture());
  const result = await searchHistoricalRecords(client, 'inyeccion extrema');
  assert.deepEqual(result.rows.map(row => row.id), [id(2)]);
  const pages = client.calls.filter(query => query.table === 'etapas_hotel');
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[1].after, { column: 'id', value: id(1199) });
});

test('admite PA- y mantiene recuperables las paradas anuladas', async () => {
  const result = await searchHistoricalRecords(fakeClient(fixture()), 'PA-2600152');
  assert.deepEqual(result.rows.map(row => row.id), [id(3)]);
  assert.equal(result.rows[0].cancelado, true);
});

test('busca matrícula, trabajos, expedientes, documentos por grupo y anotaciones', async () => {
  for (const [term, expected] of [['TEST-d793df72', 4], ['EXP-999888', 4], ['bomba hidraulica', 4], ['Certificado fugas.pdf', 2], ['plataforma', 4]]) {
    const result = await searchHistoricalRecords(fakeClient(fixture()), term);
    assert.deepEqual(result.rows.map(row => row.id), [id(expected)], term);
  }
  assert.equal((await searchHistoricalRecords(fakeClient(fixture()), 'Nota retirada')).total, 0);
});

test('el límite se aplica después de agrupar seguimientos y mantiene el orden de las fichas', async () => {
  const result = await searchHistoricalRecords(fakeClient(fixture()), 'CARRIER', 1);
  assert.equal(result.total, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.rows.map(row => row.id), [id(3)]);
});

test('una búsqueda vacía no consulta datos y un error no se presenta como ausencia de resultados', async () => {
  const client = fakeClient(fixture());
  assert.equal((await searchHistoricalRecords(client, ' %_(), ')).total, 0);
  assert.equal(client.calls.length, 0);
  assert.equal(safeHistorySearch('  PA-2600152 '), 'PA-2600152');
  await assert.rejects(searchHistoricalRecords(fakeClient(fixture(), 'etapas_hotel'), 'R1320'), /Error de conexión de prueba/);
});

test('resuelve sustituciones momentáneas calculadas sin confundir una autoasignación', async () => {
  const tables = fixture();
  tables.registros_hotel.push({ id: id(5), pizarra_id: id(102), seguimiento_id: id(204), vehiculo_sustituido: '9000', vehiculo_reserva: '2489', tipo_sustituto: 'FLOTA' });
  tables.registros_hotel[1].vehiculo_reserva = 'R1320';
  tables.registros_hotel[1].tipo_sustituto = 'FLOTA';
  const result = await searchHistoricalRecords(fakeClient(tables), 'sustitucion_momentanea');
  assert.deepEqual(result.rows.map(row => row.id), [id(4)]);
});
