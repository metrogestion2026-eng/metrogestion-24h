import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import pg from 'pg';
import { FIXTURE_ACTOR, one, parseLocalPostgresDsn } from './local-postgres-harness.mjs';

// Apps Script fetch is synchronous. A short-lived child executes the distributed
// Edge handler and binds ONLY its known RPCs to a fresh local fixture database.
// No HTTP service, operational credentials, arbitrary SQL or remote DSN enters
// this bridge. Google platform objects remain the separate synthetic harness.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { database, body } = JSON.parse(input);
assert.match(database, /^metrogestion_test_[a-z0-9_]{1,44}$/);
const base = parseLocalPostgresDsn(process.env.METROGESTION_LOCAL_PG_DSN);
const client = new pg.Client({ ...base, database, application_name: 'metrogestion_test_execution_bridge' });
await client.connect();
try {
  const identity = await one(client, `SELECT current_database() AS database, current_user AS username,
    inet_server_addr() AS address, current_setting('listen_addresses') AS listeners,
    current_setting('server_version_num')::int AS version`);
  assert.deepEqual(identity, { database, username: 'metrogestion_test', address: null, listeners: '', version: identity.version });
  assert.equal(Math.trunc(identity.version / 10000), 17);
  await client.query("SET statement_timeout='15s'; SET lock_timeout='10s'; SET TIME ZONE 'UTC'");
  await client.query("SELECT set_config('test.actor',$1,false),set_config('test.device_allowed','true',false),set_config('test.edit_allowed','true',false)", [FIXTURE_ACTOR]);
  const [source, httpSource] = await Promise.all([
    readFile(new URL('../../supabase/functions/manteniment-sync-r1/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/_shared/http-security.ts', import.meta.url), 'utf8'),
  ]);
  const http = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(httpSource)).toString('base64'));
  const executable = stripTypeScriptTypes(source.replace(/^import[^\n]*\n/gm, ''));
  const rpcMap = {
    recibir_snapshot_manteniment: { argument: 'p_payload', sql: 'SELECT public.recibir_snapshot_manteniment($1,$2::jsonb) AS value' },
    autorizar_ejecucion_manteniment: { argument: 'p_solicitud', sql: 'SELECT public.autorizar_ejecucion_manteniment($1,$2::jsonb) AS value', readOnly: true },
    confirmar_ejecucion_manteniment: { argument: 'p_solicitud', sql: 'SELECT public.confirmar_ejecucion_manteniment($1,$2::jsonb) AS value' },
  };
  const calls = [];
  const createClient = () => ({ async rpc(name, parameters) {
    assert.ok(Object.hasOwn(rpcMap, name), `Unexpected RPC in the contract bridge: ${name}`);
    const mapping = rpcMap[name];
    assert.deepEqual(Object.keys(parameters).sort(), ['p_token', mapping.argument].sort());
    const record = { name, read_only: Boolean(mapping.readOnly) };
    calls.push(record);
    if (mapping.readOnly) {
      await client.query('BEGIN READ ONLY');
      assert.equal((await one(client, 'SHOW transaction_read_only')).transaction_read_only, 'on');
    }
    try {
      const data = (await one(client, mapping.sql, [parameters.p_token, JSON.stringify(parameters[mapping.argument])])).value;
      return { data, error: null };
    } catch (error) {
      record.error_code = error.code;
      return { data: null, error: { code: error.code, message: error.message } };
    } finally {
      if (mapping.readOnly) await client.query('ROLLBACK');
    }
  } });
  let handler;
  const Deno = { serve(fn) { handler = fn; }, env: { get(key) {
    return { SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_LOCAL_BRIDGE_KEY' }[key];
  } } };
  new Function('Deno', 'createClient', 'BodyError', 'readJsonObject', 'Request', 'Response', 'fetch', executable)(
    Deno, createClient, http.BodyError, http.readJsonObject, Request, Response,
    () => { throw new Error('Network is forbidden in the local contract bridge'); });
  assert.equal(typeof handler, 'function');
  const response = await handler(new Request('https://synthetic.invalid', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  process.stdout.write(JSON.stringify({ status: response.status, body: await response.text(), rpc_calls: calls }));
} finally {
  await client.end();
}
