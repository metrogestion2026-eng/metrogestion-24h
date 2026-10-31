import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(
  new URL('../r1-alpha75/google-apps-script/sincronizar_manteniment.gs', import.meta.url),
  'utf8'
);
const token = `mg_${'a'.repeat(64)}`;
const version = 'alpha75-2026.10.26.1';
const preflightVersion = 'alpha75-preflight-2026.10.27.1';
const spreadsheetId = '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';

function reply() {
  return {
    ok: true,
    preflight: {
      protocolo: 'manteniment-preflight-v1',
      version_preflight: preflightVersion,
      solo_lectura: true,
      compatible: true,
      version_script_recibida: version,
      version_script_esperada: version,
      version_preflight_recibida: preflightVersion,
      cliente_escritura_segura_manual: true,
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
    },
    recibido_en: '2026-10-27T10:00:00.000Z',
  };
}

function harness({
  response = reply(), status = 200, rawBody, fetchError, storedToken = token,
  savedStep = { paso: 'Paso antiguo', version: 'alpha75-2026.10.14.1' },
} = {}) {
  const reads = [];
  const requests = [];
  const logs = [];
  const forbidden = name => new Proxy({}, {
    get(_, property) { throw new Error(`Acceso no permitido: ${name}.${String(property)}`); },
  });
  const props = new Proxy({
    getProperty(key) {
      reads.push(key);
      if (key === 'METROGESTION_SYNC_TOKEN') return storedToken;
      if (key === 'METROGESTION_PASO') return savedStep ? JSON.stringify(savedStep) : null;
      throw new Error(`Propiedad no permitida: ${key}`);
    },
  }, {
    get(target, property) {
      if (property === 'getProperty') return target.getProperty;
      throw new Error(`Mutación o lectura masiva de propiedades no permitida: ${String(property)}`);
    },
  });
  const context = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => props },
    SpreadsheetApp: forbidden('SpreadsheetApp'),
    ScriptApp: forbidden('ScriptApp'),
    DriveApp: forbidden('DriveApp'),
    LockService: forbidden('LockService'),
    Utilities: forbidden('Utilities'),
    Logger: { log: value => logs.push(value) },
    UrlFetchApp: {
      fetch(url, options) {
        requests.push({ url, options });
        const body = JSON.parse(options.payload);
        assert.equal(body.action, 'preflight', 'El cliente nunca debe solicitar sync o ack');
        if (fetchError) throw new Error(fetchError);
        return {
          getResponseCode: () => status,
          getContentText: () => rawBody ?? JSON.stringify(response),
        };
      },
    },
  });
  vm.runInContext(script, context, { filename: 'sincronizar_manteniment.gs' });
  for (const name of [
    'metrogestionSolicitarCiclo_', 'metrogestionEjecutarSincronizacion_',
    'metrogestionAplicarComandos_', 'metrogestionRegistrarPaso_',
    'metrogestionSincronizarAhora', 'metrogestionLanzarProgramada_',
  ]) {
    context[name] = () => { throw new Error(`Motor de sincronización no permitido: ${name}`); };
  }
  return { context, reads, requests, logs };
}

test('preflight solo consulta la clave y envía la identidad actual, sin hoja, activadores ni progreso', () => {
  const h = harness();
  const result = h.context.metrogestionComprobarInstalacionSoloLectura();
  assert.equal(result.diagnostico_apto, true);
  assert.equal(result.sincronizacion_autorizada, false);
  assert.equal(result.preflight.sincronizacion_autorizada, false);
  assert.equal(result.version_script_actual, version);
  assert.equal(result.version_preflight_actual, preflightVersion);
  assert.deepEqual(h.reads, ['METROGESTION_SYNC_TOKEN']);
  assert.equal(h.requests.length, 1);
  const { url, options } = h.requests[0];
  assert.equal(url, 'https://aemoouldgguyjsxrfuwo.supabase.co/functions/v1/manteniment-sync-r1');
  assert.equal(options.method, 'post');
  assert.equal(options.contentType, 'application/json');
  assert.equal(options.muteHttpExceptions, true);
  assert.equal(options.followRedirects, false);
  assert.deepEqual(JSON.parse(options.payload), {
    action: 'preflight', token,
    payload: {
      version_script: version,
      version_preflight: preflightVersion,
      escritura_segura_manual: true,
      spreadsheet_id: spreadsheetId,
    },
  });
  assert.equal(h.logs.length, 1);
  assert.deepEqual(JSON.parse(h.logs[0]), JSON.parse(JSON.stringify(result)));
  assert.equal(h.logs[0].includes(token), false);
});

