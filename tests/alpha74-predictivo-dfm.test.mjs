import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(
  new URL('../r1-alpha74/google-apps-script/sincronizar_manteniment.gs', import.meta.url),
  'utf8'
);
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260909123000_alpha74_ampliar_predictivo_dfm.sql', import.meta.url),
  'utf8'
);

const context = vm.createContext({ console, Date, Number, String, JSON, Math, RegExp, Object, Array, Set });
vm.runInContext(script, context, { filename: 'sincronizar_manteniment.gs' });

function dfmRow(dfm, matricula, marca, designacion = 'MCD', tipo = 'MANTENIMIENTO') {
  const row = Array(17).fill('');
  row[0] = dfm;
  row[1] = matricula;
  row[6] = tipo;
  row[7] = designacion;
  row[8] = '20/09/2026';
  row[14] = marca;
  return row;
}

test('MANTENIMENT lee necesidades DFM y transmite la marca de O', () => {
  const values = [
    Array(17).fill(''),
    dfmRow('2710', '7038NGM', 'MERCEDES-BENZ'),
    dfmRow('2604', '1234ABC', 'IVECO'),
    dfmRow('2745', '5678DEF', 'VOLVO'),
  ];
  const trabajos = context.metrogestionLeerTrabajos_(
    values,
    values.map(() => ['']),
    values.map(() => ['#ffffff']),
    values.map(() => ['#ffffff']),
    '2026-10-09'
  );

  assert.equal(trabajos.length, 3);
  assert.deepEqual(Array.from(trabajos, item => item.dfm), ['2710', '2604', '2745']);
  assert.deepEqual(Array.from(trabajos, item => item.marca_vehiculo), ['MERCEDES-BENZ', 'IVECO', 'VOLVO']);
});

test('MCD y AV usan el taller de referencia de la marca y la duda conserva F vacío', () => {
  assert.match(migration, /designacion in \('MCD', 'AV'\)[\s\S]*?marca_vehiculo like '%MERCEDES%'[\s\S]*?then 'STERN MOTOR'/);
  assert.match(migration, /marca_vehiculo like '%IVECO%' then 'AUTO DISTRIBUCIÓN'/);
  assert.match(migration, /marca_vehiculo ~ '\(\^\|\[\^A-Z0-9\]\)MAN/);
  assert.match(migration, /marca_vehiculo like '%VOLVO%' then 'VOLVO'/);
  assert.match(migration, /else null/);
});

test('RT de tipo Trámite se asigna a AUTODIS', () => {
  assert.match(migration, /tipo like '%TRAMITE%' and designacion = 'RT' then 'AUTODIS'/);
});
