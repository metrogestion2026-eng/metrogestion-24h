import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const edgeSource = await readFile(new URL('../supabase/functions/manteniment-sync-r1/index.ts', import.meta.url), 'utf8');
const sharedSource = await readFile(new URL('../supabase/functions/_shared/http-security.ts', import.meta.url), 'utf8');
const shared = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(sharedSource)).toString('base64'));
const executable = stripTypeScriptTypes(edgeSource.replace(/^import[^\n]*\n/gm, ''));
const token = 'mg_' + 'a'.repeat(64);
const serviceKey = 'synthetic-service-secret-for-isolated-tests';
const scriptVersion = 'alpha75-2026.10.26.1';
const preflightVersion = 'alpha75-preflight-2026.10.27.1';

function client(overrides = {}) {
  return {
    version_script: scriptVersion,
    version_preflight: preflightVersion,
    escritura_segura_manual: true,
    spreadsheet_id: 'synthetic_spreadsheet_identifier_12345',
    ...overrides,
  };
}

function diagnostic(input = client(), overrides = {}) {
  const result = {
    protocolo: 'manteniment-preflight-v1',
    version_preflight: preflightVersion,
    solo_lectura: true,
    compatible: true,
    version_script_recibida: input.version_script,
    version_script_esperada: scriptVersion,
    version_preflight_recibida: input.version_preflight,
    cliente_escritura_segura_manual: input.escritura_segura_manual,
    archivo_coincide: true,
    receptor_coincide: true,
    barreras: {
      solo_lectura_manual_protegida: true,
      escritura_segura_manual: false,
      pausa_importacion_identidad: true,
    },
    barreras_cerradas: true,
    sincronizacion_autorizada: false,
    motivos: [],
    ...overrides,
  };
  return result;
}

function harness({ data, error = null, rpcThrows = false, createThrows = false, missingEnv = false } = {}) {
  const calls = [];
  let clients = 0;
  let handler;
  const Deno = {
    serve(fn) { handler = fn; },
    env: { get(name) { return missingEnv ? undefined : name === 'SUPABASE_URL' ? 'https://synthetic.invalid' : serviceKey; } },
  };
  function createClient(url, key, options) {
    clients += 1;
    if (createThrows) throw new Error('constructor failed with ' + serviceKey);
    assert.equal(url, 'https://synthetic.invalid');
    assert.equal(key, serviceKey);
    assert.deepEqual(options, { auth: { persistSession: false, autoRefreshToken: false } });
    return new Proxy({
      async rpc(name, parameters) {
        calls.push({ name, parameters: structuredClone(parameters) });
        if (rpcThrows) throw new Error('network failed with ' + token + ' ' + serviceKey);
        return { data: typeof data === 'function' ? data(parameters) : data, error };
      },
    }, {
      get(target, key) {
        if (key !== 'rpc') throw new Error('Unexpected client method: ' + String(key));
        return target[key];
      },
    });
  }
  new Function('Deno', 'createClient', 'BodyError', 'readJsonObject', 'Request', 'Response', executable)(
    Deno, createClient, shared.BodyError, shared.readJsonObject, Request, Response,
  );
  assert.equal(typeof handler, 'function');
  return { handler, calls, clients: () => clients };
}