test('el diagnóstico refleja incompatibilidades y barreras abiertas sin autorizar sincronización', () => {
  const cases = [
    value => { value.compatible = false; value.version_script_esperada = 'otra-version'; value.motivos = ['VERSION_SCRIPT_DISTINTA']; },
    value => { value.compatible = false; value.version_preflight_recibida = 'otra-version'; value.motivos = ['VERSION_PREFLIGHT_DISTINTA']; },
    value => { value.compatible = false; value.cliente_escritura_segura_manual = false; value.motivos = ['CLIENTE_SIN_ESCRITURA_SEGURA']; },
    value => { value.compatible = false; value.archivo_coincide = false; value.motivos = ['ARCHIVO_DISTINTO']; },
    value => { value.compatible = false; value.receptor_coincide = false; value.motivos = ['RECEPTOR_NO_VERIFICADO']; },
    value => { value.barreras_cerradas = false; value.barreras.solo_lectura_manual_protegida = false; value.motivos = ['BARRERAS_NO_CERRADAS']; },
    value => { value.barreras_cerradas = false; value.barreras.escritura_segura_manual = true; value.motivos = ['BARRERAS_NO_CERRADAS']; },
    value => { value.barreras_cerradas = false; value.barreras.pausa_importacion_identidad = false; value.motivos = ['BARRERAS_NO_CERRADAS']; },
    value => { value.barreras_cerradas = false; value.barreras.escritura_segura_manual = null; value.motivos = ['BARRERAS_NO_CERRADAS']; },
  ];
  for (const change of cases) {
    const response = reply();
    change(response.preflight);
    const h = harness({ response });
    const result = h.context.metrogestionComprobarInstalacionSoloLectura();
    assert.equal(result.diagnostico_apto, false);
    assert.equal(result.sincronizacion_autorizada, false);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.reads, ['METROGESTION_SYNC_TOKEN']);
  }
});

test('resultados agregados incoherentes se rechazan incluso si afirman compatibilidad', () => {
  const cases = [
    value => { value.version_script_esperada = 'otra-version'; },
    value => { value.version_preflight_recibida = 'otra-version'; },
    value => { value.cliente_escritura_segura_manual = false; },
    value => { value.archivo_coincide = false; },
    value => { value.receptor_coincide = false; },
    value => { value.barreras.escritura_segura_manual = true; },
    value => { value.barreras.pausa_importacion_identidad = null; },
    value => { value.compatible = false; },
    value => { value.barreras_cerradas = false; },
  ];
  for (const change of cases) {
    const response = reply();
    change(response.preflight);
    const h = harness({ response });
    assert.throws(() => h.context.metrogestionComprobarInstalacionSoloLectura(), /resultados incoherentes/);
    assert.deepEqual(h.logs, []);
    assert.equal(h.requests.length, 1);
  }
});

test('una respuesta coherente de otra versión nunca acredita el código local actual', () => {
  const response = reply();
  response.preflight.version_script_recibida = 'version-anterior';
  response.preflight.version_script_esperada = 'version-anterior';
  const h = harness({ response });
  const result = h.context.metrogestionComprobarInstalacionSoloLectura();
  assert.equal(result.preflight.compatible, true);
  assert.equal(result.version_script_actual, version);
  assert.equal(result.diagnostico_apto, false);
  assert.equal(result.sincronizacion_autorizada, false);
});

test('motivos deben coincidir con las condiciones, sin confundir compatibilidad con barreras cerradas', () => {
  const contradictory = reply();
  contradictory.preflight.motivos = ['ARCHIVO_DISTINTO'];
  const invalid = harness({ response: contradictory });
  assert.throws(() => invalid.context.metrogestionComprobarInstalacionSoloLectura(), /resultados incoherentes/);
  assert.deepEqual(invalid.logs, []);

  const open = reply();
  open.preflight.barreras.pausa_importacion_identidad = false;
  open.preflight.barreras_cerradas = false;
  open.preflight.motivos = ['BARRERAS_NO_CERRADAS'];
  const valid = harness({ response: open });
  const result = valid.context.metrogestionComprobarInstalacionSoloLectura();
  assert.equal(result.preflight.compatible, true);
  assert.equal(result.preflight.barreras_cerradas, false);
  assert.equal(result.diagnostico_apto, false);
  assert.equal(result.sincronizacion_autorizada, false);

  open.preflight.archivo_coincide = false;
  open.preflight.compatible = false;
  open.preflight.motivos = ['BARRERAS_NO_CERRADAS', 'ARCHIVO_DISTINTO'];
  const reordered = harness({ response: open });
  assert.equal(reordered.context.metrogestionComprobarInstalacionSoloLectura().diagnostico_apto, false);
});

