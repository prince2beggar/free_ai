import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createDatabase, migrateUp, seedSynthetic } from '../../packages/db/index.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createApp } from '../../packages/api/server.mjs';

function usage() {
  return {
    syntheticOnly: true,
    unit: 'tokens',
    entitlements: [
      {
        id: 'synthetic-free',
        kind: 'free',
        status: 'active',
        startsAt: '2026-10-13T00:00:00Z',
        endsAt: '2026-10-13T02:00:00Z',
        timeLeftSeconds: 7200,
        remaining: { costMicroCu: '999111', inputTokens: '9007199254740993', outputTokens: '2000' },
        spent: { costMicroCu: '17', inputTokens: '40', outputTokens: '10' },
        estimated: false,
        pendingReconciliation: true,
        refusalReason: null,
      },
      {
        id: 'synthetic-pack',
        kind: 'pack',
        status: 'expired',
        startsAt: '2026-10-12T00:00:00Z',
        endsAt: '2026-10-13T00:00:00Z',
        timeLeftSeconds: 0,
        remaining: { costMicroCu: '0', inputTokens: '0', outputTokens: '0' },
        spent: { costMicroCu: '100', inputTokens: '30', outputTokens: '20' },
        estimated: false,
        refusalReason: '<img src="https://invalid.example/leak">',
      },
    ],
  };
}
test(
  'usage browser shows free/pack tokens, time, estimates and safe refusal text at desktop/mobile widths',
  { timeout: 45000 },
  async (t) => {
    let summary = usage();
    const ledger = { usage: async () => summary, history: async () => [] };
    const db = await createDatabase();
    await migrateUp(db);
    await seedSynthetic(db);
    const config = await loadConfig(
      {},
      {
        port: 0,
        webRoot: fileURLToPath(new URL('../../apps/web/dist/', import.meta.url)),
        limits: { chunkDelayMs: 0 },
      },
    );
    const server = createApp({ db, config, ledger });
    t.after(async () => {
      await server.shutdown();
      await db.close();
    });
    await server.ready;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const channel =
      process.env.PHASE1_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
    const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    t.after(() => browser.close());
    const context = await browser.newContext();
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
    await page.goto(base);
    await page.locator('#accept-legal').check();
    await page.locator('#login-alpha').click();
    await page.waitForSelector('#message:not(:disabled)');
    await page.locator('.account-panel summary').click();
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      const text = await page.locator('#usage-details').textContent();
      assert.match(text, /Free tokens.*9,007,199,254,740,993 input.*2,000 output/);
      assert.match(text, /Pack tokens.*0 input.*0 output/);
      assert.match(text, /Time left: 2 hours/);
      assert.match(text, /Time left: expired/);
      assert.match(text, /Awaiting usage reconciliation/);
      assert.match(text, /Refusal: <img src=/);
      assert.doesNotMatch(text, /999111|costMicroCu|\bCU\b|credits/i);
      assert.equal(await page.locator('#usage-details img').count(), 0);
      const box = await page.locator('#usage-details').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width);
    }
    assert.deepEqual(external, []);
    summary.entitlements[0].estimated = true;
    summary.entitlements[0].pendingReconciliation = false;
    await page.reload();
    await page.waitForSelector('#message:not(:disabled)');
    assert.match(await page.locator('#usage-details').textContent(), /Estimated usage/);
    summary = { syntheticOnly: true, unit: 'tokens', entitlements: [] };
    await page.reload();
    await page.waitForSelector('#message:not(:disabled)');
    assert.match(
      await page.locator('#usage-details').textContent(),
      /No free or pack token allowance/,
    );
    assert.deepEqual(errors, []);
  },
);
