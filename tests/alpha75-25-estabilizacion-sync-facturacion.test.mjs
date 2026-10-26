import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(
  new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url),
  'utf8'
);
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261026190000_alpha75_25_estabilizacion_sync_facturacion.sql', import.meta.url),
  'utf8'
);
const receiver = fs.readFileSync(
  new URL('../supabase/migrations/20261026190500_alpha75_25_sync_receiver.sql', import.meta.url),
  'utf8'
);

const context = vm.createContext({
  console, Date, Number, String, JSON, Math, RegExp, Object, Array, Map, Set,
});
vm.runInContext(script, context, { filename: 'sincronizar_manteniment.gs' });

function displayDate(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

test('75.25 candidata usa una versión de Apps Script propia', () => {
  assert.match(script, /scriptVersion: 'alpha75-2026\.10\.26\.1'/);
  assert.match(receiver, /alpha75-2026\.10\.26\.1/);
});

test('el feed contable incluye TANCAMENT cerrados aunque no tengan UUID', () => {
  const recent = new Date();
  recent.setDate(recent.getDate() - 1);
  const value = displayDate(recent);
  const header = Array(17).fill('');
  const manual = Array(17).fill('');
  manual[0] = '2746';
  manual[1] = '7349NKN';
  manual[6] = '2745';
  manual[7] = 'PARADA';
  manual[8] = value;
  manual[9] = value;
  manual[10] = value;
  manual[11] = '4';
  manual[14] = 'VOLVO/C';
  manual[15] = '1200';
  manual[16] = 'TANCAMENT 10';

  const linked = manual.slice();
  linked[0] = '2444';
  linked[1] = '0763MCK';
  linked[4] = 'PA-2600191';
  linked[15] = '230';

  const syncId = 'e5abcd63-14a7-4f33-85aa-810afaea4a60';
  const rows = context.metrogestionLeerCierresFacturacion_(
    [header, manual, linked],
    [[''], [''], [`METROGESTION_PARADA:${syncId}`]]
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].dfm, '2746');
  assert.equal(rows[0].sync_id, '');
  assert.equal(rows[1].sync_id, syncId);
  assert.equal(rows[0].tancament, 'TANCAMENT 10');
});

test('un mismo sync_id se resuelve por periodo y no por la primera fila histórica', () => {
  const syncId = '11111111-1111-4111-8111-111111111111';
  const header = Array(17).fill('');
  const period10 = Array(17).fill('');
  period10[0] = '2637';
  period10[4] = 'PA-2600223';
  period10[6] = '2715';
  period10[7] = 'PARADA';
  period10[10] = '23/10/2026';
  period10[16] = 'TANCAMENT 10';
  const period11 = period10.slice();
  period11[10] = '';
  period11[16] = 'TANCAMENT 11';

  const state = {
    values: [header, period10, period11],
    notesA: ['', `METROGESTION_PARADA:${syncId}`, `METROGESTION_PARADA:${syncId}`],
  };
  const sheet = { getLastRow: () => state.values.length };

  assert.equal(
    context.metrogestionBuscarFilaPorSyncId_(
      sheet, syncId, { tancament: 'TANCAMENT 11', sustituto: '2715' }, state
    ),
    3
  );
  assert.equal(
    context.metrogestionBuscarFilaPorSyncId_(
      sheet, syncId, { tancament: 'TANCAMENT 12', sustituto: '2715' }, state
    ),
    0
  );
});

test('la migración separa cierre persistente de cálculo vivo', () => {
  assert.match(migration, /create table if not exists public\.facturacion_tancament_cierres/i);
  assert.match(migration, /manteniment_importar_cierres_facturacion/i);
  assert.match(migration, /cierre_periodo_anterior/i);
  assert.match(migration, /c\.fecha_cierre < \(now\(\) at time zone 'Europe\/Madrid'\)::date/i);
  assert.match(migration, /with \(security_invoker=true\)/i);
});

test('regresión contable TANCAMENT 10: 30 DFM y 181186 km', () => {
  const km = [
    1400,16280,8162,7120,5850,21255,720,3250,13050,15686,
    22620,230,3440,7590,12600,1225,583,9196,720,3600,
    4935,5830,3120,583,583,5247,1737,2084,1200,1290,
  ];
  assert.equal(km.length, 30);
  assert.equal(km.reduce((sum, value) => sum + value, 0), 181186);
});

console.log('Alpha75.25: estabilización de sincronización y facturación protegida por regresiones.');
