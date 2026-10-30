import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  migrateUp,
  migrateDown,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createRouterFixture, routerFixture } from '../../tools/phase2/router-fixture.mjs';
import { AppError } from '../../packages/api/errors.mjs';
const A = SYNTHETIC_SEED.userA,
  B = SYNTHETIC_SEED.userB;
async function fixture(t, options = {}) {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 6 });
  const f = { db, time: Date.parse('2026-10-13T00:00:00.000Z') };
  Object.assign(f, await createRouterFixture(db, { clock: () => f.time, ...options }));
  return f;
}
async function prepare(f, { actor = A, routing = {}, content = 'Hello', conversationId } = {}) {
  const requestId = randomUUID();
  conversationId ??= randomUUID();
  await f.db.query('INSERT INTO conversations(id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
    conversationId,
    actor,
  ]);
  await f.db.query(
    'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES($1,$2,$3,$1,$4)',
    [requestId, actor, conversationId, 'x'.repeat(64)],
  );
  await f.db.query(
    "INSERT INTO messages(id,user_id,conversation_id,role,content,request_id) VALUES($1,$2,$3,'user',$4,$5)",
    [randomUUID(), actor, conversationId, content, requestId],
  );
  const messages = [{ role: 'user', content }];
  await f.router.prepare(actor, { requestId, conversationId, messages, language: 'en', routing });
  return { requestId, conversationId, messages, language: 'en', routing };
}
async function run(f, data, actor = A) {
  const events = [];
  for await (const e of f.router.stream(actor, data)) events.push(e);
  return { events, result: await f.router.result(actor, data.requestId) };
}
test('Router migration6 is opt-in, disposable reversible and keeps prior schema', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  assert.deepEqual(await migrateUp(db), [1]);
  assert.deepEqual(await migrateUp(db, { throughVersion: 6 }), [2, 3, 4, 5, 6]);
  assert.deepEqual(await migrateDown(db), [6]);
  await db.query('SELECT * FROM capacity_pools');
  assert.deepEqual(await migrateUp(db, { throughVersion: 6 }), [6]);
});
test('Router successful synthetic call joins exact ledger and all-scope capacity once', async (t) => {
  const f = await fixture(t);
  const d = await prepare(f);
  const { events, result } = await run(f, d);
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.attempts.length, 1);
  assert.equal(events.filter((e) => e.type === 'attempt').length, 1);
  assert.equal(
    (await f.db.query("SELECT count(*)::int AS n FROM usage_ledger WHERE type='commit'")).rows[0].n,
    1,
  );
  assert.equal(
    (await f.governor.snapshot(f.staff, { modelId: f.modelA, accountRef: f.accountRef })).limits
      .filter((l) => l.metric === 'requests')
      .every((l) => l.used === '1' && l.reserved === '0'),
    true,
  );
});
test('zero balance never dispatches a paid route (T2.2)', async (t) => {
  let calls = 0;
  const paidId = routerFixture.models.find((m) => !m.freeFlag).id;
  const f = await fixture(t, {
    gatewayOverrides: {
      [paidId]: {
        synthetic: true,
        providerId: routerFixture.provider.id,
        modelId: paidId,
        health: () => ({ synthetic: true }),
        async *stream() {
          calls++;
          yield { text: 'paid' };
        },
      },
    },
  });
  await assert.rejects(
    prepare(f, { actor: B, routing: { mode: 'manual', modelId: f.paidModel } }),
    /eligible|fund|paid/i,
  );
  assert.equal(calls, 0);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_attempts')).rows[0].n, 0);
});
test('funded paid synthetic fixture debits verified registry rates and preserves chosen provenance', async (t) => {
  const f = await fixture(t);
  const d = await prepare(f, { routing: { mode: 'manual', modelId: f.paidModel } });
  const { result } = await run(f, d);
  assert.equal(result.modelId, f.paidModel);
  const entries = (
    await f.db.query("SELECT amount_micro_cu::text AS n FROM usage_ledger WHERE type='commit'")
  ).rows;
  assert.equal(entries.length, 1);
  assert.equal(BigInt(entries[0].n) < 0n, true);
});
test('preoutput failures obey one retry and one fallback, with one hold per dispatched attempt (T2.3)', async (t) => {
  let calls = 0;
  const overrides = {};
  for (const m of routerFixture.models)
    overrides[m.id] = {
      synthetic: true,
      providerId: routerFixture.provider.id,
      modelId: m.id,
      health: () => ({ synthetic: true }),
      async *stream() {
        calls++;
        throw new AppError(503, 'SIMULATED_FAILURE', 'Synthetic failure.');
      },
    };
  const f = await fixture(t, { gatewayOverrides: overrides });
  const d = await prepare(f, { routing: { mode: 'free-only' } });
  await assert.rejects(run(f, d));
  assert.equal(calls, 3);
  const r = await f.router.result(A, d.requestId);
  assert.equal(r.attempts.length, 3);
  assert.equal(
    r.attempts.every((a) => a.state === 'PENDING_RECONCILIATION'),
    true,
  );
  assert.equal(r.retryBudgetRemaining, 0);
});
test('partial output blocks automatic resend and retains uncertain funded/capacity holds', async (t) => {
  let calls = 0;
  const overrides = {};
  for (const m of routerFixture.models)
    overrides[m.id] = {
      synthetic: true,
      providerId: routerFixture.provider.id,
      modelId: m.id,
      health: () => ({ synthetic: true }),
      async *stream() {
        calls++;
        yield { text: 'partial' };
        throw new AppError(503, 'SIMULATED_FAILURE', 'Synthetic failure.');
      },
    };
  const f = await fixture(t, { gatewayOverrides: overrides });
  const d = await prepare(f);
  await assert.rejects(run(f, d));
  assert.equal(calls, 1);
  const r = await f.router.result(A, d.requestId);
  assert.equal(r.content, 'partial');
  assert.equal(r.attempts[0].state, 'PENDING_RECONCILIATION');
  assert.equal(
    (await f.ledger.usage(A)).entitlements.some((e) => e.pendingReconciliation),
    true,
  );
});
test('explicit retry/regenerate share the durable original budget and reject changed prompts/IDOR', async (t) => {
  const f = await fixture(t);
  const d = await prepare(f);
  await run(f, d);
  await assert.rejects(
    prepare(f, {
      routing: { action: 'retry', retryOf: d.requestId },
      content: 'changed',
      conversationId: d.conversationId,
    }),
    /original|prompt/i,
  );
  const retry = await prepare(f, {
    routing: { action: 'regenerate', retryOf: d.requestId },
    conversationId: d.conversationId,
  });
  await run(f, retry);
  await assert.rejects(
    prepare(f, {
      routing: { action: 'retry', retryOf: retry.requestId },
      conversationId: d.conversationId,
    }),
    /budget/i,
  );
  await assert.rejects(f.router.result(B, d.requestId), /not found/i);
  await assert.rejects(f.router.prepare(B, { ...d, routing: {} }), /not found|own/i);
});
test('exhausted shared pool refuses every candidate without creating a ledger dispatch', async (t) => {
  const f = await fixture(t);
  await f.db.query(
    "INSERT INTO capacity_counters(id,limit_id,starts_at,resets_at,safe_amount,used_amount) SELECT 'exhausted-fixture',l.id,$1,$2,l.safe_amount,l.safe_amount FROM capacity_limits l JOIN capacity_pools p ON p.id=l.pool_id WHERE p.scope='provider' AND l.metric='requests' AND l.window_ms=60000",
    [new Date(f.time).toISOString(), new Date(f.time + 60000).toISOString()],
  );
  await assert.rejects(prepare(f), /eligible|capacity/i);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_attempts')).rows[0].n, 0);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM router_requests')).rows[0].n, 1);
});
test('joint admission rollback leaves no ledger/capacity debit if capacity expires during dispatch writes', async (t) => {
  const f = await fixture(t);
  const d = await prepare(f);
  await f.db.query("UPDATE capacity_pools SET status='disabled' WHERE scope='account'");
  await assert.rejects(run(f, d));
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_attempts')).rows[0].n, 0);
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM ledger_reservations')).rows[0].n,
    0,
  );
});
test('durable provider/model circuit opens and cool-off permits fresh selection', async (t) => {
  const overrides = {};
  for (const m of routerFixture.models)
    overrides[m.id] = {
      synthetic: true,
      providerId: routerFixture.provider.id,
      modelId: m.id,
      health: () => ({ synthetic: true }),
      async *stream() {
        throw new AppError(503, 'SIMULATED_FAILURE', 'Synthetic failure.');
      },
    };
  const f = await fixture(t, {
    gatewayOverrides: overrides,
    routerOptions: { maxRetries: 0, maxFallbacks: 0, breakerFailures: 1, coolOffMs: 1000 },
  });
  await assert.rejects(run(f, await prepare(f)));
  await assert.rejects(prepare(f), /eligible|circuit/i);
  f.time += 1000;
  const d = await prepare(f);
  assert.ok(d.requestId);
});
test('deadline estimates and one late correction reconcile both ledgers and captured counters', async (t) => {
  const m = routerFixture.models[0];
  const f = await fixture(t, {
    routerOptions: { maxRetries: 0, maxFallbacks: 0, reconciliationMs: 1000 },
    gatewayOverrides: {
      [m.id]: {
        synthetic: true,
        providerId: routerFixture.provider.id,
        modelId: m.id,
        health: () => ({ synthetic: true }),
        async *stream() {
          throw new AppError(503, 'FAIL', 'Synthetic failure.');
        },
      },
    },
  });
  const d = await prepare(f, { routing: { mode: 'manual', modelId: f.modelA } });
  await assert.rejects(run(f, d));
  const a = (await f.router.result(A, d.requestId)).attempts[0];
  f.time += 1000;
  await f.router.sweep();
  assert.equal((await f.router.result(A, d.requestId)).attempts[0].state, 'ESTIMATED');
  await f.router.reconcile(f.staff, {
    attemptId: a.attemptId,
    inputTokens: '10',
    outputTokens: '0',
    idempotencyKey: 'late-router-correction',
  });
  assert.equal((await f.router.result(A, d.requestId)).attempts[0].state, 'CORRECTED');
  await assert.rejects(
    f.router.reconcile(f.staff, {
      attemptId: a.attemptId,
      inputTokens: '10',
      outputTokens: '0',
      idempotencyKey: 'second-router-correction',
    }),
    /resolved/i,
  );
});
