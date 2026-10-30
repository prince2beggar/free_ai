import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createGovernor } from '../../packages/governor/index.mjs';
import { governorFixture, seedGovernorFixture } from '../../tools/phase2/governor-fixture.mjs';

const A = SYNTHETIC_SEED.userA;
const START = Date.parse('2026-10-13T00:00:00.000Z');
const MAX_INTEGER = '9223372036854775807';

async function fixture(t, options = {}, modify) {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 5 });
  const f = { db, time: START, governor: null };
  f.options = { clock: () => f.time, reservationTtlMs: 120000, reconciliationMs: 1000, ...options };
  f.governor = createGovernor(db, f.options);
  const inputs = structuredClone(governorFixture);
  if (modify) modify(inputs);
  Object.assign(f, await seedGovernorFixture(db, f.governor, inputs));
  return f;
}

const reserveData = (f, name, overrides = {}) => ({
  reservationId: name,
  requestId: name,
  modelId: f.modelA,
  accountRef: f.accountRef,
  inputTokens: '20',
  outputTokens: '10',
  idempotencyKey: 'boundary-reserve-' + name,
  ...overrides,
});
const dispatchData = (name) => ({
  reservationId: name,
  idempotencyKey: 'boundary-dispatch-' + name,
});
const counterRows = async (db) =>
  (
    await db.query(
      'SELECT id,used_amount::text AS used,reserved_amount::text AS reserved FROM capacity_counters ORDER BY id',
    )
  ).rows;

test('Governor SQL reservations and snapshots preserve signed64 token quantities above JS safe integers', async (t) => {
  const f = await fixture(t, { safetyFactor: '1' }, (inputs) => {
    for (const pool of inputs.pools) {
      pool.limits = [60000, 86400000].map((windowMs) => ({
        id: pool.id + '-large-' + windowMs,
        metric: 'tokens',
        limit: MAX_INTEGER,
        windowMs,
        anchorAt: inputs.anchorAt,
        safetyFactor: '1',
      }));
    }
  });
  const input = '9007199254740993';
  const bound = '9007199254740994';
  const reservation = await f.governor.reserve(
    A,
    reserveData(f, 'large-value', { inputTokens: input, outputTokens: '1' }),
  );
  assert.equal(reservation.inputTokens, input);
  assert.equal(reservation.outputTokens, '1');
  const held = await f.governor.snapshot(f.staff, { modelId: f.modelA, accountRef: f.accountRef });
  assert.equal(held.limits.length, 6);
  for (const limit of held.limits) {
    assert.equal(limit.safeLimit, MAX_INTEGER);
    assert.equal(limit.reserved, bound);
    assert.equal(limit.remaining, (BigInt(MAX_INTEGER) - BigInt(bound)).toString());
  }
  await f.governor.dispatch(f.staff, dispatchData('large-value'));
  await f.governor.settle(f.staff, {
    reservationId: 'large-value',
    inputTokens: input,
    outputTokens: '0',
    idempotencyKey: 'boundary-settle-large-value',
  });
  const settled = await f.governor.snapshot(f.staff, {
    modelId: f.modelA,
    accountRef: f.accountRef,
  });
  assert.equal(
    settled.limits.every((limit) => limit.used === input && limit.reserved === '0'),
    true,
  );
});

test('Governor malformed config cannot weaken local-only scope or trusted staff roles', async (t) => {
  const f = await fixture(t);
  const invalid = [
    { localOnly: false },
    { localOnly: 'true' },
    { staffRoles: ['user'] },
    { staffRoles: ['owner', 'super_admin', 'admin', 'user'] },
    { expectedActiveUsers: 100 },
    { expectedActiveUsers: '-1' },
    { safetyFactor: 0.8 },
    { safetyFactor: '1.0001' },
    { clock: 'clock' },
    { maxReservations: 0 },
    { maxEvents: Infinity },
    { reconciliationMs: '1000' },
    { reservationTtlMs: 86400001 },
    { trustTokenCaps: { 0: '1000' } },
    { canUseRealProviders: true },
  ];
  for (const options of invalid) assert.throws(() => createGovernor(f.db, options));
  await assert.rejects(f.governor.dispatch(A, dispatchData('missing')), {
    code: 'CAPACITY_FORBIDDEN',
  });
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM capacity_reservations')).rows[0].n,
    0,
  );
});

