import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { substitutionOwnershipText } from '../r1-alpha75/src/substitution-imputation.js';
import {
  CONTINUITY_RULE, CONTINUITY_PREVIEW_RPC, CONTINUITY_CONFIRM_RPC,
  continuityContextError, continuityPreviewError, continuityConfirmationPayload,
  createContinuityController,
} from '../r1-alpha75/src/substitution-continuity-contract.js';

const ORIGIN = '11111111-1111-4111-8111-111111111111';
const DESTINATION = '22222222-2222-4222-8222-222222222222';
const ENTRY = '33333333-3333-4333-8333-333333333333';
const ORIGIN_TRACKING = '44444444-4444-4444-8444-444444444444';
const DESTINATION_TRACKING = '55555555-5555-4555-8555-555555555555';
const LINK = '66666666-6666-4666-8666-666666666666';
const ENTRY_TRACKING = '77777777-7777-4777-8777-777777777777';
const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
const selection = { destinationId: DESTINATION, originId: ORIGIN, entryId: ENTRY };

function context({ selected = true, zero = false } = {}) {
  const origin = { id: ORIGIN, seguimiento_id: ORIGIN_TRACKING, numero_parada: 'SINT-ORIGEN', version: 4,
    dfm: 'SINT-DFM', matricula: 'SINT-PLATE', sustituto: 'R-SINT', matricula_sustituto: 'SINT-RESERVE', tipo_sustituto: 'RESERVA' };
  const destination = { ...origin, id: DESTINATION, seguimiento_id: DESTINATION_TRACKING, numero_parada: 'SINT-TALLER', version: 2, sustituto: '', matricula_sustituto: '' };
  const entry = { id: ENTRY, seguimiento_id: ENTRY_TRACKING, registro_hotel_id: DESTINATION,
    seguimiento_parada_id: DESTINATION_TRACKING, nombre: 'Entrada taller sintético', version: 7,
    estado: 'en_curso', fecha_inicio_real: '2026-10-28T23:30:00Z', dia_entrada: '2026-10-29' };
  return { ok: true, regla: CONTINUITY_RULE, destino: destination, origenes: [origin], entradas: [entry],
    bloqueos: [], continuidades: [], propietario_actual: { id: ORIGIN, seguimiento_id: ORIGIN_TRACKING, numero_parada: origin.numero_parada },
    confirmable: selected,
    prevision: selected ? { origen: origin, destino: destination, entrada: entry, fecha_referencia: '2026-10-29', periodo: '2026-11',
      huella_prevision: 'synthetic-fingerprint', bloqueos: [],
      tramo_origen: { fecha_inicio_imputacion: zero ? '2026-10-29' : '2026-10-27', fecha_fin_imputacion: '2026-10-28', dias_imputables: zero ? 0 : 2 },
      tramo_destino: { fecha_inicio_imputacion: '2026-10-29', fecha_fin_imputacion: null, dias_imputables: 1 } } : null };
}

function confirmation(payload, preview = context().prevision, extra = {}) {
  return { ok: true, regla: CONTINUITY_RULE, request_id: payload.p_request_id, reutilizada: false,
    continuidad_id: LINK, origen_id: payload.p_origen_id, destino_id: payload.p_destino_id, etapa_entrada_id: payload.p_etapa_entrada_id,
    versiones: { origen: 5, destino: 3, entrada: 7 }, tramos: { origen: clone(preview.tramo_origen), destino: clone(preview.tramo_destino) },
    propietario_al_confirmar: { id: DESTINATION, seguimiento_id: DESTINATION_TRACKING, numero_parada: 'SINT-TALLER' },
    propietario_actual: { id: DESTINATION, seguimiento_id: DESTINATION_TRACKING, numero_parada: 'SINT-TALLER' }, ...extra };
}

function controllerHarness({ read, write } = {}) {
  const calls = [];
  let serial = 0;
  const client = { rpc: async (name, args) => {
    calls.push({ name, args: clone(args) });
    if (name === CONTINUITY_PREVIEW_RPC) return { data: await (read?.(args) ?? context({ selected: Boolean(args.p_origen_id) })), error: null };
    if (write) return write(args);
    return { data: confirmation(args), error: null };
  } };
  const controller = createContinuityController({ client, destinationId: DESTINATION, requestId: () => `SYNTHETIC-${++serial}` });
  return { controller, client, calls, writes: () => calls.filter(row => row.name === CONTINUITY_CONFIRM_RPC) };
}

async function selectAndPreview(harness) {
  await harness.controller.load();
  harness.controller.select({ originId: ORIGIN, entryId: ENTRY });
  await harness.controller.preview();
  harness.controller.acknowledge(true);
}

