import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { createGoogleOAuth, newToken } from '../../packages/api/auth.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { createRepository } from '../../packages/api/repository.mjs';

async function fixture(t, limits = {}, gateway) {
  const db = await createDatabase();
  await migrateUp(db);
  await seedSynthetic(db);
  const config = await loadConfig({}, { port: 0, limits: { chunkDelayMs: 0, ...limits } });
  const server = createApp({ db, config, gateway });
  await server.ready;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await server.shutdown();
    await db.close();
  });
  function client() {
    const cookies = new Map();
    return {
      csrf: '',
      cookies,
      async request(path, { method = 'GET', value, headers = {}, raw } = {}) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            Cookie: [...cookies].map(([key, val]) => `${key}=${val}`).join('; '),
            ...(method !== 'GET'
              ? { Origin: base, 'X-CSRF-Token': this.csrf, 'Content-Type': 'application/json' }
              : {}),
            ...headers,
          },
          ...(method !== 'GET' && method !== 'DELETE'
            ? { body: raw ?? JSON.stringify(value ?? {}) }
            : {}),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const [name, val] = cookie.split(';')[0].split('=');
          if (val) cookies.set(name, val);
          else cookies.delete(name);
        }
        return response;
      },
      async json(path, options) {
        const response = await this.request(path, options);
        const value = await response.json();
        if (value.csrfToken) this.csrf = value.csrfToken;
        return { response, value };
      },
      async signIn(identity = 'demo-alpha') {
        const bootstrap = await this.json('/api/bootstrap');
        const login = await this.json('/api/auth/local', {
          method: 'POST',
          value: { identity, acceptedLegalVersion: bootstrap.value.legalVersion },
        });
        assert.equal(login.response.status, 200);
        return login;
      },
      async conversation() {
        const result = await this.json('/api/conversations', {
          method: 'POST',
          value: { title: 'Synthetic test' },
        });
        assert.equal(result.response.status, 201);
        return result.value.conversation.id;
      },
      async send(
        id,
        { content = 'A synthetic message', language = 'en', key = randomUUID(), modelId } = {},
      ) {
        return this.request(`/api/conversations/${id}/messages`, {
          method: 'POST',
          value: { content, language, ...(modelId ? { modelId } : {}) },
          headers: { 'Idempotency-Key': key },
        });
      },
    };
  }
  return { db, config, base, client };
}
function events(text) {
  return text
    .trim()
    .split('\n\n')
    .map((block) => {
      const name = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return { name, value: JSON.parse(data) };
    });
}

function historyGateway(captured) {
  let turn = 0;
  return {
    providerId: SYNTHETIC_SEED.provider,
    modelId: SYNTHETIC_SEED.model,
    synthetic: true,
    health: () => ({ status: 'ok', mode: 'synthetic_mock', retries: 0 }),
    async *stream({ messages }) {
      captured.push(structuredClone(messages));
      yield { text: `Synthetic reply ${++turn}` };
    },
  };
}

async function equalTimestampHistory(f, c, id) {
  for (const content of ['Synthetic turn one', 'Synthetic turn two']) {
    const response = await c.send(id, { content });
    assert.equal(response.status, 200);
    await response.text();
  }
  const rows = (
    await f.db.query('SELECT id FROM messages WHERE conversation_id=$1 ORDER BY sequence_no', [id])
  ).rows;
  for (let index = 0; index < rows.length; index++) {
    await f.db.query("UPDATE messages SET id=$2,created_at='2026-10-13T00:00:00Z' WHERE id=$1", [
      rows[index].id,
      `ordering-${String(100 - index).padStart(3, '0')}`,
    ]);
  }
}

