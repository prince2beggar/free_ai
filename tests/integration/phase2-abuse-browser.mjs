import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createAbuseServer } from '../../tools/phase2/abuse.mjs';
import { createPhase1Server } from '../../tools/phase1/server.mjs';

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
  await page.waitForSelector('#login-panel:not([hidden])');
  return { page, base, context };
}

async function verify(page) {
  await page.locator('#abuse-verify').click();
  await page.waitForFunction(() =>
    document.querySelector('#abuse-verification-status')?.textContent?.includes('work completed'),
  );
}
async function signIn(page) {
  await page.locator('#accept-legal').check();
  await verify(page);
  await page.locator('#login-alpha').click();
  await page.waitForSelector('#message:not(:disabled)');
}
async function saved(page) {
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('saved'),
  );
  await page.waitForSelector('#message:not(:disabled)');
}

test(
  'synthetic signup requires explicit local work and shows owned trust/limits at mobile width',
  { timeout: 60000 },
  async (t) => {
    let now = Date.now();
    const app = await createAbuseServer({ fixtureOptions: { clock: () => now } });
    const { page, base } = await browserPage(t, app, { width: 360, height: 800 });
    assert.equal(await page.locator('#abuse-verification').isVisible(), true);
    assert.match(
      await page.locator('#abuse-verification').textContent(),
      /does\s+not\s+verify\s+a\s+human/,
    );
    assert.equal(await page.locator('#abuse-verify').isDisabled(), true);
    await page.locator('#accept-legal').check();
    assert.equal(await page.locator('#login-alpha').isDisabled(), true);
    const outgoing = page.waitForRequest(
      (request) => request.url().endsWith('/api/auth/local') && request.method() === 'POST',
    );
    const mint = page.waitForResponse((response) =>
      response.url().endsWith('/api/abuse/challenges'),
    );
    await verify(page);
    const { challenge } = await (await mint).json();
    assert.equal(await page.locator('#login-panel').isVisible(), true);
    assert.equal(await page.locator('#login-alpha').isEnabled(), true);
    now = new Date(challenge.expiresAt).getTime() + 1;
    await page.locator('#login-alpha').click();
    const body = (await outgoing).postDataJSON();
    assert.equal(body.identity, 'demo-alpha');
    assert.deepEqual(Object.keys(body.challenge).sort(), ['id', 'solution']);
    assert.match(body.challenge.solution, /^\d{1,10}$/);
    await page.waitForSelector('#status[data-error="true"]');
    assert.equal(await page.locator('#login-panel').isVisible(), true);
    assert.equal(await page.locator('#login-alpha').isDisabled(), true);
    await verify(page);
    const renewed = page.waitForRequest((request) => request.url().endsWith('/api/auth/local'));
    await page.locator('#login-alpha').click();
    assert.notEqual((await renewed).postDataJSON().challenge.id, body.challenge.id);
    await page.waitForSelector('#message:not(:disabled)');
    assert.equal(await page.locator('#abuse-verification').isVisible(), false);
    await page.locator('.account-panel summary').click();
    const response = await page.request.get(base + '/api/abuse/status');
    assert.equal(response.status(), 200);
    const { abuse } = await response.json();
    const details = await page.locator('#abuse-details').textContent();
    assert.match(details, new RegExp('Trust level ' + abuse.trustLevel));
    assert.ok(details.includes(' / ' + abuse.limits.dailyRequests));
    assert.match(details, /New-account source caps:.*per device.*per network range.*Reset:/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
      { local: 0, session: 0 },
    );
    await page.reload();
    await page.waitForSelector('#message:not(:disabled)');
    assert.equal(await page.locator('#abuse-verification').isVisible(), false);
    await page.locator('#logout').click();
    await page.waitForSelector('#login-panel:not([hidden])');
    assert.equal(await page.locator('#abuse-verification').isVisible(), true);
    assert.equal(await page.locator('#login-alpha').isDisabled(), true);
    assert.equal(await page.locator('#login-beta').isDisabled(), true);
  },
);

