import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutorHarness, defaultResponse, command, scopeOf, IDS, PROTOCOL } from './helpers/alpha75-sync-executor-harness.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
function prepare({ selected = [command()], delivered = [], states = ['NO_VIGENTE'], confirmed = false } = {}) {
  const h = createExecutorHarness({ http: (body, world) => body.action
    ? defaultResponse(body, world) : { ok: true, resultado: { mensaje: 'Fotografía sintética recibida.', comandos_manteniment: delivered } } });
  h.call('metrogestionGuardarAlcanceOrdenes_', selected.map(scopeOf));
  h.save(h.newState([], { fase: 'terminado', version: 'alpha75-2026.10.14.1',
    version_ejecucion: undefined, confirmacionPendiente: null }));
  if (confirmed) {
    const ref = scopeOf(selected[0]);
    h.call('metrogestionGuardarJournalOrden_', { referencia: ref, version_ejecucion: PROTOCOL,
      spreadsheet_id: h.config.spreadsheetId, estado: 'confirmado', plan_sha256: 'a'.repeat(64),
      fotografia_inicial_sha256: 'b'.repeat(64), fotografia_final_sha256: 'c'.repeat(64),
      verificado_en: '2026-01-01T00:00:00.000Z', confirmacion: { ...ref, estado: 'aplicado' } });
  }
  // Keep the real executor/getters and the harness's HTTP trace; vary only the
  // synthetic server's status for the exact references it was asked about.
  const fetch = h.context.UrlFetchApp.fetch;
  h.context.UrlFetchApp.fetch = (url, init) => {
    const response = fetch(url, init), body = JSON.parse(init.payload);
    if (body.action !== 'scope_status') return response;
    const result = JSON.parse(response.getContentText());
    result.conciliacion.referencias.forEach((ref, index) => { ref.estado = states[index]; });
    return { ...response, getContentText: () => JSON.stringify(result) };
  };
  h.clearEvents();
  return h;
}

test('un ciclo legado terminado recibe una fotografía y retira solo el alcance acreditado obsoleto', () => {
  const h = prepare(), before = h.snapshot();
  const result = h.call('metrogestionContinuarSincronizacion');
  assert.equal(result.pendiente, false);
  assert.equal(h.load().fase, 'terminado');
  assert.equal(h.load().version, h.config.scriptVersion);
  assert.deepEqual(copy(h.load().alcance), []);
  assert.equal(h.call('metrogestionLeerAlcanceOrdenes_'), null);
  assert.deepEqual(h.httpCalls.map(call => call.method), ['sync', 'scope_status']);
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.effects, []);
  assert.equal(h.properties.METROGESTION_SOLICITUD_ENTREGA_V1, undefined);
  h.clearEvents();
  assert.throws(() => h.call('metrogestionContinuarSincronizacion'), /Selecciona manualmente/);
  assert.equal(h.httpCalls.length, 0, 'un alcance ya retirado no provoca otra importación');
});

test('una referencia con diario confirmado no importa ni concilia de nuevo', () => {
  const order = command(), h = prepare({ selected: [order], confirmed: true });
  const result = h.call('metrogestionContinuarSincronizacion');
  assert.equal(result.pendiente, false);
  assert.deepEqual(copy(h.call('metrogestionLeerAlcanceOrdenes_')), [scopeOf(order)]);
  assert.equal(h.load().comandos.length, 0);
  assert.equal(h.httpCalls.length, 0);
  assert.deepEqual(h.effects, []);
});

test('una referencia vigente ausente de la entrega conserva su alcance y exige revisión', () => {
  const order = command(), h = prepare({ selected: [order], states: ['VIGENTE'] });
  assert.throws(() => h.call('metrogestionContinuarSincronizacion'), /sigue vigente.*No se amplía el alcance/);
  assert.deepEqual(copy(h.call('metrogestionLeerAlcanceOrdenes_')), [scopeOf(order)]);
  assert.equal(h.load().version, 'alpha75-2026.10.14.1');
  assert.deepEqual(h.httpCalls.map(call => call.method), ['sync', 'scope_status']);
  assert.deepEqual(h.effects, []);
});

test('alcance mixto: retira solo la obsoleta, conserva la vigente y no incorpora una entrega ajena', () => {
  const stale = command(), active = command({ sync_id: IDS.otherStop, revision: 8 });
  const unselected = command({ sync_id: '40000000-0000-4000-8000-000000000001', revision: 9 });
  const h = prepare({ selected: [stale, active], delivered: [unselected], states: ['NO_VIGENTE', 'VIGENTE'] });
  assert.throws(() => h.call('metrogestionContinuarSincronizacion'), /sigue vigente.*No se amplía el alcance/);
  assert.deepEqual(copy(h.call('metrogestionLeerAlcanceOrdenes_')), [scopeOf(active)]);
  assert.deepEqual(copy(h.call('metrogestionLeerEntregasConservadas_')).map(scopeOf), [scopeOf(unselected)]);
  assert.deepEqual(h.httpCalls.map(call => call.method), ['sync', 'scope_status']);
  assert.deepEqual(h.effects, []);
});

test('una conciliación dudosa conserva la selección y el ciclo legado sin autorizar ni confirmar', () => {
  const order = command(), h = prepare({ selected: [order], states: ['DUDOSA'] });
  assert.throws(() => h.call('metrogestionContinuarSincronizacion'), /Revisión obligatoria/);
  assert.deepEqual(copy(h.call('metrogestionLeerAlcanceOrdenes_')), [scopeOf(order)]);
  assert.equal(h.load().version, 'alpha75-2026.10.14.1');
  assert.deepEqual(h.httpCalls.map(call => call.method), ['sync', 'scope_status']);
  assert.deepEqual(h.effects, []);
});
