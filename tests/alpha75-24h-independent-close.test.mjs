import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {
  assistanceCompletionError,
  assistanceCompletionPayload,
  assistanceWizardExtension,
  isAssistanceComplete,
} from '../r1-alpha75/src/assistance-completion.js';
import { bindAssistanceSituation } from '../r1-alpha75/src/assistance-situation.js';

const source = readFileSync(new URL('../r1-alpha34/src/app.js', import.meta.url), 'utf8');
const handlers = ['const collectPayload=', 'const saveGuard=', 'const saveActivation=', 'function validate()', 'prev.onclick=', 'next.onclick=']
  .map(prefix => {
    const line = source.split('\n').find(item => item.trim().startsWith(prefix));
    assert.ok(line, `Missing wizard handler: ${prefix}`);
    return line;
  }).join('\n');

function wizard(state, extension = assistanceWizardExtension, returnedData, initial = {}) {
  const calls = [], notices = [], renderedSteps = [];
  let generatedRequestIds = 0;
  let openedIncidences = 0;
  const context = vm.createContext({
    current: initial.current ?? 6, activationId: Object.hasOwn(initial, 'activationId') ? initial.activationId : 'TEST-ACTIVATION', next: {}, prev: {},
    state: { fecha_activacion: '2026-01-10', hora_activacion: '09:00', numero_caso: 'TEST-CASE', ...state },
    vehicle: { dfm: 'TEST-DFM', matricula: 'TEST-PLATE' },
    coverageOk: true,
    wizardExtension: extension,
    parseKm: value => Number(value || 0),
    madridToday: () => '2026-01-10',
    requestId: () => `TEST-REQUEST-${++generatedRequestIds}`,
    evaluateCoverage: () => ({ ok: true }),
    renderStep() { renderedSteps.push(context.current); }, clearNotice() {}, openIncidences() { openedIncidences += 1; },
    showNotice: message => notices.push(message),
    supabase: { rpc: async (name, args) => {
      calls.push({ name, ...JSON.parse(JSON.stringify(args)) });
      if (initial.rpc) return initial.rpc(name, args, calls.length);
      return { data: returnedData === undefined ? { id: args.p_id || 'TEST-NEW-ACTIVATION',
        estado: args.p_payload.estado, estado_seguimiento: args.p_payload.estado_seguimiento,
        resultado: args.p_payload.resultado } : returnedData, error: null };
    } },
  });
  vm.runInContext(handlers, context);
  return { calls, notices, renderedSteps, context, next: () => context.next.onclick(),
    get openedIncidences() { return openedIncidences; } };
}

const completion = {
  estado_seguimiento: 'realizada',
  fecha_fin_reparacion: '2026-01-10', hora_fin_reparacion: '10:15',
  estado_operativo_confirmado: false,
};

for (const result of ['trasladado_taller', 'necesita_sustitucion']) {
  test(`la asistencia finalizada conserva el resultado ${result} sin afirmar recuperación`, async () => {
    const state = { ...completion, resultado: result,
      trasladado_taller: result === 'trasladado_taller', taller_traslado: 'TEST-WORKSHOP',
      vehiculo_sustituto: 'TEST-RESERVE', matricula_sustituto: 'TEST-RESERVE-PLATE' };
    const before = JSON.stringify(state);
    const w = wizard(state);
    await w.next();
    assert.equal(w.notices.length, 0);
    assert.equal(w.calls.length, 1);
    const { name, p_id, p_payload: payload } = w.calls[0];
    assert.equal(name, 'guardar_activacion_24h');
    assert.equal(p_id, 'TEST-ACTIVATION');
    assert.equal(payload.estado, 'cerrada');
    assert.equal(payload.estado_seguimiento, 'realizada');
    assert.equal(payload.resultado, result);
    assert.equal(payload.estado_operativo_confirmado, 'false');
    assert.equal(payload.fecha_fin_reparacion, '2026-01-10');
    assert.equal(payload.hora_fin_reparacion, '10:15');
    assert.equal(payload.vehiculo_sustituto, 'TEST-RESERVE');
    assert.equal(JSON.stringify(state), before);
    assert.ok(!('p_etapas' in w.calls[0]));
    assert.ok(!('recuperado' in payload));
  });
}

