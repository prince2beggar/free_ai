import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { readConfig, createPreviewServer } from '../../tools/prototype/server.mjs';

test('environment refuses external bindings, real modes and invalid ports', () => {
  assert.deepEqual(readConfig({}), { host: '127.0.0.1', port: 4173, mode: 'synthetic' });
  for (const env of [
    { PROTOTYPE_HOST: '0.0.0.0' },
    { PROTOTYPE_MODE: 'live' },
    { PROTOTYPE_PORT: '1e3' },
    { PROTOTYPE_PORT: '65536' },
  ]) {
    assert.throws(() => readConfig(env));
  }
});

test('preview serves only allowlisted assets and rejects foreign Host/Origin and write methods', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const request = (path, headers = {}, method = 'GET') =>
      new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path, headers, method }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () =>
            resolve({ status: response.statusCode, headers: response.headers, body }),
          );
        });
        req.on('error', reject);
        req.end();
      });
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.body, /synthetic|Synthetic/);
    assert.match(home.headers['content-security-policy'], /connect-src 'self'/);
    assert.equal(home.headers['cache-control'], 'no-store');
    for (const path of [
      '/.env',
      '/package.json',
      '/../../.env',
      '/%2e%2e/.env',
      '/api/chat',
      '/favicon.ico?../../.env',
    ]) {
      assert.equal((await request(path)).status, 404, path);
    }
    assert.equal((await request('/', { Host: 'evil.example' })).status, 421);
    assert.equal((await request('/', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/', {}, 'POST')).status, 405);
    const head = await request('/', {}, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
