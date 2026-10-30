import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createDatabase, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createAbuseServer } from '../../tools/phase2/abuse.mjs';
import { routerFixture } from '../../tools/phase2/router-fixture.mjs';
import { AppError } from '../../packages/api/errors.mjs';

const A = SYNTHETIC_SEED.userA;
function solve(c) {
  for (let n = 0; n < 1048576; n++) {
    const d = createHash('sha256')
      .update(c.nonce + ':' + n)
      .digest();
    if (
      Array.from({ length: c.difficulty }, (_, b) => d[Math.floor(b / 8)] & (128 >> (b % 8))).every(
        (v) => v === 0,
      )
    )
      return { id: c.id, solution: String(n) };
  }
  throw new Error('Bounded synthetic proof search exhausted.');
}
async function fixture(t, options = {}, suppliedDb) {
  const f = await createAbuseServer({
    db: suppliedDb,
    fixtureOptions: {
      ...options,
      abuseOptions: { challengeDifficulty: 4, burstChallengeAfter: 100, ...options.abuseOptions },
    },
  });
  t.after(() => f.close());
  await new Promise((resolve) => f.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + f.server.address().port;
  const cookies = new Map();
  let csrf = '';
  async function call(path, method = 'GET', value, key) {
    const r = await fetch(base + path, {
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
    for (const c of r.headers.getSetCookie()) {
      const [k, v] = c.split(';')[0].split('=');
      if (v) cookies.set(k, v);
      else cookies.delete(k);
    }
    const text = await r.text(),
      json = text.startsWith('{') ? JSON.parse(text) : null;
    if (json?.csrfToken) csrf = json.csrfToken;
    return { status: r.status, text, json };
  }
  const b = await call('/api/bootstrap');
  const challenge = (await call('/api/abuse/challenges', 'POST', { purpose: 'signup' })).json
    .challenge;
  assert.equal(
    (
      await call('/api/auth/local', 'POST', {
        identity: 'demo-alpha',
        acceptedLegalVersion: b.json.legalVersion,
        challenge: solve(challenge),
      })
    ).status,
    200,
  );
  const id = (await call('/api/conversations', 'POST', { title: 'Synthetic boundary check' })).json
    .conversation.id;
  return {
    ...f,
    call,
    id,
    send: (routing = {}, content = 'Hello') =>
      call(
        '/api/conversations/' + id + '/messages',
        'POST',
        { content, language: 'en', routing },
        randomUUID(),
      ),
  };
}
function gateways(stream) {
  return Object.fromEntries(
    routerFixture.models.map((m) => [
      m.id,
      {
        synthetic: true,
        providerId: routerFixture.provider.id,
        modelId: m.id,
        health: () => ({ synthetic: true }),
        stream,
      },
    ]),
  );
}

for (const scenario of [
  { name: 'minute reset', start: '2026-10-14T00:00:59.900Z', advance: 200 },
  { name: 'reservation TTL', start: '2026-10-14T00:00:01.000Z', advance: 30000 },
]) {
  test(
    'outer abuse guard write crossing ' +
      scenario.name +
      ' rolls back funded/capacity dispatch and calls no transport',
    async (t) => {
      const db = await createDatabase();
      t.after(() => db.close());
      let time = Date.parse(scenario.start),
        armed = false,
        marked = false,
        calls = 0;
      const observed = {
        ...db,
        transaction: (body) =>
          db.transaction((tx) =>
            body({
              ...tx,
              query: async (sql, args) => {
                const value = await tx.query(sql, args);
                if (armed && sql.startsWith('INSERT INTO router_attempts')) marked = true;
                if (armed && marked && sql.startsWith('UPDATE abuse_storage_guard')) {
                  time += scenario.advance;
                  armed = false;
                }
                return value;
              },
            }),
          ),
      };
      const f = await fixture(
        t,
        {
          clock: () => time,
          gatewayOverrides: gateways(async function* () {
            calls++;
            yield { text: 'x' };
          }),
        },
        observed,
      );
      armed = true;
      const response = await f.send({ mode: 'manual', modelId: f.paidModel });
      assert.equal(calls, 0, response.text);
      for (const table of ['router_attempts', 'ledger_reservations', 'capacity_reservations'])
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM ' + table)).rows[0].n,
          0,
          table,
        );
      assert.equal((await f.abuse.status(A)).usage.dailyRequests, 1);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM abuse_daily_token_counters')).rows[0].n,
        0,
      );
    },
  );
}

test('cumulative paid synthetic usage obeys current trust token cap and all-route holds settle once', async (t) => {
  const levels = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile(new URL('../../packages/abuse/defaults.json', import.meta.url), 'utf8'),
  ).trustLevels.map((v, i) => ({
    ...v,
    dailyRequests: 100 + i * 100,
    burstRequests: 100 + i,
    dailyTokens: 250 * (i + 1),
  }));
  let calls = 0;
  const f = await fixture(t, {
    abuseOptions: { trustLevels: levels, newAccountDeviceRequests: 100, newAccountIpRequests: 200 },
    gatewayOverrides: gateways(async function* () {
      calls++;
      yield { text: 'x' };
    }),
  });
  const first = await f.send({ mode: 'manual', modelId: f.paidModel });
  assert.equal(calls, 1, first.text);
  let last;
  for (let i = 0; i < 5; i++) {
    last = await f.send({ mode: 'manual', modelId: f.paidModel });
    if (last.text.includes('ABUSE_TOKEN_LIMIT')) break;
  }
  assert.match(last.text, /ABUSE_TOKEN_LIMIT/);
  const counter = (
    await f.db.query(
      'SELECT used_tokens::text AS used,reserved_tokens::text AS reserved FROM abuse_daily_token_counters WHERE user_id=$1',
      [A],
    )
  ).rows[0];
  assert(BigInt(counter.used) > 0n && BigInt(counter.used) <= 250n);
  assert.equal(counter.reserved, '0');
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n,
    calls,
  );
});

