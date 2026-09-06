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
