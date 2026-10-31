import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../supabase/functions/manteniment-sync-r1/index.ts', import.meta.url), 'utf8');
const httpSource = await readFile(new URL('../supabase/functions/_shared/http-security.ts', import.meta.url), 'utf8');
const http = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(httpSource)).toString('base64'));
const executable = stripTypeScriptTypes(source.replace(/^import[^\n]*\n/gm, ''));
const capability = 'MG75-EJECUCION-ORDEN-001';
const token = 'mg_' + 'a'.repeat(64);
const secret = 'SYNTHETIC_EDGE_SERVICE_SECRET';
const ref = () => ({ tipo: 'parada', sync_id: '11111111-1111-4111-8111-111111111111',
  revision: 7, payload_sha256: 'c'.repeat(64) });
const client = () => ({ version_script: 'alpha75-2026.10.26.1', version_ejecucion: capability,
  escritura_segura_manual: true, spreadsheet_id: 'SYNTHETIC_SHEET_EXECUTION_7525',
  request_id: '22222222-2222-4222-8222-222222222222', alcance: [ref()],
  orden: { ...ref(), payload: { dfm: 'SYNTHETIC', km_facturables: 300, trabajos_asignados: [] } } });
const ackClient = () => ({ version_ejecucion: capability, spreadsheet_id: client().spreadsheet_id,
  request_id: client().request_id, confirmacion: { ...ref(), estado: 'aplicado', fila: 42, trabajos_creados: [] } });

function authorization(input = client(), overrides = {}) {
  const now = Date.now();
  return { protocolo: 'manteniment-ejecucion-v1', version_ejecucion: input.version_ejecucion,
    version_script: input.version_script, solo_lectura: true, request_id: input.request_id,
    spreadsheet_id: input.spreadsheet_id, alcance: input.alcance, orden: ref(), autorizada: true,
    motivo: 'AUTORIZADA', autorizado_en: new Date(now).toISOString(), expira_en: new Date(now + 30000).toISOString(), ...overrides };
}

function confirmation(input = ackClient(), overrides = {}) {
  return { protocolo: 'manteniment-acuse-ejecucion-v1', version_ejecucion: capability,
    request_id: input.request_id, spreadsheet_id: input.spreadsheet_id, confirmada: true, orden: ref(), ...overrides };
}

