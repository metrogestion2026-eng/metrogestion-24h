import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

export const FIXTURE_ACTOR = '00000000-0000-4000-8000-000000000001';
export const FIXTURE_BOARD = '00000000-0000-4000-8000-000000000010';
export const FROZEN_MIGRATION_SHA256 = '60cfff3ae8fd99818d88748080073a100ab52582eb4bc8dbcf5c02b8ce548092';
const LOCAL_SERVER_ROOT = '/tmp/metrogestion-pg17-native';
const DATABASE_PREFIX = 'metrogestion_test_';

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Parse only the dedicated, passwordless local test server's DSN.
 * No connectionString or inherited PGHOST/options is passed to node-postgres.
 * TCP is deliberately unsupported, including loopback/tunnel endpoints.
 */
export function parseLocalPostgresDsn(dsn) {
  if (typeof dsn !== 'string' || dsn.length === 0) {
    throw new Error('METROGESTION_LOCAL_PG_DSN is required; only the dedicated local Unix socket is allowed');
  }
  let parsed;
  try { parsed = new URL(dsn); } catch { throw new Error('Invalid local PostgreSQL DSN'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
      || parsed.hostname !== 'localhost' || parsed.password !== '' || parsed.hash !== '') {
    throw new Error('Only a passwordless PostgreSQL DSN with localhost placeholder and a local Unix socket is allowed');
  }
  const user = decodeURIComponent(parsed.username);
  if (user !== 'metrogestion_test' || decodeURIComponent(parsed.pathname) !== '/postgres') {
    throw new Error('The bootstrap connection must use metrogestion_test and the postgres maintenance database');
  }
  for (const key of parsed.searchParams.keys()) {
    if (!['host', 'port'].includes(key) || parsed.searchParams.getAll(key).length !== 1) {
      throw new Error('Only one host and one port parameter are accepted; external connection options are forbidden');
    }
  }
  const host = parsed.searchParams.get('host');
  if (!host || host.includes('\0') || !path.isAbsolute(host)
      || !inside(LOCAL_SERVER_ROOT, path.resolve(host))) {
    throw new Error(`Only a Unix socket under ${LOCAL_SERVER_ROOT} is allowed`);
  }
  const portText = parsed.searchParams.get('port') || parsed.port;
  if (!/^\d{1,5}$/.test(portText || '') || Number(portText) < 1 || Number(portText) > 65535
      || (parsed.port && Number(parsed.port) !== Number(portText))) {
    throw new Error('An unambiguous local PostgreSQL port is required');
  }
  return Object.freeze({
    host: path.resolve(host), port: Number(portText), user, password: () => '', database: 'postgres',
    // A truthy password provider prevents pg from consulting PGPASSWORD/pgpass.
    // Explicit startup options also prevent inheriting unrelated PGOPTIONS.
    ssl: false, client_encoding: 'UTF8', options: '-c search_path=public', connectionTimeoutMillis: 5000,
  });
}

function databaseIdentifier(name) {
  if (!/^metrogestion_test_[a-z0-9_]{1,44}$/.test(name)) throw new Error('Unsafe temporary database name');
  return `"${name}"`;
}

function sharedRoleSetup(sql) {
  // Roles are cluster-wide; separate UI/concurrency fixture databases may start
  // simultaneously. Never change an existing role's attributes or privileges.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const old = `CREATE ROLE ${role};`;
    assert.equal(sql.split(old).length - 1, 1, `Expected one fixture role declaration: ${role}`);
    sql = sql.replace(old, `DO $fixture_role$ BEGIN CREATE ROLE ${role};
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $fixture_role$;`);
  }
  return sql;
}

export async function one(client, text, values = []) {
  return (await client.query(text, values)).rows[0];
}

