import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import vm from 'node:vm';

// Execute the distributed Apps Script unchanged. Only Google's platform objects
// are synthetic: reads see real fixture state and EVERY platform effect is
// journalled. In particular no product writer/planner/selector is replaced.
export const SYNC_SOURCE = new URL('../../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url);
export const PROTOCOL = 'MG75-EJECUCION-ORDEN-001';
export const IDS = Object.freeze({
  stop: '10000000-0000-4000-8000-000000000001',
  otherStop: '10000000-0000-4000-8000-000000000002',
  work: '20000000-0000-4000-8000-000000000001',
  otherWork: '20000000-0000-4000-8000-000000000002',
});
export const HEADERS = ['DFM', 'MATRI', 'TIPO', 'UPC/INC', 'PA', 'LUGAR/TALLER/TEL',
  'PEDIDO/NOTA/FIN CONTRA', 'MANTENIMENT', 'PROGRAMAT', 'ENTRADA', 'SALIDA', 'DIES',
  'OBS', 'ASSIGNAT', 'MARCA', 'KM', 'ALBARA / ENTRADA'];
const clone = value => structuredClone(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const display = value => value instanceof Date
  ? `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`
  : String(value ?? '');
const cell = value => ({ value: clone(value ?? ''), note: '', formula: '', background: '#ffffff',
  format: '', link: '', validation: null });
const parseColumn = text => [...text].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const columnName = value => { let result = ''; for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; };
const formulaRefs = (formula, transform) => formula.split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/g)
  .map((part, i) => i % 2 ? part : part.replace(/(?<![A-Za-z0-9_])(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)(?![A-Za-z0-9_(])/g,
    (_, absoluteColumn, column, absoluteRow, row) => transform({ absoluteColumn, column: parseColumn(column), absoluteRow, row: Number(row) }))).join('');
const formulaR1C1 = (formula, row, column) => formulaRefs(formula, ref =>
  `${ref.absoluteRow ? 'R' + ref.row : ref.row === row ? 'R' : `R[${ref.row - row}]`}${ref.absoluteColumn ? 'C' + ref.column : ref.column === column ? 'C' : `C[${ref.column - column}]`}`);
const relocateFormula = (formula, deltaRow, deltaColumn) => formulaRefs(formula, ref =>
  `${ref.absoluteColumn}${columnName(ref.column + (ref.absoluteColumn ? 0 : deltaColumn))}${ref.absoluteRow}${ref.row + (ref.absoluteRow ? 0 : deltaRow)}`);

export function paradaRow(overrides = {}) {
  const row = ['TEST-DFM-01', 'TEST1234', 'FURGON', 'UPC-TEST', 'PA-910001', '',
    'TEST-SUST-01', 'PARADA', '01/10/2026', '01/10/2026', '', '', '', '', 'TEST', '', 'TANCAMENT 2'];
  for (const [column, value] of Object.entries(overrides)) row[Number(column) - 1] = value;
  return row;
}

export function workPayload(overrides = {}) {
  return { trabajo_sync_id: IDS.work, dfm: 'TEST-DFM-01', matricula: 'TEST1234',
    numero_parada: 'PA-910001', tipo: 'FURGON', upc: 'UPC-TEST', taller: 'TEST-TALLER',
    tipo_trabajo: 'MECANICA', designacion: 'TEST REVISION', fecha_necesidad: '2026-10-01',
    fecha_entrada: '', fecha_salida: '', ...overrides };
}

export function workRow(overrides = {}) {
  const work = workPayload();
  const row = [work.dfm, work.matricula, work.tipo, work.upc, work.numero_parada,
    work.taller, work.tipo_trabajo, work.designacion, '01/10/2026', '', '', '', '', '', '', '', ''];
  for (const [column, value] of Object.entries(overrides)) row[Number(column) - 1] = value;
  return row;
}

export function command(overrides = {}) {
  const { payload: patch = {}, ...other } = overrides;
  const basePayload = patch.solo_trabajos === true
    ? { sync_id: IDS.stop, seguimiento_id: '30000000-0000-4000-8000-000000000001', numero_parada: 'PA-910001',
      solo_trabajos: true, trabajos_asignados: [], trabajos_crear: [] }
    : { sync_id: IDS.stop, dfm: 'TEST-DFM-01', matricula: 'TEST1234', tipo: 'FURGON',
      upc: 'UPC-TEST', numero_parada: 'PA-910001', sustituto: 'TEST-SUST-01', estado: 'PARADA',
      marca: 'TEST', tancament: 'TANCAMENT 2', fecha_programada: '2026-10-01',
      fecha_parada: '2026-10-01', fecha_k: '', trabajos_crear: [], trabajos_asignados: [] };
  const result = { tipo: patch.solo_trabajos === true ? 'trabajos' : 'parada', sync_id: IDS.stop, revision: 7,
    payload: { ...basePayload, ...patch }, ...other };
  // Opaque server-provided fingerprint in this synthetic fixture, not a model of
  // PostgreSQL JSONB canonicalization. SQL/Edge suites verify that boundary.
  result.payload_sha256 ||= sha256(JSON.stringify(result.payload));
  return result;
}

export function scopeOf(order) {
  return { tipo: order.tipo, sync_id: order.sync_id, revision: order.revision, payload_sha256: order.payload_sha256 };
}

class RichText {
  constructor(text = '', url = '') { this.text = text; this.url = url; }
  getText() { return this.text; }
  getLinkUrl() { return this.url || null; }
  getRuns() { return [this]; }
  copy() { return new RichTextBuilder(this.text, this.url); }
}
class RichTextBuilder {
  constructor(text = '', url = '') { this.text = text; this.url = url; }
  setText(text) { this.text = String(text); return this; }
  setLinkUrl(...args) { this.url = String(args.at(-1) || ''); return this; }
  build() { return new RichText(this.text, this.url); }
}

class Range {
  constructor(sheet, row, column, height = 1, width = 1) {
    Object.assign(this, { sheet, row, column, height, width });
    if ([row, column, height, width].some(n => !Number.isInteger(n) || n < 1)) throw new Error('Invalid synthetic Range');
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.column; }
  getLastRow() { return this.row + this.height - 1; }
  getLastColumn() { return this.column + this.width - 1; }
  getNumRows() { return this.height; }
  getNumColumns() { return this.width; }
  getA1Notation() { return `R${this.row}C${this.column}:R${this.getLastRow()}C${this.getLastColumn()}`; }
  each(fn) {
    return Array.from({ length: this.height }, (_, r) => Array.from({ length: this.width }, (_, c) =>
      fn(this.sheet.at(this.row + r, this.column + c), r, c)));
  }
  getValues() { return this.each(c => clone(c.value)); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValues() { return this.each(c => c.display === undefined ? display(c.value) : String(c.display ?? '')); }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getNotes() { return this.each(c => c.note); }
  getNote() { return this.getNotes()[0][0]; }
  getFormulas() { return this.each(c => c.formula); }
  getFormula() { return this.getFormulas()[0][0]; }
  getFormulasR1C1() { return this.each((c, r, col) => c.formulaR1C1 || formulaR1C1(c.formula, this.row + r, this.column + col)); }
  getFormulaR1C1() { return this.getFormulasR1C1()[0][0]; }
  getBackgrounds() { return this.each(c => c.background); }
  getBackground() { return this.getBackgrounds()[0][0]; }
  getNumberFormats() { return this.each(c => c.format); }
  getNumberFormat() { return this.getNumberFormats()[0][0]; }
  getDataValidations() { return this.each(c => clone(c.validation)); }
  getRichTextValues() { return this.each(c => new RichText(display(c.value), c.link)); }
  getRichTextValue() { return this.getRichTextValues()[0][0]; }
  effect(method, args, fn) {
    this.sheet.world.effect({ kind: 'sheet', method, range: [this.row, this.column, this.height, this.width], args: clone(args) },
      () => this.each(fn));
    return this;
  }
  setValue(value) { return this.effect('setValue', [value], c => { c.value = clone(value); c.formula = ''; c.link = ''; delete c.display; delete c.formulaR1C1; }); }
  setValues(values) {
    if (values.length !== this.height || values.some(r => r.length !== this.width)) throw new Error('setValues dimensions');
    return this.effect('setValues', [values], (c, r, col) => { c.value = clone(values[r][col]); c.formula = ''; c.link = ''; delete c.display; delete c.formulaR1C1; });
  }
  setNote(note) { return this.effect('setNote', [note], c => { c.note = String(note ?? ''); }); }
  setNotes(notes) { return this.effect('setNotes', [notes], (c, r, col) => { c.note = String(notes[r][col] ?? ''); }); }
  setBackground(background) { return this.effect('setBackground', [background], c => { c.background = background; }); }
  setBackgrounds(values) { return this.effect('setBackgrounds', [values], (c, r, col) => { c.background = values[r][col]; }); }
  setNumberFormat(format) { return this.effect('setNumberFormat', [format], c => { c.format = format; }); }
  setNumberFormats(values) { return this.effect('setNumberFormats', [values], (c, r, col) => { c.format = values[r][col]; }); }
  setFormula(formula) { return this.effect('setFormula', [formula], c => { c.formula = formula; delete c.formulaR1C1; delete c.display; }); }
  setFormulas(values) { return this.effect('setFormulas', [values], (c, r, col) => { c.formula = values[r][col]; delete c.formulaR1C1; delete c.display; }); }
  setRichTextValue(value) { return this.effect('setRichTextValue', [value.text, value.url], c => { c.value = value.text; c.link = value.url; delete c.display; }); }
  setRichTextValues(values) { return this.effect('setRichTextValues', [values.map(r => r.map(v => [v.text, v.url]))],
    (c, r, col) => { c.value = values[r][col].text; c.link = values[r][col].url; delete c.display; }); }
  clearContent() { return this.effect('clearContent', [], c => { c.value = ''; c.formula = ''; c.link = ''; delete c.display; delete c.formulaR1C1; }); }
  clearNote() { return this.effect('clearNote', [], c => { c.note = ''; }); }
  clearDataValidations() { return this.effect('clearDataValidations', [], c => { c.validation = null; }); }
  copyTo(target, type) {
    const source = this.each(c => clone(c));
    return target.effect('copyTo', [this.getA1Notation(), type || 'all'], (c, r, col) => {
      const from = source[r % this.height][col % this.width];
      if (type === 'PASTE_FORMULA') { c.formula = relocateFormula(from.formula, target.row - this.row, target.column - this.column); delete c.formulaR1C1; }
      else if (type === 'PASTE_FORMAT') { c.format = from.format; c.background = from.background; }
      else { Object.assign(c, clone(from)); c.formula = relocateFormula(from.formula, target.row - this.row, target.column - this.column); delete c.formulaR1C1; }
      delete c.display;
    });
  }
  createFilter() {
    const filter = new Filter(this.sheet, [this.row, this.column, this.height, this.width]);
    this.sheet.world.effect({ kind: 'sheet', method: 'createFilter', range: filter.range }, () => { this.sheet.filter = filter; });
    return filter;
  }
}

class Filter {
  constructor(sheet, range, criteria = {}) { Object.assign(this, { sheet, range, criteria: clone(criteria) }); }
  getRange() { return this.sheet.getRange(...this.range); }
  getColumnFilterCriteria(column) { return this.criteria[column] ?? null; }
  setColumnFilterCriteria(column, criterion) {
    this.sheet.world.effect({ kind: 'sheet', method: 'setColumnFilterCriteria', column }, () => { this.criteria[column] = clone(criterion); });
    return this;
  }
  remove() { this.sheet.world.effect({ kind: 'sheet', method: 'removeFilter' }, () => { this.sheet.filter = null; }); }
}

class Sheet {
  constructor(world, rows, options) {
    Object.assign(this, { world, rows: rows.map(r => r.map(cell)), heights: {}, maxRows: options.maxRows || 100, maxColumns: 19,
      filter: null });
    // Matrix input makes the harness reusable with a private exported snapshot.
    // Cached cell values and formula text stay separate; this is not a formula
    // evaluator. No fixture data are loaded or written merely by importing it.
    for (const [name, field] of Object.entries({ displayValues: 'display', notes: 'note', formulas: 'formula', formulasR1C1: 'formulaR1C1', backgrounds: 'background',
      numberFormats: 'format', links: 'link', dataValidations: 'validation' })) {
      (options[name] || []).forEach((row, r) => row.forEach((value, c) => { this.at(r + 1, c + 1)[field] = clone(value ?? ''); }));
    }
    Object.assign(this.heights, options.rowHeights || {});
    for (const [key, patch] of Object.entries(options.cells || {})) {
      const [row, column] = key.split(',').map(Number);
      Object.assign(this.at(row, column), clone(patch));
    }
    if (options.filter) this.filter = new Filter(this, [1, 1, this.maxRows, 17], options.filter === true ? {} : options.filter);
  }
  at(row, column) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push(cell(''));
    return this.rows[row - 1][column - 1];
  }
  getName() { return 'MANTENIMENT'; }
  getSheetId() { return 1; }
  getParent() { return this.world.book; }
  getLastRow() {
    for (let r = this.rows.length - 1; r >= 0; r--) if (this.rows[r].some(c => c.value !== '' || c.formula)) return r + 1;
    return 0;
  }
  getLastColumn() { return Math.max(17, ...this.rows.map(row => row.findLastIndex(c => c.value !== '' || c.formula) + 1)); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(row, column, height = 1, width = 1) {
    if (typeof row === 'string') {
      const m = /^([A-Z]+)(\d*)?(?::([A-Z]+)(\d*)?)?$/.exec(row);
      if (!m) throw new Error(`Unsupported synthetic A1 ${row}`);
      return new Range(this, Number(m[2] || 1), parseColumn(m[1]),
        (Number(m[4] || (m[3] ? this.maxRows : m[2] || 1)) - Number(m[2] || 1)) + 1,
        parseColumn(m[3] || m[1]) - parseColumn(m[1]) + 1);
    }
    return new Range(this, row, column, height, width);
  }
  getFilter() { return this.filter; }
  getRowHeight(row) { return this.heights[row] || 21; }
  setRowHeight(row, height) { this.world.effect({ kind: 'sheet', method: 'setRowHeight', row, height }, () => { this.heights[row] = height; }); return this; }
  insertRowAfter(row) {
    this.world.effect({ kind: 'sheet', method: 'insertRowAfter', row }, () => {
      this.rows.splice(row, 0, Array.from({ length: 19 }, () => cell('')));
      this.maxRows++;
      this.heights = Object.fromEntries(Object.entries(this.heights).map(([r, v]) => [Number(r) > row ? Number(r) + 1 : r, v]));
    });
    return this;
  }
  getProtections() { return []; }
  snapshot() {
    // Include only initialized rows/columns up to the existing sheet dimensions;
    // trailing blank read buffers do not change observable state.
    const last = Math.max(this.getLastRow(), ...this.rows.map((r, i) => r.some(c => c.note || c.link || c.background !== '#ffffff' || c.format) ? i + 1 : 0));
    const rows = Array.from({ length: last }, (_, r) => Array.from({ length: 19 }, (_, c) => clone(this.at(r + 1, c + 1))));
    return { rows, maxRows: this.maxRows, heights: clone(this.heights), filter: this.filter ? { range: clone(this.filter.range), criteria: clone(this.filter.criteria) } : null };
  }
}

class Folder {
  constructor(world, name, id, parent = null) { Object.assign(this, { world, name, id, parent, children: [], createdAt: new Date('2020-01-01T00:00:00Z') }); }
  getName() { return this.name; }
  getId() { return this.id; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  getDateCreated() { return this.createdAt; }
  getFoldersByName(name) {
    const items = this.children.filter(f => f.name === name); let i = 0;
    return { hasNext: () => i < items.length, next: () => items[i++] };
  }
  add(name, id = `synthetic-folder-${this.world.folders.size}`) {
    const folder = new Folder(this.world, name, id, this);
    this.children.push(folder); this.world.folders.set(id, folder); return folder;
  }
  createFolder(name) {
    let folder;
    this.world.effect({ kind: 'drive', method: 'createFolder', parent: this.id, name }, () => { folder = this.add(name); });
    return folder;
  }
}

class Blob {
  constructor(data) { this.data = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.from(data.map(n => n & 255)) : Buffer.from(String(data)); }
  getBytes() { return [...this.data].map(n => n > 127 ? n - 256 : n); }
  getDataAsString() { return this.data.toString('utf8'); }
}

export class SimulatedCrash extends Error {
  constructor(message = 'Synthetic execution terminated') { super(message); this.name = 'SimulatedCrash'; }
}

export function createExecutorHarness(options = {}) {
  const world = {
    source: options.source ?? readFileSync(SYNC_SOURCE, 'utf8'), events: [], httpCalls: [], faults: [], crashed: false,
    properties: new Map(Object.entries(options.properties || {})), folders: new Map(), triggers: [], httpHandler: options.http,
    checkpoint(event, timing) {
      if (this.crashed) throw new SimulatedCrash();
      const fault = this.faults.find(f => f.timing === timing && f.match(event));
      if (!fault) return;
      if (fault.once !== false) this.faults.splice(this.faults.indexOf(fault), 1);
      if (fault.crash) this.crashed = true;
      throw fault.error || (fault.crash ? new SimulatedCrash() : new Error('Synthetic platform failure'));
    },
    effect(event, change) {
      event.sequence = this.events.length;
      this.checkpoint(event, 'before');
      change();
      event.applied = true;
      this.events.push(event);
      this.checkpoint(event, 'after');
    },
  };
  const sheet = new Sheet(world, options.rows || options.values || [HEADERS, paradaRow()], options);
  world.sheet = sheet;
  const properties = {
    getProperty: key => world.properties.get(key) ?? null,
    getProperties: () => Object.fromEntries(world.properties),
    setProperty(key, value) {
      world.effect({ kind: 'property', method: 'setProperty', key, value: String(value) }, () => world.properties.set(key, String(value)));
      return this;
    },
    setProperties(values, deleteOthers = false) {
      world.effect({ kind: 'property', method: 'setProperties', keys: Object.keys(values) }, () => {
        if (deleteOthers) world.properties.clear();
        Object.entries(values).forEach(([key, value]) => world.properties.set(key, String(value)));
      });
      return this;
    },
    deleteProperty(key) { world.effect({ kind: 'property', method: 'deleteProperty', key }, () => world.properties.delete(key)); return this; },
    deleteAllProperties() { world.effect({ kind: 'property', method: 'deleteAllProperties' }, () => world.properties.clear()); return this; },
  };
  const noopChain = new Proxy({}, { get: (_, key) => key === 'then' ? undefined : () => noopChain });
  const ui = { Button: { OK: 'OK', CANCEL: 'CANCEL' }, ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
    createMenu: () => noopChain, alert: (...args) => { world.events.push({ kind: 'ui', method: 'alert', args }); },
    prompt: () => ({ getSelectedButton: () => 'CANCEL', getResponseText: () => '' }), showModalDialog: () => {} };
  const rootFolder = new Folder(world, 'A-FLOTA', 'synthetic-root');
  world.folders.set(rootFolder.id, rootFolder);
  for (const name of options.dfmFolders || ['TEST-DFM-01', 'TEST-DFM-02']) rootFolder.add(name);
  const buildContext = () => {
    world.crashed = false;
    const context = vm.createContext({
      console, Date, Math, JSON, Map, Set, Number, String, Boolean, Object, Array, RegExp, Error, Uint8Array,
      PropertiesService: { getScriptProperties: () => properties },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: randomUUID,
        newBlob: data => new Blob(data), gzip: blob => new Blob(gzipSync(blob.data)), ungzip: blob => new Blob(gunzipSync(blob.data)),
        base64Encode: data => Buffer.from(data.map(n => n & 255)).toString('base64'), base64Decode: text => [...Buffer.from(text, 'base64')],
        computeDigest: (_, text) => [...createHash('sha256').update(String(text)).digest()].map(n => n > 127 ? n - 256 : n),
        formatDate: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      },
      SpreadsheetApp: {
        openById: () => world.book, getActiveSpreadsheet: () => world.book, getActive: () => world.book,
        CopyPasteType: { PASTE_FORMULA: 'PASTE_FORMULA', PASTE_FORMAT: 'PASTE_FORMAT' }, ProtectionType: { RANGE: 'RANGE' },
        getUi: () => ui, newRichTextValue: () => new RichTextBuilder(),
        flush: () => world.effect({ kind: 'flush', method: 'flush' }, () => {}),
      },
      DriveApp: {
        getFolderById: id => world.folders.get(id) || (id === world.config.archivoFlotaFolderId ? rootFolder : (() => { throw new Error('Unknown synthetic folder'); })()),
        getFileById: () => ({ getLastUpdated: () => new Date('2026-10-01T00:00:00Z') }),
      },
      UrlFetchApp: { fetch(url, init) {
        const body = JSON.parse(init.payload);
        const event = { kind: 'http', method: body.action || 'sync', body, url, init };
        world.checkpoint(event, 'before'); world.events.push(event); world.httpCalls.push(event);
        const result = world.httpHandler ? world.httpHandler(body, world) : defaultResponse(body, world);
        world.checkpoint(event, 'after');
        return { getResponseCode: () => result?.status ?? 200,
          getContentText: () => typeof result?.body === 'string' ? result.body : JSON.stringify(result?.body ?? result) };
      } },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
      ScriptApp: { getProjectTriggers: () => world.triggers, deleteTrigger: trigger => world.effect({ kind: 'trigger', method: 'delete' }, () => { world.triggers = world.triggers.filter(t => t !== trigger); }),
        newTrigger: name => { const builder = { timeBased: () => builder, everyHours: () => builder, after: () => builder,
          create: () => world.effect({ kind: 'trigger', method: 'create', name }, () => world.triggers.push({ getHandlerFunction: () => name })) }; return builder; } },
      HtmlService: { createHtmlOutput: () => noopChain },
      Session: { getScriptTimeZone: () => 'Europe/Madrid' },
    });
    vm.runInContext(world.source, context, { filename: 'sincronizar_manteniment.gs' });
    world.context = context;
    world.config = vm.runInContext('METROGESTION', context);
    world.book = { getId: () => world.config.spreadsheetId, getName: () => world.config.spreadsheetName,
      getSheetByName: name => name === world.config.sheetName ? sheet : null, getSpreadsheetTimeZone: () => 'Europe/Madrid' };
    if (!world.properties.has(world.config.tokenProperty)) world.properties.set(world.config.tokenProperty, 'mg_' + '0'.repeat(64));
    return context;
  };
  buildContext();
  const harness = {
    world, sheet,
    get context() { return world.context; }, get config() { return world.config; },
    get events() { return world.events; }, get httpCalls() { return world.httpCalls; },
    get effects() { return world.events.filter(e => ['sheet', 'drive', 'trigger'].includes(e.kind)); },
    get properties() { return Object.fromEntries(world.properties); },
    call(name, ...args) {
      const fn = world.context[name];
      if (typeof fn !== 'function') throw new Error(`Distributed GS does not expose ${name}`);
      return fn(...args);
    },
    restart() { buildContext(); return harness; },
    fault(match, { timing = 'after', crash = false, error, once = true } = {}) { world.faults.push({ match, timing, crash, error, once }); },
    clearFaults() { world.faults = []; },
    clearEvents() { world.events = []; world.httpCalls = []; },
    setHttp(handler) { world.httpHandler = handler; },
    snapshot() { return { sheet: sheet.snapshot(), folders: [...world.folders.values()].map(f => ({ id: f.id, name: f.name, parent: f.parent?.id || null })) }; },
    sheetState() { return harness.call('metrogestionEstadoHojaLote_', sheet); },
    newState(commands, extra = {}) { return { id: randomUUID(), hoja: world.config.spreadsheetId, fase: 'comandos',
      comandos: clone(commands), trabajos: [], version: world.config.scriptVersion, version_ejecucion: PROTOCOL,
      totalComandos: commands.length, confirmados: 0, creadas: 0, cierres: 0, mensajeBase: 'Synthetic test',
      alcance: commands.map(scopeOf), ...extra }; },
    save(state) { return harness.call('metrogestionGuardarCiclo_', state); },
    load() { return harness.call('metrogestionLeerCiclo_'); },
    process(state) { return harness.call('metrogestionProcesarOrdenesLote_', sheet, state, 'mg_' + '0'.repeat(64), Date.now() + 30000); },
    externalEdit(row, column, patch) { world.effect({ kind: 'external', method: 'edit', row, column, patch }, () => Object.assign(sheet.at(row, column), clone(patch))); },
  };
  return harness;
}

export function defaultResponse(body, world) {
  if (body.action === 'authorize') {
    const p = body.payload;
    const now = Date.now();
    return { ok: true, autorizacion: { protocolo: 'manteniment-ejecucion-v1', version_ejecucion: PROTOCOL,
      version_script: p.version_script, alcance: clone(p.alcance),
      solo_lectura: true, request_id: p.request_id, spreadsheet_id: p.spreadsheet_id,
      orden: scopeOf(p.orden), autorizada: true, motivo: 'AUTORIZADA',
      autorizado_en: new Date(now).toISOString(), expira_en: new Date(now + 30000).toISOString() } };
  }
  if (body.action === 'ack') return { ok: true };
  if (body.action === 'ack_execution') {
    const p = body.payload;
    return { ok: true, confirmacion: { protocolo: 'manteniment-acuse-ejecucion-v1', version_ejecucion: PROTOCOL,
      request_id: p.request_id, spreadsheet_id: p.spreadsheet_id, confirmada: true, orden: scopeOf(p.confirmacion) } };
  }
  throw new Error(`Unexpected synthetic HTTP action: ${body.action || 'sync'}`);
}