test('contexto inicial sin origen ni entrada preseleccionados; no confirma por abrir la ficha', async () => {
  const h = controllerHarness();
  await h.controller.load();
  assert.deepEqual(h.calls[0], { name: CONTINUITY_PREVIEW_RPC,
    args: { p_destino_id: DESTINATION, p_origen_id: null, p_etapa_entrada_id: null } });
  assert.equal(h.controller.state.originId, '');
  assert.equal(h.controller.state.entryId, '');
  assert.equal(h.controller.state.acknowledged, false);
  await h.controller.confirm();
  assert.equal(h.writes().length, 0);
});

test('el payload contiene identidades/versiones/huella, nunca inventa una fecha, recuperación ni modalidad', () => {
  const dto = context({ zero: true });
  const payload = continuityConfirmationPayload(dto, selection, 'SYNTHETIC-ID');
  assert.equal(continuityContextError(dto, DESTINATION), '');
  assert.equal(continuityPreviewError(dto, selection), '');
  assert.deepEqual(payload, {
    p_origen_id: ORIGIN, p_destino_id: DESTINATION, p_etapa_entrada_id: ENTRY,
    p_version_origen: 4, p_version_destino: 2, p_version_entrada: 7,
    p_huella_prevision: 'synthetic-fingerprint', p_request_id: 'SYNTHETIC-ID',
  });
  assert.equal(dto.prevision.tramo_origen.dias_imputables, 0);
  assert.equal(dto.prevision.entrada.dia_entrada, '2026-10-29');
  assert.notEqual(dto.prevision.entrada.seguimiento_id, dto.prevision.destino.seguimiento_id);
  assert.ok(Object.isFrozen(payload));
});

test('doble clic comparte la llamada en curso y no anuncia un vínculo antes de respuesta confirmada', async () => {
  let finish;
  const h = controllerHarness({ write: args => new Promise(resolve => { finish = () => resolve({ data: confirmation(args), error: null }); }) });
  await selectAndPreview(h);
  const first = h.controller.confirm();
  const second = h.controller.confirm();
  assert.equal(first, second);
  assert.equal(h.controller.state.saving, true);
  assert.equal(h.controller.state.confirmed, null);
  await turn();
  assert.equal(h.writes().length, 1);
  finish();
  assert.equal((await first).continuidad_id, LINK);
  assert.equal((await second).continuidad_id, LINK);
  assert.equal(h.controller.state.saving, false);
  assert.equal(h.controller.state.confirmed.continuidad_id, LINK);
});

test('respuesta perdida conserva petición, selección y huella; replay tras recuperación posterior es éxito', async () => {
  let count = 0;
  const h = controllerHarness({ write: async args => {
    if (++count === 1) throw new Error('synthetic response lost after COMMIT');
    return { data: confirmation(args, context().prevision, { reutilizada: true, propietario_actual: null }), error: null };
  } });
  await selectAndPreview(h);
  await h.controller.confirm();
  assert.equal(h.controller.state.uncertain, true);
  assert.equal(h.controller.state.confirmed, null);
  assert.equal(h.controller.dispose(), false);
  assert.equal(h.controller.select({ originId: LINK }), false);
  await h.controller.preview();
  const replay = await h.controller.confirm();
  assert.equal(h.writes().length, 2);
  assert.deepEqual(h.writes()[0].args, h.writes()[1].args);
  assert.equal(replay.reutilizada, true);
  assert.equal(replay.propietario_actual, null);
  assert.equal(h.controller.state.uncertain, false);
  assert.equal(h.controller.dispose(), true);
});

for (const [label, mutate] of [
  ['contrato antiguo', data => { delete data.regla; }],
  ['otra PA destino', data => { data.destino_id = ORIGIN; }],
  ['otra petición', data => { data.request_id = 'OTHER'; }],
  ['sin vínculo', data => { data.continuidad_id = null; }],
  ['sin propietario al confirmar', data => { data.propietario_al_confirmar = null; }],
  ['sin información de propietario actual', data => { delete data.propietario_actual; }],
]) {
  test(`no declara éxito ante ${label}; mantiene identidad para comprobar`, async () => {
    const h = controllerHarness({ write: async args => {
      const data = confirmation(args); mutate(data); return { data, error: null };
    } });
    await selectAndPreview(h);
    await h.controller.confirm();
    assert.equal(h.controller.state.confirmed, null);
    assert.equal(h.controller.state.uncertain, true);
    assert.match(h.controller.state.error, /Continuidad no confirmada/);
    await h.controller.confirm();
    assert.equal(h.writes()[0].args.p_request_id, h.writes()[1].args.p_request_id);
  });
}