for (const [label, override, message] of [
  ['fecha vacía', { fecha_fin_reparacion: '' }, /fecha de fin de asistencia/],
  ['hora vacía', { hora_fin_reparacion: '' }, /hora de fin de asistencia/],
  ['fecha anterior', { fecha_fin_reparacion: '2026-01-09' }, /anterior a la activación/],
  ['hora anterior', { hora_fin_reparacion: '08:59' }, /anterior a la activación/],
  ['fecha imposible', { fecha_fin_reparacion: '2026-02-30' }, /no son válidas/],
  ['hora imposible', { hora_fin_reparacion: '25:00' }, /no son válidas/],
  ['activación sin fecha', { fecha_activacion: '' }, /fecha real de activación/],
  ['activación sin hora', { hora_activacion: '' }, /hora real de activación/],
  ['activación imposible', { fecha_activacion: '2026-02-30' }, /activación no son válidas/],
]) {
  test(`cerrar rechaza ${label} antes de llamar a la RPC`, async () => {
    const w = wizard({ ...completion, resultado: 'necesita_sustitucion', vehiculo_sustituto: 'TEST-RESERVE', ...override });
    await w.next();
    assert.equal(w.calls.length, 0);
    assert.match(w.notices.at(-1), message);
  });
}

test('el cierre al día siguiente admite una hora menor sin inventar fechas', () => {
  assert.equal(assistanceCompletionError({ ...completion, fecha_activacion: '2026-01-09',
    resultado: 'necesita_sustitucion', hora_activacion: '23:50', hora_fin_reparacion: '00:10' }), '');
  const open = assistanceCompletionPayload({ resultado: 'trasladado_taller', estado_seguimiento: 'en_curso',
    fecha_fin_reparacion: '2026-01-10', hora_fin_reparacion: '10:15' });
  assert.equal(open.estado, 'abierta');
  assert.equal(open.fecha_fin_reparacion, '');
  assert.equal(open.hora_fin_reparacion, '');
});

test('finalizar exige indicar resultado real y no lo convierte en reparado', async () => {
  const w = wizard({ ...completion, resultado: 'seguimiento_abierto' });
  await w.next();
  assert.equal(w.calls.length, 0);
  assert.match(w.notices.at(-1), /Indica el resultado real/);
});

test('el resultado explícito de traslado exige taller y activa su flag sin crear T', async () => {
  const w = wizard({ ...completion, resultado: 'trasladado_taller', trasladado_taller: false });
  await w.next();
  assert.equal(w.calls.length, 0);
  assert.match(w.notices.at(-1), /Indica el taller/);
  const valid = wizard({ ...completion, resultado: 'trasladado_taller', trasladado_taller: false, taller_traslado: 'TEST-WORKSHOP' });
  await valid.next();
  assert.equal(valid.calls.length, 1);
  assert.equal(valid.calls[0].p_payload.trasladado_taller, 'true');
  assert.equal(valid.calls[0].p_payload.estado_operativo_confirmado, 'false');
  assert.ok(!('p_etapas' in valid.calls[0]));
});

test('reparado/operativo sigue exigiendo confirmación real de operatividad', async () => {
  const w = wizard({ ...completion, resultado: 'operativo_reparado' });
  await w.next();
  assert.equal(w.calls.length, 0);
  assert.match(w.notices.at(-1), /Confirma que el vehículo está operativo/);
  assert.equal(isAssistanceComplete({ resultado: 'operativo_reparado' }), true);
});

test('sin adaptador Alpha75 el asistente mantiene el payload histórico', async () => {
  const w = wizard({ ...completion, resultado: 'trasladado_taller',
    trasladado_taller: true, taller_traslado: 'TEST-WORKSHOP' }, () => null);
  await w.next();
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].p_payload.estado, 'abierta');
  assert.equal(w.calls[0].p_payload.fecha_fin_reparacion, '');
  assert.equal(w.calls[0].p_payload.resultado, 'trasladado_taller');
});

