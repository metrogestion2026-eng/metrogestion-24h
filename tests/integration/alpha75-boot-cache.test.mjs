import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SHARED_WIZARD, BILLING_READER, startBootServer } from './boot-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ENTRY = '/r1-alpha75/index.html';

async function awaitBoot(page) {
  await page.evaluate(async () => {
    const source = [...document.querySelectorAll('script[type="module"]')]
      .find(script => new URL(script.src).pathname.endsWith('/boot75.js'))?.src;
    if (!source) throw new Error('The actual Alpha75 boot entry is missing');
    await import(source);
  });
}

test('Alpha75 published index and warm HTTP cache', { timeout: 60000 }, async t => {
  const server = await startBootServer();
  let browser;
  const errors = [], externalPageRequests = [];
  try {
    browser = await chromium.launch({
      ...(process.env.METROGESTION_BROWSER_EXECUTABLE ? { executablePath: process.env.METROGESTION_BROWSER_EXECUTABLE } : {}),
      headless: true,
      proxy: { server: server.origin, bypass: '127.0.0.1,localhost' },
      args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    });
    // No page/context routing: Playwright routing disables HTTP cache.
    const context = await browser.newContext({ timezoneId: 'Europe/Madrid', locale: 'es-ES', serviceWorkers: 'block' });
    context.on('request', request => {
      if (new URL(request.url()).origin !== server.origin) externalPageRequests.push(request.url());
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));

    await t.test('cold boot loads the published graph and retains the login boundary', async () => {
      await page.goto(server.origin + ENTRY);
      await awaitBoot(page);
      assert.equal(await page.locator('#app-version').textContent(), 'r1.0.0-alpha.75.25');
      assert.equal(await page.locator('#login-view').isVisible(), true);
      assert.equal(await page.locator('#app-view').isVisible(), false);
      assert.equal(await page.locator('[data-alpha34-24h]').count(), 1);
      assert.equal(await page.evaluate(() => globalThis.__BOOT_STALE_WIZARD__), undefined);
      for (const file of ['assistance-situation.js', 'assistance-completion.js']) {
        assert.ok(server.calls.some(call => call.path === `/r1-alpha75/src/${file}` && call.query === '?v=75.25-paradas-002'), file);
      }
      for (const file of ['hotel-native.js', 'history-native.js', 'panel-native-hf23.js']) {
        assert.ok(server.calls.some(call => call.path === `/r1-alpha75/src/${file}` && call.query === '?v=75.25-continuidad-001'), file);
      }
      assert.ok((await page.evaluate(() => globalThis.__BOOT_AUTH_CALLS__)).includes('getSession'));
      assert.deepEqual(errors, []);
    });

    await t.test('warm cache replaces the previous shared wizard even with a delayed response body', async () => {
      await page.goto(server.origin + '/__boot/prime');
      server.controls.oldWizard = true;
      const old = await page.evaluate(async path => (await fetch(path, { cache: 'reload' })).text(), SHARED_WIZARD);
      assert.match(old, /__BOOT_STALE_WIZARD__/);
      server.controls.oldWizard = false;
      const before = server.calls.filter(call => call.path === SHARED_WIZARD).length;
      const cached = await page.evaluate(async path => (await fetch(path)).text(), SHARED_WIZARD);
      assert.equal(cached, old);
      assert.equal(server.calls.filter(call => call.path === SHARED_WIZARD).length, before,
        'Priming must prove a real cache hit with no server request');
      server.controls.delayWizardBody = 700;
      await page.goto(server.origin + ENTRY);
      await awaitBoot(page);
      assert.equal(await page.evaluate(() => globalThis.__BOOT_STALE_WIZARD__), undefined,
        'A valid prior wizard must never silently execute after the candidate boot');
      const loaded = server.calls.filter(call => call.path === SHARED_WIZARD).slice(before);
      assert.ok(loaded.some(call => call.sha256 === server.currentWizardSha256 && call.bodyEndedAt),
        'The exact candidate wizard must finish loading from the server');
      assert.equal(await page.locator('[data-alpha34-24h]').count(), 1);
      assert.deepEqual(errors, []);
      server.controls.delayWizardBody = 0;
    });

    await t.test('after a failed preload the module loader obtains the current wizard', async () => {
      await page.goto(server.origin + '/__boot/prime');
      server.controls.oldWizard = true;
      const old = await page.evaluate(async path => (await fetch(path, { cache: 'reload' })).text(), SHARED_WIZARD);
      assert.match(old, /__BOOT_STALE_WIZARD__/);
      server.controls.oldWizard = false;
      const before = server.calls.filter(call => call.path === SHARED_WIZARD).length;
      assert.equal(await page.evaluate(async path => (await fetch(path)).text(), SHARED_WIZARD), old);
      assert.equal(server.calls.filter(call => call.path === SHARED_WIZARD).length, before);
      server.controls.failWizardRefresh = true;
      await page.goto(server.origin + ENTRY);
      await awaitBoot(page);
      assert.equal(await page.evaluate(() => globalThis.__BOOT_STALE_WIZARD__), undefined,
        'A failed refresh must not execute the cached wizard from the previous delivery');
      const requests = server.calls.filter(call => call.path === SHARED_WIZARD).slice(before);
      assert.ok(requests.some(call => call.failedRefresh), 'The preload failure must actually occur');
      assert.ok(requests.some(call => !call.failedRefresh && call.sha256 === server.currentWizardSha256 && call.bodyEndedAt),
        'A later module request must successfully retrieve the exact candidate wizard');
      assert.equal(await page.locator('[data-alpha34-24h]').count(), 1);
    });

    await t.test('the continuity graph replaces a genuinely cached previous billing reader', async () => {
      const fresh = await browser.newContext({ timezoneId: 'Europe/Madrid', locale: 'es-ES', serviceWorkers: 'block' });
      fresh.on('request', request => {
        if (new URL(request.url()).origin !== server.origin) externalPageRequests.push(request.url());
      });
      try {
        const continuityPage = await fresh.newPage();
        continuityPage.setDefaultTimeout(10000);
        continuityPage.on('pageerror', error => errors.push(error.message));
        server.controls.failWizardRefresh = false;
        await continuityPage.goto(server.origin + '/__boot/prime');
        server.controls.oldBilling = true;
        const old = await continuityPage.evaluate(async path => (await fetch(path, { cache: 'reload' })).text(), BILLING_READER);
        assert.match(old, /__BOOT_STALE_BILLING__/);
        server.controls.oldBilling = false;
        const before = server.calls.filter(call => call.path === BILLING_READER).length;
        assert.equal(await continuityPage.evaluate(async path => (await fetch(path)).text(), BILLING_READER), old);
        assert.equal(server.calls.filter(call => call.path === BILLING_READER).length, before,
          'The old financial reader must be served from HTTP cache before boot');
        await continuityPage.goto(server.origin + ENTRY);
        await awaitBoot(continuityPage);
        assert.equal(await continuityPage.evaluate(() => globalThis.__BOOT_STALE_BILLING__), undefined,
          'The new continuity graph must not execute the previous reader');
        const loaded = server.calls.filter(call => call.path === BILLING_READER).slice(before);
        assert.ok(loaded.some(call => call.query === '?v=75.25-continuidad-001'
          && call.sha256 === server.currentBillingSha256 && call.bodyEndedAt),
        'The actual candidate graph must retrieve the current reader with the new revision');
        assert.deepEqual(errors, []);
      } finally {
        await fresh.close();
      }
    });

    assert.deepEqual(server.failures, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(externalPageRequests, [], 'The application must not request an external service');
    // The deny proxy also blocks Chrome's own background services. Those are
    // not page traffic and are never forwarded to an external destination.
    t.diagnostic(`Browser ${browser.version()}; full public build; anonymous auth double; HTTP cache remained enabled.`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