test(
  'burst challenge keeps the message, waits for explicit retry and displays cap reset',
  { timeout: 90000 },
  async (t) => {
    let now = Date.now();
    const app = await createAbuseServer({ fixtureOptions: { clock: () => now } });
    const { page, base } = await browserPage(t, app);
    await signIn(page);
    const messageRequests = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/messages') && request.method() === 'POST')
        messageRequests.push(request.postDataJSON());
    });
    await page.locator('#message').fill('First synthetic request before burst challenge');
    await page.locator('#send').click();
    await saved(page);
    const content = '<img src="https://evil.example/challenge" onerror="window.stolen=true">';
    await page.locator('#message').fill(content);
    await page.locator('#send').click();
    await page.waitForSelector('#status[data-error="true"]');
    await page.waitForSelector('#message:not(:disabled)');
    assert.equal(await page.locator('#message').inputValue(), content);
    assert.equal(await page.locator('#abuse-verification').isVisible(), true);
    assert.equal(messageRequests.length, 2);
    await verify(page);
    assert.equal(messageRequests.length, 2);
    assert.equal(await page.locator('#message').inputValue(), content);
    await page.locator('#send').click();
    await saved(page);
    assert.equal(messageRequests.length, 3);
    assert.deepEqual(Object.keys(messageRequests[2].challenge).sort(), ['id', 'solution']);
    assert.match(messageRequests[2].challenge.solution, /^\d{1,10}$/);
    assert.equal(await page.locator('.user .message-body').last().textContent(), content);
    assert.equal(await page.locator('#messages img').count(), 0);
    assert.equal(await page.evaluate(() => window.stolen), undefined);
    const status = await (await page.request.get(base + '/api/abuse/status')).json();
    const burstLimit = status.abuse.limits.burstRequests;
    assert.equal(status.abuse.usage.burstRequests, burstLimit);
    const capped = 'Synthetic request over the burst cap';
    await page.locator('#message').fill(capped);
    await verify(page);
    assert.equal(messageRequests.length, 3);
    await page.locator('#send').click();
    await page.waitForSelector('#status[data-error="true"]');
    await page.waitForSelector('#message:not(:disabled)');
    assert.match(await page.locator('#status').textContent(), /Reset:/);
    assert.equal(await page.locator('#message').inputValue(), capped);
    assert.equal(messageRequests.length, 4);
    now += status.abuse.limits.burstWindowMs + 1;
    await page.locator('#send').click();
    await saved(page);
    assert.equal(messageRequests.length, 5);
    assert.equal(await page.locator('.user .message-body').last().textContent(), capped);
  },
);

test(
  'abuse-disabled Phase 1 keeps its sign-in and message contracts',
  { timeout: 45000 },
  async (t) => {
    const app = await createPhase1Server();
    const { page } = await browserPage(t, app, { width: 360, height: 800 });
    assert.equal(await page.locator('#abuse-verification').isVisible(), false);
    await page.locator('#accept-legal').check();
    assert.equal(await page.locator('#login-alpha').isEnabled(), true);
    const login = page.waitForRequest((request) => request.url().endsWith('/api/auth/local'));
    await page.locator('#login-alpha').click();
    assert.equal(Object.hasOwn((await login).postDataJSON(), 'challenge'), false);
    await page.waitForSelector('#message:not(:disabled)');
    const outgoing = page.waitForRequest(
      (request) => request.url().endsWith('/messages') && request.method() === 'POST',
    );
    await page.locator('#message').fill('Synthetic unchanged Phase 1 request');
    await page.locator('#send').click();
    assert.deepEqual((await outgoing).postDataJSON(), {
      content: 'Synthetic unchanged Phase 1 request',
      language: 'en',
    });
    await saved(page);
    assert.equal(await page.locator('#abuse-details').isVisible(), false);
  },
);