test('Governor malformed payloads cannot forge identity, bounds, safety factors, or staff calls', async (t) => {
  const f = await fixture(t);
  for (const override of [
    { userId: f.staff },
    { staffRoles: ['user'] },
    { localOnly: false },
    { safetyFactor: '1' },
    { inputTokens: 20 },
    { outputTokens: '-1' },
    { inputTokens: '9223372036854775808' },
    { inputTokens: MAX_INTEGER, outputTokens: '1' },
  ]) {
    await assert.rejects(f.governor.reserve(A, reserveData(f, 'invalid-payload', override)));
  }
  for (const role of ['support', 'finance', 'reviewer']) {
    await f.db.query('UPDATE users SET role=$2 WHERE id=$1', [A, role]);
    await assert.rejects(f.governor.runFairShare(A, { idempotencyKey: 'boundary-forged-share' }), {
      code: 'CAPACITY_FORBIDDEN',
    });
  }
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM capacity_reservations')).rows[0].n,
    0,
  );
});

test('Governor checks current user and staff permissions before returning cached mutation results', async (t) => {
  const f = await fixture(t);
  const data = reserveData(f, 'revoked-replay');
  await f.governor.reserve(A, data);
  await f.db.query("UPDATE users SET status='suspended' WHERE id=$1", [A]);
  await assert.rejects(f.governor.reserve(A, data), { code: 'CAPACITY_FORBIDDEN' });
  await f.db.query("UPDATE users SET status='active' WHERE id=$1", [A]);
  const marked = await f.governor.dispatch(f.staff, dispatchData('revoked-replay'));
  assert.equal(marked.state, 'DISPATCHED');
  await f.db.query("UPDATE users SET role='user' WHERE id=$1", [f.staff]);
  await assert.rejects(f.governor.dispatch(f.staff, dispatchData('revoked-replay')), {
    code: 'CAPACITY_FORBIDDEN',
  });
  assert.equal(
    (await f.db.query("SELECT count(*)::int AS n FROM capacity_events WHERE kind='DISPATCH'"))
      .rows[0].n,
    1,
  );
});

for (const racePoint of ['second-allocation-read', 'journal-write', 'journal-expiry']) {
  test(`Governor rolls back dispatch when a reset or expiry passes during awaited ${racePoint}`, async (t) => {
    const f = await fixture(t, racePoint === 'journal-expiry' ? { reservationTtlMs: 1000 } : {});
    const name = 'reset-' + racePoint;
    await f.governor.reserve(A, reserveData(f, name));
    const before = await counterRows(f.db);
    let allocationReads = 0;
    let advanced = false;
    const wrapped = {
      ...f.db,
      transaction: (callback) =>
        f.db.transaction((tx) =>
          callback({
            ...tx,
            query: async (sql, params) => {
              const result = await tx.query(sql, params);
              if (sql.startsWith('SELECT counter_id,metric,')) allocationReads++;
              if (
                !advanced &&
                ((racePoint === 'second-allocation-read' && allocationReads === 2) ||
                  (racePoint.startsWith('journal-') &&
                    sql.startsWith('INSERT INTO capacity_operations')))
              ) {
                advanced = true;
                f.time += racePoint === 'journal-expiry' ? 1000 : 60000;
              }
              return result;
            },
          }),
        ),
    };
    const governor = createGovernor(wrapped, f.options);
    await assert.rejects(
      governor.dispatch(f.staff, dispatchData(name)),
      /window|reset|expired|time/i,
    );
    assert.equal(advanced, true);
    assert.equal((await f.governor.reservation(A, name)).state, 'RESERVED');
    assert.deepEqual(await counterRows(f.db), before);
    assert.equal(
      (await f.db.query("SELECT count(*)::int AS n FROM capacity_events WHERE kind='DISPATCH'"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM capacity_operations WHERE action='DISPATCH'",
        )
      ).rows[0].n,
      0,
    );
  });
}