function request(body, { method = 'POST', headers = {} } = {}) {
  return new Request('https://synthetic.invalid/functions/v1/manteniment-sync-r1', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

async function run(h, body = { action: 'preflight', token, payload: client() }, options) {
  const response = await h.handler(request(body, options));
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

function noSecrets(result) {
  assert.equal(result.text.includes(token), false);
  assert.equal(result.text.includes(serviceKey), false);
}

test('preflight calls only its read-only RPC and cannot fall through to sync/ack', async () => {
  const h = harness({ data: diagnostic() });
  const result = await run(h);
  assert.equal(result.response.status, 200);
  assert.deepEqual(h.calls, [{ name: 'preflight_manteniment', parameters: { p_token: token, p_cliente: client() } }]);
  assert.equal(h.clients(), 1);
  assert.deepEqual(result.body.preflight, diagnostic());
  assert.equal(result.body.ok, true);
  assert.equal(result.body.preflight.sincronizacion_autorizada, false);
  assert.equal(result.body.resultado, undefined);
  assert.equal(result.body.confirmacion, undefined);
  assert.match(result.body.recibido_en, /^\d{4}-\d\d-\d\dT/);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  noSecrets(result);
});

test('compatibility failure is a successful diagnostic, never permission to synchronize', async () => {
  const input = client({ version_script: 'alpha75-2026.10.14.1' });
  const expected = diagnostic(input, { compatible: false, motivos: ['VERSION_SCRIPT_DISTINTA'] });
  const h = harness({ data: expected });
  const result = await run(h, { action: 'preflight', token, payload: input });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.preflight, expected);
  assert.equal(result.body.preflight.sincronizacion_autorizada, false);
  assert.deepEqual(h.calls.map(call => call.name), ['preflight_manteniment']);
});

test('server expected script version is authoritative rather than an Edge duplicate', async () => {
  const expected = diagnostic(client(), {
    compatible: false,
    version_script_esperada: 'alpha75-2026.10.28.1',
    motivos: ['VERSION_SCRIPT_DISTINTA'],
  });
  const result = await run(harness({ data: expected }));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.preflight.compatible, false);
});

for (const [name, input, changes] of [
  ['old preflight revision', client({ version_preflight: 'alpha75-preflight-2026.10.26.1' }), { motivos: ['VERSION_PREFLIGHT_DISTINTA'] }],
  ['client safe-write feature disabled', client({ escritura_segura_manual: false }), { motivos: ['CLIENTE_SIN_ESCRITURA_SEGURA'] }],
  ['wrong spreadsheet', client(), { archivo_coincide: false, motivos: ['ARCHIVO_DISTINTO'] }],
  ['changed receiver fingerprint', client(), { receptor_coincide: false, motivos: ['RECEPTOR_NO_VERIFICADO'] }],
]) {
  test(`reports incompatibility: ${name}`, async () => {
    const h = harness({ data: diagnostic(input, { compatible: false, ...changes }) });
    const result = await run(h, { action: 'preflight', token, payload: input });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.preflight.compatible, false);
    assert.equal(result.body.preflight.sincronizacion_autorizada, false);
    assert.deepEqual(h.calls.map(call => call.name), ['preflight_manteniment']);
  });
}

for (const [flag, value] of [
  ['solo_lectura_manual_protegida', false],
  ['escritura_segura_manual', true],
  ['pausa_importacion_identidad', false],
  ['pausa_importacion_identidad', null],
]) {
  test(`reports an open/unknown barrier without authorizing sync: ${flag}=${value}`, async () => {
    const expected = diagnostic();
    expected.barreras[flag] = value;
    expected.barreras_cerradas = false;
    expected.motivos = ['BARRERAS_NO_CERRADAS'];
    const result = await run(harness({ data: expected }));
    assert.equal(result.response.status, 200);
    assert.equal(result.body.preflight.compatible, true);
    assert.equal(result.body.preflight.barreras_cerradas, false);
    assert.equal(result.body.preflight.sincronizacion_autorizada, false);
  });
}

for (const [name, mutate] of [
  ['top-level confirmations', body => { body.confirmaciones = []; }],
  ['top-level command', body => { body.comandos_manteniment = []; }],
  ['snapshot rows', body => { body.payload.filas = []; }],
  ['work rows', body => { body.payload.trabajos = []; }],
  ['missing version', body => { delete body.payload.version_script; }],
  ['missing client revision', body => { delete body.payload.version_preflight; }],
  ['missing spreadsheet', body => { delete body.payload.spreadsheet_id; }],
  ['missing safe-write feature', body => { delete body.payload.escritura_segura_manual; }],
  ['string boolean', body => { body.payload.escritura_segura_manual = 'true'; }],
  ['null boolean', body => { body.payload.escritura_segura_manual = null; }],
  ['number boolean', body => { body.payload.escritura_segura_manual = 1; }],
  ['numeric version', body => { body.payload.version_script = 75; }],
  ['oversized version', body => { body.payload.version_script = 'a'.repeat(97); }],
  ['version containing whitespace', body => { body.payload.version_script = 'alpha75 unsafe'; }],
  ['version containing credential', body => { body.payload.version_script = token; }],
  ['invalid spreadsheet', body => { body.payload.spreadsheet_id = 'https://unexpected.invalid'; }],
  ['oversized spreadsheet', body => { body.payload.spreadsheet_id = 'a'.repeat(151); }],
  ['array payload', body => { body.payload = []; }],
  ['null payload', body => { body.payload = null; }],
  ['array action', body => { body.action = ['preflight']; }],
]) {
  test(`rejects malformed preflight before RPC: ${name}`, async () => {
    const body = { action: 'preflight', token, payload: client() };
    mutate(body);
    const h = harness({ data: diagnostic() });
    const result = await run(h, body);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.ok, false);
    assert.equal(h.clients(), 0);
    assert.deepEqual(h.calls, []);
    noSecrets(result);
  });
}

