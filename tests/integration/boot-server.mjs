import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);
export const SHARED_WIZARD = '/r1-alpha34/src/app.js';
export const BILLING_READER = '/r1-alpha75/src/billing-data-hf2.js';
export const HOTEL_EDITOR = '/r1-alpha75/src/hotel-editor.js';

export async function startBootServer() {
  const published = await mkdtemp(path.join(os.tmpdir(), 'metrogestion-boot-static-'));
  try {
    await run('python3', [path.join(repo, '.github/scripts/build-pages.py'), published]);
  } catch (error) {
    await rm(published, { recursive: true, force: true });
    throw error;
  }
  const currentWizard = await readFile(path.join(published, SHARED_WIZARD), 'utf8');
  const oldWizard = await readFile(new URL('./fixtures/alpha34-before-paradas002.js', import.meta.url), 'utf8');
  const currentBilling = await readFile(path.join(published, BILLING_READER), 'utf8');
  const oldBilling = await readFile(new URL('./fixtures/alpha75-billing-before-continuidad001.js', import.meta.url), 'utf8');
  const currentEditor = await readFile(path.join(published, HOTEL_EDITOR), 'utf8');
  const oldEditor = await readFile(new URL('./fixtures/alpha75-editor-before-fechas001.js', import.meta.url), 'utf8');
  if (createHash('sha256').update(oldWizard).digest('hex') !== 'd48844d48691ddfdc514aca257a98a65c343f0eb4d70b55fef20907b8c126c13') {
    await rm(published, { recursive: true, force: true });
    throw new Error('The previous wizard fixture no longer matches commit 8d0138e');
  }
  if (createHash('sha256').update(oldBilling).digest('hex') !== '894860b836d294b83a8e5536372a98919efcc26c726a7e40774e7adc0c09d455') {
    await rm(published, { recursive: true, force: true });
    throw new Error('The previous billing reader no longer matches commit c5324299');
  }
  if (createHash('sha256').update(oldEditor).digest('hex') !== 'b3db99af9cb4e663909ab04032826fae50644394b523e6487722ce728f1b020d') {
    await rm(published, { recursive: true, force: true });
    throw new Error('The previous Hotel editor no longer matches commit 18ba1e8');
  }
  const calls = [], failures = [], denied = [];
  const controls = { oldWizard: false, delayWizardBody: 0, failWizardRefresh: false, oldBilling: false, oldEditor: false };
  let origin;
  const server = createServer(async (request, response) => {
    try {
      if (/^https?:\/\//i.test(request.url) && !request.url.startsWith(origin + '/')) {
        denied.push(request.url); response.writeHead(403).end(); return;
      }
      const url = new URL(request.url, origin);
      if (url.origin !== origin || request.method !== 'GET') {
        denied.push(`${request.method} ${request.url}`); response.writeHead(403).end(); return;
      }
      const entry = { path: url.pathname, query: url.search, cacheControl: request.headers['cache-control'] || '',
        at: performance.now(), mode: controls.oldWizard ? 'old' : 'current' };
      calls.push(entry);
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'none'; object-src 'none'; base-uri 'none'");
      if (url.pathname === '/__boot/prime') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end('<!doctype html><html lang="es"><title>Caché sintética</title><p>Origen aislado de pruebas.</p></html>'); return;
      }
      if (url.pathname === '/functions/v1/bootstrap-admin-r1') {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end('{"open":false}'); return;
      }
      const relative = decodeURIComponent(url.pathname).slice(1);
      if (!/^(r1-alpha(?:\d+|80test)\/|shared\/)/.test(relative)
          || relative.split('/').includes('..')
          || !/\.(?:html|js|mjs|css|svg|webmanifest|png)$/.test(relative)) {
        response.writeHead(404).end(); return;
      }
      let source = await readFile(path.join(published, relative));
      const extension = path.extname(relative);
      if (url.pathname === '/r1-alpha17/src/supabase.js') {
        source = await readFile(new URL('./boot-anonymous-client.js', import.meta.url));
      } else if (url.pathname === '/r1-alpha17/src/config.js') {
        source = Buffer.from(source.toString().replace(
          /export const SUPABASE_URL = '[^']+';/,
          `export const SUPABASE_URL = '${origin}';`,
        ).replace(/export const SUPABASE_PUBLISHABLE_KEY = '[^']+';/,
          "export const SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-test-key';"));
      } else if (url.pathname === SHARED_WIZARD) {
        if (controls.failWizardRefresh && request.headers['cache-control']) {
          entry.failedRefresh = true; response.writeHead(503).end('Synthetic refresh failure'); return;
        }
        source = Buffer.from(controls.oldWizard ? oldWizard + '\nglobalThis.__BOOT_STALE_WIZARD__ = true;\n' : currentWizard);
        entry.sha256 = createHash('sha256').update(source).digest('hex');
      } else if (url.pathname === BILLING_READER) {
        source = Buffer.from(controls.oldBilling ? oldBilling + '\nglobalThis.__BOOT_STALE_BILLING__ = true;\n' : currentBilling);
        entry.sha256 = createHash('sha256').update(source).digest('hex');
      } else if (url.pathname === HOTEL_EDITOR) {
        source = Buffer.from(controls.oldEditor ? oldEditor + '\nglobalThis.__BOOT_STALE_EDITOR__ = true;\n' : currentEditor);
        entry.sha256 = createHash('sha256').update(source).digest('hex');
      }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
        '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
      response.setHeader('Content-Type', `${types[extension]}; charset=utf-8`);
      response.setHeader('Cache-Control', extension === '.html' ? 'no-cache' : 'public, max-age=3600');
      if (url.pathname === SHARED_WIZARD && controls.delayWizardBody && !controls.oldWizard) {
        response.setHeader('Content-Length', source.length);
        response.flushHeaders();
        await new Promise(resolve => setTimeout(resolve, controls.delayWizardBody));
      }
      entry.bodyEndedAt = performance.now();
      response.end(source);
    } catch (error) {
      failures.push({ path: request.url, message: error.message });
      response.writeHead(500).end('Isolated fixture error');
    }
  });
  server.on('connect', (request, socket) => { denied.push(request.url); socket.destroy(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, calls, failures, denied, controls,
    currentWizardSha256: createHash('sha256').update(currentWizard).digest('hex'),
    currentBillingSha256: createHash('sha256').update(currentBilling).digest('hex'),
    currentEditorSha256: createHash('sha256').update(currentEditor).digest('hex'),
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(published, { recursive: true, force: true });
    },
  };
}
