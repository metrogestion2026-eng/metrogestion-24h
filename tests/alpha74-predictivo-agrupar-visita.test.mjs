import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(
  new URL('../r1-alpha74/google-apps-script/sincronizar_manteniment.gs', import.meta.url),
  'utf8'
);
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260906150626_alpha74_agrupar_trabajos_por_visita.sql', import.meta.url),
  'utf8'
);

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
vm.runInContext(script, context, { filename: 'sincronizar_manteniment.gs' });

const row = ({
  dfm,
  parada = '',
  taller,
  tipo,
  designacion,
  necesidad,
  realizada = '',
}) => {
  const value = Array(17).fill('');
  value[0] = dfm;
  value[4] = parada;
  value[5] = taller;
  value[6] = tipo;
  value[7] = designacion;
  value[8] = necesidad;
  value[9] = realizada;
  return value;
};

test('solo el fondo blanco de H origina necesidades, incluso si ya estaban vinculadas', () => {
  const values = [
    Array(17).fill(''),
    row({ dfm: '1487', taller: 'DIRECAUTO', tipo: 'REPARACIÓN', designacion: 'GP', necesidad: '06/09/2026' }),
    row({ dfm: '1487', taller: 'DIRECAUTO', tipo: 'REPARACIÓN', designacion: 'AV', necesidad: '06/09/2026' }),
    row({ dfm: '1487', parada: 'PA-2600152', taller: 'DIRECAUTO', tipo: 'MANTENIMIENTO', designacion: 'BPW', necesidad: '06/09/2026' }),
  ];
  const notes = [[''], [''], [''], ['METROGESTION_T:11111111-1111-4111-8111-111111111111']];
  const backgrounds = [['#ffffff'], ['#ffffff'], ['#b7e1cd'], ['#b7e1cd']];
  const priorityBackgrounds = [['#ffffff'], ['#ffffff'], ['#ffffff'], ['#ffffff']];

  const trabajos = context.metrogestionLeerTrabajos_(
    values,
    notes,
    backgrounds,
    priorityBackgrounds,
    '2026-10-07'
  );

  assert.equal(trabajos.length, 1);
  assert.equal(trabajos[0].designacion, 'GP');
  assert.equal(trabajos[0].pendiente_fondo_blanco, true);
  assert.ok(!trabajos.some(item => item.designacion === 'AV'));
  assert.ok(!trabajos.some(item => item.designacion === 'BPW'));
});

test('el amarillo en A incluye una necesidad aunque esté a más de un mes', () => {
  const values = [
    Array(17).fill(''),
    row({ dfm: '1443', taller: 'FRIDIEL', tipo: 'AVERÍA', designacion: 'AV', necesidad: '08/10/2026' }),
    row({ dfm: '1443', taller: 'FRIDIEL', tipo: 'TRÁMITE', designacion: 'LKT', necesidad: '08/10/2026' }),
  ];
  const notes = [[''], [''], ['']];
  const workBackgrounds = [['#ffffff'], ['#ffffff'], ['#ffffff']];
  const priorityBackgrounds = [['#ffffff'], ['#ffff00'], ['#ffffff']];

  const trabajos = context.metrogestionLeerTrabajos_(
    values,
    notes,
    workBackgrounds,
    priorityBackgrounds,
    '2026-10-06'
  );

  assert.equal(trabajos.length, 1);
  assert.equal(trabajos[0].designacion, 'AV');
  assert.equal(trabajos[0].prioridad_fondo_amarillo, true);
});

test('el amarillo de A no reactiva una H que ya tiene color', () => {
  const values = [
    Array(17).fill(''),
    row({ dfm: '1443', taller: 'FRIDIEL', tipo: 'AVERÍA', designacion: 'AV', necesidad: '08/10/2026' }),
  ];

  const trabajos = context.metrogestionLeerTrabajos_(
    values,
    [[''], ['']],
    [['#ffffff'], ['#b7e1cd']],
    [['#ffffff'], ['#ffff00']],
    '2026-10-06'
  );

  assert.equal(trabajos.length, 0);
});

