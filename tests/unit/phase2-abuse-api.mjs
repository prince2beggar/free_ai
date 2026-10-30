import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createAbuseServer } from '../../tools/phase2/abuse.mjs';

async function fixture(t, abuseOptions = {}) {
  const app = await createAbuseServer({
    fixtureOptions: { abuseOptions: { challengeDifficulty: 4, ...abuseOptions } },
  });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  function client() {
    const cookies = new Map();
    let csrf = '';
    return {
      cookies,
      async call(path, method = 'GET', value, key, extra = {}) {
        const response = await fetch(base + path, {
          method,
          headers: {
            Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
            ...(method === 'GET'
              ? {}
              : { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
            ...(key ? { 'Idempotency-Key': key } : {}),
            ...extra,
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
      async proof(purpose = 'signup') {
        const r = await this.call('/api/abuse/challenges', 'POST', { purpose });
        assert.equal(r.response.status, 200, r.text);
        const c = r.json.challenge;
        assert.equal(c.syntheticOnly, true);
        assert.equal(c.humanVerification, false);
        for (let n = 0; n < 1048576; n++) {
          const digest = createHash('sha256')
            .update(c.nonce + ':' + n)
            .digest();
          let valid = true;
          for (let bit = 0; bit < c.difficulty; bit++)
            if ((digest[Math.floor(bit / 8)] >> (7 - (bit % 8))) & 1) {
              valid = false;
              break;
            }
          if (valid) return { id: c.id, solution: String(n) };
        }
        throw new Error('Bounded synthetic proof search exhausted.');
      },
      async login(identity = 'demo-alpha') {
        const b = await this.call('/api/bootstrap');
        assert.equal(b.json.abuseEnabled, true);
        const challenge = await this.proof();
        const r = await this.call('/api/auth/local', 'POST', {
          identity,
          acceptedLegalVersion: b.json.legalVersion,
          challenge,
        });
        assert.equal(r.response.status, 200, r.text);
      },
      async conversation() {
        return (
          await this.call('/api/conversations', 'POST', { title: 'Synthetic abuse HTTP check' })
        ).json.conversation.id;
      },
      send(id, { key = randomUUID(), challenge, content = 'Synthetic only' } = {}) {
        return this.call(
          '/api/conversations/' + id + '/messages',
          'POST',
          {
            content,
            language: 'en',
            routing: { mode: 'auto' },
            ...(challenge ? { challenge } : {}),
          },
          key,
        );
      },
    };
  }
  return { ...app, client };
}

test('protected local sign-in needs a one-use source-bound proof and does not create a session on refusal', async (t) => {
  const f = await fixture(t),
    a = f.client(),
    b = f.client();
  const bootstrap = await a.call('/api/bootstrap');
  await b.call('/api/bootstrap');
  const input = { identity: 'demo-alpha', acceptedLegalVersion: bootstrap.json.legalVersion };
  assert.equal((await a.call('/api/auth/local', 'POST', input)).response.status, 429);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, 0);
  const proof = await a.proof();
  assert.equal(
    (await b.call('/api/auth/local', 'POST', { ...input, challenge: proof })).response.status,
    403,
  );
  assert.equal(
    (await a.call('/api/auth/local', 'POST', { ...input, challenge: proof })).response.status,
    200,
  );
  const replay = await a.call('/api/auth/local', 'POST', { ...input, challenge: proof });
  assert.equal(replay.response.status, 403);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, 1);
});

test('caller source/trust overrides and forged device cookies cannot bypass enabled HTTP admission', async (t) => {
  const f = await fixture(t, { burstChallengeAfter: 100 }),
    c = f.client();
  await c.login();
  const id = await c.conversation();
  const payload = { content: 'Synthetic only', language: 'en', routing: { mode: 'auto' } };
  for (const field of ['userId', 'trustLevel', 'deviceToken', 'ipAddress']) {
    const r = await c.call(
      '/api/conversations/' + id + '/messages',
      'POST',
      { ...payload, [field]: 'override' },
      randomUUID(),
    );
    assert.equal(r.response.status, 400, field);
  }
  c.cookies.set('local_device', 'a'.repeat(87));
  assert.equal((await c.send(id)).response.status, 403);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM chat_requests')).rows[0].n, 0);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n, 0);
});

test('one admitted HTTP key consumes one request allowance and completed replay makes no new attempt', async (t) => {
  const f = await fixture(t, { burstChallengeAfter: 100 }),
    c = f.client();
  await c.login();
  const id = await c.conversation(),
    key = randomUUID();
  assert.equal((await c.send(id, { key })).response.status, 200);
  const before = (await c.call('/api/abuse/status')).json.abuse;
  assert.equal(before.trustLevel, 0);
  assert.equal((await c.send(id, { key })).response.status, 200);
  const after = (await c.call('/api/abuse/status')).json.abuse;
  assert.deepEqual(after.usage, before.usage);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n, 1);
});

test('shared socket IP cap applies across browsers despite forwarded-IP overrides and rolls back chat admission', async (t) => {
  const f = await fixture(t, { burstChallengeAfter: 100, newAccountIpRequests: 1 }),
    a = f.client(),
    b = f.client();
  await a.login();
  await b.login('demo-beta');
  const first = await a.conversation(),
    second = await b.conversation();
  assert.equal((await a.send(first)).response.status, 200);
  const refused = await b.call(
    '/api/conversations/' + second + '/messages',
    'POST',
    {
      content: 'Synthetic only',
      language: 'en',
      routing: { mode: 'auto' },
    },
    randomUUID(),
    { 'X-Forwarded-For': '203.0.113.123' },
  );
  assert.equal(refused.response.status, 429, refused.text);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM chat_requests')).rows[0].n, 1);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n, 1);
});

test('suspicious burst requires fresh proof before a new owned request and leaves pending counters unchanged', async (t) => {
  const f = await fixture(t),
    c = f.client();
  await c.login();
  const id = await c.conversation();
  assert.equal((await c.send(id)).response.status, 200);
  const refused = await c.send(id);
  assert.equal(refused.response.status, 429, refused.text);
  assert.equal(refused.json.error.code, 'ABUSE_CHALLENGE_REQUIRED');
  assert.equal(refused.json.error.challengeRequired, true);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM chat_requests')).rows[0].n, 1);
  const proof = await c.proof('burst');
  assert.equal((await c.send(id, { challenge: proof })).response.status, 200);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n, 2);
  const status = (await c.call('/api/abuse/status')).json.abuse;
  assert.equal(status.trustLevel, 0);
  assert.equal(status.challenge.humanVerification, false);
});