test('Governor explicit not_applicable scopes admit provider-only routes and fail closed when a new pool contradicts them', async (t) => {
  const f = await fixture(t);
  const accountRef = 'boundary-provider-only-account';
  await f.governor.createRoute(f.staff, {
    modelId: f.modelA,
    accountRef,
    providerLimits: 'known',
    accountLimits: 'not_applicable',
    modelLimits: 'not_applicable',
    quotaConfirmed: true,
    idempotencyKey: 'boundary-provider-only-route',
  });
  await f.governor.reserve(A, reserveData(f, 'provider-only', { accountRef }));
  const before = await f.governor.snapshot(f.staff, { modelId: f.modelA, accountRef });
  assert.equal(
    before.limits.every((limit) => limit.scope === 'provider'),
    true,
  );
  assert.equal(
    before.limits.find((limit) => limit.metric === 'tokens' && limit.windowMs === 60000).reserved,
    '30',
  );
  await f.governor.createPool(f.staff, {
    id: 'boundary-undeclared-account-pool',
    providerId: f.providerId,
    scope: 'account',
    accountRef,
    limits: [
      {
        id: 'boundary-undeclared-request-limit',
        metric: 'requests',
        limit: '10',
        windowMs: 60000,
        anchorAt: governorFixture.anchorAt,
      },
    ],
    idempotencyKey: 'boundary-undeclared-pool-create',
  });
  await assert.rejects(
    f.governor.reserve(A, reserveData(f, 'contradictory-pool', { accountRef })),
    { code: 'CAPACITY_UNKNOWN' },
  );
  await assert.rejects(f.governor.dispatch(f.staff, dispatchData('provider-only')), {
    code: 'CAPACITY_UNKNOWN',
  });
  assert.equal((await f.governor.reservation(A, 'provider-only')).state, 'RESERVED');
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS n FROM capacity_reservations')).rows[0].n,
    1,
  );
});

test('Governor concurrent pending maintenance reports and posts one estimate, then one late correction', async (t) => {
  const f = await fixture(t);
  await f.governor.reserve(A, reserveData(f, 'pending-race'));
  await f.governor.dispatch(f.staff, dispatchData('pending-race'));
  await f.governor.cancel(A, {
    reservationId: 'pending-race',
    idempotencyKey: 'boundary-pending-cancel',
  });
  f.time += 1000;
  const workers = 6;
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const wrapped = {
    ...f.db,
    query: async (sql, params) => {
      const result = await f.db.query(sql, params);
      if (sql.startsWith('SELECT id,state FROM capacity_reservations')) {
        arrivals++;
        if (arrivals === workers) release();
        await barrier;
      }
      return result;
    },
  };
  const governor = createGovernor(wrapped, f.options);
  const summaries = await Promise.all(
    Array.from({ length: workers }, () => governor.sweep(f.staff)),
  );
  assert.equal(arrivals, workers);
  assert.equal((await f.governor.reservation(A, 'pending-race')).state, 'ESTIMATED');
  assert.equal(
    (
      await f.db.query(
        "SELECT count(*)::int AS n FROM capacity_events WHERE kind='DEADLINE_ESTIMATE'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    summaries.reduce((sum, result) => sum + result.estimated, 0),
    1,
  );
  const reports = await Promise.allSettled(
    Array.from({ length: workers }, (_, i) =>
      governor.settle(f.staff, {
        reservationId: 'pending-race',
        inputTokens: '15',
        outputTokens: '5',
        idempotencyKey: 'boundary-concurrent-late-' + i,
      }),
    ),
  );
  assert.equal(reports.filter((result) => result.status === 'fulfilled').length, 1);
  for (const result of reports.filter((result) => result.status === 'rejected'))
    assert.equal(result.reason.code, 'CAPACITY_RESOLVED');
  assert.equal(
    (
      await f.db.query(
        "SELECT count(*)::int AS n FROM capacity_events WHERE kind='LATE_CORRECTION'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await f.governor.reservation(A, 'pending-race')).state, 'CORRECTED');
});