for (const [label, data] of [
  ['respuesta antigua sin estado', { id: 'TEST-ACTIVATION' }],
  ['estado todavía abierto', { id: 'TEST-ACTIVATION', estado: 'abierta', estado_seguimiento: 'en_curso', resultado: 'necesita_sustitucion' }],
  ['resultado distinto', { id: 'TEST-ACTIVATION', estado: 'cerrada', estado_seguimiento: 'realizada', resultado: 'operativo_reparado' }],
  ['rechazo sin error de transporte', { id: 'TEST-ACTIVATION', ok: false }],
  ['otra asistencia', { id: 'TEST-OTHER', estado: 'cerrada', estado_seguimiento: 'realizada', resultado: 'necesita_sustitucion' }],
]) {
  test(`el wizard no anuncia el cierre ante ${label}`, async () => {
    const w = wizard({ ...completion, resultado: 'necesita_sustitucion', vehiculo_sustituto: 'TEST-RESERVE' }, assistanceWizardExtension, data);
    await w.next();
    assert.equal(w.calls.length, 1);
    assert.match(w.notices.at(-1), /No se pudo guardar:/);
    assert.equal(w.context.activationId, 'TEST-ACTIVATION');
    assert.equal(w.context.current, 6);
  });
}

test('una respuesta de alta no confirmada conserva el id recibido para no repetir el alta', async () => {
  const w = wizard({ resultado: 'seguimiento_abierto' }, assistanceWizardExtension,
    { id: 'TEST-NEW-ACTIVATION', ok: false }, { current: 5, activationId: null });
  await w.next();
  assert.match(w.notices.at(-1), /No se pudo guardar:/);
  assert.equal(w.context.activationId, 'TEST-NEW-ACTIVATION');
  await w.next();
  assert.equal(w.calls.length, 1);
  assert.equal(w.context.current, 6);
});

function confirmedResponse(args) {
  return { data: { id: args.p_id || 'TEST-NEW-ACTIVATION', estado: args.p_payload.estado,
    estado_seguimiento: args.p_payload.estado_seguimiento, resultado: args.p_payload.resultado }, error: null };
}

test('un doble clic en alta comparte el envío y solo avanza una vez', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const w = wizard({}, assistanceWizardExtension, undefined,
    { current: 5, activationId: null, rpc: () => response });
  const first = w.next();
  const second = w.next();
  await Promise.resolve();
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].p_id, null);
  assert.equal(w.context.next.disabled, true);
  assert.equal(w.context.prev.disabled, true);
  w.context.prev.onclick();
  assert.equal(w.context.current, 5);
  release(confirmedResponse(w.calls[0]));
  await Promise.all([first, second]);
  assert.equal(w.context.activationId, 'TEST-NEW-ACTIVATION');
  assert.equal(w.context.current, 6);
  assert.deepEqual(w.renderedSteps, [6]);
  assert.equal(w.context.next.disabled, false);
  assert.equal(w.context.prev.disabled, false);
});

test('dos invocaciones concurrentes de guardado comparten la misma promesa y RPC', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const w = wizard({}, assistanceWizardExtension, undefined, { rpc: () => response });
  const first = vm.runInContext('saveActivation()', w.context);
  const second = vm.runInContext('saveActivation()', w.context);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(w.calls.length, 1);
  release(confirmedResponse(w.calls[0]));
  await Promise.all([first, second]);
});

