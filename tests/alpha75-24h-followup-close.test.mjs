import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { assistanceCompletionError, assistanceCompletionPayload, assistanceSaveError, isAssistanceComplete } from '../r1-alpha75/src/assistance-completion.js';
import { bindAssistanceSituation } from '../r1-alpha75/src/assistance-situation.js';

// Ejecuta el diálogo y su handler reales. El DOM mínimo y la RPC son las únicas
// dependencias sustituidas; no hay red ni modificación de fichas reales.
class Node extends EventTarget {
  constructor(tag = '') {
    super(); this.tagName = tag; this.children = []; this.dataset = {}; this.value = '';
    this.classList = { add() {}, toggle() {} };
  }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  setAttribute(name, value) { this[name] = value; }
  get options() { return this.children; }
  get selectedIndex() { return this.options.findIndex(option => option.value === this.value); }
  change(value) { this.value = value; this.onchange?.(); this.dispatchEvent(new Event('change')); }
  remove() { this.removed = true; }
  after(node) { this.insertedAfter = node; }
  querySelector() { return null; }
}
class Option extends Node {
  constructor(text, value) { super('option'); this.text = text; this.textContent = text; this.value = value; }
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

function followup(extra = {}, rpcError = null, rpcData) {
  const row = {
    id: 'TEST-ACTIVATION', dfm: 'TEST-DFM', matricula: 'TEST-PLATE',
    fecha_activacion: '2026-01-10', hora_activacion: '09:00',
    estado_seguimiento: 'en_curso', resultado: 'trasladado_taller',
    taller_traslado: 'TEST-WORKSHOP', estado_operativo_confirmado: false,
    vehiculo_sustituto: 'TEST-RESERVE', matricula_sustituto: 'TEST-RESERVE-PLATE',
    ...extra,
  };
  const before = JSON.stringify(row), calls = [];
  const body = new Node('body'), head = new Node('head');
  const cardState = new Node('span');
  cardState.textContent = 'ABIERTA';
  const meta = new Node('div');
  meta.textContent = 'TEST-DATE · Traslado';
  const actions = new Node('div');
  const card = { querySelector: selector => ({ '.a50-state': cardState, '.a50-meta': meta, '.a50-actions': actions }[selector] || null) };
  const context = vm.createContext({
    document: {
      body, head, querySelector: () => null,
      createElement: tag => new Node(tag),
      createTextNode: text => Object.assign(new Node('#text'), { textContent: text }),
    },
    Option,
    bindAssistanceSituation, assistanceCompletionError, assistanceCompletionPayload, assistanceSaveError, isAssistanceComplete,
    supabase: { rpc: async (name, args) => {
      calls.push({ name, ...JSON.parse(JSON.stringify(args)) });
      if (rpcError instanceof Error) throw rpcError;
      return { data: rpcData === undefined ? { id: row.id, estado: args.p_payload.estado,
        estado_seguimiento: args.p_payload.estado_seguimiento, resultado: args.p_payload.resultado } : rpcData, error: rpcError };
    } },
  });
  const source = readFileSync(new URL('../r1-alpha75/src/assistance-followup.js', import.meta.url), 'utf8').replace(/^import .+;\n/gm, '');
  vm.runInContext(source, context);
  context.openFollowup(row, card, []);
  const overlay = body.children[0];
  const label = title => descendants(overlay).find(node => node.tagName === 'label' && node.children[0]?.textContent === title);
  const field = title => label(title)?.children[1];
  const save = descendants(overlay).find(node => node.tagName === 'button' && node.textContent === 'Guardar seguimiento');
  return { row, before, calls, overlay, cardState, actions, label, field, save: () => save.onclick() };
}

test('el seguimiento finaliza la misma 24H y conserva sustituto, resultado y operatividad', async () => {
  const w = followup();
  w.field('Situación actual').change('realizada');
  assert.equal(w.field('Resultado').value, 'trasladado_taller');
  assert.equal(w.label('Fecha de fin de asistencia').hidden, false);
  w.field('Fecha de fin de asistencia').value = '2026-01-10';
  w.field('Hora de fin de asistencia').value = '11:00';
  await w.save();
  assert.equal(w.calls.length, 1);
  const { name, p_id, p_payload: payload } = w.calls[0];
  assert.equal(name, 'guardar_activacion_24h');
  assert.equal(p_id, 'TEST-ACTIVATION');
  assert.equal(payload.estado, 'cerrada');
  assert.equal(payload.estado_seguimiento, 'realizada');
  assert.equal(payload.resultado, 'trasladado_taller');
  assert.equal(payload.estado_operativo_confirmado, 'false');
  assert.equal(payload.vehiculo_sustituto, 'TEST-RESERVE');
  assert.equal(payload.taller_traslado, 'TEST-WORKSHOP');
  assert.equal(w.cardState.textContent, 'CERRADA');
  assert.equal(JSON.stringify(w.row), w.before);
  assert.equal(w.overlay.removed, true);
});

test('no envía un cierre sin hora real ni una fecha anterior', async () => {
  const w = followup();
  w.field('Situación actual').change('realizada');
  w.field('Fecha de fin de asistencia').value = '2026-01-10';
  await w.save();
  assert.equal(w.calls.length, 0);
  w.field('Hora de fin de asistencia').value = '08:00';
  await w.save();
  assert.equal(w.calls.length, 0);
  assert.equal(w.overlay.removed, undefined);
});

test('un traslado sin finalización sigue abierto y no promete crear T', async () => {
  const w = followup();
  await w.save();
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].p_payload.estado, 'abierta');
  assert.equal(w.calls[0].p_payload.fecha_fin_reparacion, '');
  assert.equal(w.cardState.textContent, 'ABIERTA');
  assert.doesNotMatch(w.actions.insertedAfter.textContent, /cread[ao]s|Recogida/);
});

