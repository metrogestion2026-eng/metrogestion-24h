import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash, randomUUID, randomBytes } from 'node:crypto';

const source = fs.readFileSync(new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url), 'utf8');
const sheetId = '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
function setup() {
  const props = new Map(), writes = [], acknowledgements = [];
  let failSaving = false, now = 0, requests = 0, failAck = false, restores = 0;
  const service = {
    getProperty: key => props.get(key) ?? null,
    setProperty(key, value) { assert.ok(Buffer.byteLength(value) <= 9000); props.set(key, value); },
    setProperties(values) { let i = 0; for (const [k, v] of Object.entries(values)) { this.setProperty(k, v); if (failSaving && ++i === 1) throw new Error('Corte al guardar partes'); } },
    getProperties: () => Object.fromEntries(props),
    deleteProperty: key => props.delete(key),
  };
  const blob = (data, contentType = null, name = null) => ({
    getBytes: () => [...Buffer.from(data)],
    getDataAsString: () => Buffer.from(data).toString('utf8'),
    getContentType: () => contentType,
    getName: () => name,
  });
  const requireContentType = b => {
    if (!b.getContentType()) throw new Error('El objeto blob no puede contener un tipo de contenido nulo en esta operación.');
  };
  class Clock extends Date { static now() { return now; } }
  const c = vm.createContext({ console, Date: Clock, PropertiesService: { getScriptProperties: () => service },
    Utilities: {
      getUuid: randomUUID,
      newBlob: (data, contentType = typeof data === 'string' ? 'text/plain' : null, name = null) => blob(typeof data === 'string' ? Buffer.from(data) : data, contentType, name),
      gzip(b, name) { requireContentType(b); return blob(gzipSync(Buffer.from(b.getBytes())), 'application/gzip', name); },
      ungzip(b) { requireContentType(b); return blob(gunzipSync(Buffer.from(b.getBytes())), 'application/json'); },
      base64Encode: b => Buffer.from(b).toString('base64'),
      base64Decode: s => [...Buffer.from(s, 'base64')],
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { flush() {}, openById: () => ({ getName: () => 'MANTENIMIENTOS', getSheetByName: () => ({}) }) },
  });
  vm.runInContext(source, c);
  c.metrogestionSha256_ = value => createHash('sha256').update(value).digest('hex');
  c.metrogestionLeerToken_ = () => 'TEST';
  c.metrogestionSolicitarCiclo_ = () => { requests++; return { syncResult: { mensaje: 'Sincronización correcta.', comandos_manteniment: Array.from({ length: 7 }, (_, i) => ({ id: i })) }, trabajos: [] }; };
  c.metrogestionEstadoHojaLote_ = () => ({});
  c.metrogestionSuspenderFiltro_ = () => ({ saved: true });
  c.metrogestionRestaurarFiltro_ = () => { restores++; };
  c.metrogestionAplicarComandos_ = (sheet, commands) => { writes.push(commands[0].id); return [{ id: commands[0].id }]; };
  c.metrogestionConfirmarComandos_ = (token, confirmations) => { if (failAck) throw new Error('ACK falló'); acknowledgements.push(confirmations[0].id); };
  c.metrogestionAplicarReglaAdministrativa_ = () => ({ renovaciones: 4, cierres: 1, avisos: [], pendiente: false, restantes: 0 });
  return { c, props, service, writes, acknowledgements, setFailure: b => { failSaving = b; }, setAckFailure: b => { failAck = b; }, advance: ms => { now += ms; }, requests: () => requests, restores: () => restores };
}

test('guarda Unicode en partes menores de 9 KB y conserva la generación anterior tras un corte', () => {
  const env = setup(), state = { hoja: sheetId, id: 'first', fase: 'comandos', texto: 'Trámite · día · ' + randomBytes(30000).toString('base64') };
  env.c.metrogestionGuardarCiclo_(state);
  assert.equal(env.c.metrogestionLeerCiclo_().texto, state.texto);
  env.setFailure(true);
  assert.throws(() => env.c.metrogestionGuardarCiclo_({ ...state, id: 'second' }), /Corte/);
  assert.equal(env.c.metrogestionLeerCiclo_().id, 'first');
  env.setFailure(false); env.c.metrogestionGuardarCiclo_({ ...state, id: 'third' });
  assert.equal(env.c.metrogestionLeerCiclo_().id, 'third');
  const manifest = JSON.parse(env.props.get('METROGESTION_CICLO'));
  assert.equal([...env.props.keys()].filter(k => k.startsWith('METROGESTION_CICLO_')).length, manifest.partes);
});

test('lee y retoma una cola de .2 sin regenerarla ni volver a enviar el snapshot', () => {
  const e = setup();
  const previous = { id: 'cola-anterior', hoja: sheetId, fase: 'comandos', comandos: [{ id: 6 }], trabajos: [], totalComandos: 7, confirmados: 6, creadas: 4, cierres: 0, mensajeBase: 'Sincronización correcta · Trámite' };
  // Formato persistido de .2: base64(gzip(JSON)), sin metadatos MIME.
  // Se prepara fuera del escritor nuevo para comprobar compatibilidad real.
  const packed = gzipSync(Buffer.from(JSON.stringify(previous))).toString('base64');
  e.props.set('METROGESTION_CICLO_anterior_0', packed);
  e.props.set('METROGESTION_CICLO', JSON.stringify({ generacion: 'anterior', partes: 1, sha: createHash('sha256').update(packed).digest('hex') }));
  const read = e.c.metrogestionLeerCiclo_();
  assert.deepEqual(JSON.parse(JSON.stringify(read)), previous);
  assert.equal(e.props.get('METROGESTION_CICLO_anterior_0'), packed);
  const r = e.c.metrogestionEjecutarSincronizacion_('manual');
  assert.equal(r.ciclo, previous.id);
  assert.equal(e.requests(), 0);
  assert.deepEqual(e.acknowledgements, [6]);
  const saved = e.c.metrogestionLeerCiclo_();
  assert.equal(saved.confirmados, 7);
  assert.equal(saved.creadas, 4);
  assert.equal(saved.mensajeBase, previous.mensajeBase);
  assert.equal(saved.fase, 'necesidades');
});

test('siete órdenes se confirman una por llamada, sin volver a enviar el snapshot', () => {
  const e = setup(); let r = e.c.metrogestionEjecutarSincronizacion_('manual');
  assert.equal(r.pendiente, true); assert.deepEqual(e.writes, []); const id = r.ciclo;
  for (let i = 1; i <= 7; i++) {
    e.c.metrogestionEjecutarSincronizacion_('manual', id); assert.equal(e.writes.length, i);
  }
  r = e.c.metrogestionEjecutarSincronizacion_('manual', id); assert.equal(r.pendiente, false);
  assert.deepEqual(e.acknowledgements, [0, 1, 2, 3, 4, 5, 6]); assert.equal(e.requests(), 1);
  assert.equal(e.c.metrogestionEjecutarSincronizacion_('manual', id).pendiente, false);
  assert.equal(e.requests(), 1, 'Reintentar la respuesta final no inicia otro ciclo');
});

test('si falla la confirmación, conserva la orden para reintentar y restaura el filtro', () => {
  const e = setup(); const r = e.c.metrogestionEjecutarSincronizacion_('manual');
  e.setAckFailure(true); assert.throws(() => e.c.metrogestionEjecutarSincronizacion_('manual', r.ciclo), /ACK/);
  assert.equal(e.c.metrogestionLeerCiclo_().comandos[0].id, 0); assert.equal(e.restores(), 1);
  e.setAckFailure(false); e.c.metrogestionEjecutarSincronizacion_('manual', r.ciclo);
  assert.deepEqual(e.acknowledgements, [0]); assert.equal(e.requests(), 1);
});

test('cerrar la ventana y abrirla de nuevo retoma la cola guardada', () => {
  const e = setup(); const r = e.c.metrogestionEjecutarSincronizacion_('manual');
  e.c.metrogestionEjecutarSincronizacion_('manual', r.ciclo);
  const resumed = e.c.metrogestionEjecutarSincronizacion_('manual');
  assert.equal(resumed.ciclo, r.ciclo); assert.equal(e.requests(), 1);
  assert.deepEqual(e.acknowledgements, [0, 1]);
});

test('la fase de necesidades mantiene el filtro existente y confirma el avance', () => {
  const e = setup();
  e.c.metrogestionSolicitarCiclo_ = () => ({ syncResult: {}, trabajos: [] });
  const r = e.c.metrogestionEjecutarSincronizacion_('manual');
  e.c.metrogestionSuspenderFiltro_ = () => { throw new Error('No retirar el filtro para crear necesidades'); };
  e.c.metrogestionRestaurarFiltro_ = () => { throw new Error('No reconstruir el filtro para crear necesidades'); };
  assert.equal(e.c.metrogestionEjecutarSincronizacion_('manual', r.ciclo).pendiente, false);
  assert.equal(e.c.metrogestionLeerCiclo_().creadas, 4);
});

test('el diagnóstico conserva el último paso fallido y no lee la hoja ni la clave', () => {
  const e = setup();
  const r = e.c.metrogestionEjecutarSincronizacion_('manual');
  e.c.metrogestionAplicarComandos_ = () => { throw new Error('Tiempo máximo'); };
  assert.throws(() => e.c.metrogestionEjecutarSincronizacion_('manual', r.ciclo), /Tiempo máximo/);
  e.c.metrogestionRegistrarPaso_('Insertando próxima LINDEP de 9000 · después de fila 500');
  e.c.SpreadsheetApp.openById = () => { throw new Error('Diagnóstico no debe abrir Sheets'); };
  e.c.metrogestionLeerToken_ = () => { throw new Error('Diagnóstico no debe leer clave'); };
  const diag = e.c.metrogestionDiagnosticoSincronizacion();
  assert.match(diag.paso, /Insertando próxima LINDEP/);
  assert.equal(diag.version, 'alpha75-2026.09.17.4');
  assert.equal(e.c.metrogestionLeerCiclo_().comandos.length, 7);
});

test('un comando lento cede antes de comenzar otro; no se marca terminado', () => {
  const e = setup(); const r = e.c.metrogestionEjecutarSincronizacion_('manual');
  const apply = e.c.metrogestionAplicarComandos_;
  e.c.metrogestionAplicarComandos_ = (...args) => { e.advance(125000); return apply(...args); };
  const result = e.c.metrogestionEjecutarSincronizacion_('manual', r.ciclo);
  assert.deepEqual(e.acknowledgements, [0]); assert.equal(result.pendiente, true);
  assert.equal(e.c.metrogestionLeerCiclo_().comandos.length, 6);
});

test('un identificador de ventana antiguo no puede iniciar ni modificar otro ciclo', () => {
  const e = setup(); e.c.metrogestionEjecutarSincronizacion_('manual');
  assert.throws(() => e.c.metrogestionEjecutarSincronizacion_('manual', 'antiguo'), /otro ciclo/);
  assert.equal(e.writes.length, 0); assert.equal(e.requests(), 1);
});

test('lectura de enlaces de una parada usa una llamada a Sheets para todo el bloque', () => {
  const e = setup(); let reads = 0;
  const link = 'https://drive.google.com/drive/folders/existing';
  const rich = { getLinkUrl: () => link };
  const sheet = { getRange: () => ({ getRichTextValues: () => { reads++; return Array.from({ length: 100 }, () => [rich]); } }) };
  e.c.metrogestionObtenerCarpetaParada_ = () => ({ getUrl: () => link });
  const values = [Array(17).fill(''), ...Array.from({ length: 100 }, () => { const r = Array(17).fill(''); r[0] = '9000'; r[4] = 'PA-1'; return r; })];
  assert.equal(e.c.metrogestionEnlazarArchivoParada_(sheet, 'PA-1', '9000', { values }), 100);
  assert.equal(reads, 1);
});

test('modalidad programada mantiene una sola continuación y no reinicia un ciclo ya terminado', () => {
  const e = setup(); const triggers = [];
  e.c.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger(name) { return { timeBased() { return this; }, after(ms) { assert.equal(ms, 60000); return this; }, create() { const t = { getHandlerFunction: () => name }; triggers.push(t); return t; } }; },
  };
  const r = e.c.metrogestionLanzarProgramada_(); assert.equal(triggers.length, 1);
  e.c.metrogestionReanudarProgramada(); assert.equal(triggers.length, 1);
  while (e.c.metrogestionEjecutarSincronizacion_('manual', r.ciclo).pendiente) { /* completar en el menú */ }
  const before = e.requests();
  e.c.metrogestionReanudarProgramada();
  assert.equal(triggers.length, 0); assert.equal(e.requests(), before);
});
