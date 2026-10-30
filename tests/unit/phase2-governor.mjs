import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabase,
  migrateUp,
  migrateDown,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createRegistry } from '../../packages/registry/index.mjs';
import { createGovernor } from '../../packages/governor/index.mjs';
import { governorFixture, seedGovernorFixture } from '../../tools/phase2/governor-fixture.mjs';

const A = SYNTHETIC_SEED.userA,
  B = SYNTHETIC_SEED.userB;
const start = Date.parse('2026-10-13T00:00:00.000Z');
async function fixture(t, options = {}, modify, dataDir) {
  const db = await createDatabase({ dataDir });
  await migrateUp(db, { throughVersion: 5 });
  const f = { db, time: start, governor: null };
  f.governor = createGovernor(db, {
    clock: () => f.time,
    reservationTtlMs: 120000,
    reconciliationMs: 1000,
    ...options,
  });
  const inputs = structuredClone(governorFixture);
  if (modify) modify(inputs);
  Object.assign(f, await seedGovernorFixture(db, f.governor, inputs));
  if (t) t.after(() => db.close());
  return f;
}
function poolLimits(inputs, poolIndex, limits) {
  const pool = inputs.pools[poolIndex];
  pool.limits = limits.map((l, i) => ({
    id: pool.id + '-custom-' + i,
    anchorAt: inputs.anchorAt,
    safetyFactor: '0.8',
    windowMs: 60000,
    ...l,
  }));
}
const key = (idempotencyKey) => ({ idempotencyKey });
const reserve = (f, id = 'request-a', other = {}) =>
  f.governor.reserve(A, {
    reservationId: id,
    requestId: id,
    modelId: f.modelA,
    accountRef: f.accountRef,
    inputTokens: '20',
    outputTokens: '10',
    ...key('reserve-' + id),
    ...other,
  });
const dispatch = (f, id = 'request-a') =>
  f.governor.dispatch(f.staff, { reservationId: id, ...key('dispatch-' + id) });
const settle = (f, id = 'request-a', other = {}) =>
  f.governor.settle(f.staff, {
    reservationId: id,
    inputTokens: '15',
    outputTokens: '5',
    ...key('settle-' + id),
    ...other,
  });
const snapshot = (f, modelId = f.modelA) =>
  f.governor.snapshot(f.staff, { modelId, accountRef: f.accountRef });
function counter(view, scope, metric, windowMs = 60000) {
  return view.limits.find(
    (l) => l.scope === scope && l.metric === metric && l.windowMs === windowMs,
  );
}

test('Governor migration5 is opt-in, reversible on disposable data and preserves earlier ledger schema', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  assert.deepEqual(await migrateUp(db), [1]);
  await assert.rejects(db.query('SELECT * FROM capacity_counters'));
  assert.deepEqual(await migrateUp(db, { throughVersion: 5 }), [2, 3, 4, 5]);
  assert.deepEqual(await migrateDown(db), [5]);
  await db.query('SELECT * FROM usage_ledger');
  assert.deepEqual(await migrateUp(db, { throughVersion: 5 }), [5]);
});

test('two models sharing provider/account pools cannot duplicate quota under concurrent simulated load (T2.9)', async (t) => {
  const f = await fixture(t);
  const values = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      reserve(f, 'parallel-' + i, { modelId: i % 2 ? f.modelA : f.modelB }),
    ),
  );
  const accepted = values.flatMap((r, i) => (r.status === 'fulfilled' ? ['parallel-' + i] : []));
  assert.equal(accepted.length, 8);
  const before = await snapshot(f);
  assert.equal(counter(before, 'account', 'requests').reserved, '8');
  assert.equal(counter(before, 'provider', 'tokens').reserved, '240');
  await Promise.all(accepted.map((id) => dispatch(f, id)));
  await Promise.all(accepted.flatMap((id) => [settle(f, id), settle(f, id)]));
  const after = await snapshot(f);
  assert.equal(counter(after, 'account', 'requests').used, '8');
  assert.equal(counter(after, 'account', 'tokens').used, '160');
  assert.equal(counter(after, 'account', 'tokens').reserved, '0');
  assert.equal(counter(after, 'account', 'requests').remaining, '0');
});