test('message ordering preserves multiple reopened turns when timestamps and UUID sort disagree', async (t) => {
  const f = await fixture(t, {}, historyGateway([]));
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  await equalTimestampHistory(f, c, id);
  const result = await c.json(`/api/conversations/${id}`);
  assert.deepEqual(
    result.value.messages.map(({ role, content }) => ({ role, content })),
    [
      { role: 'user', content: 'Synthetic turn one' },
      { role: 'assistant', content: 'Synthetic reply 1' },
      { role: 'user', content: 'Synthetic turn two' },
      { role: 'assistant', content: 'Synthetic reply 2' },
    ],
  );
});

test('gateway history preserves chronological user-assistant pairs across equal timestamps', async (t) => {
  const captured = [];
  const f = await fixture(t, {}, historyGateway(captured));
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  await equalTimestampHistory(f, c, id);
  const response = await c.send(id, { content: 'Synthetic turn three' });
  assert.equal(response.status, 200);
  await response.text();
  assert.deepEqual(captured[2], [
    { role: 'user', content: 'Synthetic turn one' },
    { role: 'assistant', content: 'Synthetic reply 1' },
    { role: 'user', content: 'Synthetic turn two' },
    { role: 'assistant', content: 'Synthetic reply 2' },
    { role: 'user', content: 'Synthetic turn three' },
  ]);
});

test('health is safe, private endpoints require login, and integrations stay disabled', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  const health = await c.json('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.value.externalProvidersEnabled, false);
  assert.equal(health.value.gateway.retries, 0);
  assert.equal((await c.json('/api/account')).response.status, 401);
  assert.equal((await c.json('/api/conversations')).response.status, 401);
  const disabled = await c.json('/api/auth/google/start', { method: 'POST', value: {} });
  assert.equal(disabled.response.status, 403);
  assert.equal(disabled.value.error.code, 'AUTH_DISABLED');
  assert.doesNotMatch(JSON.stringify(health.value), /secret|token_hash|client_secret|api_key/i);
});

test('synthetic login stores hashed tokens, accepted legal version and trust level zero', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  const login = await c.signIn();
  assert.equal(login.value.user.trustLevel, 0);
  for (const cookie of login.response.headers.getSetCookie()) {
    assert.match(cookie, /HttpOnly; SameSite=Lax/);
    assert.match(cookie, /Max-Age=3600/);
  }
  const record = (await f.db.query('SELECT token_hash,csrf_hash FROM sessions')).rows[0];
  assert.notEqual(record.token_hash, c.cookies.get('local_session'));
  assert.notEqual(record.csrf_hash, c.csrf);
  const user = (
    await f.db.query('SELECT legal_version,email FROM users WHERE id=$1', [SYNTHETIC_SEED.userA])
  ).rows[0];
  assert.equal(user.legal_version, SYNTHETIC_SEED.legalVersion);
  assert.equal(user.email, null);
  assert.equal((await c.json('/api/bootstrap')).value.authenticated, true);
});

test('CSRF/origin forgery is rejected and logout revokes replayed sessions', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.signIn();
  const forged = await c.json('/api/conversations', {
    method: 'POST',
    value: { title: 'bad' },
    headers: { 'X-CSRF-Token': 'forged-value' },
  });
  assert.equal(forged.response.status, 403);
  const crossOrigin = await c.json('/api/conversations', {
    method: 'POST',
    value: { title: 'bad' },
    headers: { Origin: 'https://attacker.invalid' },
  });
  assert.equal(crossOrigin.response.status, 403);
  const old = new Map(c.cookies);
  assert.equal((await c.json('/api/auth/logout', { method: 'POST' })).response.status, 200);
  c.cookies.clear();
  for (const [key, val] of old) c.cookies.set(key, val);
  assert.equal((await c.json('/api/account')).response.status, 401);
});

test('expired sessions fail without exposing token or database internals', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.signIn();
  await f.db.query(
    "UPDATE sessions SET created_at=CURRENT_TIMESTAMP-INTERVAL '2 hours',expires_at=CURRENT_TIMESTAMP-INTERVAL '1 hour'",
  );
  const result = await c.json('/api/account');
  assert.equal(result.response.status, 401);
  assert.doesNotMatch(JSON.stringify(result.value), /stack|token_hash|SELECT/);
});