test('un rechazo del servidor conserva el diálogo y no anuncia un cierre', async () => {
  const w = followup({}, { message: 'TEST-REJECTED' });
  w.field('Situación actual').change('realizada');
  w.field('Fecha de fin de asistencia').value = '2026-01-10';
  w.field('Hora de fin de asistencia').value = '11:00';
  await w.save();
  assert.equal(w.calls.length, 1);
  assert.equal(w.cardState.textContent, 'ABIERTA');
  assert.equal(w.overlay.removed, undefined);
});

for (const [label, data] of [
  ['respuesta antigua sin confirmación', { id: 'TEST-ACTIVATION' }],
  ['rechazo sin error de transporte', { id: 'TEST-ACTIVATION', ok: false, estado: 'abierta' }],
  ['estado abierto', { id: 'TEST-ACTIVATION', estado: 'abierta', estado_seguimiento: 'en_curso', resultado: 'trasladado_taller' }],
  ['otra identidad', { id: 'TEST-OTHER', estado: 'cerrada', estado_seguimiento: 'realizada', resultado: 'trasladado_taller' }],
]) {
  test(`el seguimiento mantiene el formulario ante ${label}`, async () => {
    const w = followup({}, null, data);
    w.field('Situación actual').change('realizada');
    w.field('Fecha de fin de asistencia').value = '2026-01-10';
    w.field('Hora de fin de asistencia').value = '11:00';
    await w.save();
    assert.equal(w.calls.length, 1);
    assert.equal(w.cardState.textContent, 'ABIERTA');
    assert.equal(w.overlay.removed, undefined);
    assert.equal(w.actions.insertedAfter, undefined);
  });
}

test('un fallo de red no deja el botón bloqueado ni anuncia cierre', async () => {
  const w = followup({}, new Error('TEST-NETWORK'));
  await w.save();
  await w.save();
  assert.equal(w.calls.length, 2);
  assert.equal(w.overlay.removed, undefined);
  assert.equal(w.cardState.textContent, 'ABIERTA');
});
