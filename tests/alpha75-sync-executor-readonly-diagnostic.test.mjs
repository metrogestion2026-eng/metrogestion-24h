import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = new URL('../r1-alpha75/google-apps-script/', import.meta.url);
const main = fs.readFileSync(new URL('sincronizar_manteniment.gs', root), 'utf8');
const helper = fs.readFileSync(new URL('diagnostico_reintento_solo_lectura.gs', root), 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const ref = { tipo: 'parada', sync_id: '11111111-1111-4111-8111-111111111111', revision: 1, payload_sha256: 'a'.repeat(64) };
const executor = 'MG75-EJECUCION-ORDEN-001';

function harness(kind) {
  const values = { METROGESTION_SYNC_TOKEN: 'NEVER_READ_SECRET', OTHER: 'PRIVATE_OTHER' };
  const effects = [], logs = [], reads = [];
  const blocked = name => { effects.push(name); throw new Error('PRIVATE_FAILURE'); };
  const props = {
    getKeys: () => Object.keys(values),
    getProperty(key) {
      reads.push(key);
      if (!/^(?:METROGESTION_CICLO(?:_|$)|METROGESTION_ALCANCE_ORDENES_V1(?:_|$)|METROGESTION_ORDEN_V1:|METROGESTION_SOLICITUD_ENTREGA_V1$|METROGESTION_ENTREGA_V1:)/.test(key)) blocked('secret_read');
      return values[key] ?? null;
    },
    getProperties: () => blocked('getProperties'),
    setProperty: () => blocked('setProperty'), setProperties: () => blocked('setProperties'),
    deleteProperty: () => blocked('deleteProperty'), deleteAllProperties: () => blocked('deleteAllProperties'),
  };
  const blob = value => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return { getBytes: () => [...buffer], getDataAsString: () => buffer.toString('utf8') };
  };
  const denied = name => new Proxy({}, { get() { return blocked(name); } });
  const ctx = vm.createContext({ console,
    PropertiesService: { getScriptProperties: () => props },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()],
      base64Decode: value => Buffer.from(value, 'base64'), newBlob: blob,
      ungzip: value => blob(zlib.gunzipSync(Buffer.from(value.getBytes()))) },
    ScriptApp: { getProjectTriggers: () => [
      { getHandlerFunction: () => 'metrogestionReanudarProgramada' },
      { getHandlerFunction: () => 'OTHER_PRIVATE_TRIGGER' },
    ] },
    SpreadsheetApp: denied('Sheets'), DriveApp: denied('Drive'), UrlFetchApp: denied('HTTP'),
    Logger: { log: value => logs.push(value) },
  });
  vm.runInContext(main + '\n' + helper, ctx);
  const spreadsheetId = vm.runInContext('METROGESTION.spreadsheetId', ctx);
  if (kind === 'terminado' || kind === 'comandos') {
    const cycle = { id: '22222222-2222-4222-8222-222222222222', hoja: spreadsheetId,
      fase: kind, comandos: kind === 'comandos' ? [{ ...ref, payload: { private: 'PRIVATE_PAYLOAD' } }] : [],
      version: 'alpha75-2026.10.26.1', version_ejecucion: executor };
    const packed = zlib.gzipSync(Buffer.from(JSON.stringify(cycle))).toString('base64');
    values.METROGESTION_CICLO = JSON.stringify({ partes: 1, generacion: 'fixture', sha: sha(packed) });
    values.METROGESTION_CICLO_fixture_0 = packed;
    const selected = JSON.stringify({ version_ejecucion: executor, spreadsheet_id: spreadsheetId, alcance: [ref] });
    const generation = 'b'.repeat(32);
    values.METROGESTION_ALCANCE_ORDENES_V1 = JSON.stringify({ generacion: generation, partes: 1, sha: sha(selected) });
    values['METROGESTION_ALCANCE_ORDENES_V1_' + generation + '_0'] = selected;
  }
  if (kind === 'comandos') values.METROGESTION_SOLICITUD_ENTREGA_V1 = JSON.stringify({
    request_id: '33333333-3333-4333-8333-333333333333', spreadsheet_id: spreadsheetId, version_ejecucion: executor,
  });
  if (kind === 'incierto') {
    values['METROGESTION_ORDEN_V1:' + sha(JSON.stringify(ref))] = JSON.stringify({
      referencia: ref, version_ejecucion: executor, spreadsheet_id: spreadsheetId, estado: 'incierto',
      plan_sha256: 'c'.repeat(64), fotografia_inicial_sha256: 'd'.repeat(64), payload: 'PRIVATE_PAYLOAD',
    });
    values['METROGESTION_ORDEN_V1:' + 'e'.repeat(64)] = '{ PRIVATE_FAILURE';
  }
  const before = JSON.stringify(values);
  const result = ctx.metrogestionComprobarReintentoSoloLectura();
  assert.deepEqual(effects, []);
  assert.equal(JSON.stringify(values), before);
  assert.ok(!reads.includes('METROGESTION_SYNC_TOKEN'));
  assert.doesNotMatch(JSON.stringify(result) + logs.join('\n'), /NEVER_READ_SECRET|PRIVATE_|OTHER_PRIVATE_TRIGGER/);
  assert.equal(result.versiones.build, 'alpha75-2026.11.07.8');
  assert.equal(result.activadores.cantidades.metrogestionReanudarProgramada, 1);
  return result;
}

test('estado vacío: solo lee las propiedades necesarias y no produce efectos', () => {
  const r = harness('vacio');
  assert.equal(r.estado.ciclo.presente, false);
  assert.equal(r.estado.alcance.presente, false);
});
test('ciclo terminado: verifica hash y conserva la referencia de alcance', () => {
  const r = harness('terminado');
  assert.equal(r.estado.ciclo.fase, 'terminado');
  assert.equal(r.estado.ciclo.integridad, 'verificada');
  assert.equal(r.estado.alcance.referencias[0].sync_id, ref.sync_id);
});
test('ciclo con comandos: resume identidad y solicitud sin payload ni limpieza', () => {
  const r = harness('comandos');
  assert.equal(r.estado.ciclo.comandos, 1);
  assert.equal(r.estado.solicitud_entrega.presente, true);
  assert.equal(r.estado.solicitud_entrega.cabecera_entrega_presente, false);
});
test('journal incierto e ilegible: informa estados y códigos seguros sin mutar ni ocultar el error', () => {
  const r = harness('incierto');
  assert.equal(r.estado.diarios.estados.incierto, 1);
  assert.equal(r.estado.diarios.estados.error, 1);
  assert.equal(r.estado.diarios.pendientes[1].error, 'DIARIO_NO_VERIFICABLE');
});