test('conversation and message IDOR checks protect every CRUD route', async (t) => {
  const f = await fixture(t);
  const a = f.client();
  const b = f.client();
  await a.signIn();
  await b.signIn('demo-beta');
  const id = await a.conversation();
  for (const options of [
    {},
    { method: 'PATCH', value: { title: 'stolen' } },
    { method: 'DELETE' },
  ]) {
    assert.equal((await b.json(`/api/conversations/${id}`, options)).response.status, 404);
  }
  assert.equal((await b.send(id)).status, 404);
  const rename = await a.json(`/api/conversations/${id}`, {
    method: 'PATCH',
    value: { title: 'Renamed synthetic chat' },
  });
  assert.equal(rename.value.conversation.title, 'Renamed synthetic chat');
  assert.equal((await a.json(`/api/conversations/${id}`)).response.status, 200);
  assert.equal((await b.json('/api/conversations')).value.conversations.length, 0);
});

test('SSE progressively streams mock output and persists exact synthetic provenance and estimates', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  const prompt = 'A private synthetic prompt marker';
  const response = await c.send(id, { content: prompt });
  assert.equal(response.status, 200);
  const stream = events(await response.text());
  assert.equal(stream[0].name, 'meta');
  assert.equal(stream[0].value.synthetic, true);
  assert.equal(stream[0].value.providerId, SYNTHETIC_SEED.provider);
  assert.equal(stream[0].value.modelId, SYNTHETIC_SEED.model);
  assert.ok(stream.filter((item) => item.name === 'chunk').length > 1);
  const done = stream.at(-1).value;
  assert.equal(done.usage.usageKind, 'synthetic_estimate');
  assert.equal(done.usage.inputTokens, Array.from(prompt).length);
  assert.equal(done.usage.outputTokens, Array.from(done.message.content).length);
  const routed = (await f.db.query('SELECT * FROM routing_records')).rows[0];
  assert.equal(routed.run_kind, 'synthetic_mock');
  assert.equal(routed.model_id, SYNTHETIC_SEED.model);
  assert.equal(routed.external_model, SYNTHETIC_SEED.model);
  const usage = (await f.db.query('SELECT * FROM usage_events')).rows[0];
  assert.equal(usage.cost_micro_cu, 0);
  assert.equal(usage.estimated, true);
  assert.doesNotMatch(
    JSON.stringify((await f.db.query('SELECT * FROM audit_events')).rows),
    /private synthetic prompt marker/,
  );
  const reopened = await c.json(`/api/conversations/${id}`);
  assert.equal(reopened.value.messages.length, 2);
  assert.equal(
    reopened.value.messages.find((message) => message.role === 'assistant').providerId,
    SYNTHETIC_SEED.provider,
  );
});

test('idempotent replay does not add calls, usage or messages and conflicting reuse fails', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  const key = randomUUID();
  await (await c.send(id, { key })).text();
  const replay = events(await (await c.send(id, { key })).text());
  assert.equal(replay.at(-1).value.replay, true);
  assert.equal(replay.filter((item) => item.name === 'chunk').length, 0);
  assert.equal((await c.send(id, { key, content: 'Different synthetic message' })).status, 409);
  assert.equal(
    Number((await f.db.query('SELECT COUNT(*) AS count FROM usage_events')).rows[0].count),
    1,
  );
  assert.equal(
    Number((await f.db.query('SELECT COUNT(*) AS count FROM messages')).rows[0].count),
    2,
  );
});

test('daily request admission survives deleting a conversation and direct API use cannot bypass it', async (t) => {
  const f = await fixture(t, { dailyRequests: 1 });
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  await (await c.send(id)).text();
  assert.equal(
    (await c.json(`/api/conversations/${id}`, { method: 'DELETE' })).response.status,
    200,
  );
  const next = await c.conversation();
  const refused = await c.send(next);
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).error.code, 'DAILY_LIMIT');
  assert.equal((await c.json('/api/account')).value.usage.requestsToday, 1);
});

