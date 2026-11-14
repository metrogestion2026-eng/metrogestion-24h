import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutorHarness, HEADERS, IDS, command, paradaRow } from './helpers/alpha75-sync-executor-harness.mjs';
const copy = x => JSON.parse(JSON.stringify(x));
const REQUEST = 'METROGESTION_SOLICITUD_ENTREGA_V1';
const protectedFlags = { solo_lectura_manual_protegida: true, escritura_segura_manual: false, pausa_importacion_identidad: false };
function preflight(h, flags = protectedFlags, changed = {}) {
  const p = { protocolo: 'manteniment-preflight-v1', solo_lectura: true,
    barreras: { ...flags }, sincronizacion_autorizada: false, compatible: true,
    cliente_escritura_segura_manual: true, archivo_coincide: true, receptor_coincide: true,
    barreras_cerradas: flags.solo_lectura_manual_protegida === true && flags.escritura_segura_manual === false && flags.pausa_importacion_identidad === true,
    version_preflight: h.config.preflightVersion, version_script_recibida: h.config.scriptVersion,
    version_script_esperada: h.config.scriptVersion, version_preflight_recibida: h.config.preflightVersion,
    ...changed };
  p.motivos = p.barreras_cerradas ? [] : ['BARRERAS_NO_CERRADAS'];
  if (!p.archivo_coincide) { p.compatible = false; p.motivos.unshift('ARCHIVO_DISTINTO'); }
  return { ok: true, preflight: p, recibido_en: new Date().toISOString() };
}
function received(changes = {}) { return { ok: true, resultado: {
  ok: true, ejecucion_id: '40000000-0000-4000-8000-000000000001',
  solo_lectura_manual_protegida: true, escritura_segura_manual: false, comandos_manteniment: [],
  mensaje: 'Synthetic photograph received', ...changes,
} }; }
function fixture(options = {}) {
  const h = createExecutorHarness({ rows: [HEADERS,paradaRow()], cells: { '2,1': { note: `METROGESTION_PARADA:${IDS.stop}` } }, ...options });
  h.logs = []; h.context.Logger = { log: value => h.logs.push(String(value)) };
  h.setHttp(body => {
    if (body.action === 'preflight') return preflight(h);
    assert.equal(body.action, undefined, 'This entry point cannot authorize, ACK or reconcile a scope');
    return received();
  });
  return h;
}
function unchanged(h, before) {
  assert.deepEqual(h.snapshot(),before);
  assert.deepEqual(h.effects,[], 'No cells, formulas, notes, filters, Drive items or triggers may change');
  assert.equal(h.httpCalls.some(x => ['authorize','ack_execution','ack','scope_status'].includes(x.method)),false);
}
function storedResponses(h) {
  return Object.keys(h.properties).filter(key => /^METROGESTION_ENTREGA_V1:[0-9a-f-]{36}$/.test(key))
    .map(key => h.call('metrogestionLeerEntregaCompleta_',key));
}

test('R01 explicit reception uses the complete existing five-feed snapshot without scope, execution, local cycle or sheet mutation', () => {
  const h = fixture(), before = h.snapshot(), properties = copy(h.properties);
  const result = h.call('metrogestionEnviarHojaAMetrogestion');
  assert.equal(result.fotografia_recibida_por_servidor,true);
  assert.equal(result.escrituras_en_hoja,0);
  assert.equal(result.ordenes_aplicadas,0);
  assert.equal(result.sincronizacion_total,'pendiente');
  assert.deepEqual(h.httpCalls.map(x => x.method),['preflight','sync','preflight']);
  const payload = h.httpCalls[1].body.payload;
  for (const key of ['filas','paradas','cierres_facturacion','trabajos','pendientes']) assert.ok(Array.isArray(payload[key]),key);
  assert.equal(payload.paradas[0].id_fila,900001);
  assert.equal(payload.cierres_facturacion[0].id_fila,900001);
  assert.equal(payload.version_script,h.config.scriptVersion);
  assert.equal(payload.version_ejecucion,h.config.executorVersion);
  assert.equal(Object.hasOwn(payload,'alcance'),false);
  assert.equal(h.load(),null);
  assert.equal(h.properties.METROGESTION_ALCANCE_ORDENES_V1,undefined);
  assert.equal(h.properties[REQUEST],undefined);
  for (const [key,value] of Object.entries(properties)) assert.equal(h.properties[key],value);
  assert.equal(storedResponses(h).length,1);
  assert.equal(h.logs.length,1);
  assert.equal(h.logs.some(x => /mg_[0-9a-f]{64}/i.test(x)),false);
  unchanged(h,before);
});

for (const [label,flags] of [
  ['output enabled',{ ...protectedFlags,solo_lectura_manual_protegida:false,escritura_segura_manual:true }],
  ['protected flag missing',{ ...protectedFlags,solo_lectura_manual_protegida:null }],
  ['identity import paused',{ ...protectedFlags,pausa_importacion_identidad:true }],
  ['safe-write ambiguous',{ ...protectedFlags,escritura_segura_manual:null }],
]) test(`R02 ${label} rejects before a snapshot and preserves local state`, () => {
  const h = fixture(), before = h.snapshot(), properties = copy(h.properties);
  h.setHttp(body => { assert.equal(body.action,'preflight'); return preflight(h,flags); });
  assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/envío requiere/);
  assert.deepEqual(h.httpCalls.map(x => x.method),['preflight']);
  assert.deepEqual(h.properties,properties); unchanged(h,before);
});

