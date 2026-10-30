import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createAdminServer } from '../../tools/phase2/admin.mjs';

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
  });
  return { page, base, context };
}

test(
  'AP-01 & T2.7 browser verification: separate admin interface scope and 403 on user session',
  { timeout: 60000 },
  async (t) => {
    const app = await createAdminServer();
    const { page, base } = await browserPage(t, app);

    // 1. Anonymous visitor to /admin receives Control Center status
    const adminResponse = await page.goto(base + '/admin');
    assert.equal(adminResponse.status(), 200);
    const adminBody = await adminResponse.json();
    assert.equal(adminBody.module, 'admin_control_center');
    assert.equal(adminBody.mfaRequired, true);

    // 2. Visit main web chat app at / and sign in as demo-beta
    await page.goto(base);
    await page.waitForSelector('#login-panel:not([hidden])');
    await page.locator('#accept-legal').check();
    await page.locator('#abuse-verify').click();
    await page.waitForFunction(() =>
      document.querySelector('#abuse-verification-status')?.textContent?.includes('work completed'),
    );
    await page.locator('#login-beta').click();
    await page.waitForSelector('#message:not(:disabled)');

    // 3. User session navigates to /admin -> server strictly returns 403 ADMIN_FORBIDDEN (AP-01)
    const forbiddenResponse = await page.goto(base + '/admin');
    assert.equal(forbiddenResponse.status(), 403);
    const forbiddenBody = await forbiddenResponse.json();
    assert.equal(forbiddenBody.error.code, 'ADMIN_FORBIDDEN');
  },
);