test('un rechazo SQL confirmado obliga a nueva previsión; conserva intactos los campos elegidos', async () => {
  let rejected = true;
  const h = controllerHarness({ write: async args => rejected
    ? { data: null, error: { code: '40001', message: 'La versión de origen cambió' } }
    : { data: confirmation(args), error: null } });
  await selectAndPreview(h);
  await h.controller.confirm();
  assert.equal(h.controller.state.uncertain, false);
  assert.equal(h.controller.state.originId, ORIGIN);
  assert.equal(h.controller.state.entryId, ENTRY);
  assert.equal(h.controller.state.context.prevision, null);
  await h.controller.confirm();
  assert.equal(h.writes().length, 1);
  rejected = false;
  await h.controller.preview(); h.controller.acknowledge(true);
  assert.equal((await h.controller.confirm()).continuidad_id, LINK);
  assert.notEqual(h.writes()[0].args.p_request_id, h.writes()[1].args.p_request_id);
});

test('una previsión tardía no repone la selección ni habilita confirmar otra PA', async () => {
  let finish;
  const h = controllerHarness({ read: args => args.p_origen_id
    ? new Promise(resolve => { finish = () => resolve(context()); }) : context({ selected: false }) });
  await h.controller.load();
  h.controller.select({ originId: ORIGIN, entryId: ENTRY });
  const pending = h.controller.preview();
  await turn();
  h.controller.select({ originId: '', entryId: '' });
  finish(); await pending;
  assert.equal(h.controller.state.context.prevision, null);
  assert.equal(h.controller.state.originId, '');
  assert.equal(h.controller.state.acknowledged, false);
  assert.equal(h.writes().length, 0);
});

test('actualizar contexto exige volver a seleccionar; nunca conserva un origen invisible en el desplegable', async () => {
  const h = controllerHarness();
  await selectAndPreview(h);
  await h.controller.load();
  assert.equal(h.controller.state.originId, '');
  assert.equal(h.controller.state.entryId, '');
  assert.equal(h.controller.state.acknowledged, false);
  assert.equal(h.controller.state.context.prevision, null);
  await h.controller.confirm();
  assert.equal(h.writes().length, 0);
});

for (const [label, mutate] of [
  ['entrada sin fecha real', data => { data.prevision.entrada.fecha_inicio_real = null; }],
  ['otra T', data => { data.prevision.entrada.id = LINK; }],
  ['T de otro registro', data => { data.prevision.entrada.registro_hotel_id = ORIGIN; }],
  ['T de otro seguimiento de PA', data => { data.prevision.entrada.seguimiento_parada_id = ORIGIN_TRACKING; }],
  ['T sin identidad estable propia', data => { data.prevision.entrada.seguimiento_id = null; }],
  ['fecha inexistente', data => { data.prevision.entrada.dia_entrada = '2026-02-30'; }],
  ['falta huella', data => { delete data.prevision.huella_prevision; }],
  ['días negativos', data => { data.prevision.tramo_origen.dias_imputables = -1; }],
  ['afectado R bloqueado', data => { data.bloqueos = [{ codigo: 'AFECTADO_R', mensaje: 'El reparto de la unidad R no está definido.' }]; data.confirmable = false; }],
  ['modalidad manual incompatible', data => { data.bloqueos = [{ codigo: 'MODALIDAD_CONFLICTO', mensaje: 'La modalidad manual es incompatible.' }]; data.confirmable = false; }],
]) {
  test(`impide confirmar ${label}, sin mutar las fechas ni la modalidad`, async () => {
    const data = context(); mutate(data);
    const before = clone(data);
    const h = controllerHarness({ read: args => args.p_origen_id ? data : context({ selected: false }) });
    await selectAndPreview(h);
    await h.controller.confirm();
    assert.equal(h.writes().length, 0);
    assert.deepEqual(data, before);
    assert.ok(continuityPreviewError(data, selection));
  });
}

