import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createPhase1Server } from '../../tools/phase1/server.mjs';
import { createRouterServer } from '../../tools/phase2/router.mjs';
import { routerFixture } from '../../tools/phase2/router-fixture.mjs';
import { AppError } from '../../packages/api/errors.mjs';

async function browserPage(t, app, viewport = { width: 1440, height: 1000 }) {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const channel =
    process.env.PHASE1_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const external = [];
  await context.route('**/*', (route) => {
    if (
      !route
        .request()
        .url()
        .startsWith(base + '/')
    ) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => {
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
  });
  await page.goto(base);
  await page.locator('#accept-legal').check();
  await page.locator('#login-alpha').click();
  await page.waitForSelector('#message:not(:disabled)');
  return page;
}

async function saved(page) {
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('saved'),
  );
  await page.waitForSelector('#message:not(:disabled)');
}
test(
  'Router model/preset controls, saved attempts and regenerate budget work at mobile width',
  { timeout: 60000 },
  async (t) => {
    const app = await createRouterServer();
    const page = await browserPage(t, app, { width: 360, height: 800 });
    await page.locator('#model-choice').selectOption('model:' + app.paidModel);
    await page.locator('#task-preset').selectOption('writing');
    await page.locator('#message').fill('Synthetic selected writing request');
    await page.locator('#send').click();
    await saved(page);
    assert.equal(await page.locator('.response-attempts section').count(), 1);
    assert.match(
      await page.locator('.assistant .response-attempts').textContent(),
      new RegExp(app.paidModel),
    );
    const regenerate = page.locator('[data-response-action="regenerate"]').first();
    assert.equal(await regenerate.isEnabled(), true);
    await regenerate.click();
    await page.waitForFunction(
      () => document.querySelectorAll('.response-attempts section').length === 2,
    );
    await saved(page);
    assert.equal(await page.locator('[data-response-action="regenerate"]:enabled').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  },
);
test(
  'manual preoutput failure shows separate real fallback attempts and model-change banner',
  { timeout: 60000 },
  async (t) => {
    let calls = 0;
    const m = routerFixture.models[0];
    const app = await createRouterServer({
      fixtureOptions: {
        gatewayOverrides: {
          [m.id]: {
            synthetic: true,
            providerId: routerFixture.provider.id,
            modelId: m.id,
            health: () => ({ synthetic: true }),
            async *stream() {
              calls++;
              throw new AppError(503, 'SIMULATED_FAILURE', 'Synthetic failure.');
            },
          },
        },
      },
    });
    const page = await browserPage(t, app);
    await page.locator('#model-choice').selectOption('model:' + app.modelA);
    await page.locator('#message').fill('Synthetic preferred model fallback');
    await page.locator('#send').click();
    await saved(page);
    assert.equal(calls, 2);
    assert.equal(await page.locator('.response-attempts section').count(), 3);
    assert.match(
      await page.locator('.assistant .response-attempts').textContent(),
      new RegExp(app.modelB),
    );
    assert.match(await page.locator('.assistant').textContent(), /different|instead|changed/i);
    assert.equal(await page.locator('[data-response-action="regenerate"]:enabled').count(), 0);
  },
);
test(
  'partial synthetic reply is saved as one attempt without automatic fallback',
  { timeout: 60000 },
  async (t) => {
    let calls = 0;
    const m = routerFixture.models[0];
    const app = await createRouterServer({
      fixtureOptions: {
        gatewayOverrides: {
          [m.id]: {
            synthetic: true,
            providerId: routerFixture.provider.id,
            modelId: m.id,
            health: () => ({ synthetic: true }),
            async *stream() {
              calls++;
              yield { text: 'Visible partial synthetic reply' };
              throw new AppError(503, 'SIMULATED_FAILURE', 'Synthetic failure.');
            },
          },
        },
      },
    });
    const page = await browserPage(t, app);
    await page.locator('#message').fill('Synthetic partial response');
    await page.locator('#send').click();
    await page.waitForSelector('#message:not(:disabled)');
    await page.waitForFunction(() =>
      document
        .querySelector('.assistant .response-attempts')
        ?.textContent?.includes('Visible partial synthetic reply'),
    );
    assert.equal(calls, 1);
    assert.equal(await page.locator('.response-attempts section').count(), 1);
    assert.equal(await page.locator('[data-response-action="retry"]').isEnabled(), true);
  },
);

test(
  'routing-disabled browser preserves Phase 1 controls and request contract',
  { timeout: 45000 },
  async (t) => {
    const app = await createPhase1Server();
    const page = await browserPage(t, app, { width: 360, height: 800 });
    assert.equal(await page.locator('#routing-controls').count(), 0);
    const outgoing = page.waitForRequest(
      (request) => request.url().endsWith('/messages') && request.method() === 'POST',
    );
    await page.locator('#message').fill('Synthetic routing-disabled regression');
    await page.locator('#send').click();
    const request = await outgoing;
    assert.deepEqual(request.postDataJSON(), {
      content: 'Synthetic routing-disabled regression',
      language: 'en',
    });
    assert.match(request.headers()['idempotency-key'], /^[0-9a-f-]{36}$/);
    await saved(page);
    assert.equal(await page.locator('[data-response-action]').count(), 0);
    assert.equal(await page.locator('.response-attempts section').count(), 0);
    assert.equal(await page.locator('.assistant > .message-body').isVisible(), true);
    assert.match(
      await page.locator('.assistant > .message-meta').textContent(),
      /synthetic-chat-v1/,
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  },
);