test('invalid connection token is rejected before creating an API client', async () => {
  const h = harness({ data: diagnostic() });
  const result = await run(h, { action: 'preflight', token: 'invalid', payload: client() });
  assert.equal(result.response.status, 401);
  assert.equal(h.clients(), 0);
  assert.deepEqual(h.calls, []);
});

test('SQL authentication error returns generic 401 and does not reflect database message/details', async () => {
  const h = harness({ error: { code: '28000', message: token, details: serviceKey } });
  const result = await run(h);
  assert.equal(result.response.status, 401);
  assert.equal(result.body.ok, false);
  noSecrets(result);
  assert.deepEqual(h.calls.map(call => call.name), ['preflight_manteniment']);
});

test('other SQL errors return generic 400 without secret-bearing messages', async () => {
  const result = await run(harness({ error: { code: '22023', message: token + serviceKey } }));
  assert.equal(result.response.status, 400);
  assert.equal(result.body.ok, false);
  noSecrets(result);
});

for (const option of ['rpcThrows', 'createThrows']) {
  test(`sanitizes thrown transport/constructor failure: ${option}`, async () => {
    const result = await run(harness({ [option]: true }));
    assert.equal(result.response.status, 502);
    assert.equal(result.body.ok, false);
    noSecrets(result);
  });
}

for (const [name, mutate] of [
  ['missing field', value => { delete value.solo_lectura; }],
  ['extra token', value => { value.token = token; }],
  ['extra command list', value => { value.comandos_manteniment = []; }],
  ['authorization true', value => { value.sincronizacion_autorizada = true; }],
  ['read-only false', value => { value.solo_lectura = false; }],
  ['wrong protocol', value => { value.protocolo = 'other'; }],
  ['wrong server preflight revision', value => { value.version_preflight = 'other'; }],
  ['mismatched echoed script', value => { value.version_script_recibida = 'old'; }],
  ['mismatched echoed client revision', value => { value.version_preflight_recibida = 'old'; }],
  ['mismatched echoed client boolean', value => { value.cliente_escritura_segura_manual = false; }],
  ['unjustified compatibility', value => { value.receptor_coincide = false; }],
  ['compatibility string', value => { value.compatible = 'true'; }],
  ['unjustified closed barriers', value => { value.barreras.pausa_importacion_identidad = false; }],
  ['barrier string', value => { value.barreras.escritura_segura_manual = 'false'; }],
  ['missing barrier', value => { delete value.barreras.pausa_importacion_identidad; }],
  ['extra barrier token', value => { value.barreras.token = token; }],
  ['expected version reflects token', value => { value.version_script_esperada = token; }],
  ['reason reflects service key', value => { value.motivos = [serviceKey]; }],
  ['unknown reason', value => { value.motivos = ['UNKNOWN']; }],
  ['duplicate reasons', value => { value.motivos = ['BARRERAS_NO_CERRADAS', 'BARRERAS_NO_CERRADAS']; }],
  ['rejection reason contradicts valid diagnosis', value => { value.motivos = ['VERSION_SCRIPT_DISTINTA']; }],
  ['missing reason for verified receiver mismatch', value => { value.receptor_coincide = false; value.compatible = false; }],
]) {
  test(`fails closed on invalid RPC result: ${name}`, async () => {
    const value = diagnostic();
    mutate(value);
    const h = harness({ data: value });
    const result = await run(h);
    assert.equal(result.response.status, 502);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.preflight, undefined);
    noSecrets(result);
    assert.deepEqual(h.calls.map(call => call.name), ['preflight_manteniment']);
  });
}

