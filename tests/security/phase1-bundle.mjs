import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createPhase1Server } from '../../tools/phase1/server.mjs';

test('T1.3 client bundle has no server modules, credential configuration or dynamic execution', async () => {
  const root = new URL('../../apps/web/dist/', import.meta.url);
  const names = (await readdir(root)).filter((name) => /\.(js|html|css|json)$/.test(name));
  assert.ok(names.includes('phase1.js') && names.includes('api.js'));
  for (const name of names) {
    const content = await readFile(new URL(name, root), 'utf8');
    assert.doesNotMatch(
      content,
      /GOOGLE_CLIENT_SECRET|LITELLM_MASTER_KEY|PROVIDER_NAME_API_KEY|PRIVATE KEY-----|node_modules\/jose|packages\/api\/auth|process\.env/,
    );
    if (name.endsWith('.js'))
      assert.doesNotMatch(content, /\b(?:eval|Function)\s*\(|\.innerHTML\s*=/);
  }
});

test('T1.2/T1.3 local staging keeps every private route and server/data file protected', async () => {
  const app = await createPhase1Server();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (const path of [
      '/api/account',
      '/api/usage',
      '/api/conversations',
      '/api/conversations/synthetic-user-a',
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 401, path);
    }
    for (const path of [
      '/.env',
      '/package.json',
      '/node_modules/jose/package.json',
      '/.phase1-local/database',
      '/packages/api/auth.mjs',
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, path);
      assert.doesNotMatch(
        await response.text(),
        /client_secret|PRIVATE KEY|D:\\free_ai|file:\/\//i,
      );
    }
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.doesNotMatch(await health.text(), /secret|api.key|database.path/i);
  } finally {
    await app.close();
  }
});
