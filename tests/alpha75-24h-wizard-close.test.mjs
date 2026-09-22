import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../r1-alpha34/src/app.js', import.meta.url), 'utf8');
// Execute the production handlers with the wizard's surrounding state and RPC
// boundary supplied by the fixture. No browser or database dependency in CI.
const handlers = ['const collectPayload=', 'const saveActivation=', 'function validate()', 'next.onclick=']
  .map(prefix => {
    const line = source.split('\n').find(line => line.trim().startsWith(prefix));
    assert.ok(line, `Missing wizard handler: ${prefix}`);
    return line;
  }).join('\n');

function wizard({ current = 6, activationId = 'existing-activation', state = {} } = {}) {
  const calls = [];
  const notices = [];
  const context = vm.createContext({
    current, activationId, next: {},
    state: { fecha_activacion: '2026-09-22', hora_activacion: '00:01', numero_caso: 'TEST-CASE', ...state },
    vehicle: { dfm: 'TEST-DFM', matricula: 'TEST-PLATE' },
    coverageOk: true,
    parseKm: value => Number(value || 0),
    madridToday: () => '2026-09-22',
    requestId: () => 'test-wizard-close',
    evaluateCoverage: () => ({ ok: true }),
    renderStep() {},
    clearNotice() {},
    openIncidences() {},
    showNotice: message => notices.push(message),
    supabase: { rpc: async (name, args) => {
      calls.push({ name, ...JSON.parse(JSON.stringify(args)) });
      return { data: { id: args.p_id || 'new-activation' }, error: null };
    } },
  });
  vm.runInContext(handlers, context);
  return { calls, notices, context, next: () => context.next.onclick() };
}

const repaired = { resultado: 'operativo_reparado', estado_operativo_confirmado: true,
  fecha_fin_reparacion: '2026-09-23', hora_fin_reparacion: '02:30' };

test('step 6 registers an open activation without requiring a future repair date', async () => {
  const w = wizard({ current: 5, activationId: null });
  await w.next();
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].p_id, null);
  assert.equal(w.calls[0].p_payload.resultado, 'seguimiento_abierto');
  assert.equal(w.calls[0].p_payload.fecha_fin_reparacion, '');
  assert.equal(w.context.current, 6);
});

test('returning from step 7 with an incomplete closure does not resave or block step 6', async () => {
  const w = wizard({ current: 5, state: { ...repaired, fecha_fin_reparacion: '' } });
  await w.next();
  assert.equal(w.calls.length, 0);
  assert.equal(w.context.current, 6);
  assert.equal(w.context.state.resultado, 'operativo_reparado');
  assert.equal(w.context.state.hora_fin_reparacion, '02:30');
});

for (const [label, fields, message] of [
  ['missing date', { fecha_fin_reparacion: '' }, /Indica la fecha de fin/],
  ['missing time', { hora_fin_reparacion: '' }, /Indica la hora de fin/],
  ['missing confirmation', { estado_operativo_confirmado: false }, /Confirma que el vehículo/],
  ['date before activation', { fecha_fin_reparacion: '2026-09-21' }, /no puede ser anterior/],
]) {
  test(`step 7 rejects ${label} before making a request`, async () => {
    const w = wizard({ state: { ...repaired, ...fields } });
    await w.next();
    assert.equal(w.calls.length, 0);
    assert.match(w.notices.at(-1), message);
  });
}

test('closure sends the entered date and time and updates the same activation', async () => {
  const w = wizard({ state: repaired });
  await w.next();
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].p_id, 'existing-activation');
  assert.equal(w.calls[0].p_payload.fecha_fin_reparacion, '2026-09-23');
  assert.equal(w.calls[0].p_payload.hora_fin_reparacion, '02:30');
  assert.equal(w.calls[0].p_payload.estado, 'cerrada');
});

test('switching back to open followup excludes draft closure dates', async () => {
  const w = wizard({ state: { ...repaired, resultado: 'seguimiento_abierto' } });
  await w.next();
  assert.equal(w.calls[0].p_payload.estado, 'abierta');
  assert.equal(w.calls[0].p_payload.fecha_fin_reparacion, '');
  assert.equal(w.calls[0].p_payload.hora_fin_reparacion, '');
});

test('step 6 edits survive returning to step 7 and are sent with the final save', async () => {
  const w = wizard({ current: 5, state: { ...repaired, proveedor: 'TEST-WORKSHOP', fecha_activacion: '2026-09-20' } });
  await w.next();
  await w.next();
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].p_id, 'existing-activation');
  assert.equal(w.calls[0].p_payload.proveedor, 'TEST-WORKSHOP');
  assert.equal(w.calls[0].p_payload.fecha_activacion, '2026-09-20');
});