for (const value of [null, undefined, [], 'ok', true]) {
  test(`fails closed on absent/non-object RPC result: ${String(value)}`, async () => {
    const result = await run(harness({ data: value }));
    assert.equal(result.response.status, 502);
    assert.equal(result.body.ok, false);
  });
}

test('missing server configuration cannot result in an RPC or successful diagnosis', async () => {
  const h = harness({ data: diagnostic(), missingEnv: true });
  const result = await run(h);
  assert.equal(result.response.status, 500);
  assert.equal(h.clients(), 0);
  assert.deepEqual(h.calls, []);
});

test('shared transport validation still rejects method, media type and malformed JSON', async () => {
  for (const [body, options, status] of [
    ['', { method: 'GET' }, 405],
    ['{}', { headers: { 'content-type': 'text/plain' } }, 415],
    ['{bad', {}, 400],
    ['[]', {}, 400],
    ['null', {}, 400],
  ]) {
    const h = harness({ data: diagnostic() });
    const result = await run(h, body, options);
    assert.equal(result.response.status, status);
    assert.deepEqual(h.calls, []);
  }
});

test('actual and declared body limits still reject large input before RPC', async () => {
  for (const [body, headers] of [
    ['{}', { 'content-length': '4000001' }],
    [JSON.stringify({ action: 'preflight', token, payload: client(), filler: 'a'.repeat(4_000_000) }), { 'content-length': '1' }],
  ]) {
    const h = harness({ data: diagnostic() });
    const result = await run(h, body, { headers });
    assert.equal(result.response.status, 413);
    assert.deepEqual(h.calls, []);
  }
});

test('existing sync success preserves receiver, payload and response shape', async () => {
  const data = { ok: true, insertados: 0, comandos_manteniment: [] };
  const h = harness({ data });
  const payload = { filas: [], trabajos: [], modo: 'prueba' };
  const result = await run(h, { action: 'sync', token, payload });
  assert.equal(result.response.status, 200);
  assert.deepEqual(h.calls, [{ name: 'recibir_snapshot_manteniment', parameters: { p_token: token, p_payload: payload } }]);
  assert.deepEqual(result.body.resultado, data);
  assert.equal(result.body.preflight, undefined);
});

test('deployed v6 protection keeps structured sync failure at HTTP400', async () => {
  const data = { ok: false, error: 'Importación detenida por conflicto.' };
  const result = await run(harness({ data }), { action: 'sync', token, payload: { filas: [] } });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, data.error);
  assert.deepEqual(result.body.resultado, data);
});

for (const data of [null, {}, { ok: 'true' }]) {
  test(`deployed v6 protection rejects unconfirmed sync: ${JSON.stringify(data)}`, async () => {
    const result = await run(harness({ data }), { action: 'sync', token, payload: { filas: [] } });
    assert.equal(result.response.status, 502);
    assert.equal(result.body.ok, false);
  });
}

test('existing ack preserves confirmation RPC, payload and response', async () => {
  const confirmations = [{ id: 'synthetic-command', aplicada: true }];
  const data = { confirmadas: 1 };
  const h = harness({ data });
  const result = await run(h, { action: 'ack', token, confirmaciones: confirmations });
  assert.equal(result.response.status, 200);
  assert.deepEqual(h.calls, [{ name: 'confirmar_comandos_manteniment', parameters: { p_token: token, p_confirmaciones: confirmations } }]);
  assert.deepEqual(result.body.confirmacion, data);
  assert.equal(result.body.preflight, undefined);
});

test('existing sync/ack malformed inputs still stop before RPC', async () => {
  for (const body of [
    { action: 'sync', token, payload: {} },
    { action: 'sync', token, payload: { filas: new Array(2501).fill({}) } },
    { action: 'sync', token, payload: { filas: [], trabajos: new Array(10001).fill({}) } },
    { action: 'ack', token, confirmaciones: null },
    { action: 'ack', token, confirmaciones: new Array(501).fill({}) },
    { action: 'unexpected', token },
  ]) {
    const h = harness({ data: { ok: true } });
    const result = await run(h, body);
    assert.equal(result.response.status, 400);
    assert.deepEqual(h.calls, []);
  }
});
