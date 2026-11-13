import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createEditableCatalogueField } from '../../r1-alpha75/src/editable-catalogue.js';

// Exercise the real component through DOM events, without a database or a
// browser dependency. This small DOM adapter supplies only platform primitives;
// option filtering, selection, focus handling and callbacks all run production
// code. Browser layout and HTTP cache have separate integration coverage.
class TestNode extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.className = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const next = force === undefined ? !names.has(name) : force;
        if (next) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
        return next;
      },
    };
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(node => node.textContent).join(''); }
  querySelectorAll(selector) {
    assert.match(selector, /^\.[\w-]+$/, 'The DOM adapter only needs class selectors');
    const name = selector.slice(1);
    return this.children.flatMap(node => [
      ...(node.className.split(/\s+/).includes(name) ? [node] : []),
      ...node.querySelectorAll(selector),
    ]);
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  scrollIntoView() {}
  select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
  focus() {
    if (this.disabled || document.activeElement === this) return;
    document.activeElement = this;
    this.dispatchEvent(new Event('focus'));
  }
  click() {
    if (this.disabled) return;
    const down = new Event('mousedown', { cancelable: true });
    this.dispatchEvent(down);
    if (!down.defaultPrevented) this.focus();
    this.dispatchEvent(new Event('click'));
  }
}

const originalGlobals = new Map();
before(() => {
  for (const key of ['document', 'window', 'Node']) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  globalThis.Node = TestNode;
  globalThis.document = {
    activeElement: null,
    createElement: tag => new TestNode(tag),
    createTextNode: text => { const node = new TestNode('#text'); node.textContent = text; return node; },
  };
  globalThis.window = { setTimeout };
});
after(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

const catalogue = [
  { codigo: 'entrada_taller', nombre: 'Entrada en taller', orden: 1 },
  { codigo: 'recogida_taller', nombre: 'Recogida de taller', orden: 2 },
  { codigo: 'tramite', nombre: 'Trámite', orden: 3 },
  { codigo: 'gestion', nombre: 'Gestión', orden: 4 },
  ...Array.from({ length: 40 }, (_, index) => ({
    codigo: `aux_${index + 1}`, nombre: `Opción ${index + 1}`, orden: index + 5,
  })),
];

function mount(value = 'entrada_taller', items = catalogue) {
  document.activeElement = null;
  const changes = [];
  const component = createEditableCatalogueField('Tipo de T', items, value, {
    onChange: (item, typed) => changes.push({ code: item?.codigo ?? item?.id ?? null, typed }),
  });
  const list = component.field.querySelectorAll('.a71-catalogue-listbox')[0];
  const arrow = component.field.querySelectorAll('.a71-catalogue-trigger')[0];
  const options = () => list.querySelectorAll('.a71-catalogue-option');
  const labels = () => options().map(option => option.children[0].textContent);
  const choose = label => {
    const option = options().find(candidate => candidate.children[0].textContent === label);
    assert.ok(option, `Option ${label} must be available without clearing the current value`);
    option.click();
  };
  const type = value => {
    component.input.value = value;
    component.input.dispatchEvent(new Event('input'));
  };
  const key = value => {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value });
    component.input.dispatchEvent(event);
    return event;
  };
  return { ...component, list, arrow, options, labels, choose, type, key, changes };
}

test('focusing a populated Tipo de T opens every option without changing its value', () => {
  const ui = mount();
  assert.equal(ui.list.hidden, true);
  ui.input.focus();
  assert.equal(ui.list.hidden, false);
  assert.equal(ui.options().length, catalogue.length);
  assert.deepEqual(ui.labels(), catalogue.map(item => item.nombre));
  assert.equal(ui.input.value, 'Entrada en taller');
  assert.deepEqual(ui.changes, []);
  ui.key('Escape');
  assert.equal(ui.list.hidden, true);
  ui.input.click();
  assert.equal(ui.options().length, catalogue.length);
  assert.equal(ui.list.hidden, false);
  assert.deepEqual(ui.changes, []);
});