test('exhausted provider pool refuses admission without invoking a synthetic transport (local T2.1)', async (t) => {
  const f = await fixture(t, {}, (inputs) =>
    poolLimits(inputs, 0, [{ metric: 'requests', limit: '0' }]),
  );
  let calls = 0;
  await assert.rejects(
    (async () => {
      await reserve(f);
      calls++;
    })(),
    /capacity|exhausted/i,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM capacity_reservations')).rows[0].n,
    0,
  );
  assert.equal(counter(await snapshot(f), 'account', 'tokens').reserved, '0');
});

test('failure at an account/model/input/output limit rolls back every applicable counter', async () => {
  for (const [index, metric] of [
    [1, 'tokens'],
    [2, 'requests'],
    [1, 'input_tokens'],
    [2, 'output_tokens'],
  ]) {
    const f = await fixture(null, {}, (inputs) =>
      poolLimits(inputs, index, [{ metric, limit: '0' }]),
    );
    try {
      await assert.rejects(reserve(f), /capacity|exhausted/i);
      const view = await snapshot(f);
      assert.equal(
        view.limits.every((l) => l.used === '0' && l.reserved === '0'),
        true,
      );
    } finally {
      await f.db.close();
    }
  }
});

test('reserve/cancel/dispatch/settlement are idempotent and conflicting payloads cannot reuse a key', async (t) => {
  const f = await fixture(t);
  const first = await reserve(f);
  assert.deepEqual(await reserve(f), first);
  await assert.rejects(reserve(f, 'request-a', { inputTokens: '21' }), /idempotency/i);
  await dispatch(f);
  await settle(f);
  await settle(f);
  assert.equal(counter(await snapshot(f), 'account', 'requests').used, '1');
  assert.equal(counter(await snapshot(f), 'account', 'tokens').used, '20');
  await assert.rejects(
    f.governor.dispatch(f.staff, { reservationId: 'request-a', ...key('new-dispatch-attempt') }),
    /state|resolved|dispatch/i,
  );
  await assert.rejects(settle(f, 'request-a', { ...key('second-settlement') }), /resolved/i);
});

test('predispatch cancellation releases request/token holds; dispatched unknown usage retains bounded tokens', async (t) => {
  const f = await fixture(t);
  await reserve(f, 'before');
  await f.governor.cancel(A, { reservationId: 'before', ...key('cancel-before') });
  assert.equal(counter(await snapshot(f), 'account', 'requests').remaining, '8');
  await reserve(f);
  await dispatch(f);
  await f.governor.cancel(A, { reservationId: 'request-a', ...key('cancel-after') });
  const pending = await snapshot(f);
  assert.equal(counter(pending, 'account', 'requests').used, '1');
  assert.equal(counter(pending, 'account', 'tokens').reserved, '30');
  f.time += 999;
  assert.equal((await f.governor.sweep(f.staff)).estimated, 0);
  f.time += 1;
  assert.equal((await f.governor.sweep(f.staff)).estimated, 1);
  assert.equal(counter(await snapshot(f), 'account', 'tokens').used, '30');
  await settle(f);
  assert.equal(counter(await snapshot(f), 'account', 'tokens').used, '20');
  assert.equal(counter(await snapshot(f), 'account', 'requests').used, '1');
  assert.equal(
    (
      await f.db.query(
        "SELECT count(*)::int AS n FROM capacity_events WHERE kind='LATE_CORRECTION'",
      )
    ).rows[0].n,
    1,
  );
});

test('dispatch atomically rebinds old reservations to current reset windows and checks all new bounds', async (t) => {
  const f = await fixture(t);
  await reserve(f, 'old-window');
  f.time += 60000;
  await Promise.all(Array.from({ length: 8 }, (_, i) => reserve(f, 'fresh-' + i)));
  await assert.rejects(dispatch(f, 'old-window'), /capacity|exhausted/i);
  assert.equal((await f.governor.reservation(A, 'old-window')).state, 'RESERVED');
  await f.governor.cancel(A, { reservationId: 'fresh-0', ...key('cancel-fresh-window') });
  await dispatch(f, 'old-window');
  assert.equal(counter(await snapshot(f), 'account', 'requests').used, '1');
  assert.equal(counter(await snapshot(f), 'account', 'requests').reserved, '7');
});