test('R03 incompatible installation is rejected before opening a reception', () => {
  const h = fixture(), before = h.snapshot();
  h.setHttp(body => { assert.equal(body.action,'preflight'); return preflight(h,protectedFlags,{ archivo_coincide:false }); });
  assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/envío requiere/);
  assert.deepEqual(h.httpCalls.map(x => x.method),['preflight']); unchanged(h,before);
});

for (const [label,extra] of [
  ['unfinished cycle',{ fase:'comandos',comandos:[] }],
  ['pending ACK',{ fase:'terminado',comandos:[],confirmacionPendiente:{ synthetic:true } }],
  ['commands under a finished header',{ fase:'terminado',comandos:[command()] }],
]) test(`R04 ${label} stops before any network request`, () => {
  const h = fixture(); h.save(h.newState([],{ ...extra })); h.clearEvents();
  const before = h.snapshot(), properties = copy(h.properties);
  assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/ciclo o un acuse pendiente/);
  assert.deepEqual(h.httpCalls,[]); assert.deepEqual(h.properties,properties); unchanged(h,before);
});

test('R05 unresolved journal and uncertain delivery are never cleared or repaired by the reception helper', () => {
  for (const marker of ['journal','delivery']) {
    const h = fixture();
    if (marker === 'journal') {
      const plan = h.call('metrogestionPlanificarOrdenCompleta_',h.sheet,command());
      h.call('metrogestionGuardarJournalOrden_',h.call('metrogestionIntentoOrden_',plan));
    } else h.context.PropertiesService.getScriptProperties().setProperty(REQUEST,'{"request_id":"pending"}');
    h.clearEvents(); const before=h.snapshot(), properties=copy(h.properties);
    assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/incierto|pendiente/);
    assert.deepEqual(h.httpCalls,[]); assert.deepEqual(h.properties,properties); unchanged(h,before);
  }
});

test('R06 a verified finished cycle and its existing selection remain byte-for-byte unchanged', () => {
  const h = fixture(); h.save(h.newState([],{ fase:'terminado' }));
  h.context.PropertiesService.getScriptProperties().setProperty('METROGESTION_ALCANCE_ORDENES_V1','existing-selection-not-read-by-this-entry');
  h.clearEvents(); const before=h.snapshot(), properties=copy(h.properties);
  h.call('metrogestionEnviarHojaAMetrogestion');
  for (const [key,value] of Object.entries(properties)) assert.equal(h.properties[key],value,key);
  unchanged(h,before);
});

test('R07 unexpected commands or an unprotected response are conserved intact and never applied', () => {
  for (const response of [received({ comandos_manteniment:[command()] }),received({ solo_lectura_manual_protegida:false })]) {
    const h=fixture(), before=h.snapshot();
    h.setHttp(body => body.action === 'preflight' ? preflight(h) : response);
    assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/respuesta no acredita/);
    assert.deepEqual(copy(storedResponses(h)),[response]);
    assert.deepEqual(h.httpCalls.map(x => x.method),['preflight','sync']);
    assert.equal(h.properties[REQUEST],undefined); unchanged(h,before);
  }
});

test('R08 changed barriers after a successful reception report the completed receipt without retrying or writing the sheet', () => {
  const h=fixture(), before=h.snapshot(); let reads=0;
  h.setHttp(body => {
    if (body.action === 'preflight') return preflight(h,++reads===1 ? protectedFlags : { ...protectedFlags,escritura_segura_manual:true });
    return received();
  });
  assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/fotografía fue recibida/);
  assert.equal(storedResponses(h).length,1);
  assert.deepEqual(h.httpCalls.map(x => x.method),['preflight','sync','preflight']); unchanged(h,before);
});

test('R09 a transport failure retains its uncertain request and blocks a second send', () => {
  const h=fixture(), before=h.snapshot();
  h.setHttp(body => { if(body.action==='preflight') return preflight(h); throw new Error('Synthetic transport failure'); });
  assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/Synthetic transport failure/);
  assert.ok(h.properties[REQUEST]);
  const request=h.properties[REQUEST]; h.clearEvents();
  assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/solicitud de entrega pendiente/);
  assert.equal(h.properties[REQUEST],request); assert.deepEqual(h.httpCalls,[]); unchanged(h,before);
});

test('R10 response-storage failure retains the uncertainty marker; no delivery is silently retried', () => {
  const h=fixture(), before=h.snapshot();
  h.fault(event => event.kind==='property' && event.key?.startsWith('METROGESTION_ENTREGA_V1:'),{ timing:'before' });
  assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/Synthetic platform failure/);
  assert.ok(h.properties[REQUEST]);
  h.clearFaults(); h.clearEvents();
  assert.throws(() => h.call('metrogestionEnviarHojaAMetrogestion'),/solicitud de entrega pendiente/);
  assert.deepEqual(h.httpCalls,[]); unchanged(h,before);
});

test('R11 the execution path still requires a real selected scope before requesting the shared snapshot', () => {
  const h=fixture(), before=h.snapshot(), properties=copy(h.properties);
  assert.throws(() => h.call('metrogestionSolicitarCiclo_',h.sheet,'manual','synthetic-token'),/Selecciona manualmente/);
  assert.deepEqual(h.httpCalls,[]); assert.deepEqual(h.properties,properties); unchanged(h,before);
});