function harness({ data, error, throws = false } = {}) {
  let handler; const calls = []; let clients = 0;
  const Deno = { serve(fn) { handler = fn; }, env: { get(key) { return key === 'SUPABASE_URL' ? 'https://synthetic.invalid' : secret; } } };
  const createClient = () => {
    clients++;
    return { async rpc(name, parameters) {
      calls.push({ name, parameters: structuredClone(parameters) });
      if (throws) throw new Error('transport failure ' + token + secret);
      return { data: typeof data === 'function' ? data(parameters) : data, error };
    } };
  };
  new Function('Deno', 'createClient', 'BodyError', 'readJsonObject', 'Request', 'Response', executable)(
    Deno, createClient, http.BodyError, http.readJsonObject, Request, Response);
  return { calls, clients: () => clients, async request(body) {
    const response = await handler(new Request('https://synthetic.invalid', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    const text = await response.text();
    assert.equal(text.includes(token), false); assert.equal(text.includes(secret), false);
    return { status: response.status, headers: response.headers, value: JSON.parse(text) };
  } };
}

test('authorize uses only its SELECT RPC and returns the exact bound authorization without a receiver/ACK call', async () => {
  const input = client();
  const data = authorization(input);
  const h = harness({ data });
  const result = await h.request({ action: 'authorize', token, payload: input });
  assert.equal(result.status, 200);
  assert.deepEqual(result.value, { ok: true, autorizacion: data });
  assert.deepEqual(h.calls, [{ name: 'autorizar_ejecucion_manteniment', parameters: { p_token: token, p_solicitud: input } }]);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('a coherent closed-barrier denial has no execution lifetime and is not treated as permission', async () => {
  const data = authorization();
  Object.assign(data, { autorizada: false, motivo: 'BARRERAS_CERRADAS', expira_en: data.autorizado_en });
  const h = harness({ data });
  const result = await h.request({ action: 'authorize', token, payload: client() });
  assert.equal(result.status, 200);
  assert.equal(result.value.autorizacion.autorizada, false);
  assert.deepEqual(h.calls.map(call => call.name), ['autorizar_ejecucion_manteniment']);
});

for (const [name, mutate] of [
  ['empty scope', input => { input.alcance = []; }],
  ['duplicate scope', input => { input.alcance.push(ref()); }],
  ['scope over bound', input => { input.alcance = Array.from({ length: 201 }, ref); }],
  ['scope revision omitted', input => { delete input.alcance[0].revision; }],
  ['scope wildcard', input => { input.alcance[0].sync_id = '*'; }],
  ['text revision', input => { input.orden.revision = '7'; }],
  ['fractional revision', input => { input.orden.revision = 1.5; }],
  ['revision overflow', input => { input.orden.revision = 2147483648; }],
  ['unbounded type', input => { input.orden.tipo = 'alta'; }],
  ['missing hash', input => { delete input.orden.payload_sha256; }],
  ['malformed hash', input => { input.orden.payload_sha256 = token; }],
  ['missing payload', input => { delete input.orden.payload; }],
  ['array payload', input => { input.orden.payload = []; }],
  ['missing capability', input => { delete input.version_ejecucion; }],
  ['missing nonce', input => { delete input.request_id; }],
  ['wrong spreadsheet shape', input => { input.spreadsheet_id = 'https://synthetic.invalid'; }],
  ['extra snapshot', input => { input.filas = []; }],
  ['permission as text', input => { input.escritura_segura_manual = 'true'; }],
]) {
  test(`authorize rejects malformed request before RPC: ${name}`, async () => {
    const input = client(); mutate(input);
    const h = harness({ data: authorization() });
    const result = await h.request({ action: 'authorize', token, payload: input });
    assert.equal(result.status, 400); assert.equal(result.value.ok, false);
    assert.equal(h.clients(), 0); assert.deepEqual(h.calls, []);
  });
}

for (const [name, mutate] of [
  ['other nonce', value => { value.request_id = '33333333-3333-4333-8333-333333333333'; }],
  ['other spreadsheet', value => { value.spreadsheet_id = 'OTHER_SYNTHETIC_SHEET_7525'; }],
  ['other scope', value => { value.alcance = [{ ...ref(), revision: 8 }]; }],
  ['expanded scope', value => { value.alcance = [ref(), { ...ref(), revision: 8 }]; }],
  ['other order', value => { value.orden = { ...ref(), revision: 8 }; }],
  ['other hash', value => { value.orden = { ...ref(), payload_sha256: 'f'.repeat(64) }; }],
  ['permission as string', value => { value.autorizada = 'true'; }],
  ['mutating authorization', value => { value.solo_lectura = false; }],
  ['unknown reason', value => { value.motivo = 'ALLOW_ANYTHING'; }],
  ['incoherent reason', value => { value.motivo = 'BARRERAS_CERRADAS'; }],
  ['wrong capability', value => { value.version_ejecucion = 'old'; }],
  ['unbounded lifetime', value => { value.expira_en = new Date(Date.parse(value.autorizado_en) + 60000).toISOString(); }],
  ['old authorization', value => { value.autorizado_en = new Date(Date.now() - 60000).toISOString(); value.expira_en = new Date(Date.now() - 30000).toISOString(); }],
  ['future authorization', value => { value.autorizado_en = new Date(Date.now() + 60000).toISOString(); value.expira_en = new Date(Date.now() + 90000).toISOString(); }],
  ['wrong date representation', value => { value.autorizado_en = value.autorizado_en.replace('Z', '+00:00'); }],
  ['payload leak', value => { value.payload = { private: true }; }],
  ['permission-like extra field', value => { value.sincronizacion_autorizada = true; }],
]) {
  test(`authorize rejects unbound/incoherent RPC response: ${name}`, async () => {
    const data = authorization(); mutate(data);
    const h = harness({ data });
    const result = await h.request({ action: 'authorize', token, payload: client() });
    assert.equal(result.status, 502); assert.equal(result.value.ok, false);
    assert.equal(result.value.autorizacion, undefined);
    assert.deepEqual(h.calls.map(call => call.name), ['autorizar_ejecucion_manteniment']);
  });
}

test('positive RPC output cannot bypass a caller scope that excludes this order', async () => {
  const input = client(); input.alcance = [{ ...ref(), revision: 99 }];
  const h = harness({ data: authorization(input) });
  assert.equal((await h.request({ action: 'authorize', token, payload: input })).status, 502);
});

test('JSON object key order in a SQL receipt does not change identity or scope', async () => {
  const data = authorization();
  const reversed = { payload_sha256: ref().payload_sha256, revision: 7, sync_id: ref().sync_id, tipo: 'parada' };
  data.orden = reversed; data.alcance = [reversed];
  assert.equal((await harness({ data }).request({ action: 'authorize', token, payload: client() })).status, 200);
});

for (const action of ['authorize', 'ack_execution']) {
  test(`${action}: SQL errors and transport failures never leak credentials or fall through`, async () => {
    const payload = action === 'authorize' ? client() : ackClient();
    for (const scenario of [
      { error: { code: '28000', message: token + secret }, status: 401 },
      { error: { code: '55000', message: token + secret }, status: 400 },
      { throws: true, status: 502 },
    ]) {
      const h = harness(scenario);
      const result = await h.request({ action, token, payload });
      assert.equal(result.status, scenario.status); assert.equal(result.value.ok, false);
      assert.equal(h.calls.length, 1);
    }
  });
}

test('strict ACK uses only its confirmation RPC and verifies nonce/sheet/exact delivered reference', async () => {
  const input = ackClient(), data = confirmation(input);
  const h = harness({ data });
  const result = await h.request({ action: 'ack_execution', token, payload: input });
  assert.equal(result.status, 200); assert.deepEqual(result.value, { ok: true, confirmacion: data });
  assert.deepEqual(h.calls, [{ name: 'confirmar_ejecucion_manteniment', parameters: { p_token: token, p_solicitud: input } }]);
});

for (const [name, data] of [
  ['legacy count only', { ok: true, confirmados: 1 }],
  ['not confirmed', confirmation(ackClient(), { confirmada: false })],
  ['different revision', confirmation(ackClient(), { orden: { ...ref(), revision: 8 } })],
  ['different nonce', confirmation(ackClient(), { request_id: '33333333-3333-4333-8333-333333333333' })],
  ['different sheet', confirmation(ackClient(), { spreadsheet_id: 'OTHER_SYNTHETIC_SHEET_7525' })],
  ['extra payload', { ...confirmation(), payload: {} }],
]) {
  test(`strict ACK cannot advance on an invalid receipt: ${name}`, async () => {
    const result = await harness({ data }).request({ action: 'ack_execution', token, payload: ackClient() });
    assert.equal(result.status, 502); assert.equal(result.value.confirmacion, undefined);
  });
}

test('strict ACK rejects a local journal or an unbound hash in the canonical confirmation before RPC', async () => {
  for (const mutate of [
    value => { value.confirmacion.plan_sha256 = 'd'.repeat(64); },
    value => { delete value.confirmacion.payload_sha256; },
    value => { value.confirmacion.estado = 'aplicando'; },
    value => { value.version_ejecucion = 'old'; },
  ]) {
    const input = ackClient(); mutate(input);
    const h = harness({ data: confirmation() });
    assert.equal((await h.request({ action: 'ack_execution', token, payload: input })).status, 400);
    assert.deepEqual(h.calls, []);
  }
});

test('sync negotiates capability before the receiver and passes the complete snapshot without command-scope filtering', async () => {
  for (const version of [undefined, null, 'old']) {
    const h = harness({ data: { ok: true } });
    const result = await h.request({ action: 'sync', token, payload: { filas: [], version_ejecucion: version } });
    assert.equal(result.status, 400); assert.deepEqual(h.calls, []);
  }
  const payload = { version_ejecucion: capability, filas: [{ dfm: 'SYN-A' }, { dfm: 'SYN-B' }],
    paradas: [{ sync_id: ref().sync_id }], trabajos: [{ synthetic: 1 }, { synthetic: 2 }], cierres_facturacion: [{ synthetic: 3 }] };
  const h = harness({ data: { ok: true, comandos_manteniment: [] } });
  assert.equal((await h.request({ action: 'sync', token, payload })).status, 200);
  assert.deepEqual(h.calls, [{ name: 'recibir_snapshot_manteniment', parameters: { p_token: token, p_payload: payload } }]);
});

test('legacy ACK remains available for an already applied receipt without an executor-version condition', async () => {
  const input = [{ ...ref(), estado: 'aplicado', fila: 42 }];
  const h = harness({ data: { ok: true, confirmados: 1 } });
  const result = await h.request({ action: 'ack', token, confirmaciones: input });
  assert.equal(result.status, 200);
  assert.deepEqual(h.calls, [{ name: 'confirmar_comandos_manteniment', parameters: { p_token: token, p_confirmaciones: input } }]);
});