test('reintentar un alta tras perder respuesta conserva request e identidad hasta confirmación', async () => {
  const w = wizard({}, assistanceWizardExtension, undefined, { current: 5, activationId: null,
    rpc: async (_name, args, count) => {
      if (count === 1) throw new Error('TEST-RESPONSE-LOST');
      return confirmedResponse(args);
    },
  });
  await w.next();
  assert.match(w.notices.at(-1), /TEST-RESPONSE-LOST/);
  assert.equal(w.context.current, 5);
  assert.equal(w.context.activationId, null);
  assert.equal(w.context.next.disabled, false);
  await w.next();
  assert.equal(w.calls.length, 2);
  assert.equal(w.calls[0].p_id, null);
  assert.equal(w.calls[1].p_id, null);
  assert.equal(w.calls[0].p_request_id, w.calls[1].p_request_id);
  assert.deepEqual(w.calls[0].p_payload, w.calls[1].p_payload);
  assert.equal(w.context.activationId, 'TEST-NEW-ACTIVATION');
  assert.equal(w.context.current, 6);
  await w.next();
  assert.equal(w.calls.length, 3);
  assert.equal(w.calls[2].p_id, 'TEST-NEW-ACTIVATION');
  assert.notEqual(w.calls[2].p_request_id, w.calls[1].p_request_id);
  assert.equal(w.openedIncidences, 1);
});

test('un rechazo sin id no renueva la identidad del alta pendiente', async () => {
  const w = wizard({}, assistanceWizardExtension, undefined, { current: 5, activationId: null,
    rpc: async (_name, args, count) => count === 1 ? { data: { ok: false }, error: null } : confirmedResponse(args),
  });
  await w.next();
  assert.equal(w.context.current, 5);
  assert.equal(w.context.activationId, null);
  await w.next();
  assert.equal(w.calls.length, 2);
  assert.equal(w.calls[0].p_request_id, w.calls[1].p_request_id);
  assert.equal(w.context.current, 6);
});

test('el catálogo ampliado conserva las opciones originales', () => {
  const options = [['en_curso', 'En curso']];
  const updated = assistanceWizardExtension('states', { options });
  assert.deepEqual(options, [['en_curso', 'En curso']]);
  assert.deepEqual(updated.at(-1), ['realizada', 'Asistencia 24H finalizada']);
});

test('el hook compartido solo cambia el payload cuando Alpha75 está conectado', () => {
  const helper = source.slice(source.indexOf('function wizardExtension('), source.indexOf('\nfunction el('));
  const situationSource = readFileSync(new URL('../r1-alpha75/src/assistance-situation.js', import.meta.url), 'utf8')
    .replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
  const content = new EventTarget();
  content.querySelector = () => null;
  const context = vm.createContext({
    document: { querySelector: () => content },
    CustomEvent,
    MutationObserver: class { observe() {} },
    assistanceWizardExtension,
    isAssistanceComplete,
  });
  vm.runInContext(situationSource + '\n' + helper, context);
  const original = { estado: 'abierta', resultado: 'trasladado_taller', vehiculo_sustituto: 'TEST-RESERVE' };
  const saved = context.wizardExtension('payload', { payload: original, state: { ...completion, resultado: 'trasladado_taller' } });
  assert.equal(saved.estado, 'cerrada');
  assert.equal(saved.resultado, 'trasladado_taller');
  assert.equal(saved.vehiculo_sustituto, 'TEST-RESERVE');
  assert.equal(original.estado, 'abierta');
  const unconnected = vm.createContext({ content: new EventTarget(), CustomEvent });
  vm.runInContext(helper, unconnected);
  assert.equal(unconnected.wizardExtension('payload', { payload: original, state: completion }), null);
});

test('seleccionar asistencia finalizada no convierte un traslado en reparación', () => {
  const OriginalOption = globalThis.Option;
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  class Control extends EventTarget {
    constructor(value) { super(); this.value = value; this.dataset = {}; this.options = []; }
    append(option) { this.options.push(option); }
    change(value) { this.value = value; this.dispatchEvent(new Event('change')); }
  }
  try {
    const current = new Control('en_curso');
    const result = new Control('trasladado_taller');
    bindAssistanceSituation(current, result);
    current.change('realizada');
    assert.equal(result.value, 'trasladado_taller');
    result.change('necesita_sustitucion');
    assert.equal(current.value, 'realizada');
    result.change('operativo_reparado');
    assert.equal(current.value, 'realizada');
    current.change('en_curso');
    assert.equal(result.value, 'seguimiento_abierto');
  } finally {
    if (OriginalOption === undefined) delete globalThis.Option;
    else globalThis.Option = OriginalOption;
  }
});