test('late usage changes its captured old counters rather than the freshly reset window', async (t) => {
  const f = await fixture(t);
  await reserve(f);
  await dispatch(f);
  f.time += 1000;
  await f.governor.sweep(f.staff);
  f.time += 59000;
  await reserve(f, 'new-window');
  await settle(f);
  const view = await snapshot(f);
  assert.equal(counter(view, 'account', 'tokens').reserved, '30');
  assert.equal(counter(view, 'account', 'tokens').used, '0');
  const old = (
    await f.db.query(
      "SELECT c.used_amount::text AS used FROM capacity_counters c JOIN capacity_limits l ON l.id=c.limit_id JOIN capacity_pools p ON p.id=l.pool_id WHERE p.scope='account' AND l.metric='tokens' AND l.window_ms=60000 ORDER BY c.starts_at",
    )
  ).rows;
  assert.deepEqual(
    old.map((r) => r.used),
    ['20', '0'],
  );
});

test('reservation TTL cleanup and backwards clocks fail safely without quota reuse', async (t) => {
  const f = await fixture(t, { reservationTtlMs: 1000 });
  await reserve(f);
  f.time += 1000;
  await assert.rejects(dispatch(f), /expired/i);
  assert.equal((await f.governor.sweep(f.staff)).released, 1);
  assert.equal(counter(await snapshot(f), 'account', 'requests').remaining, '8');
  f.time--;
  await assert.rejects(reserve(f, 'clock-backwards'), /clock|time/i);
});

test('current provider/model eligibility and disabled pools are rechecked before dispatch', async (t) => {
  const f = await fixture(t);
  await reserve(f);
  const changed = await f.governor.setPoolStatus(f.staff, {
    poolId: f.poolIds[1],
    status: 'disabled',
    expectedRevision: 1,
    ...key('disable-shared-pool'),
  });
  assert.equal(changed.revision, 2);
  await assert.rejects(dispatch(f), /disabled|unavailable/i);
  await f.governor.setPoolStatus(f.staff, {
    poolId: f.poolIds[1],
    status: 'enabled',
    expectedRevision: 2,
    ...key('enable-shared-pool'),
  });
  const registry = createRegistry(f.db);
  await registry.updateModel(
    f.staff,
    f.modelA,
    { status: 'disabled' },
    { expectedRevision: 2, idempotencyKey: 'disable-current-model' },
  );
  await assert.rejects(dispatch(f), /model|eligible|unavailable/i);
  assert.equal(counter(await snapshot(f, f.modelB), 'account', 'requests').reserved, '1');
});

test('unknown scopes/accounts/legacy models, caller identity overrides and direct configuration abuse are rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    reserve(f, 'unknown-account', { accountRef: 'not-configured' }),
    /unknown|route/i,
  );
  await assert.rejects(
    reserve(f, 'legacy', { modelId: SYNTHETIC_SEED.model }),
    /model|route|unknown/i,
  );
  await assert.rejects(reserve(f, 'override', { userId: B }), /field|payload/i);
  await assert.rejects(
    f.governor.createRoute(A, {
      modelId: f.modelA,
      accountRef: 'other-account',
      providerLimits: 'known',
      accountLimits: 'known',
      modelLimits: 'known',
      quotaConfirmed: true,
      ...key('forged-route'),
    }),
    /staff/i,
  );
  await assert.rejects(f.governor.runFairShare(A, key('forged-fair-share')), /staff/i);
  await reserve(f);
  await assert.rejects(f.governor.reservation(B, 'request-a'), /not found/i);
  await assert.rejects(
    f.governor.cancel(B, { reservationId: 'request-a', ...key('foreign-cancel') }),
    /not found/i,
  );
  await assert.rejects(
    f.governor.dispatch(A, { reservationId: 'request-a', ...key('forged-dispatch') }),
    /staff/i,
  );
  await assert.rejects(
    f.governor.snapshot(A, { modelId: f.modelA, accountRef: f.accountRef }),
    /staff/i,
  );
});

test('canonical shared pool ownership cannot be registered twice under an alias', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.governor.createPool(f.staff, {
      id: 'duplicate-shared-alias',
      providerId: f.providerId,
      scope: 'account',
      accountRef: f.accountRef,
      tokensPerRequest: '50',
      limits: [
        {
          id: 'duplicate-limit',
          metric: 'requests',
          limit: '10',
          windowMs: 60000,
          anchorAt: governorFixture.anchorAt,
        },
      ],
      ...key('duplicate-shared-pool'),
    }),
    /unique|ownership|already/i,
  );
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM capacity_pools')).rows[0].n, 4);
});

