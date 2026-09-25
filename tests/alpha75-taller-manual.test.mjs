import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function context(version) {
  const source = fs.readFileSync(new URL(`../r1-${version}/google-apps-script/sincronizar_manteniment.gs`, import.meta.url), 'utf8');
  const ctx = vm.createContext({ console });
  vm.runInContext(source, ctx);
  return ctx;
}

// Identificadores ficticios: dos averías del mismo semirremolque.
function row(taller = '', marca = 'CARRIER', designacion = 'AV', dfm = 'R900001') {
  const value = Array(19).fill('');
  [value[0], value[1], value[2], value[5], value[6], value[7], value[8], value[14]] =
    [dfm, 'TEST-PLATE', 'T33/C', taller, 'AVERÍA', designacion, '2026-09-01', marca];
  return value;
}

function trabajos(ctx, rows) {
  const values = [Array(19).fill(''), ...rows];
  const white = values.map(() => ['#ffffff']);
  return ctx.metrogestionLeerTrabajos_(values, values.map(() => ['']), white, white, '2026-10-24', white);
}

for (const version of ['alpha75', 'alpha76']) {
  test(`${version}: F escrita manda en todos los tipos de trabajo y marcas`, () => {
    const ctx = context(version);
    for (const marca of ['IVECO', 'MERCEDES', 'MAN', 'VOLVO', 'CARRIER', 'TERMO KING', 'HWASUNG', 'IVECO/CAR']) {
      for (const designacion of ['AV', 'MCD', 'RT', 'BPW', 'ATP', 'TMG', 'GP', 'GC', 'EXTINTOR']) {
        const input = row('Taller elegido manualmente', marca, designacion, '900001');
        input[16] = 'CARRIER';
        input[13] = 'FRAGADIS';
        const work = trabajos(ctx, [input])[0];
        assert.equal(work.taller, input[5], `${marca} ${designacion}`);
      }
    }
    const gestion = row('Taller elegido manualmente', 'IVECO', 'LKT', '900001');
    gestion[6] = 'GESTIÓN';
    assert.equal(trabajos(ctx, [gestion])[0].taller, gestion[5]);
  });

  test(`${version}: dos AV del mismo R conservan sus talleres e identidades al enviar y reintentar`, () => {
    const ctx = context(version);
    const rows = [row('DIRECAUTO'), row('FRIDIEL')];
    for (let retry = 0; retry < 2; retry++) {
      const works = trabajos(ctx, rows);
      assert.equal(works.length, 2);
      assert.deepEqual(Array.from(works, w => w.taller), ['DIRECAUTO', 'FRIDIEL']);
      assert.notEqual(works[0].clave_fila, works[1].clave_fila);
    }
    assert.equal(rows[0][5], 'DIRECAUTO');
  });

  test(`${version}: una AV de R sin taller no se asigna por la marca del frío`, () => {
    for (const marca of ['CARRIER', 'TERMO KING', 'HWASUNG']) {
      const work = trabajos(context(version), [row('', marca)])[0];
      assert.equal(work.taller, '');
    }
  });
}

test('alpha75: la planificación conserva F y no cambia una AV por la marca ni por su detalle', () => {
  const ctx = context('alpha75');
  const alta = row('', 'CARRIER', 'ALTA');
  alta[8] = '2020-01-01';
  const av = row('DIRECAUTO');
  av[16] = 'CARRIER';
  const records = [alta, av, row('FRIDIEL'), row('')].map((values, i) =>
    ({row: i + 2, values, note: '', colorH: '#ffffff', colorG: '#ffffff', colorM: '#ffffff'}));
  const plan = ctx.metrogestionPlanificarNecesidades_(records, '2026-09-24');
  assert.equal(plan.cambios.filter(c => c.original[7] === 'AV' && c.values[5] !== c.original[5]).length, 0);
  assert.equal(plan.nuevas.filter(c => c.values[7] === 'AV').length, 0);
});

test('alpha75: mantiene las reglas de MCD del frío, BPW y AV de tractora', () => {
  const ctx = context('alpha75');
  assert.equal(ctx.metrogestionReglaTallerPendiente_(row('', 'CARRIER', 'MCD')).taller, 'FRIDIEL');
  assert.equal(ctx.metrogestionReglaTallerPendiente_(row('', 'CARRIER', 'BPW')).taller, 'DIRECAUTO');
  assert.equal(ctx.metrogestionReglaTallerPendiente_(row('', 'IVECO', 'AV', '900001')).taller, 'AUTODIS');
});

test('alpha75: la planificación no sobrescribe F manual y sigue clasificando EXTINTOR', () => {
  const ctx = context('alpha75');
  const alta = row('', 'IVECO', 'ALTA', '900001');
  alta[8] = '2020-01-01';
  const manuales = ['AV', 'MCD', 'RT', 'BPW', 'ATP', 'TMG', 'GP', 'GC', 'EXTINTOR'].map(type =>
    row('Taller elegido manualmente', 'IVECO', type, '900001'));
  const records = [alta, ...manuales].map((values, i) =>
    ({ row: i + 2, values, note: '', colorH: '#ffffff', colorG: '#ffffff', colorM: '#ffffff' }));
  const plan = ctx.metrogestionPlanificarNecesidades_(records, '2026-09-24');
  assert.equal(plan.cambios.filter(c => c.values[5] !== c.original[5]).length, 0);
  const extintor = plan.cambios.find(c => c.original[7] === 'EXTINTOR');
  assert.equal(extintor.values[6], 'TRÁMITE');
  assert.equal(extintor.values[5], 'Taller elegido manualmente');
});