test('the arrow lets the user select another type and an option beyond the old limit of 30', () => {
  const ui = mount();
  ui.arrow.click();
  assert.equal(ui.options().length, catalogue.length);
  assert.deepEqual(ui.changes, []);
  ui.choose('Trámite');
  assert.equal(ui.input.value, 'Trámite');
  assert.equal(ui.list.hidden, true);
  assert.deepEqual(ui.changes, [{ code: 'tramite', typed: 'Trámite' }]);
  ui.arrow.click();
  assert.equal(ui.options().length, catalogue.length);
  // A keyboard user can focus an option button. Returning focus to the input
  // during selection must not reopen the dropdown through its focus handler.
  ui.options().at(-1).focus();
  ui.choose('Opción 40');
  assert.equal(ui.list.hidden, true);
  assert.deepEqual(ui.changes.at(-1), { code: 'aux_40', typed: 'Opción 40' });
});

test('typing filters by text or code; the arrow reopens the full catalogue without clearing the typed text', () => {
  const ui = mount();
  ui.input.focus();
  ui.type('trami');
  assert.deepEqual(ui.labels(), ['Trámite']);
  assert.deepEqual(ui.changes.at(-1), { code: null, typed: 'trami' });
  const count = ui.changes.length;
  ui.arrow.click();
  assert.equal(ui.list.hidden, false);
  assert.equal(ui.options().length, catalogue.length);
  assert.equal(ui.input.value, 'trami');
  assert.equal(ui.changes.length, count, 'Opening the full list must not mutate the model');
  ui.type('AUX_39');
  assert.deepEqual(ui.labels(), ['Opción 39']);
  ui.choose('Opción 39');
  assert.deepEqual(ui.changes.at(-1), { code: 'aux_39', typed: 'Opción 39' });
  assert.equal(ui.list.hidden, true);
});

test('free text remains a new value and Escape does not commit a different option', () => {
  const ui = mount();
  ui.input.focus();
  ui.type('Inspección especial nueva');
  assert.equal(ui.options().length, 0);
  assert.match(ui.list.textContent, /es un valor nuevo/);
  assert.deepEqual(ui.changes.at(-1), { code: null, typed: 'Inspección especial nueva' });
  const count = ui.changes.length;
  ui.key('Escape');
  assert.equal(ui.list.hidden, true);
  assert.equal(ui.input.value, 'Inspección especial nueva');
  assert.equal(ui.changes.length, count);
});

test('keyboard navigation changes the selection only on Enter and keeps the list closed after selection', () => {
  const ui = mount();
  ui.input.focus();
  assert.equal(ui.key('ArrowDown').defaultPrevented, true);
  ui.key('ArrowDown');
  ui.key('ArrowUp');
  ui.key('ArrowDown');
  assert.deepEqual(ui.changes, []);
  assert.equal(ui.key('Enter').defaultPrevented, true);
  assert.equal(ui.input.value, 'Recogida de taller');
  assert.deepEqual(ui.changes, [{ code: 'recogida_taller', typed: 'Recogida de taller' }]);
  assert.equal(ui.list.hidden, true);
  ui.key('ArrowDown');
  assert.equal(ui.list.hidden, false);
  assert.equal(ui.options().length, catalogue.length);
  ui.key('Escape');
  assert.equal(ui.list.hidden, true);
  assert.equal(ui.changes.length, 1);
});

test('disabled fields cannot open or change; replacing the catalogue resets an obsolete filter', () => {
  const ui = mount();
  ui.input.focus();
  ui.type('trami');
  ui.setDisabled(true);
  assert.equal(ui.input.disabled, true);
  assert.equal(ui.arrow.disabled, true);
  assert.equal(ui.list.hidden, true);
  const count = ui.changes.length;
  ui.arrow.click();
  assert.equal(ui.list.hidden, true);
  assert.equal(ui.changes.length, count);
  ui.rebuild([
    { id: 'centre-a', nombre: 'Centro A', orden: 1 },
    { id: 'centre-b', nombre: 'Centro B', orden: 2 },
  ], 'centre-a', true);
  ui.setDisabled(false);
  ui.arrow.click();
  assert.deepEqual(ui.labels(), ['Centro A', 'Centro B']);
  assert.equal(ui.input.value, 'Centro A');
  assert.equal(ui.changes.length, count);
  ui.choose('Centro B');
  assert.deepEqual(ui.changes.at(-1), { code: 'centre-b', typed: 'Centro B' });
});