test('input/body/model/context/output bounds are enforced server-side', async (t) => {
  const f = await fixture(t, {
    maxInputChars: 80,
    maxContextChars: 100,
    maxOutputTokens: 20,
    maxBodyBytes: 256,
  });
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  assert.equal((await c.send(id, { content: 'x'.repeat(81) })).status, 400);
  assert.equal((await c.send(id, { modelId: 'unapproved-model' })).status, 400);
  const large = await c.request(`/api/conversations/${id}/messages`, {
    method: 'POST',
    raw: JSON.stringify({ content: 'x'.repeat(300), language: 'en' }),
    headers: { 'Idempotency-Key': randomUUID() },
  });
  assert.equal(large.status, 413);
  const stream = events(await (await c.send(id, { content: 'x'.repeat(70) })).text());
  assert.equal(stream.at(-1).value.message.outputTokens, 20);
  const context = await c.send(id, { content: 'x'.repeat(20) });
  assert.equal(context.status, 413);
  assert.equal((await context.json()).error.code, 'CONTEXT_LIMIT');
});

test('IP/endpoint limits cannot be bypassed with forwarded IP headers or a new account', async (t) => {
  const f = await fixture(t, { endpointRequestsPerWindow: 2, ipRequestsPerWindow: 100 });
  const c = f.client();
  assert.equal((await c.json('/api/bootstrap')).response.status, 200);
  assert.equal((await c.json('/api/bootstrap')).response.status, 200);
  const result = await c.json('/api/bootstrap', { headers: { 'X-Forwarded-For': '203.0.113.45' } });
  assert.equal(result.response.status, 429);
  assert.equal(result.value.error.code, 'RATE_LIMIT');
});

test('concurrency admission is atomic and explicit cancellation persists partial status', async (t) => {
  const f = await fixture(t, { chunkDelayMs: 100 });
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  const response = await c.send(id);
  const reader = response.body.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  const requestId = events(initial)[0].value.requestId;
  assert.equal((await c.send(id)).status, 429);
  const foreign = f.client();
  await foreign.signIn('demo-beta');
  assert.equal(
    (await foreign.json(`/api/requests/${requestId}/cancel`, { method: 'POST' })).response.status,
    404,
  );
  const cancelled = await c.json(`/api/requests/${requestId}/cancel`, { method: 'POST' });
  assert.equal(cancelled.value.status, 'cancelled');
  await reader.cancel();
  const reopened = (await c.json(`/api/conversations/${id}`)).value;
  assert.equal(
    reopened.messages.find((message) => message.role === 'assistant').status,
    'cancelled',
  );
  assert.equal((await c.json('/api/account')).value.usage.requestsToday, 1);
});

test('provider errors are normalized without secrets and dispatch is never retried', async (t) => {
  let calls = 0;
  const gateway = {
    providerId: SYNTHETIC_SEED.provider,
    modelId: SYNTHETIC_SEED.model,
    synthetic: true,
    health: () => ({ status: 'ok', mode: 'synthetic_mock', retries: 0 }),
    async *stream() {
      calls++;
      throw new Error('sensitive upstream credential marker');
    },
  };
  const f = await fixture(t, {}, gateway);
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  const text = await (await c.send(id)).text();
  assert.doesNotMatch(text, /sensitive upstream|Error:|stack/);
  assert.equal(events(text).at(-1).value.code, 'SERVICE_UNAVAILABLE');
  assert.equal(calls, 1);
  assert.equal((await f.db.query('SELECT outcome FROM usage_events')).rows[0].outcome, 'failed');
});