export async function snapshotProtectedFacts(client) {
  return (await one(client, `SELECT jsonb_build_object(
    'registros',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.registros_hotel x
      WHERE x.id IN ('00000000-0000-4000-8000-000000002556','00000000-0000-4000-8000-000000002637')),
    'etapas',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.etapas_hotel x
      WHERE x.registro_hotel_id IN ('00000000-0000-4000-8000-000000002556','00000000-0000-4000-8000-000000002637')),
    'activaciones',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.activaciones_24h x
      WHERE x.id='00000000-0000-4000-8000-000000102556'),
    'sync',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.seguimiento_id),'[]') FROM app_private.manteniment_parada_sync x
      WHERE x.seguimiento_id IN ('00000000-0000-4000-8000-000000202556','00000000-0000-4000-8000-000000202637')),
    'barriers',(SELECT jsonb_agg(to_jsonb(x)) FROM app_private.test_sync_config x)
  ) AS value`)).value;
}

/** Creates only a new, randomly named database in the dedicated local cluster.
 * Caller must await destroy(); it closes tracked clients before dropping ONLY
 * the database created by this invocation. Existing databases are never reused.
 */
export async function createLocalFixture({
  dsn = process.env.METROGESTION_LOCAL_PG_DSN,
  prefix = 'concurrency',
} = {}) {
  if (!/^[a-z][a-z0-9_]{0,14}$/.test(prefix)) throw new Error('Invalid fixture scope');
  const base = parseLocalPostgresDsn(dsn);
  if (!inside(await realpath(LOCAL_SERVER_ROOT), await realpath(base.host))) {
    throw new Error('The socket resolves outside the dedicated local server directory');
  }
  const admin = new pg.Client({ ...base, application_name: `metrogestion_test_${prefix}_bootstrap` });
  const dbName = `${DATABASE_PREFIX}${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
  const dbIdentifier = databaseIdentifier(dbName);
  const clients = new Set();
  let created = false;
  let destroyed = false;
  let observer;
  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    const ended = await Promise.allSettled([...clients].map(client => client.end()));
    clients.clear();
    try {
      if (created) await admin.query(`DROP DATABASE ${dbIdentifier} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
    const failure = ended.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  try {
    await admin.connect();
    const server = await one(admin, `SELECT version() AS version,
      current_setting('server_version_num')::int AS version_number,
      current_setting('data_directory') AS data_directory,
      current_setting('listen_addresses') AS listen_addresses,
      inet_server_addr() AS server_address, current_user AS user_name,
      current_database() AS database_name, pg_is_in_recovery() AS recovery`);
    if (Math.trunc(server.version_number / 10000) !== 17 || server.server_address !== null
        || server.listen_addresses !== '' || server.user_name !== 'metrogestion_test'
        || server.database_name !== 'postgres' || server.recovery
        || !inside(await realpath(LOCAL_SERVER_ROOT), await realpath(server.data_directory))) {
      throw new Error('Server identity does not match the isolated PostgreSQL17 Unix-socket fixture');
    }
    const [setup, baseline, seed, triggers, migration] = await Promise.all([
      readFile(new URL('./fixtures/setup.sql', import.meta.url), 'utf8'),
      readFile(new URL('../fixtures/alpha75-24h-paradas-baseline.sql', import.meta.url), 'utf8'),
      readFile(new URL('./fixtures/concurrency-history.sql', import.meta.url), 'utf8'),
      readFile(new URL('./fixtures/triggers.sql', import.meta.url), 'utf8'),
      readFile(new URL('../../supabase/migrations/20261028174243_alpha75_24h_paradas_independientes.sql', import.meta.url), 'utf8'),
    ]);
    const migrationSha256 = createHash('sha256').update(migration).digest('hex');
    assert.equal(migrationSha256, FROZEN_MIGRATION_SHA256, 'The candidate is no longer the frozen migration under review');
    await admin.query(`CREATE DATABASE ${dbIdentifier} TEMPLATE template0 ENCODING 'UTF8'`);
    created = true;
    const connectionConfig = Object.freeze({ ...base, database: dbName });
    async function connect(label = 'worker', { actor = FIXTURE_ACTOR } = {}) {
      if (destroyed) throw new Error('Fixture has already been destroyed');
      if (!/^[a-zA-Z0-9_-]{1,24}$/.test(label)) throw new Error('Invalid connection label');
      const client = new pg.Client({ ...connectionConfig, application_name: `metrogestion_test_${prefix}_${label}` });
      clients.add(client);
      try {
        await client.connect();
        await client.query("SET statement_timeout='25s'; SET lock_timeout='15s'; SET TIME ZONE 'UTC';");
        await client.query("SELECT set_config('test.actor',$1,false),set_config('test.device_allowed','true',false),set_config('test.edit_allowed','true',false)", [actor]);
        return client;
      } catch (error) {
        await client.end().catch(() => {});
        clients.delete(client);
        throw error;
      }
    }
    observer = await connect('observer');
    await observer.query(sharedRoleSetup(setup));
    await observer.query(baseline);
    await observer.query(seed);
    await observer.query(triggers);
    const protectedBefore = await snapshotProtectedFacts(observer);
    await observer.query(migration);
    assert.deepEqual(await snapshotProtectedFacts(observer), protectedBefore, 'Installing the candidate changed synthetic history or barriers');
    const volatility = (await observer.query(`SELECT p.oid::regprocedure::text AS signature,p.provolatile
      FROM pg_proc p WHERE p.oid IN (
        'app_private.guardar_activacion_24h(uuid,jsonb,text)'::regprocedure,
        'app_private.proteger_sustitucion_paradas002()'::regprocedure)
      ORDER BY 1`)).rows;
    assert.equal(volatility.length, 2);
    for (const fn of volatility) assert.equal(fn.provolatile, 'v', `${fn.signature} must remain VOLATILE`);
    return {
      dbName, observer, admin: observer, connectionConfig, connect, destroy,
      async close(client) { if (clients.delete(client)) await client.end(); },
      protectedBefore,
      metadata: {
        server, database: dbName, migration_sha256: migrationSha256,
        socket: base.host, port: base.port, volatility,
        scope: 'Synthetic fixtures only; two real PostgreSQL workers plus one lock observer',
      },
    };
  } catch (error) {
    await destroy().catch(cleanupError => { error.cleanupError = cleanupError.message; });
    throw error;
  }
}