test('el número de parada en E no reactiva por sí solo un histórico realizado', () => {
  const values = [
    Array(17).fill(''),
    row({
      dfm: '2710',
      parada: 'PA-2600102',
      taller: 'AUTODIS',
      tipo: 'AVERÍA',
      designacion: 'AV',
      necesidad: '17/06/2026',
      realizada: '17/06/2026',
    }),
  ];

  const trabajos = context.metrogestionLeerTrabajos_(
    values,
    [[''], ['']],
    [['#ffffff'], ['#b7e1cd']],
    [['#ffffff'], ['#ffffff']],
    '2026-10-06'
  );

  assert.equal(trabajos.length, 0);
});

test('una asignación antigua ya vinculada se omite y no bloquea las pendientes actuales', () => {
  const linkedSyncId = '254901df-7e2e-44f1-ad92-69b064750315';
  const pendingSyncId = '49880d2a-7c1c-4b96-a6c4-25a95d3f2336';
  const linked = row({
    dfm: '2710',
    parada: 'PA-2600102',
    taller: 'AUTODIS',
    tipo: 'AVERÍA',
    designacion: 'AV',
    necesidad: '17/06/2026',
    realizada: '17/06/2026',
  });
  linked[1] = '7038NGM';
  const pending = row({
    dfm: '2710',
    taller: 'APPLUS VILAFRANCA',
    tipo: 'TRÁMITE',
    designacion: '44TN',
    necesidad: '09/10/2026',
  });
  pending[1] = '7038NGM';
  const values = [Array(17).fill(''), linked, pending];
  const notesE = ['', `METROGESTION_T:${linkedSyncId}`, ''];
  const writes = [];
  const sheet = {
    getRange(rowNumber, column) {
      assert.equal(column, 5);
      return {
        getDisplayValue: () => values[rowNumber - 1][4],
        getNote: () => notesE[rowNumber - 1],
        setValue: value => { values[rowNumber - 1][4] = value; writes.push(['value', rowNumber, value]); },
        setNote: value => { notesE[rowNumber - 1] = value; writes.push(['note', rowNumber, value]); },
        setBackground: value => { writes.push(['background', rowNumber, value]); },
      };
    },
  };

  const applied = context.metrogestionAplicarAsignacionesTrabajos_(sheet, [
    {
      fila: 3299,
      clave_fila: '2710|7038NGM|AUTODIS PDF6|ELECTRONICA|AV|2026-06-17',
      trabajo_sync_id: linkedSyncId,
    },
    {
      fila: 3310,
      clave_fila: context.metrogestionClaveFilaTrabajo_(pending),
      trabajo_sync_id: pendingSyncId,
    },
  ], 'PA-2600102', { values, notesE });

  assert.equal(applied, 1);
  assert.equal(values[1][4], 'PA-2600102');
  assert.equal(values[2][4], 'PA-2600102');
  assert.ok(!writes.some(([, rowNumber]) => rowNumber === 2));
  assert.ok(writes.some(([type, rowNumber]) => type === 'note' && rowNumber === 3));
});

test('los trabajos de un mismo taller se alojan en la T de entrada', () => {
  assert.match(migration, /if v_visit_stage\.modalidad = 'taller' then\s+v_stage_id := v_entry_id;/);
  assert.match(migration, /Cada H diferente es un trabajo dentro de esa misma T/);
  assert.match(migration, /insert into public\.trabajos_etapa_hotel\([\s\S]*?v_stage_id/);
  assert.match(migration, /v_visit_stage\.modalidad <> 'taller' and v_work\.fecha_realizada is not null/);
});

test('la corrección protege el histórico realizado', () => {
  assert.match(migration, /trabajo_etapa\.estado = 'pendiente'/);
  assert.match(migration, /trabajo_etapa\.fecha_inicio_real is null/);
  assert.match(migration, /trabajo_etapa\.fecha_fin_real is null/);
  assert.match(migration, /trabajo_etapa\.fecha_real is null/);
  assert.match(migration, /not exists \([\s\S]*public\.documentos_gestion/);
  assert.match(migration, /not exists \([\s\S]*public\.reservas_pendientes_resueltos/);
  assert.doesNotMatch(migration, /delete\s+from/i);
});
