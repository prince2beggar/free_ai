import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRouterServer } from '../../tools/phase2/router.mjs';
import { routerFixture } from '../../tools/phase2/router-fixture.mjs';
import { AppError } from '../../packages/api/errors.mjs';
async function fixture(t, fixtureOptions = {}) {
  const app = await createRouterServer({ fixtureOptions });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  function client() {
    const cookies = new Map();
    let csrf = '';
    return {
      async call(path, method = 'GET', value, key) {
        const response = await fetch(base + path, {
          method,
          headers: {
            Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
            ...(method === 'GET'
              ? {}
              : { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          ...(value === undefined ? {} : { body: JSON.stringify(value) }),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const [k, v] = cookie.split(';')[0].split('=');
          if (v) cookies.set(k, v);
          else cookies.delete(k);
        }
        const text = await response.text();
        const json = text.startsWith('{') ? JSON.parse(text) : null;
        if (json?.csrfToken) csrf = json.csrfToken;
        return { response, text, json };
      },
      async login(identity = 'demo-alpha') {
        const b = await this.call('/api/bootstrap');
        assert.equal(
          (
            await this.call('/api/auth/local', 'POST', {
              identity,
              acceptedLegalVersion: b.json.legalVersion,
            })
          ).response.status,
          200,
        );
      },
      async conversation() {
        return (await this.call('/api/conversations', 'POST', { title: 'Synthetic Router test' }))
          .json.conversation.id;
      },
      send(id, routing = {}, content = 'Hello', key = randomUUID()) {
        return this.call(
          '/api/conversations/' + id + '/messages',
          'POST',
          { content, language: 'en', routing },
          key,
        );
      },
    };
  }
  return { ...app, client };
}
function events(text, name) {
  return text.split('\n\n').flatMap((part) => {
    const lines = part.split('\n');
    return lines[0] === 'event: ' + name ? [JSON.parse(lines[1].slice(6))] : [];
  });
}
test('routed HTTP response, owned history and ledger agree on chosen model and exact synthetic paid spend', async (t) => {
  const f = await fixture(t),
    c = f.client();
  await c.login();
  const id = await c.conversation();
  assert.equal((await c.call('/api/bootstrap')).json.routingEnabled, true);
  const models = (await c.call('/api/models/available')).json;
  assert.equal(models.models.length, 3);
  const r = await c.send(id, {
    mode: 'manual',
    modelId: f.paidModel,
    preset: 'writing',
    contextAction: 'trim',
  });
  assert.equal(r.response.status, 200, r.text);
  assert.equal(events(r.text, 'attempt')[0].modelId, f.paidModel);
  const done = events(r.text, 'done')[0];
  assert.equal(done.message.modelId, f.paidModel);
  const history = (await c.call('/api/conversations/' + id)).json.messages;
  const answer = history.at(-1);
  assert.equal(answer.attempts.length, 1);
  assert.ok(answer.sourceMessageId);
  assert.equal(answer.requestId, done.requestId);
  assert.equal(answer.regenerateAllowed, true);
  const costs = (await f.db.query('SELECT cost_micro_cu::text AS cost FROM usage_events')).rows;
  assert.equal(BigInt(costs[0].cost) > 0n, true);
});
test('direct HTTP auth, scope overrides and unfunded paid selection cannot bypass router admission', async (t) => {
  const f = await fixture(t),
    a = f.client(),
    b = f.client();
  assert.equal((await a.call('/api/models/available')).response.status, 401);
  await a.login();
  await b.login('demo-beta');
  const id = await a.conversation();
  assert.equal((await b.send(id)).response.status, 404);
  const bid = await b.conversation();
  assert.equal((await b.send(bid, { mode: 'manual', modelId: f.paidModel })).response.status, 503);
  assert.equal((await a.send(id, { userId: 'synthetic-user-b' })).response.status, 400);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_attempts')).rows[0].n, 0);
});
test('HTTP semantic replay is one charged request and regenerate consumes durable retry budget', async (t) => {
  const f = await fixture(t),
    c = f.client();
  await c.login();
  const id = await c.conversation(),
    key = randomUUID();
  const first = await c.send(id, {}, 'Hello', key),
    requestId = events(first.text, 'done')[0].requestId;
  assert.equal((await c.send(id, {}, 'Hello', key)).response.status, 200);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n, 1);
  const retry = await c.send(id, { action: 'regenerate', retryOf: requestId });
  assert.equal(events(retry.text, 'done')[0].message.retryBudgetRemaining, 0);
  const refused = await c.send(id, { action: 'retry', retryOf: requestId });
  assert.equal(refused.response.status, 409);
  assert.equal(refused.json.error.code, 'RETRY_BUDGET');
});
test('HTTP preoutput retry/fallback has separate persisted attempt boundaries', async (t) => {
  let calls = 0;
  const m = routerFixture.models[0];
  const f = await fixture(t, {
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
    }),
    c = f.client();
  await c.login();
  const id = await c.conversation(),
    r = await c.send(id, { mode: 'free-only' });
  assert.equal(calls, 2);
  assert.deepEqual(
    events(r.text, 'attempt').map((a) => a.modelId),
    [f.modelA, f.modelA, f.modelB],
  );
  const done = events(r.text, 'done')[0];
  assert.equal(done.message.attempts.length, 3);
  assert.equal(done.message.modelId, f.modelB);
  assert.equal(done.message.retryBudgetRemaining, 0);
});
test('HTTP partial failure persists one attempt and never resends automatically', async (t) => {
  let calls = 0;
  const m = routerFixture.models[0];
  const f = await fixture(t, {
      gatewayOverrides: {
        [m.id]: {
          synthetic: true,
          providerId: routerFixture.provider.id,
          modelId: m.id,
          health: () => ({ synthetic: true }),
          async *stream() {
            calls++;
            yield { text: 'partial synthetic reply' };
            throw new AppError(503, 'SIMULATED_FAILURE', 'Synthetic failure.');
          },
        },
      },
    }),
    c = f.client();
  await c.login();
  const id = await c.conversation(),
    r = await c.send(id);
  assert.equal(calls, 1);
  assert.equal(events(r.text, 'attempt').length, 1);
  assert.equal(events(r.text, 'error').length, 1);
  const saved = (await c.call('/api/conversations/' + id)).json.messages.at(-1);
  assert.equal(saved.content, 'partial synthetic reply');
  assert.equal(saved.status, 'failed');
  assert.equal(saved.retryAllowed, true);
  assert.equal(
    (await f.db.query('SELECT state FROM ledger_reservations')).rows[0].state,
    'PENDING_RECONCILIATION',
  );
});
test('HTTP long history trims bounded old turns and preserves provider provenance without context overflow', async (t) => {
  const f = await fixture(t),
    c = f.client();
  await c.login();
  const id = await c.conversation();
  for (let i = 0; i < 48; i++)
    await f.db.query(
      "INSERT INTO messages(id,user_id,conversation_id,role,content) VALUES($1,'synthetic-user-a',$2,'user',$3)",
      [randomUUID(), id, 'synthetic history '.repeat(60)],
    );
  const r = await c.send(
    id,
    { mode: 'manual', modelId: f.paidModel, contextAction: 'trim' },
    'Newest user turn',
  );
  assert.equal(r.response.status, 200, r.text);
  assert.equal(
    events(r.text, 'context').some((x) => x.removedMessages > 0),
    true,
  );
  assert.equal(events(r.text, 'done').length, 1);
  const saved = (await c.call('/api/conversations/' + id)).json.messages;
  assert.equal(saved.at(-2).content, 'Newest user turn');
  assert.equal(saved.at(-1).contextTrimmed, true);
});