test('rechaza respuestas de sincronización, permisos de escritura y booleanos textuales', () => {
  const responses = [
    { ok: true, resultado: { comandos: [] } },
    (() => { const r = reply(); r.preflight.solo_lectura = false; return r; })(),
    (() => { const r = reply(); r.preflight.sincronizacion_autorizada = true; return r; })(),
    (() => { const r = reply(); r.preflight.compatible = 'true'; return r; })(),
    (() => { const r = reply(); r.preflight.barreras.escritura_segura_manual = 'false'; return r; })(),
    (() => { const r = reply(); r.preflight.protocolo = 'otro-protocolo'; return r; })(),
  ];
  for (const response of responses) {
    const h = harness({ response });
    assert.throws(() => h.context.metrogestionComprobarInstalacionSoloLectura(), /no acredita el protocolo/);
    assert.deepEqual(h.logs, []);
    assert.equal(h.requests.length, 1);
  }
});

test('una clave ausente o inválida no produce ninguna petición', () => {
  for (const storedToken of ['', null, 'clave-invalida']) {
    const h = harness({ storedToken });
    assert.throws(() => h.context.metrogestionComprobarInstalacionSoloLectura(), /clave de conexión válida/);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.logs, []);
  }
});

test('errores de red, HTTP y parseo nunca reflejan la clave ni el cuerpo remoto', () => {
  const cases = [
    { fetchError: `Fallo con contenido ${token}` },
    { status: 401, response: { error: `Credencial ${token}` } },
    { rawBody: `no-json ${token}` },
    { rawBody: 'x'.repeat(32001) },
  ];
  for (const options of cases) {
    const h = harness(options);
    assert.throws(() => h.context.metrogestionComprobarInstalacionSoloLectura(), error => {
      assert.equal(error.message.includes(token), false);
      assert.match(error.message, /solo lectura/);
      return true;
    });
    assert.deepEqual(h.logs, []);
    assert.equal(h.requests.length, 1);
  }
});

test('rechaza órdenes, confirmaciones, filas o cualquier campo adicional en todos los niveles', () => {
  for (const target of ['result', 'preflight', 'barreras']) {
    for (const [key, value] of Object.entries({
      comandos: [], confirmaciones: [], filas: [], action: 'sync', token, token_hash: 'dato-privado',
    })) {
      const response = reply();
      const object = target === 'result' ? response
        : target === 'preflight' ? response.preflight : response.preflight.barreras;
      object[key] = value;
      const h = harness({ response });
      assert.throws(() => h.context.metrogestionComprobarInstalacionSoloLectura(), error => {
        assert.match(error.message, /no acredita el protocolo/);
        assert.equal(error.message.includes(token), false);
        assert.equal(error.message.includes('dato-privado'), false);
        return true;
      });
      assert.deepEqual(h.logs, []);
      assert.equal(h.requests.length, 1);
    }
  }
});

test('versiones, motivos y fecha se validan antes de mostrar cualquier resultado', () => {
  const cases = [
    response => { response.preflight.version_script_recibida = ''; },
    response => { response.preflight.version_preflight = 'a'.repeat(97); },
    response => { response.preflight.version_preflight_recibida = `x-${token}`; },
    response => { response.preflight.version_script_esperada = 'version\ninvalida'; },
    response => { response.preflight.motivos = [`No mostrar ${token}`]; },
    response => { response.preflight.motivos = ['CODIGO_DESCONOCIDO']; },
    response => { response.preflight.motivos = ['ARCHIVO_DISTINTO', 'ARCHIVO_DISTINTO']; },
    response => { response.preflight.motivos = Array(7).fill('ARCHIVO_DISTINTO'); },
    response => { response.recibido_en = 'no es una fecha'; },
    response => { response.recibido_en = '2026-02-30T10:00:00.000Z'; },
    response => { response.recibido_en = '2026-10-27T25:00:00.000Z'; },
    response => { response.recibido_en = `${token}`; },
  ];
  for (const change of cases) {
    const response = reply();
    change(response);
    const h = harness({ response });
    assert.throws(() => h.context.metrogestionComprobarInstalacionSoloLectura(), error => {
      assert.match(error.message, /no acredita el protocolo/);
      assert.equal(error.message.includes(token), false);
      return true;
    });
    assert.deepEqual(h.logs, []);
    assert.equal(h.requests.length, 1);
  }
});

test('diagnóstico histórico conserva su API y distingue la versión guardada de la actual', () => {
  const h = harness();
  const result = h.context.metrogestionDiagnosticoSincronizacion();
  assert.equal(result.paso, 'Paso antiguo');
  assert.equal(result.version, 'alpha75-2026.10.14.1');
  assert.equal(result.version_ultimo_paso, 'alpha75-2026.10.14.1');
  assert.equal(result.version_actual, version);
  assert.deepEqual(h.reads, ['METROGESTION_PASO']);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.logs, []);

  const empty = harness({ savedStep: null });
  const noPrevious = empty.context.metrogestionDiagnosticoSincronizacion();
  assert.equal(noPrevious.version, version);
  assert.equal(noPrevious.version_actual, version);
  assert.equal(noPrevious.version_ultimo_paso, null);
});
