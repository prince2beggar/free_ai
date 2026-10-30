import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createPreviewServer } from '../../tools/prototype/server.mjs';

test(
  'desktop/mobile synthetic chat: keyboard, Bangla, stop/reset, safe text and local requests',
  { timeout: 45000 },
  async () => {
    const server = createPreviewServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      browser = await chromium.launch({ channel: 'msedge', headless: true });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'reduce',
      });
      const unexpectedRequests = [];
      await context.route('**/*', (route) => {
        if (
          !route
            .request()
            .url()
            .startsWith(base + '/')
        ) {
          unexpectedRequests.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base);
      await page.waitForSelector('#message:not(:disabled)');
      assert.equal(await page.getByText('Synthetic demo', { exact: true }).count(), 1);
      await mkdir('.tools/prototype-preview', { recursive: true });
      await page.screenshot({ path: '.tools/prototype-preview/desktop.png', fullPage: true });
      await page.locator('#message').fill('demo');
      await page.locator('#message').press('Shift+Enter');
      assert.ok((await page.locator('#message').inputValue()).includes('\n'));
      assert.equal(await page.locator('.message').count(), 0);
      const hostile = '<img src="https://evil.example/collect" onerror="window.stolen=true">';
      await page.locator('#message').fill(hostile);
      await page.locator('#message').press('Enter');
      await page.waitForFunction(() =>
        document
          .querySelector('.assistant .message-body')
          ?.textContent?.includes('does not analyze your message'),
      );
      assert.equal(await page.locator('.user .message-body').textContent(), hostile);
      assert.equal(await page.locator('#messages img').count(), 0);
      assert.equal(await page.evaluate(() => window.stolen), undefined);
      await page.getByRole('button', { name: 'New chat', exact: false }).click();
      assert.equal(await page.locator('.message').count(), 0);
      await page.locator('#message').fill('study');
      await page.getByRole('button', { name: 'Send demo message' }).click();
      await page.waitForSelector('#stop:not([hidden])');
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      const stopped = await page.locator('.assistant .message-body').textContent();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.assistant .message-body').textContent(), stopped);
      assert.match(await page.locator('#status').textContent(), /stopped/);
      await page.getByRole('button', { name: 'New chat', exact: false }).click();
      await page.setViewportSize({ width: 360, height: 800 });
      await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
      assert.equal(
        await page.getByRole('button', { name: 'বাংলা', exact: true }).getAttribute('aria-pressed'),
        'true',
      );
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      await page.locator('.prompt-card').first().click();
      await page.locator('#message').press('Enter');
      await page.waitForFunction(() =>
        document
          .querySelector('.assistant .message-body')
          ?.textContent?.includes('বিশ্লেষণ করা হয়নি'),
      );
      assert.match(await page.locator('.assistant .message-label').textContent(), /নমুনা/);
      await page.screenshot({ path: '.tools/prototype-preview/mobile.png', fullPage: true });
      await page.reload();
      await page.waitForSelector('#message:not(:disabled)');
      assert.equal(await page.locator('.message').count(), 0);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.deepEqual(unexpectedRequests, []);
      assert.deepEqual(errors, []);
    } finally {
      if (browser) await browser.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
