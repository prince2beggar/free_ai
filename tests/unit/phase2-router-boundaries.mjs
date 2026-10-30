import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createRouterFixture, routerFixture } from '../../tools/phase2/router-fixture.mjs';
import { createRepository } from '../../packages/api/repository.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { AppError } from '../../packages/api/errors.mjs';
import { createRouter } from '../../packages/router/index.mjs';
const A = SYNTHETIC_SEED.userA;
async function fixture(t, stream, options = {}) {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 6 });
  const f = { db, time: Date.parse('2026-10-13T00:00:00.000Z') };
  const overrides = {};
  if (stream)
    for (const m of routerFixture.models)
      overrides[m.id] = {
        synthetic: true,
        providerId: routerFixture.provider.id,
        modelId: m.id,
        health: () => ({ synthetic: true }),
        stream,
      };
  Object.assign(
    f,
    await createRouterFixture(db, {
      clock: () => f.time,
      gatewayOverrides: overrides,
      routerOptions: options,
    }),
  );
  return f;
}
async function prepare(f, routing = {}) {
  const requestId = randomUUID(),
    conversationId = randomUUID();
  await f.db.query('INSERT INTO conversations(id,user_id) VALUES($1,$2)', [conversationId, A]);
  await f.db.query(
    'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES($1,$2,$3,$1,$4)',
    [requestId, A, conversationId, 'x'.repeat(64)],
  );
  await f.db.query(
    "INSERT INTO messages(id,user_id,conversation_id,role,content,request_id) VALUES($1,$2,$3,'user','Hello',$4)",
    [randomUUID(), A, conversationId, requestId],
  );
  const d = {
    requestId,
    conversationId,
    messages: [{ role: 'user', content: 'Hello' }],
    language: 'en',
    routing,
  };
  await f.router.prepare(A, d);
  return d;
}
async function consume(f, d) {
  for await (const _e of f.router.stream(A, d)) {
    assert.equal(typeof _e.type, 'string');
  }
  return f.router.result(A, d.requestId);
}
test('cancellation at transaction commit before transport entrance restores funded balance and every quota', async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  let calls = 0;
  const gateways = Object.fromEntries(
    routerFixture.models.map((m) => [
      m.id,
      {
        synthetic: true,
        modelId: m.id,
        providerId: routerFixture.provider.id,
        health: () => ({ synthetic: true }),
        async *stream({ signal }) {
          signal.throwIfAborted();
          calls++;
          yield { text: 'healthy' };
        },
      },
    ]),
  );
  const wrapped = {
    ...f.db,
    transaction: async (callback) => {
      const result = await f.db.transaction(callback);
      if (result?.attemptId) controller.abort(new DOMException('Stopped at commit.', 'AbortError'));
      return result;
    },
  };
  const router = createRouter(wrapped, { clock: () => f.time, staffActorId: f.staff, gateways });
  const d = await prepare(f, { mode: 'manual', modelId: f.paidModel });
  await assert.rejects(
    (async () => {
      for await (const _event of router.stream(A, { ...d, signal: controller.signal })) {
        assert.equal(typeof _event.type, 'string');
      }
    })(),
  );
  assert.equal(calls, 0);
  const result = await router.result(A, d.requestId);
  assert.equal(result.state, 'CANCELLED');
  const usage = await f.ledger.usage(A);
  assert.equal(usage.entitlements.find((e) => e.kind === 'pack').remaining.costMicroCu, '1000000');
  assert.equal(
    usage.entitlements.some((e) => e.pendingReconciliation),
    false,
  );
  const snapshot = await f.governor.snapshot(f.staff, {
    modelId: f.paidModel,
    accountRef: f.accountRef,
  });
  assert.equal(
    snapshot.limits.every((l) => l.used === '0' && l.reserved === '0'),
    true,
  );
  f.time += 60000;
  assert.equal((await router.sweep()).estimated, 0);
});
test('prepared policy snapshot governs dispatch after a policy changes', async (t) => {
  const f = await fixture(t);
  const d = await prepare(f);
  const defaults = JSON.parse(
    await readFile(new URL('../../packages/router/defaults.json', import.meta.url), 'utf8'),
  );
  await f.router.configurePolicy(f.staff, {
    policy: { ...defaults.policy, version: 2, mode: 'pinned', modelId: f.modelB },
    expectedVersion: 1,
    idempotencyKey: 'boundary-policy-change',
  });
  assert.equal((await consume(f, d)).modelId, f.modelA);
  assert.equal((await f.router.inspect(f.staff, d.requestId)).policy_version, 1);
  assert.equal((await consume(f, await prepare(f))).modelId, f.modelB);
});
test('transport entry precedes first yielded attempt; returning a started stream retains uncertainty', async (t) => {
  let calls = 0;
  const f = await fixture(t, async function* () {
    calls++;
    yield { text: 'healthy' };
  });
  const d = await prepare(f),
    controller = new AbortController(),
    iterator = f.router.stream(A, { ...d, signal: controller.signal });
  assert.equal((await iterator.next()).value.type, 'attempt');
  assert.equal(calls, 1);
  controller.abort(new DOMException('Stopped.', 'AbortError'));
  await iterator.return();
  const r = await f.router.result(A, d.requestId);
  assert.equal(r.state, 'CANCELLED');
  assert.equal(r.attempts[0].state, 'PENDING_RECONCILIATION');
});
test('cancellation before stream entrance releases all predispatch capacity without invoking a transport', async (t) => {
  let calls = 0;
  const f = await fixture(t, async function* () {
    calls++;
    yield { text: 'healthy' };
  });
  const d = await prepare(f),
    controller = new AbortController();
  controller.abort(new DOMException('Stopped.', 'AbortError'));
  await assert.rejects(consume(f, { ...d, signal: controller.signal }));
  assert.equal(calls, 0);
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM ledger_reservations')).rows[0].n,
    0,
  );
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM capacity_reservations')).rows[0].n,
    0,
  );
});
test('healthy user stops do not open provider or model circuit breakers', async (t) => {
  let calls = 0;
  const f = await fixture(t, async function* () {
    calls++;
    yield { text: 'healthy' };
  });
  for (let i = 0; i < 3; i++) {
    const d = await prepare(f),
      controller = new AbortController(),
      it = f.router.stream(A, { ...d, signal: controller.signal });
    await it.next();
    await it.next();
    controller.abort(new DOMException('Stopped.', 'AbortError'));
    await assert.rejects(it.next());
  }
  assert.equal(calls, 3);
  const rows = (await f.db.query('SELECT failures,opened_until FROM router_breakers')).rows;
  assert.equal(
    rows.every((r) => r.failures === 0 && !r.opened_until),
    true,
  );
  assert.ok((await prepare(f)).requestId);
});
test('success between failures does not erase failures in the configured breaker window', async (t) => {
  let calls = 0;
  const f = await fixture(
    t,
    async function* () {
      calls++;
      if (calls % 2) throw new AppError(503, 'FAIL', 'Synthetic failure.');
      yield { text: 'healthy' };
    },
    { maxRetries: 0, maxFallbacks: 0 },
  );
  for (let i = 0; i < 5; i++) {
    const d = await prepare(f);
    if (i % 2 === 0) await assert.rejects(consume(f, d));
    else await consume(f, d);
  }
  assert.equal(calls, 5);
  await assert.rejects(prepare(f), /eligible|circuit/i);
  const rows = (await f.db.query('SELECT failures,opened_until FROM router_breakers')).rows;
  assert.equal(
    rows.every((r) => r.failures === 3 && r.opened_until),
    true,
  );
});
test('owned chat deletion removes attempt content while minimal holds still estimate and correct once', async (t) => {
  const f = await fixture(
    t,
    async function* () {
      yield { text: 'private synthetic fragment' };
      throw new AppError(503, 'FAIL', 'Synthetic failure.');
    },
    { maxRetries: 0, maxFallbacks: 0, reconciliationMs: 1000 },
  );
  const d = await prepare(f);
  await assert.rejects(consume(f, d));
  const a = (await f.router.result(A, d.requestId)).attempts[0];
  await f.db.query("UPDATE chat_requests SET status='failed' WHERE id=$1", [d.requestId]);
  const repo = createRepository(f.db, await loadConfig({}));
  await repo.deleteConversation(A, d.conversationId);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n, 0);
  f.time += 1000;
  assert.equal((await f.router.sweep()).estimated, 1);
  const key = {
    attemptId: a.attemptId,
    inputTokens: '10',
    outputTokens: '0',
    idempotencyKey: 'deleted-request-correction',
  };
  assert.deepEqual(await f.router.reconcile(f.staff, key), await f.router.reconcile(f.staff, key));
  const holds = (await f.db.query('SELECT state FROM router_accounting_holds')).rows;
  assert.equal(holds[0].state, 'CORRECTED');
  assert.equal(
    (await f.db.query('SELECT reserved_tokens::text AS reserved FROM router_daily_counters'))
      .rows[0].reserved,
    '0',
  );
});
