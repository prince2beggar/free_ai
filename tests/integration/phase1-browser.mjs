import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createPhase1Server } from '../../tools/phase1/server.mjs';

async function signIn(page, identity) {
  await page.waitForSelector('#login-panel:not([hidden])');
  await page.locator('#accept-legal').check();
  await page.locator('#login-' + identity).click();
  await page.waitForSelector('#message:not(:disabled)');
}
async function waitForSaved(page) {
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('saved'),
  );
  await page.waitForSelector('#message:not(:disabled)');
}
test(
  'local Phase 1 browser: real session isolation, persistence, safe SSE, limits UI, mobile and deletion',
  { timeout: 90000 },
  async () => {
    const app = await createPhase1Server();
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      const base = 'http://127.0.0.1:' + app.server.address().port;
      const channel =
        process.env.PHASE1_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
      browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
      const alpha = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'reduce',
      });
      const beta = await browser.newContext({
        viewport: { width: 360, height: 800 },
        reducedMotion: 'reduce',
      });
      const external = [];
      const errors = [];
      for (const context of [alpha, beta]) {
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
        context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
      }
      const a = await alpha.newPage();
      const b = await beta.newPage();
      await a.goto(base);
      await a.waitForSelector('#login-panel:not([hidden])');
      assert.equal(await a.locator('#google-signin').isVisible(), false);
      assert.equal(await a.locator('#login-alpha').isDisabled(), true);
      await signIn(a, 'alpha');
      const cookies = await alpha.cookies();
      const session = cookies.find((cookie) => cookie.name === 'local_session');
      assert.ok(session);
      assert.equal(session.httpOnly, true);
      assert.equal(session.sameSite, 'Lax');
      assert.equal(session.secure, false); // Explicit HTTP-loopback-only exception.
      const hostile = '<img src="https://evil.example/collect" onerror="window.stolen=true">';
      await a.locator('#message').fill(hostile);
      await a.locator('#message').press('Shift+Enter');
      assert.ok((await a.locator('#message').inputValue()).includes('\n'));
      assert.equal(await a.locator('.message').count(), 0);
      await a.locator('#message').fill(hostile);
      await a.locator('#message').press('Enter');
      await waitForSaved(a);
      assert.equal(await a.locator('.user .message-body').textContent(), hostile);
      assert.equal(await a.locator('#messages img').count(), 0);
      assert.equal(await a.evaluate(() => window.stolen), undefined);
      assert.match(
        await a.locator('.assistant .message-meta').textContent(),
        /synthetic-provider.*synthetic-chat-v1.*Estimated synthetic tokens/,
      );
      const alphaId = await a
        .locator('.conversation-link')
        .first()
        .getAttribute('data-conversation-id');
      await a.locator('#rename-chat').click();
      await a.locator('#title-input').fill('Alpha saved example');
      await a.locator('#dialog-confirm').click();
      await a.waitForFunction(
        () => document.querySelector('#conversation-title')?.textContent === 'Alpha saved example',
      );
      // Hold saved history so readiness cannot pass by winning a fast network race.
      const historyUrl = base + '/api/conversations/' + alphaId;
      let releaseHistory;
      const historyGate = new Promise((resolve) => {
        releaseHistory = resolve;
      });
      await a.route(historyUrl, async (route) => {
        await historyGate;
        await route.continue();
      });
      const historyRequest = a.waitForRequest(historyUrl);
      try {
        await a.reload();
        await historyRequest;
        assert.equal(await a.locator('#message').isDisabled(), true);
        assert.equal(await a.locator('#new-chat').isDisabled(), true);
      } finally {
        releaseHistory();
      }
      await a.waitForSelector('#message:not(:disabled)');
      await a.unroute(historyUrl);
      assert.equal(await a.locator('.message').count(), 2);
      assert.equal(await a.locator('#conversation-title').textContent(), 'Alpha saved example');
      assert.equal(await a.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await mkdir('.tools/phase1-preview', { recursive: true });
      await a.screenshot({ path: '.tools/phase1-preview/desktop.png', fullPage: true });

      await b.goto(base);
      await signIn(b, 'beta');
      assert.equal(await b.locator('.conversation-link').count(), 0);
      const forbidden = await b.evaluate(async (id) => {
        const response = await fetch('/api/conversations/' + encodeURIComponent(id));
        return { status: response.status, text: await response.text() };
      }, alphaId);
      assert.equal(forbidden.status, 404);
      assert.ok(!forbidden.text.includes(hostile));
      await b.getByRole('button', { name: 'বাংলা', exact: true }).click();
      assert.equal(await b.locator('#message').getAttribute('lang'), 'bn');
      await b.locator('.prompt-card').first().click();
      await b.locator('#message').press('Enter');
      await b.waitForSelector('#stop:not([hidden])');
      await b.waitForFunction(
        () => (document.querySelector('.assistant .message-body')?.textContent?.length ?? 0) > 0,
      );
      await b.locator('#stop').click();
      await b.waitForSelector('#message:not(:disabled)');
      assert.match(await b.locator('#status').textContent(), /বন্ধ/);
      assert.match(await b.locator('.assistant .message-meta').textContent(), /Stopped/);
      const stopped = await b.locator('.assistant .message-body').textContent();
      await b.waitForTimeout(100);
      assert.equal(await b.locator('.assistant .message-body').textContent(), stopped);
      assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await b.screenshot({ path: '.tools/phase1-preview/mobile.png', fullPage: true });
      await b.locator('.account-panel summary').click();
      assert.match(
        await b.locator('#usage-details').textContent(),
        /Requests today: 1.*Estimated synthetic tokens/,
      );

      await b.getByRole('button', { name: 'English', exact: true }).click();
      await beta.route(
        '**/api/conversations/*/messages',
        (route) =>
          route.fulfill({
            status: 429,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'DAILY_LIMIT', message: 'Local daily limit reached. Wait for reset.' },
            }),
          }),
        { times: 1 },
      );
      await b.locator('#message').fill('synthetic error-state example');
      await b.locator('#send').click();
      await b.waitForFunction(() =>
        document.querySelector('#status')?.textContent?.includes('Local daily limit reached'),
      );
      assert.equal(await b.locator('#status').getAttribute('data-error'), 'true');
      await b.locator('#message').fill('A second synthetic sample');
      await b.locator('#message').press('Enter');
      await waitForSaved(b);
      assert.match(
        await b.locator('.assistant .message-meta').last().textContent(),
        /Estimated synthetic tokens/,
      );

      await a.locator('#logout').click();
      await a.waitForSelector('#login-panel:not([hidden])');
      await signIn(a, 'alpha');
      assert.equal(await a.locator('#conversation-title').textContent(), 'Alpha saved example');
      const shadow = await browser.newContext();
      const shadowPage = await shadow.newPage();
      await shadowPage.goto(base);
      await signIn(shadowPage, 'alpha');
      await a.locator('.account-panel summary').click();
      await a.locator('#delete-account').click();
      await a.locator('#dialog-confirm').click();
      await a.waitForSelector('#login-panel:not([hidden])');
      assert.match(await a.locator('#status').textContent(), /deleted/);
      const revoked = await shadowPage.evaluate(async () => (await fetch('/api/account')).status);
      assert.equal(revoked, 401);
      await shadow.close();
      await b.reload();
      await b.waitForSelector('#message:not(:disabled)');
      assert.equal(await b.locator('.conversation-link').count(), 1);
      assert.ok((await b.locator('.message').count()) >= 4);
      await b.locator('#delete-chat').click();
      await b.locator('#dialog-confirm').click();
      await b.waitForFunction(() => document.querySelectorAll('.conversation-link').length === 0);
      assert.equal(await b.locator('.message').count(), 0);

      for (const name of ['terms', 'privacy', 'aup', 'cookies', 'refunds']) {
        const response = await beta.request.get(base + '/legal/' + name + '.html');
        assert.equal(response.status(), 200);
        const html = await response.text();
        assert.match(html, /NEEDS LEGAL REVIEW/);
        assert.match(html, /Version local-draft-v2/);
        assert.ok(!html.includes('<script'));
        assert.ok(!html.includes('https://'));
      }
      await b.goto(base + '/legal/privacy.html');
      assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.match(await b.locator('body').textContent(), /No timed purge/);
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
    } finally {
      if (browser) await browser.close();
      await app.close();
    }
  },
);