test('fair-share job counts a shared daily pool once, caps trust, shrinks with usage and preserves zero-user safety', async (t) => {
  const f = await fixture(t, { expectedActiveUsers: '100' });
  const initial = await f.governor.runFairShare(f.staff, key('daily-policy-one'));
  assert.equal(initial.poolRemainingTokens, '40000');
  assert.equal((await f.governor.allowance(A)).tokens, '400');
  await reserve(f);
  await dispatch(f);
  await settle(f);
  await f.governor.runFairShare(f.staff, key('daily-policy-two'));
  assert.equal((await f.governor.allowance(A)).tokens, '399');
  assert.deepEqual(await f.governor.runFairShare(f.staff, key('daily-policy-one')), initial);
  await f.db.query('UPDATE users SET trust_level=1 WHERE id=$1', [A]);
  const zeroUsers = createGovernor(f.db, { clock: () => f.time, expectedActiveUsers: '0' });
  await zeroUsers.runFairShare(f.staff, key('daily-policy-zero'));
  assert.equal((await zeroUsers.allowance(A)).tokens, '2000');
  assert.equal((await zeroUsers.allowance(B)).tokens, '1000');
});

test('request-only daily quotas use explicit conservative token conversion and never become request allowance', async (t) => {
  const f = await fixture(t, {}, (inputs) => {
    inputs.windows = inputs.windows.map((w) => ({ ...w }));
    for (const p of inputs.pools)
      p.limits = inputs.windows.map((w) => ({
        id: p.id + '-requests-' + w.id,
        metric: 'requests',
        limit: w.requests,
        windowMs: w.windowMs,
        anchorAt: inputs.anchorAt,
        safetyFactor: inputs.safetyFactor,
      }));
  });
  await f.governor.runFairShare(f.staff, key('request-only-policy'));
  const policy = await f.governor.allowance(A);
  assert.equal(policy.tokens, '400');
  assert.equal(policy.unit, 'tokens');
  assert.equal(counter(await snapshot(f), 'account', 'requests', 86400000).remaining, '800');
});

test('fair-share fails closed for scopes with no documented daily bound instead of extrapolating minute limits', async (t) => {
  const f = await fixture(t, {}, (inputs) => {
    inputs.windows = inputs.windows.filter((w) => w.id === 'minute');
  });
  await assert.rejects(
    f.governor.runFairShare(f.staff, key('unknown-daily-policy')),
    /daily|unknown/i,
  );
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM capacity_job_runs')).rows[0].n, 0);
});

test('storage admission preserves existing dispatched deadline and correction capacity; trails are immutable', async (t) => {
  const f = await fixture(t, { maxEvents: 13, maxOperations: 13 });
  // Fixture creates four pools and two routes: six events; one request reserves four closing slots.
  await reserve(f);
  await assert.rejects(reserve(f, 'storage-extra'), /storage/i);
  await dispatch(f);
  await f.governor.cancel(A, { reservationId: 'request-a', ...key('storage-cancel') });
  f.time += 1000;
  await f.governor.sweep(f.staff);
  await settle(f);
  for (const table of [
    'capacity_events',
    'capacity_operations',
    'capacity_limits',
    'capacity_routes',
  ]) {
    await assert.rejects(f.db.query('DELETE FROM ' + table), /append-only|foreign key/);
    await assert.rejects(f.db.exec('TRUNCATE ' + table + ' CASCADE'), /append-only/);
  }
  assert.equal(counter(await snapshot(f), 'account', 'tokens').used, '20');
});

test('persisted Governor holds, window snapshots and journals survive close/reopen with unknown usage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'free-ai-governor-'));
  let f;
  try {
    f = await fixture(null, {}, null, dir);
    await reserve(f);
    await dispatch(f);
    await f.db.close();
    f = null;
    const db = await createDatabase({ dataDir: dir });
    f = {
      db,
      time: start + 1000,
      governor: null,
      staff: 'registry-local-reviewer',
      modelA: governorFixture.models[0].id,
      accountRef: governorFixture.accountRef,
    };
    f.governor = createGovernor(db, { clock: () => f.time });
    assert.equal((await f.governor.sweep(f.staff)).estimated, 1);
    await settle(f);
    assert.equal(counter(await snapshot(f), 'account', 'requests').used, '1');
    assert.equal(counter(await snapshot(f), 'account', 'tokens').used, '20');
  } finally {
    if (f) await f.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
