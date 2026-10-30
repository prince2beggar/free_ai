import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhase1Server } from '../../tools/phase1/server.mjs';

test('structured request logs correlate safe errors without recording URLs, headers or bodies', async (t) => {
  const records = [];
  const app = await createPhase1Server({ logger: (record) => records.push(record) });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const privateMarker = 'synthetic-private-query-and-header';
  const response = await fetch(base + '/api/auth/google/callback?code=' + privateMarker, {
    headers: { Authorization: 'Bearer ' + privateMarker, 'X-Request-ID': privateMarker },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  const id = response.headers.get('x-request-id');
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(body.error.requestId, id);
  assert.equal(records.length, 1);
  assert.equal(records[0].requestId, id);
  assert.equal(records[0].surface, 'google_callback');
  assert.equal(records[0].status, 400);
  assert.ok(!JSON.stringify(records).includes(privateMarker));
  assert.deepEqual(Object.keys(records[0]).sort(), [
    'durationMs',
    'event',
    'method',
    'requestId',
    'status',
    'surface',
  ]);
});