test('ban after partial output closes uncertainty, recovers without resending, estimates and corrects captured paid tokens', async (t) => {
  let calls = 0,
    time = Date.now();
  const f = await fixture(t, {
    clock: () => time,
    gatewayOverrides: gateways(async function* () {
      calls++;
      yield { text: 'partial' };
      await f.abuse.moderate(f.staff, {
        targetId: A,
        action: 'ban',
        until: null,
        reason: 'ACCOUNT_ABUSE',
        idempotencyKey: 'boundary-ban',
      });
      throw new AppError(503, 'SYNTHETIC_FAILURE', 'Synthetic failure.');
    }),
  });
  const r = await f.send({ mode: 'manual', modelId: f.paidModel });
  assert.equal(r.status, 200);
  assert.equal(calls, 1);
  for (const table of [
    'router_attempts',
    'router_accounting_holds',
    'ledger_reservations',
    'capacity_reservations',
  ])
    assert.equal(
      (await f.db.query('SELECT state FROM ' + table)).rows[0].state,
      'PENDING_RECONCILIATION',
      table,
    );
  assert.notEqual((await f.db.query('SELECT state FROM router_requests')).rows[0].state, 'RUNNING');
  await f.router.recover();
  assert.equal(calls, 1);
  time += 60000;
  await f.router.sweep();
  const a = (await f.db.query('SELECT attempt_id FROM router_accounting_holds')).rows[0];
  await f.router.reconcile(f.staff, {
    attemptId: a.attempt_id,
    inputTokens: '3',
    outputTokens: '1',
    idempotencyKey: 'boundary-paid-correction',
  });
  const counter = (
    await f.db.query(
      'SELECT used_tokens::text AS used,reserved_tokens::text AS reserved FROM abuse_daily_token_counters WHERE user_id=$1',
      [A],
    )
  ).rows[0];
  assert.equal(counter.used, '4');
  assert.equal(counter.reserved, '0');
});

test('expired suspension restores a valid session through HTTP while permanent ban stays unavailable', async (t) => {
  let time = Date.now();
  const f = await fixture(t, { clock: () => time });
  await f.abuse.moderate(f.staff, {
    targetId: A,
    action: 'suspend',
    until: new Date(time + 1000).toISOString(),
    reason: 'ACCOUNT_ABUSE',
    idempotencyKey: 'boundary-suspend',
  });
  assert.equal((await f.call('/api/abuse/status')).status, 401);
  time += 2000;
  const b = await f.call('/api/bootstrap');
  assert.equal(b.json.authenticated, true);
  assert.equal((await f.call('/api/abuse/status')).status, 200);
  await f.abuse.moderate(f.staff, {
    targetId: A,
    action: 'ban',
    until: null,
    reason: 'ACCOUNT_ABUSE',
    idempotencyKey: 'boundary-permanent-ban',
  });
  time += 2000;
  assert.equal((await f.call('/api/bootstrap')).json.authenticated, false);
});

test('deleted private chat retains minimal all-route token holds for one deadline and correction', async (t) => {
  let time = Date.now();
  const f = await fixture(t, {
    clock: () => time,
    gatewayOverrides: gateways(async function* () {
      yield { text: 'partial' };
      throw new AppError(503, 'SYNTHETIC_FAILURE', 'Synthetic failure.');
    }),
  });
  await f.send({ mode: 'manual', modelId: f.paidModel });
  const a = (await f.db.query('SELECT attempt_id FROM router_accounting_holds')).rows[0];
  assert.equal((await f.call('/api/conversations/' + f.id, 'DELETE')).status, 200);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n, 0);
  time += 60000;
  await f.router.sweep();
  const data = {
    attemptId: a.attempt_id,
    inputTokens: '3',
    outputTokens: '1',
    idempotencyKey: 'boundary-deleted-correction',
  };
  await f.router.reconcile(f.staff, data);
  await f.router.reconcile(f.staff, data);
  const row = (
    await f.db.query(
      'SELECT used_tokens::text AS used,reserved_tokens::text AS reserved FROM abuse_daily_token_counters WHERE user_id=$1',
      [A],
    )
  ).rows[0];
  assert.equal(row.used, '4');
  assert.equal(row.reserved, '0');
});

