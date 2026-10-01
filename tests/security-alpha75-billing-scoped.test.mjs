import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createBillingReader } from '../r1-alpha75/src/billing-data-hf2.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const turn = () => new Promise(resolve => setImmediate(resolve));

function fakeClient({ delay = 0, respond } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const call = { table, filters: [] };
      const query = {
        select(fields) { call.fields = fields; return this; },
        eq(column, value) { call.filters.push([column, value]); return this; },
        order(column, options) { call.order = [column, options]; return this; },
        abortSignal(signal) { call.signal = signal; return this; },
        maybeSingle() { call.single = true; return this; },
        then(resolve, reject) {
          calls.push(call);
          return new Promise((done, fail) => {
            let timer;
            const abort = () => { clearTimeout(timer); fail(new Error('aborted')); };
            if (call.signal?.aborted) { abort(); return; }
            call.signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => {
              call.signal?.removeEventListener('abort', abort);
              try {
                const id = call.filters.find(([name]) => name === 'seguimiento_id')?.[1];
                const result = respond?.(call) ?? (table === 'paradas_sustitucion_resumen'
                  ? { data: { seguimiento_id: id, km_dia: 100 }, error: null }
                  : table === 'cierres_facturacion'
                    ? { data: [{ periodo: '2026-10', fecha_inicio: '2026-10-01', fecha_cierre: '2026-10-31' }], error: null }
                    : { data: { precio_r_unidad: 12 }, error: null });
                done(result);
              } catch (error) { fail(error); }
            }, delay);
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return client;
}

for (const value of [undefined, null, '', '  ', 'TEST', 'PA-TEST', `${A},or=(true)`, '../other', '11111111']) {
  test(`rechaza identidad inválida sin consultar: ${JSON.stringify(value)}`, async () => {
    const client = fakeClient();
    await assert.rejects(createBillingReader(client).read(value), /identidad válida/);
    assert.equal(client.calls.length, 0);
  });
}

test('todas las lecturas de resumen filtran una identidad exacta, sin lista global', async () => {
  const client = fakeClient();
  const reader = createBillingReader(client);
  const result = await reader.read(` ${A.toUpperCase()} `);
  assert.equal(result.stop.seguimiento_id, A);
  assert.equal(result.rPrice, 12);
  const stops = client.calls.filter(call => call.table === 'paradas_sustitucion_resumen');
  assert.equal(stops.length, 1);
  assert.deepEqual(stops[0].filters, [['seguimiento_id', A]]);
  assert.equal(stops[0].single, true);
  assert.ok(stops[0].fields.includes('km_dia_manual'));
  assert.ok(client.calls.every(call => call.signal instanceof AbortSignal));
});

test('comparte solo peticiones simultáneas de la misma identidad', async () => {
  const client = fakeClient({ delay: 10 });
  const reader = createBillingReader(client);
  const one = reader.read(A);
  const two = reader.read(A);
  assert.equal(one, two);
  const three = reader.read(B);
  assert.notEqual(one, three);
  const results = await Promise.all([one, two, three]);
  assert.equal(results[0].stop.seguimiento_id, A);
  assert.equal(results[2].stop.seguimiento_id, B);
  assert.equal(client.calls.filter(c => c.table === 'paradas_sustitucion_resumen').length, 2);
});

test('reabrir después de editar obtiene valores nuevos; no retiene resultados', async () => {
  let km = 100;
  const client = fakeClient({ respond: c => c.table === 'paradas_sustitucion_resumen'
    ? { data: { seguimiento_id: A, km_dia: km }, error: null } : undefined });
  const reader = createBillingReader(client);
  assert.equal((await reader.read(A)).stop.km_dia, 100);
  km = 321;
  assert.equal((await reader.read(A)).stop.km_dia, 321);
  assert.equal(client.calls.filter(c => c.table === 'paradas_sustitucion_resumen').length, 2);
});

for (const data of [null, { seguimiento_id: B }, { km_dia: 100 }, []]) {
  test(`no sustituye ausencia o identidad ajena por un cálculo: ${JSON.stringify(data)}`, async () => {
    const client = fakeClient({ respond: c => c.table === 'paradas_sustitucion_resumen' ? { data, error: null } : undefined });
    await assert.rejects(createBillingReader(client).read(A), /No hay un cálculo accesible/);
    assert.equal(client.calls.filter(c => c.table === 'paradas_sustitucion_resumen').length, 1);
  });
}

for (const table of ['paradas_sustitucion_resumen', 'cierres_facturacion', 'config_facturacion_sustituciones']) {
  test(`propaga error de ${table} y permite reintento fresco, no ceros`, async () => {
    let fail = true;
    const client = fakeClient({ respond: c => c.table === table && fail ? { data: null, error: { message: 'TEST_TIMEOUT' } } : undefined });
    const reader = createBillingReader(client);
    await assert.rejects(reader.read(A), /TEST_TIMEOUT/);
    fail = false;
    assert.equal((await reader.read(A)).stop.seguimiento_id, A);
  });
}

test('limita a tres las consultas de resumen al abrir muchas fichas', async () => {
  const client = fakeClient({ delay: 20 });
  const reader = createBillingReader(client);
  const ids = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
  const promises = ids.map(id => reader.read(id));
  await turn();
  assert.equal(client.calls.filter(c => c.table === 'paradas_sustitucion_resumen').length, 3);
  const results = await Promise.all(promises);
  assert.deepEqual(results.map(r => r.stop.seguimiento_id), ids);
  assert.ok(client.calls.filter(c => c.table === 'paradas_sustitucion_resumen').every(c => c.filters.length === 1));
});

test('al cambiar sesión cancela lecturas activas y en cola; no reutiliza datos anteriores', async () => {
  const client = fakeClient({ delay: 30 });
  const reader = createBillingReader(client, { concurrency: 1 });
  const oldA = reader.read(A);
  const oldB = reader.read(B);
  const oldResult = Promise.allSettled([oldA, oldB]);
  await turn();
  const epoch = reader.generation;
  reader.reset();
  assert.equal(reader.generation, epoch + 1);
  assert.ok((await oldResult).every(r => r.status === 'rejected'));
  assert.ok(client.calls.every(c => c.signal.aborted));
  assert.equal(client.calls.filter(c => c.table === 'paradas_sustitucion_resumen').length, 1);
  const fresh = await reader.read(B);
  assert.equal(fresh.stop.seguimiento_id, B);
});

test('invalidar una parada no invalida la otra; un resultado antiguo no borra la petición nueva', async () => {
  const client = fakeClient({ delay: 15 });
  const reader = createBillingReader(client);
  const old = reader.read(A);
  const caught = assert.rejects(old, /desactualizada/);
  const other = reader.read(B);
  await turn();
  reader.invalidate(A);
  const fresh = reader.read(A);
  assert.notEqual(old, fresh);
  await caught;
  assert.equal((await other).stop.seguimiento_id, B);
  assert.equal((await fresh).stop.seguimiento_id, A);
});

for (const concurrency of [0, 5, 1.5, NaN]) {
  test(`rechaza concurrencia insegura ${concurrency}`, () => {
    assert.throws(() => createBillingReader(fakeClient(), { concurrency }), /concurrencia/);
  });
}

const baseline = fs.readFileSync(new URL('../r1-alpha67/src/card-operational.js', import.meta.url), 'utf8');
const candidate = fs.readFileSync(new URL('../r1-alpha75/src/substitution-billing-hf2.js', import.meta.url), 'utf8');
function between(source, start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }

test('conserva literalmente los ayudantes de fechas y cálculo inclusivo de alpha67', () => {
  assert.equal(between(candidate, 'function el(', 'async function isPrimaryAdmin'), between(baseline, 'function el(', 'function stageTimestamp('));
  assert.equal(between(candidate, 'function findPeriod(', 'function createManualEditor('), between(baseline, 'function findPeriod(', 'function createManualEditor('));
});

function billingContext(source) {
  const context = vm.createContext({ console, Date, Intl, Math, Number, String });
  const helpers = between(source, 'function el(', source === baseline ? 'function stageTimestamp(' : 'async function isPrimaryAdmin');
  const math = between(source, 'function findPeriod(', 'function metric(');
  vm.runInContext(`const DAY_MS = 86400000;\n${helpers}\n${math}\nthis.snapshot = billingSnapshot;`, context);
  return context;
}
const oldMath = billingContext(baseline);
const newMath = billingContext(candidate);
const periods = [
  { periodo: '2026-09', fecha_inicio: '2026-08-26', fecha_cierre: '2026-09-25' },
  { periodo: '2026-10', fecha_inicio: '2026-09-26', fecha_cierre: '2026-10-25' },
];
const scenarios = [
  ['misma fecha', '2026-10-01', '2026-10-01', '2026-10-01', 400],
  ['cambio de periodo', '2026-09-24', null, '2026-10-01', 333.333],
  ['sin media', '2026-09-30', null, '2026-10-01', null],
  ['media manual', '2026-09-28', null, '2026-10-01', 510],
  ['histórico acotado', '2026-09-01', '2026-10-01', '2026-09-12', 245],
  ['recuperado', '2026-09-01', '2026-09-10', '2026-10-01', 245],
  ['inicio futuro', '2026-10-10', null, '2026-10-01', 100],
  ['sin fechas', null, null, '2026-10-01', null],
  ['año bisiesto', '2024-02-28', '2024-03-01', '2024-03-01', 10],
];
for (const [label, start, end, reference, km] of scenarios) {
  test(`mismo resultado matemático que alpha67: ${label}`, () => {
    const row = { fecha_pizarra: reference, fecha_parada: start };
    const stop = { fecha_inicio_parada: start, fecha_fin_parada: end, km_dia: km };
    assert.deepEqual(JSON.parse(JSON.stringify(newMath.snapshot(row, stop, periods))), JSON.parse(JSON.stringify(oldMath.snapshot(row, stop, periods))));
  });
}

test('la línea 75 carga el lector corregido en Hotel e Histórico, sin alterar el módulo compartido', () => {
  const load = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(load('r1-alpha75/src/card-operational.js'), /from '\.\/substitution-billing-hf2\.js'/);
  for (const name of ['hotel-native', 'history-native']) assert.match(load(`r1-alpha75/src/${name}.js`), /invalidateSubstitutionBilling\(\);/);
  assert.match(load('r1-alpha75/index.html'), /hotel-native\.js\?v=75\.23-hf2/);
  assert.match(load('r1-alpha75/index.html'), /history-native\.js\?v=75\.23-hf2/);
  assert.match(candidate, /generation !== billingReader\.generation/);
  assert.doesNotMatch(candidate, /loadBillingData|byStop|byTracking|localStorage|sessionStorage/);
  assert.match(baseline, /let billingDataPromise = null/);
});
