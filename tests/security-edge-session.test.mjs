import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

for (const slug of ['gestionar-usuarios-r1', 'gestionar-claves-r1']) {
  for (const [name, data, error, expected] of [
    ['revoked session', false, null, 401],
    ['missing session result', null, null, 401],
    ['session service failure', null, { message: 'unavailable' }, 401],
    ['nonboolean session result', 'true', null, 401],
    ['current session reaches action validation', true, null, 400],
  ]) {
    test(`${slug}: ${name}`, async () => {
      let handler;
      let privilegedClients = 0;
      let checks = 0;
      const source = await readFile(new URL(`../supabase/functions/${slug}/index.ts`, import.meta.url), 'utf8');
      const helpers = await readFile(new URL('../supabase/functions/_shared/http-security.ts', import.meta.url), 'utf8');
      const code = stripTypeScriptTypes(helpers.replace(/^export /gm, '') + '\n' + source.replace(/^import .*;\s*$/gm, ''));
      const profile = { id: 'audit-user', activo: true, tipo_usuario: 'administrador_principal', debe_cambiar_clave: false, credenciales_actualizadas_en: '2026-01-01T00:00:00Z' };
      const createClient = (_url, key) => {
        if (key === 'test-anon') return {
          auth: { getUser: async () => ({ data: { user: { id: profile.id } }, error: null }) },
          rpc: async (rpc) => {
            assert.equal(rpc, 'credencial_vigente');
            checks++;
            return { data, error };
          },
        };
        assert.equal(key, 'test-service');
        privilegedClients++;
        const query = { select() { return this; }, eq() { return this; }, single: async () => ({ data: profile, error: null }) };
        return { from: () => query };
      };
      vm.runInNewContext(code, {
        createClient, Request, Response, TextEncoder, TextDecoder, crypto, atob,
        Deno: { env: { get: (key) => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service' })[key] }, serve: (fn) => { handler = fn; } },
      });
      const jwt = `test.${Buffer.from(JSON.stringify({ iat: 1789900000 })).toString('base64url')}.test`;
      const response = await handler(new Request('https://example.invalid', {
        method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'not-an-action' }),
      }));
      assert.equal(response.status, expected);
      assert.equal(checks, 1);
      assert.equal(privilegedClients, expected === 401 ? 0 : 1);
    });
  }
}
