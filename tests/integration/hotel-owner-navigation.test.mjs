import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LEGACY_HOTEL_ROUTER, startBootServer } from './boot-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

async function awaitBoot(page, version) {
  await page.evaluate(async version => {
    const script = [...document.querySelectorAll('script[type="module"]')]
      .find(node => new URL(node.src).pathname.endsWith(`/boot${version}.js`));
    if (!script) throw new Error(`Published Alpha${version} must use its owner boot`);
    await import(script.src);
  }, version);
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function readyHotel(page) {
  await page.waitForSelector('#module-content[data-alpha56-hotel-native="1"] .hotel-card');
}

test('Published Hotel has one owner across cached boots, login and delayed navigation', { timeout: 90000 }, async t => {
  const server = await startBootServer({ authenticated: true });
  let browser;
  const external = [];
  try {
    browser = await chromium.launch({
      ...(process.env.METROGESTION_BROWSER_EXECUTABLE ? { executablePath: process.env.METROGESTION_BROWSER_EXECUTABLE } : {}),
      headless: true,
      proxy: { server: server.origin, bypass: '127.0.0.1,localhost' },
      args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    });
    for (const version of [75, 76]) {
      await t.test(`Alpha${version}: restored session uses native Hotel once, with a genuinely cached legacy router`, async t => {
        // Routing interception would disable the cache; this uses a real HTTP server.
        const context = await browser.newContext({ timezoneId: 'Europe/Madrid', locale: 'es-ES', serviceWorkers: 'block' });
        context.on('request', request => { if (new URL(request.url()).origin !== server.origin) external.push(request.url()); });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(server.origin + '/__boot/prime');
          server.controls.oldHotelRouter = true;
          const old = await page.evaluate(async path => (await fetch(path, { cache: 'reload' })).text(), LEGACY_HOTEL_ROUTER);
          assert.match(old, /__BOOT_STALE_HOTEL_ROUTER__/);
          server.controls.oldHotelRouter = false;
          const before = server.calls.filter(call => call.path === LEGACY_HOTEL_ROUTER).length;
          assert.equal(await page.evaluate(async path => (await fetch(path)).text(), LEGACY_HOTEL_ROUTER), old);
          assert.equal(server.calls.filter(call => call.path === LEGACY_HOTEL_ROUTER).length, before, 'Old router must be a real cache hit');
          server.controls.delayHotelRouterBody = 650;
          await page.goto(`${server.origin}/r1-alpha${version}/index.html`);
          await awaitBoot(page, version);
          await readyHotel(page);
          await settle(page);
          const reads = await page.evaluate(() => globalThis.__HOTEL_TEST__.hotelReads());
          assert.equal(reads.length, 1, 'Initial session restoration must not render legacy Hotel first');
          assert.equal(reads[0].owner, `alpha${version}`);
          assert.deepEqual(reads[0].orders, ['orden', 'id']);
          assert.equal(await page.evaluate(() => globalThis.__BOOT_STALE_HOTEL_ROUTER__), undefined);
          assert.equal(await page.locator('#module-content .summary-grid').count(), 0);
          const refreshed = server.calls.filter(call => call.path === LEGACY_HOTEL_ROUTER).slice(before);
          assert.ok(refreshed.some(call => call.sha256 === server.currentHotelRouterSha256 && call.bodyEndedAt));
          assert.ok(!server.calls.some(call => call.path === '/r1-alpha17/src/app.js'), 'App17 is not a second login/router entry in the published graph');
          server.controls.delayHotelRouterBody = 0;

          await t.test('leaving Hotel discards a delayed data response', async () => {
            const id = await page.evaluate(() => __HOTEL_TEST__.deferNextHotel({ row: { dfm: 'RESPUESTA-ANTIGUA' } }));
            await page.locator('#module-nav [data-module="hotel"]').click();
            await page.waitForFunction(id => __HOTEL_TEST__.hotelReads().some(call => call.pendingId === id), id);
            await page.locator('#module-nav [data-module="talleres"]').click();
            await page.waitForFunction(() => document.querySelector('#module-nav [data-module="talleres"].active'));
            await page.waitForFunction(() => !document.querySelector('#module-content').textContent.includes('Cargando módulo'));
            const otherScreen = await page.locator('#module-content').textContent();
            await page.evaluate(id => __HOTEL_TEST__.release(id), id);
            await page.waitForFunction(id => __HOTEL_TEST__.completed.includes(id), id);
            await settle(page);
            assert.equal(await page.locator('#module-content').textContent(), otherScreen);
            assert.equal(await page.locator('#module-content .hotel-card').count(), 0);
          });

          await t.test('Hotel → Talleres → Hotel keeps the new response when the old one arrives last', async () => {
            const id = await page.evaluate(() => __HOTEL_TEST__.deferNextHotel({ row: { dfm: 'RESPUESTA-ANTIGUA' } }));
            await page.locator('#module-nav [data-module="hotel"]').click();
            await page.waitForFunction(id => __HOTEL_TEST__.hotelReads().some(call => call.pendingId === id), id);
            await page.locator('#module-nav [data-module="talleres"]').click();
            await page.waitForFunction(() => !document.querySelector('#module-content').textContent.includes('Cargando módulo'));
            await page.locator('#module-nav [data-module="hotel"]').click();
            await readyHotel(page);
            assert.match(await page.locator('#module-content .hotel-card').textContent(), /PRUEBA-ACTUAL/);
            await page.evaluate(id => __HOTEL_TEST__.release(id), id);
            await page.waitForFunction(id => __HOTEL_TEST__.completed.includes(id), id);
            await settle(page);
            assert.equal(await page.locator('#module-content .hotel-card').count(), 1);
            assert.doesNotMatch(await page.locator('#module-content').textContent(), /RESPUESTA-ANTIGUA/);
          });

          await t.test('an old Hotel error cannot replace the newly selected module', async () => {
            const id = await page.evaluate(() => __HOTEL_TEST__.deferNextHotel({ error: 'ERROR-DE-RESPUESTA-ANTIGUA' }));
            await page.locator('#module-nav [data-module="hotel"]').click();
            await page.waitForFunction(id => __HOTEL_TEST__.hotelReads().some(call => call.pendingId === id), id);
            await page.locator('#module-nav [data-module="talleres"]').click();
            await page.waitForFunction(() => !document.querySelector('#module-content').textContent.includes('Cargando módulo'));
            const otherScreen = await page.locator('#module-content').textContent();
            await page.evaluate(id => __HOTEL_TEST__.release(id), id);
            await page.waitForFunction(id => __HOTEL_TEST__.completed.includes(id), id);
            await settle(page);
            assert.equal(await page.locator('#module-content').textContent(), otherScreen);
            assert.doesNotMatch(otherScreen, /ERROR-DE-RESPUESTA-ANTIGUA/);
          });

          await t.test('a controller for another native version cannot invalidate the assigned owner', async () => {
            const other = version === 75 ? 76 : 75;
            await page.evaluate(async other => import(`/r1-alpha${other}/src/hotel-native.js?v=owner-isolation-test`), other);
            const before = await page.evaluate(() => __HOTEL_TEST__.hotelReads().length);
            await page.locator('#module-nav [data-module="hotel"]').click();
            await readyHotel(page);
            await settle(page);
            assert.equal(await page.evaluate(() => __HOTEL_TEST__.hotelReads().length), before + 1);
          });

          assert.deepEqual(await page.evaluate(() => __HOTEL_TEST__.writes), []);
          assert.deepEqual(errors, []);
        } finally {
          server.controls.delayHotelRouterBody = 0;
          await context.close();
        }
      });

      await t.test(`Alpha${version}: signing in after boot opens Hotel without a legacy snapshot`, async () => {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.addInitScript(() => { globalThis.__HOTEL_TEST_INITIAL_SESSION__ = false; });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        try {
          await page.goto(`${server.origin}/r1-alpha${version}/index.html`);
          await awaitBoot(page, version);
          assert.equal(await page.locator('#login-view').isVisible(), true);
          await page.locator('#login-email').fill('hotel@example.invalid');
          await page.locator('#login-password').fill('synthetic-test-only');
          await page.locator('#login-button').click();
          await readyHotel(page);
          await settle(page);
          assert.equal(await page.evaluate(() => __HOTEL_TEST__.hotelReads().length), 1);
          assert.equal(await page.evaluate(() => __METROGESTION_MODULE_OWNERS__.hotel), `alpha${version}`);
          assert.deepEqual(await page.evaluate(() => __HOTEL_TEST__.writes), []);
        } finally { await context.close(); }
      });
    }

    await t.test('an unavailable updated router blocks old cached application code from running', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      try {
        await page.goto(server.origin + '/__boot/prime');
        server.controls.oldHotelRouter = true;
        await page.evaluate(async path => (await fetch(path, { cache: 'reload' })).text(), LEGACY_HOTEL_ROUTER);
        server.controls.oldHotelRouter = false;
        server.controls.failHotelRouterRefresh = true;
        await page.goto(`${server.origin}/r1-alpha75/index.html`);
        await assert.rejects(awaitBoot(page, 75), /No se pudo cargar la actualización de Hotel/);
        assert.match(await page.locator('#login-message').textContent(), /actualización de Hotel/);
        assert.equal(await page.evaluate(() => globalThis.__BOOT_STALE_HOTEL_ROUTER__), undefined);
        assert.equal(await page.evaluate(() => globalThis.__HOTEL_TEST__), undefined);
      } finally { server.controls.failHotelRouterRefresh = false; await context.close(); }
    });
    assert.deepEqual(server.failures, []);
    assert.deepEqual(external, []);
    t.diagnostic(`Browser ${browser.version()}; full public build; synthetic authenticated transport; HTTP cache enabled.`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