// DOM mínimo: ejecuta el diálogo y sus eventos reales. Se sustituyen sólo DOM,
// Supabase y callback de refresco; el contrato/controlador anterior es el real.
class TestNode {
  constructor(tag, ownerDocument) { this.tagName = tag; this.ownerDocument = ownerDocument; this.children = []; this.listeners = new Map(); this.dataset = {}; this.value = ''; this._text = ''; }
  set textContent(value) { this.children.forEach(node => { node.parentNode = null; }); this.children = []; this._text = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, handler) { const handlers = this.listeners.get(type) || []; handlers.push(handler); this.listeners.set(type, handlers); }
  async emit(type) { for (const handler of this.listeners.get(type) || []) await handler({ target: this, preventDefault() {} }); }
  async click() { if (!this.disabled) await this.emit('click'); }
  async change(value) { this.value = value; await this.emit('change'); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  get isConnected() { return this === this.ownerDocument.body || this === this.ownerDocument.head || Boolean(this.parentNode?.isConnected); }
  focus() { this.ownerDocument.activeElement = this; }
  closest(selector) { return selector === '[hidden]' ? this.hidden ? this : this.parentNode?.closest(selector) : null; }
  querySelectorAll() { return descendants(this).filter(node => ['button', 'select', 'input'].includes(node.tagName)); }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];

async function dialogHarness({ selectedContext = context({ zero: true }), write, onSaved, readOnly = false, initialContext } = {}) {
  const document = { createElement: tag => new TestNode(tag, document), querySelector: () => null };
  document.body = document.createElement('body'); document.head = document.createElement('head'); document.activeElement = document.body;
  const h = controllerHarness({ read: args => args.p_origen_id ? selectedContext : initialContext || context({ selected: false }),
    write: write || (async args => ({ data: confirmation(args, selectedContext.prevision), error: null })) });
  const globals = vm.createContext({ document, Date, Intl, Object, Map, String, Number, Promise,
    createContinuityController, continuityPreviewError, supabase: h.client });
  const source = readFileSync(new URL('../r1-alpha75/src/substitution-continuity.js', import.meta.url), 'utf8')
    .replace(/^import .+;\n/gm, '').replace('export function openSubstitutionContinuity', 'function openSubstitutionContinuity');
  vm.runInContext(`${source}\nthis.openDialog = openSubstitutionContinuity;`, globals);
  const opened = globals.openDialog(DESTINATION, { onSaved, readOnly });
  await turn();
  const nodes = () => descendants(opened.overlay);
  const button = label => nodes().find(node => node.tagName === 'button' && node.textContent === label);
  const field = label => nodes().find(node => node['aria-label'] === label);
  return { ...h, ...opened, button, field, nodes, document, text: () => opened.overlay.textContent };
}

async function fillDialog(w) {
  await w.field('PA de origen').change(ORIGIN);
  await w.field('Entrada real en taller').change(ENTRY);
  await w.button('Previsualizar continuidad').click();
  await turn();
  const checkbox = w.field('Confirmo la entrada real y la continuidad del mismo sustituto');
  checkbox.checked = true; await checkbox.emit('change');
}

test('formulario real muestra origen 0, día Madrid acreditado, selección explícita y confirmación separada', async () => {
  let saved = 0;
  const w = await dialogHarness({ onSaved: async () => { saved += 1; } });
  assert.equal(w.field('PA de origen').value, '');
  assert.equal(w.field('Entrada real en taller').value, '');
  assert.equal(w.button('Confirmar continuidad').disabled, true);
  assert.equal(w.nodes().filter(node => node.tagName === 'input' && node.type === 'date').length, 0);
  await fillDialog(w);
  assert.match(w.text(), /La PA de origen queda con 0 días imputables/);
  assert.match(w.text(), /Día de entrada: 29\/10\/2026/);
  assert.equal(w.writes().length, 0);
  assert.equal(w.button('Confirmar continuidad').disabled, false);
  await w.button('Confirmar continuidad').click();
  assert.equal(saved, 1);
  assert.equal(w.writes().length, 1);
  assert.match(w.text(), /Continuidad confirmada entre PA SINT-ORIGEN y PA SINT-TALLER/);
  await w.button('Cerrar').click();
  assert.equal(w.overlay.isConnected, false);
});

test('formulario real mantiene abierto el resultado incierto y reintenta exactamente la misma petición', async () => {
  let attempt = 0;
  const w = await dialogHarness({ write: async args => {
    if (++attempt === 1) throw new Error('SYNTHETIC-LOST');
    return { data: confirmation(args, context().prevision, { reutilizada: true, propietario_actual: null }), error: null };
  } });
  await fillDialog(w);
  await w.button('Confirmar continuidad').click();
  assert.equal(w.button('Cerrar').disabled, true);
  assert.equal(w.field('PA de origen').disabled, true);
  assert.equal(w.button('Reintentar confirmación').disabled, false);
  assert.doesNotMatch(w.text(), /Continuidad confirmada entre/);
  await w.button('Reintentar confirmación').click();
  assert.deepEqual(w.writes()[0].args, w.writes()[1].args);
  assert.match(w.text(), /misma petición ya registrada/);
  assert.match(w.text(), /Asignación vigente actual: sin PA propietaria/);
});

test('fallar el refresco tras éxito no ofrece repetir la escritura ni convierte el éxito en fallo de guardado', async () => {
  const w = await dialogHarness({ onSaved: async () => { throw new Error('SYNTHETIC-REFRESH'); } });
  await fillDialog(w); await w.button('Confirmar continuidad').click();
  assert.match(w.text(), /La continuidad está guardada/);
  assert.equal(w.controller.state.uncertain, false);
  assert.equal(w.button('Confirmar continuidad').disabled, true);
  assert.equal(w.writes().length, 1);
});

test('detalle histórico real muestra enlaces entrantes/salientes y propietario actual sin botones de escritura visibles', async () => {
  const initial = context({ selected: false });
  initial.continuidades = [{ continuidad_id: LINK, origen_numero_parada: 'SINT-ORIGEN', destino_numero_parada: 'SINT-TALLER',
    fecha_hora_entrada: '2026-10-28T23:30:00Z', dia_entrada: '2026-10-29' }];
  initial.propietario_actual = null;
  const w = await dialogHarness({ initialContext: initial, readOnly: true });
  assert.match(w.text(), /PA SINT-ORIGEN → PA SINT-TALLER/);
  assert.match(w.text(), /Asignación vigente actual: sin PA propietaria/);
  assert.equal(w.button('Confirmar continuidad').hidden, true);
  assert.equal(w.button('Previsualizar continuidad').hidden, true);
  assert.ok(w.field('PA de origen').closest('[hidden]'));
  assert.equal(w.writes().length, 0);
});

test('bloqueo de modalidad real en el formulario permanece visible y no activa confirmación', async () => {
  const blocked = context();
  blocked.confirmable = false;
  blocked.bloqueos = [{ codigo: 'MODALIDAD_CONFLICTO', mensaje: 'Modalidad manual incompatible: revisar expresamente.' }];
  const w = await dialogHarness({ selectedContext: blocked });
  await fillDialog(w);
  assert.match(w.text(), /Modalidad manual incompatible: revisar expresamente/);
  assert.equal(w.button('Confirmar continuidad').disabled, true);
  await w.button('Confirmar continuidad').click();
  assert.equal(w.writes().length, 0);
});

function hotelCardHarness({ editMode = true, editable = true, callback = true } = {}) {
  const document = { createElement: tag => new TestNode(tag, document) };
  document.body = document.createElement('body'); document.head = document.createElement('head');
  const element = (tag, options = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
      if (value == null) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  };
  const globals = vm.createContext({ document, element, substitutionOwnershipText, Map, Set, Number, String, Boolean,
    detail: (label, value) => element('div', { text: `${label}: ${value}` }),
    createStagesToggle: () => ({ button: element('button', { text: 'T' }) }),
    createOperationalDates: () => element('div'), createSubstitutionBilling: () => element('section'),
    renderAnnotationsChronology: () => null,
    summarizeDocuments: () => ({ total: 0, photos: 0, pdfs: 0, cancelled: 0 }),
    STATE_LABELS: {}, STAGE_STATE_LABELS: {}, vehicleLabel: row => row.dfm, substituteText: row => row.sustituto || '',
  });
  const source = readFileSync(new URL('../r1-alpha75/src/hotel-card.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace('export function renderHotelCard', 'function renderHotelCard');
  vm.runInContext(`${source}\nthis.renderCard = renderHotelCard;`, globals);
  const opened = [];
  const card = globals.renderCard({ id: DESTINATION, dfm: 'SINT-DFM', numero_parada: 'SINT-TALLER' }, [], new Map(), [], {
    editMode, editableIds: new Set(editable ? [DESTINATION] : []), canEditDocuments: false, canAddNotes: false, canManageNotes: false,
    onOpenEditor: () => {}, onOpenContinuity: callback ? id => opened.push(id) : undefined,
  });
  return { card, opened, button: descendants(card).find(node => node.textContent === 'Continuar sustitución desde otra PA') };
}

test('la tarjeta Hotel real ofrece continuidad sólo en edición y con identidad editable acreditada', async () => {
  const allowed = hotelCardHarness();
  assert.ok(allowed.button);
  await allowed.button.click();
  assert.deepEqual(allowed.opened, [DESTINATION]);
  assert.equal(hotelCardHarness({ editMode: false }).button, undefined);
  assert.equal(hotelCardHarness({ editable: false }).button, undefined);
  assert.equal(hotelCardHarness({ callback: false }).button, undefined);
});
