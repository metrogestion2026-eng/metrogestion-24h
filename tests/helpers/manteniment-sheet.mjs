import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const blank = () => Array(19).fill('');
export const row = (dfm, estado, stop = '') => {
  const value = blank();
  [value[0], value[1], value[4], value[7]] = [dfm, 'TEST-PLATE', stop, estado];
  return value;
};

export function richTextBuilder(text = '', url = '') {
  return {
    setText(value) { text = value; return this; },
    setLinkUrl(value) { url = value; return this; },
    build() {
      const savedText = text, savedUrl = url;
      return {
        getText: () => savedText,
        getLinkUrl: () => savedUrl,
        copy: () => richTextBuilder(savedText, savedUrl),
      };
    },
  };
}

function archiveFixture(location) {
  let sequence = 0;
  const created = [];
  function folder(name, parent = null) {
    const id = `folder-test-${++sequence}`;
    const result = {
      name, parent, children: [],
      getId: () => id,
      getUrl: () => `https://drive.google.com/drive/folders/${id}`,
      getDateCreated: () => new Date('2026-01-01T00:00:00Z'),
      getFoldersByName(target) {
        const matches = this.children.filter(child => child.name === target);
        let index = 0;
        return { hasNext: () => index < matches.length, next: () => matches[index++] };
      },
      createFolder(target) {
        const child = folder(target, this);
        created.push(child);
        return child;
      },
    };
    parent?.children.push(result);
    return result;
  }
  const root = folder('A-FLOTA');
  const exchange = folder('7A INTERCAMBIO', root);
  const vehicle = location === 'missing' ? null : folder('EXT-TEST', location === 'exchange' ? exchange : root);
  return { root, exchange, vehicle, created, folder };
}

export function fixture(version, rows, location = 'fleet') {
  const source = fs.readFileSync(new URL(`../../r1-${version}/google-apps-script/sincronizar_manteniment.gs`, import.meta.url), 'utf8');
  const context = vm.createContext({ console });
  vm.runInContext(source, context);
  const archive = archiveFixture(location);
  const archiveId = vm.runInContext('METROGESTION.archivoFlotaFolderId', context);
  context.DriveApp = { getFolderById(id) { assert.equal(id, archiveId); return archive.root; } };
  context.SpreadsheetApp = { newRichTextValue: () => richTextBuilder() };
  // Keep the complete row-and-archive flow; assigned-work reconciliation has
  // independent coverage and no assigned work is needed in these fixtures.
  context.metrogestionAplicarAsignacionesTrabajos_ = () => 0;
  const data = [blank(), ...rows.map(value => value.slice())];
  const notes = data.map(blank);
  const richTexts = data.map(() => Array(19).fill(null));
  const sheet = {
    data, notes, richTexts, copies: [], inserted: 0, linkWrites: 0,
    getLastRow: () => data.length,
    insertRowAfter(index) {
      data.splice(index, 0, blank()); notes.splice(index, 0, blank());
      richTexts.splice(index, 0, Array(19).fill(null)); this.inserted++;
    },
    getRowHeight: () => 21,
    setRowHeight() {},
    getRange(r, c, nr = 1, nc = 1) {
      const cells = (fn) => {
        for (let y = 0; y < nr; y++) for (let x = 0; x < nc; x++) fn(r - 1 + y, c - 1 + x);
      };
      return {
        r, c, nr, nc,
        getValues: () => data.slice(r - 1, r - 1 + nr).map(value => value.slice(c - 1, c - 1 + nc)),
        getDisplayValues() { return this.getValues().map(value => value.map(String)); },
        getDisplayValue: () => String(data[r - 1][c - 1]),
        getNotes: () => notes.slice(r - 1, r - 1 + nr).map(value => value.slice(c - 1, c - 1 + nc)),
        getRichTextValues: () => richTexts.slice(r - 1, r - 1 + nr).map(value => value.slice(c - 1, c - 1 + nc)),
        getRichTextValue: () => richTexts[r - 1][c - 1],
        setRichTextValue(value) {
          cells((y, x) => { data[y][x] = value.getText(); richTexts[y][x] = value; });
          sheet.linkWrites++; return this;
        },
        setValues(values) { cells((y, x) => { data[y][x] = values[y - r + 1][x - c + 1]; richTexts[y][x] = null; }); return this; },
        setValue(value) { cells((y, x) => { data[y][x] = value; richTexts[y][x] = null; }); return this; },
        setNote(value) { cells((y, x) => { notes[y][x] = value; }); return this; },
        clearContent() { return this.setValue(''); },
        clearNote() { return this.setNote(''); },
        setNumberFormat() { return this; },
        setBackground() { return this; },
        getBackground: () => '#ffffff',
        copyTo(target) {
          sheet.copies.push({ source: r, target: target.r, columns: nc });
          target.setValues(this.getValues());
          const oldNotes = this.getNotes();
          for (let y = 0; y < nr; y++) for (let x = 0; x < nc; x++) notes[target.r - 1 + y][target.c - 1 + x] = oldNotes[y][x];
        },
      };
    },
  };
  const state = { values: data.map(value => value.slice()), notesA: data.map(() => ''), notesE: data.map(() => '') };
  const command = {
    sync_id: '11111111-1111-4111-8111-111111111111', revision: 2,
    payload: { dfm: 'EXT-TEST', matricula: 'TEST-EXTERNAL', tipo: 'TR', upc: 'TEST',
      numero_parada: 'PA-9999999', sustituto: 'RES-TEST', estado: 'PARADA',
      fecha_parada: '2026-09-20', fecha_k: null, dias_parada: 2, marca: 'TEST',
      tancament: 'TANCAMENT 9', trabajos_asignados: [] },
  };
  return { context, sheet, state, command, archive };
}