test('dispatched uncertainty markers require current staff, preserve holds on replay and refuse reserved work', async (t) => {
  const f = await fixture(t, {
    gatewayOverrides: gateways(async function* () {
      yield { text: 'partial' };
      throw new AppError(503, 'SYNTHETIC_FAILURE', 'Synthetic failure.');
    }),
  });
  await f.send({ mode: 'manual', modelId: f.paidModel });
  const id = (await f.db.query('SELECT attempt_id FROM router_accounting_holds')).rows[0]
    .attempt_id;
  const ledgerData = { reservationId: id, idempotencyKey: 'router-pending-ledger-' + id };
  const capacityData = { reservationId: id, idempotencyKey: 'router-pending-capacity-' + id };
  await assert.rejects(f.ledger.cancelDispatched(A, ledgerData), (e) => e.status === 403);
  await assert.rejects(f.governor.cancelDispatched(A, capacityData), (e) => e.status === 403);
  const before = (
    await f.db.query(
      'SELECT reserved_tokens::text AS held FROM abuse_daily_token_counters WHERE user_id=$1',
      [A],
    )
  ).rows[0].held;
  await f.ledger.cancelDispatched(f.staff, ledgerData);
  await f.governor.cancelDispatched(f.staff, capacityData);
  assert.equal(
    (
      await f.db.query(
        'SELECT reserved_tokens::text AS held FROM abuse_daily_token_counters WHERE user_id=$1',
        [A],
      )
    ).rows[0].held,
    before,
  );
  const reserved = randomUUID();
  await f.ledger.reserve(A, {
    entitlementId: f.entitlements.userAPack,
    reservationId: reserved,
    requestId: reserved,
    kind: 'request',
    costMicroCu: '1',
    inputTokens: '1',
    outputTokens: '1',
    idempotencyKey: 'boundary-reserved-ledger',
  });
  await assert.rejects(
    f.ledger.cancelDispatched(f.staff, {
      reservationId: reserved,
      idempotencyKey: 'boundary-cancel-reserved',
    }),
    (e) => e.status === 409,
  );
  await f.db.query("UPDATE users SET role='user' WHERE id=$1", [f.staff]);
  await assert.rejects(f.ledger.cancelDispatched(f.staff, ledgerData), (e) => e.status === 403);
  await assert.rejects(f.governor.cancelDispatched(f.staff, capacityData), (e) => e.status === 403);
});

test('cancellation after commit before gateway entry restores all-route token holds and funded balance', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const controller = new AbortController();
  let armed = false,
    marked = false,
    calls = 0;
  const observed = {
    ...db,
    async transaction(body) {
      const result = await db.transaction((tx) =>
        body({
          ...tx,
          query: async (sql, args) => {
            const value = await tx.query(sql, args);
            if (armed && sql.startsWith('INSERT INTO router_attempts')) marked = true;
            return value;
          },
        }),
      );
      if (armed && marked) {
        armed = false;
        controller.abort(new DOMException('Stopped.', 'AbortError'));
      }
      return result;
    },
  };
  const f = await fixture(
    t,
    {
      gatewayOverrides: gateways(async function* () {
        calls++;
        yield { text: 'x' };
      }),
    },
    observed,
  );
  const requestId = randomUUID();
  await db.query(
    'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES($1,$2,$3,$1,$4)',
    [requestId, A, f.id, 'x'.repeat(64)],
  );
  await f.abuse.withTransaction((tx) =>
    f.abuse.admitInTransaction(tx, {
      userId: A,
      requestId,
      source: { deviceToken: 'synthetic-boundary-device-0000000000000001', ipAddress: '192.0.2.1' },
    }),
  );
  const data = {
    requestId,
    conversationId: f.id,
    messages: [{ role: 'user', content: 'Hello' }],
    language: 'en',
    routing: { mode: 'manual', modelId: f.paidModel },
  };
  await f.router.prepare(A, data);
  armed = true;
  await assert.rejects(
    async () => {
      for await (const item of f.router.stream(A, { ...data, signal: controller.signal }))
        assert.notEqual(item.type, 'delta');
    },
    (error) => error.name === 'AbortError',
  );
  assert.equal(calls, 0);
  const counter = (
    await db.query(
      'SELECT used_tokens::text AS used,reserved_tokens::text AS reserved FROM abuse_daily_token_counters WHERE user_id=$1',
      [A],
    )
  ).rows[0];
  assert.deepEqual(counter, { used: '0', reserved: '0' });
  const pack = (await f.ledger.usage(A)).entitlements.find(
    (e) => e.id === f.entitlements.userAPack,
  );
  assert.equal(pack.remaining.costMicroCu, '1000000');
  assert.equal(
    (
      await db.query(
        "SELECT sum(c.used_amount)::text AS used FROM capacity_counters c JOIN capacity_limits l ON l.id=c.limit_id WHERE l.metric='requests'",
      )
    ).rows[0].used,
    '0',
  );
});