export async function beginReadCommitted(client) {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const state = await one(client, `SELECT pg_backend_pid() AS pid, auth.uid()::text AS actor,
    current_setting('transaction_isolation') AS isolation, current_database() AS database_name`);
  assert.equal(state.actor, FIXTURE_ACTOR, 'Each worker needs the same non-null synthetic actor');
  assert.equal(state.isolation, 'read committed');
  return state;
}

/** Return only after PostgreSQL proves waiter is blocked on an advisory lock
 * actually held by blocker. Poll delay bounds observer load; it is NOT used as
 * evidence that the race happened. Timeout, non-advisory wait or an early result
 * never counts as a successful conflict test.
 */
export async function observeAdvisoryWait(observer, blockerPid, waiterPid, {
  timeoutMs = 10000, isSettled = () => false,
} = {}) {
  const started = performance.now();
  let last;
  while (performance.now() - started < timeoutMs) {
    last = await one(observer, `SELECT a.pid,a.state,a.wait_event_type,a.wait_event,
      pg_blocking_pids(a.pid) AS blocking_pids,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('classid',w.classid::text,'objid',w.objid::text,
        'objsubid',w.objsubid,'mode',w.mode,'granted',w.granted)),'[]')
       FROM pg_locks w JOIN pg_locks h ON h.locktype=w.locktype
         AND h.database IS NOT DISTINCT FROM w.database AND h.classid=w.classid
         AND h.objid=w.objid AND h.objsubid=w.objsubid
       WHERE w.pid=a.pid AND w.locktype='advisory' AND NOT w.granted
         AND h.pid=$1 AND h.granted) AS matching_waits
      FROM pg_stat_activity a WHERE a.pid=$2`, [blockerPid, waiterPid]);
    if (last?.wait_event_type === 'Lock' && last.wait_event === 'advisory'
        && last.blocking_pids.includes(blockerPid) && last.matching_waits.length > 0) {
      return { ...last, blocker_pid: blockerPid, observed_after_ms: Math.round(performance.now() - started) };
    }
    if (isSettled()) throw new Error(`The second operation finished before a real advisory wait was observed: ${JSON.stringify(last)}`);
    await delay(20);
  }
  throw new Error(`No proven advisory wait within ${timeoutMs}ms: ${JSON.stringify(last)}`);
}