test('request timeout also stops an uncooperative injected gateway', async (t) => {
  const gateway = {
    providerId: SYNTHETIC_SEED.provider,
    modelId: SYNTHETIC_SEED.model,
    synthetic: true,
    health: () => ({ status: 'ok', mode: 'synthetic_mock', retries: 0 }),
    async *stream() {
      await new Promise(() => undefined);
      yield { text: 'never' };
    },
  };
  const f = await fixture(t, { requestTimeoutMs: 100 }, gateway);
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  const result = events(await (await c.send(id)).text());
  assert.equal(result.at(-1).value.code, 'REQUEST_TIMEOUT');
  assert.equal((await f.db.query('SELECT status FROM chat_requests')).rows[0].status, 'failed');
});

test('account deletion removes owned content and sessions and retains only minimal metadata', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  await (await c.send(id, { content: 'A removable private synthetic marker' })).text();
  const result = await c.json('/api/account/deletion', { method: 'POST' });
  assert.equal(result.value.deleted, true);
  assert.equal((await c.json('/api/account')).response.status, 401);
  for (const table of [
    'messages',
    'conversations',
    'routing_records',
    'chat_requests',
    'sessions',
  ]) {
    assert.equal(
      Number(
        (
          await f.db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=$1`, [
            SYNTHETIC_SEED.userA,
          ])
        ).rows[0].count,
      ),
      0,
    );
  }
  const user = (await f.db.query('SELECT * FROM users WHERE id=$1', [SYNTHETIC_SEED.userA]))
    .rows[0];
  assert.equal(user.status, 'deleted');
  assert.equal(user.email, null);
  assert.equal(user.google_sub, null);
  assert.equal(user.display_name, 'Deleted local account');
  assert.doesNotMatch(
    JSON.stringify((await f.db.query('SELECT * FROM audit_events')).rows),
    /removable private synthetic marker/,
  );
  assert.equal(
    (await f.db.query('SELECT status FROM deletion_requests')).rows[0].status,
    'complete',
  );
});

test('client disconnect cancels persisted work and releases the active request slot', async (t) => {
  const f = await fixture(t, { chunkDelayMs: 100 });
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  const response = await c.send(id);
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  let status;
  for (let index = 0; index < 30; index++) {
    status = (await f.db.query('SELECT status FROM chat_requests')).rows[0].status;
    if (status === 'cancelled') break;
    await delay(20);
  }
  assert.equal(status, 'cancelled');
  assert.equal((await f.db.query('SELECT outcome FROM usage_events')).rows[0].outcome, 'cancelled');
});

test('global concurrency and simultaneous daily admission apply across users and calls', async (t) => {
  const f = await fixture(t, { globalConcurrency: 1, dailyRequests: 1, chunkDelayMs: 100 });
  const a = f.client();
  const b = f.client();
  await a.signIn();
  await b.signIn('demo-beta');
  const aId = await a.conversation();
  const bId = await b.conversation();
  const [one, two] = await Promise.all([a.send(aId), a.send(aId)]);
  assert.deepEqual([one.status, two.status].sort(), [200, 429]);
  const admitted = one.status === 200 ? one : two;
  const busy = await b.send(bId);
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).error.code, 'CONCURRENCY_LIMIT');
  await admitted.body.cancel();
});

test('admission/deletion race guards preserve pending usage and tombstones cannot create chats', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.signIn();
  const id = await c.conversation();
  const repository = createRepository(f.db, f.config);
  const registry = await repository.registry();
  const admission = await repository.admit({
    userId: SYNTHETIC_SEED.userA,
    conversationId: id,
    key: randomUUID(),
    requestHash: 'synthetic-race-hash',
    content: 'Synthetic race fixture',
    registry,
  });
  await assert.rejects(repository.deleteConversation(SYNTHETIC_SEED.userA, id), {
    code: 'REQUEST_IN_PROGRESS',
  });
  await assert.rejects(repository.deleteAccount(SYNTHETIC_SEED.userA), {
    code: 'REQUEST_IN_PROGRESS',
  });
  await repository.finish({
    userId: SYNTHETIC_SEED.userA,
    requestId: admission.requestId,
    content: '',
    status: 'cancelled',
    latencyMs: 0,
  });
  await repository.deleteAccount(SYNTHETIC_SEED.userA);
  await assert.rejects(
    repository.createConversation(SYNTHETIC_SEED.userA, 'Invalid tombstone chat'),
    { code: 'ACCOUNT_UNAVAILABLE' },
  );
  assert.equal(
    Number((await f.db.query('SELECT COUNT(*) AS count FROM usage_events')).rows[0].count),
    1,
  );
});

test('OAuth state is browser-bound, expiring and one-use; code exchange validates a signed nonce', async (t) => {
  const f = await fixture(t);
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...pair.publicKey.export({ format: 'jwk' }),
    kid: 'mock-key',
    alg: 'RS256',
    use: 'sig',
  };
  let calls = 0;
  let subject = 'synthetic-google-sub';
  const settings = {
    enabled: true,
    clientId: 'synthetic-client',
    clientSecret: randomUUID(),
    redirectUri: 'https://example.invalid/callback',
    stateSeconds: 300,
    timeoutMs: 2000,
    legalVersion: SYNTHETIC_SEED.legalVersion,
  };
  const oauth = createGoogleOAuth({
    db: f.db,
    settings,
    transport: async (url, options) => {
      calls++;
      assert.equal(options.redirect, 'error');
      if (url === 'https://oauth2.googleapis.com/token') {
        assert.equal(new URLSearchParams(options.body).get('code_verifier').length, 43);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'mock-key' })).toString(
          'base64url',
        );
        const now = Math.floor(Date.now() / 1000);
        const payload = Buffer.from(
          JSON.stringify({
            iss: 'https://accounts.google.com',
            aud: settings.clientId,
            sub: subject,
            nonce: currentNonce,
            iat: now,
            exp: now + 300,
            email_verified: true,
          }),
        ).toString('base64url');
        const signature = sign(
          'RSA-SHA256',
          Buffer.from(`${header}.${payload}`),
          pair.privateKey,
        ).toString('base64url');
        return Response.json({
          access_token: 'synthetic-opaque-access',
          token_type: 'Bearer',
          expires_in: 300,
          id_token: `${header}.${payload}.${signature}`,
        });
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/certs')
        return Response.json({ keys: [jwk] });
      assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
      return Response.json({
        sub: subject,
        email_verified: true,
        name: 'Synthetic Google identity',
      });
    },
  });
  const browserToken = newToken();
  const start = await oauth.start({
    browserToken,
    acceptedLegalVersion: SYNTHETIC_SEED.legalVersion,
  });
  const url = new URL(start.authorizationUrl);
  const currentNonce = url.searchParams.get('nonce');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const state = url.searchParams.get('state');
  await assert.rejects(oauth.complete({ state, code: 'mock-code', browserToken: newToken() }));
  assert.equal(calls, 0);
  const user = await oauth.complete({ state, code: 'mock-code', browserToken });
  assert.equal(user.trust_level, 0);
  assert.equal(user.identity_provider, 'google');
  assert.equal(user.email, null);
  assert.equal(calls, 3);
  await assert.rejects(oauth.complete({ state, code: 'mock-code', browserToken }));
  assert.equal(calls, 3);
  subject = 'expired-synthetic-google-sub';
  const expired = await oauth.start({
    browserToken,
    acceptedLegalVersion: SYNTHETIC_SEED.legalVersion,
  });
  await f.db.query(
    "UPDATE oauth_states SET created_at=CURRENT_TIMESTAMP-INTERVAL '2 hours',expires_at=CURRENT_TIMESTAMP-INTERVAL '1 hour'",
  );
  await assert.rejects(
    oauth.complete({
      state: new URL(expired.authorizationUrl).searchParams.get('state'),
      code: 'mock-code',
      browserToken,
    }),
  );
  assert.equal(calls, 3);
});
