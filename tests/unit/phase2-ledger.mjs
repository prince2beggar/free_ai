import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createDatabase,
  migrateUp,
  migrateDown,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createRegistry, seedRegistryReviewActor } from '../../packages/registry/index.mjs';
import { createLedger } from '../../packages/ledger/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';

const A = SYNTHETIC_SEED.userA;
const B = SYNTHETIC_SEED.userB;
const start = Date.parse('2026-10-13T00:00:00Z');
async function fixture(t, options = {}, dataDir) {
  const db = await createDatabase({ dataDir });
  await migrateUp(db, { throughVersion: 4 });
  await seedSynthetic(db);
  const staff = await seedRegistryReviewActor(db);
  const registry = createRegistry(db);
  await registry.createProvider(
    staff,
    {
      id: 'ledger-fixture-provider',
      name: 'Synthetic ledger fixture',
      adapterKind: 'synthetic_mock',
      status: 'disabled',
      termsUrl: 'https://example.invalid/fixture',
      termsReviewedAt: '2026-10-13',
      dataPolicy: 'synthetic_only',
      allowsMultiuser: true,
      ownerApproved: true,
      quotaConfirmed: true,
    },
    { idempotencyKey: 'ledger-provider-create', expectedRevision: 0 },
  );
  await registry.updateProvider(
    staff,
    'ledger-fixture-provider',
    { status: 'enabled' },
    { idempotencyKey: 'ledger-provider-enable', expectedRevision: 1 },
  );
  await registry.createModel(
    staff,
    {
      id: 'ledger-fixture-model',
      providerId: 'ledger-fixture-provider',
      externalName: 'ledger-fixture-model',
      displayName: 'Synthetic exact accounting model',
      capabilities: ['text'],
      contextLimit: 4096,
      contextVerified: true,
      modelClass: 'synthetic',
      cuInputRate: '1000',
      cuOutputRate: '1000',
      ratesVerified: true,
      freeFlag: false,
      status: 'disabled',
    },
    { idempotencyKey: 'ledger-model-create', expectedRevision: 0 },
  );
  await registry.updateModel(
    staff,
    'ledger-fixture-model',
    { status: 'enabled' },
    { idempotencyKey: 'ledger-model-enable', expectedRevision: 1 },
  );
  const f = { db, staff, registry, time: start, ledger: null };
  f.ledger = createLedger(db, {
    clock: () => f.time,
    reconciliationMs: 1000,
    taskWaitTimeoutMs: 2000,
    ...options,
  });
  if (t) t.after(() => db.close());
  return f;
}
const key = (idempotencyKey) => ({ idempotencyKey });
async function grant(
  f,
  {
    userId = A,
    entitlementId = 'allowance-a',
    costMicroCu = '1000000',
    inputTokens = '100',
    outputTokens = '100',
    kind = 'free',
    ...other
  } = {},
) {
  return f.ledger.grant(f.staff, {
    userId,
    entitlementId,
    kind,
    costMicroCu,
    inputTokens,
    outputTokens,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3600000).toISOString(),
    idempotencyKey: 'grant-' + entitlementId,
    ...other,
  });
}
async function reserve(f, id = 'request-one', other = {}) {
  return f.ledger.reserve(A, {
    entitlementId: 'allowance-a',
    reservationId: id,
    requestId: id,
    kind: 'request',
    costMicroCu: '200000',
    inputTokens: '20',
    outputTokens: '0',
    ...key('reserve-' + id),
    ...other,
  });
}
const dispatch = (f, id = 'request-one') =>
  f.ledger.dispatch(f.staff, {
    reservationId: id,
    modelId: 'ledger-fixture-model',
    ...key('dispatch-' + id),
  });
const settle = (f, id = 'request-one', other = {}) =>
  f.ledger.settle(f.staff, {
    reservationId: id,
    inputTokens: '12',
    outputTokens: '0',
    toolSurchargeCu: '0',
    ...key('settle-' + id),
    ...other,
  });
async function allowance(f, actor = A) {
  return (await f.ledger.usage(actor)).entitlements[0];
}
const remaining = async (f) => (await allowance(f)).remaining;

test('ledger migration is opt-in, reversible on disposable data, and leaves earlier migrations intact', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  assert.deepEqual(await migrateUp(db), [1]);
  await seedSynthetic(db);
  await assert.rejects(db.query('SELECT * FROM usage_ledger'));
  assert.deepEqual(await migrateUp(db, { throughVersion: 4 }), [2, 3, 4]);
  assert.deepEqual(await migrateDown(db), [4]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 2);
  assert.deepEqual(await migrateUp(db, { throughVersion: 4 }), [4]);
});

test('standalone settlement releases full hold and records actual spend once in all dimensions', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await reserve(f);
  assert.deepEqual(await remaining(f), {
    costMicroCu: '800000',
    inputTokens: '80',
    outputTokens: '100',
  });
  await dispatch(f);
  assert.equal((await allowance(f)).pendingReconciliation, true);
  const result = await settle(f);
  assert.deepEqual(await remaining(f), {
    costMicroCu: '880000',
    inputTokens: '88',
    outputTokens: '100',
  });
  assert.equal((await allowance(f)).spent.costMicroCu, '120000');
  assert.deepEqual(await settle(f), result);
  await assert.rejects(settle(f, 'request-one', { inputTokens: '11' }), /idempotency/i);
  await assert.rejects(settle(f, 'request-one', { ...key('second-settlement') }), /resolved/i);
  const rows = await f.ledger.history(A);
  assert.deepEqual(
    rows.map((r) => r.type),
    ['grant', 'reserve', 'release', 'commit'],
  );
  for (const table of ['usage_ledger', 'ledger_operations']) {
    await assert.rejects(f.db.query('DELETE FROM ' + table), /append-only/);
    await assert.rejects(f.db.exec('TRUNCATE ' + table + ' CASCADE'), /append-only/);
  }
});

test('concurrent reservations and settlement preserve sum-of-rows balance without overspending (T2.4)', async (t) => {
  const f = await fixture(t);
  await grant(f, { costMicroCu: '1000000' });
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => reserve(f, 'race-' + i)),
  );
  const accepted = outcomes.flatMap((r, i) => (r.status === 'fulfilled' ? ['race-' + i] : []));
  assert.equal(accepted.length, 5);
  assert.equal((await remaining(f)).costMicroCu, '0');
  await Promise.all(accepted.map((id) => dispatch(f, id)));
  await Promise.all(accepted.flatMap((id) => [settle(f, id), settle(f, id)]));
  const sum = (
    await f.db.query('SELECT sum(amount_micro_cu)::text AS n FROM usage_ledger WHERE user_id=$1', [
      A,
    ])
  ).rows[0].n;
  assert.equal(sum, '400000');
  assert.equal((await remaining(f)).costMicroCu, sum);
  assert.equal((await allowance(f)).spent.costMicroCu, '600000');
});

test('cancellation before dispatch releases; cancellation after dispatch retains a bounded hold until deadline (T2.8)', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await reserve(f, 'before');
  await f.ledger.cancel(A, { reservationId: 'before', ...key('cancel-before') });
  assert.equal((await remaining(f)).costMicroCu, '1000000');
  await assert.rejects(dispatch(f, 'before'), /state|dispatch/i);
  await reserve(f);
  await dispatch(f);
  await f.ledger.cancel(A, { reservationId: 'request-one', ...key('cancel-after') });
  assert.equal((await remaining(f)).costMicroCu, '800000');
  assert.equal((await f.ledger.reservation(A, 'request-one')).state, 'PENDING_RECONCILIATION');
  f.time += 999;
  assert.equal((await f.ledger.sweep(f.staff)).estimated, 0);
  f.time += 1;
  assert.equal((await f.ledger.sweep(f.staff)).estimated, 1);
  assert.equal((await allowance(f)).estimated, true);
  assert.equal((await allowance(f)).spent.costMicroCu, '200000');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM ledger_alerts')).rows[0].n, 1);
  await assert.rejects(f.db.query('DELETE FROM ledger_alerts'), /append-only/);
  await assert.rejects(
    f.db.query('UPDATE usage_ledger SET estimate_flag=FALSE WHERE estimate_flag'),
    /append-only/,
  );
  assert.equal((await f.ledger.sweep(f.staff)).estimated, 0);
  await settle(f);
  assert.equal((await remaining(f)).costMicroCu, '880000');
  assert.equal((await allowance(f)).estimated, false);
  assert.equal((await allowance(f)).pendingReconciliation, false);
  const rows = await f.ledger.history(A);
  const estimated = rows.find((r) => r.type === 'commit' && r.estimateFlag);
  const correction = rows.find((r) => r.reconcilesEntryId === estimated.id);
  assert.equal(correction.amountMicroCu, '80000');
  assert.equal(estimated.estimateFlag, true);
  await settle(f);
  await assert.rejects(settle(f, 'request-one', { ...key('late-twice') }), /resolved/i);
});

test('settlement and cancellation races converge safely, and dispatch cannot reuse an attempt', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await reserve(f);
  await dispatch(f);
  const values = await Promise.allSettled([
    f.ledger.cancel(A, { reservationId: 'request-one', ...key('race-cancel') }),
    settle(f),
  ]);
  assert.equal(values.filter((v) => v.status === 'fulfilled').length >= 1, true);
  assert.equal((await remaining(f)).costMicroCu, '880000');
  await assert.rejects(
    f.ledger.dispatch(f.staff, {
      reservationId: 'request-one',
      modelId: 'ledger-fixture-model',
      ...key('dispatch-reused-attempt'),
    }),
    /state|dispatch|resolved/i,
  );
});

test('parent task calls allocate without a second debit and retain funds across pauses and review', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await reserve(f, 'task-one', { kind: 'task', costMicroCu: '400000', inputTokens: '40' });
  assert.equal((await remaining(f)).costMicroCu, '600000');
  await f.ledger.allocate(A, {
    parentId: 'task-one',
    reservationId: 'child-one',
    requestId: 'child-one',
    costMicroCu: '200000',
    inputTokens: '20',
    outputTokens: '0',
    ...key('allocate-child-one'),
  });
  assert.equal((await remaining(f)).costMicroCu, '600000');
  await dispatch(f, 'child-one');
  await settle(f, 'child-one');
  assert.equal((await remaining(f)).costMicroCu, '600000');
  assert.equal((await f.ledger.reservation(A, 'task-one')).outstanding.costMicroCu, '280000');
  await f.ledger.taskState(A, {
    reservationId: 'task-one',
    state: 'REVIEW',
    ...key('task-review'),
  });
  await assert.rejects(
    f.ledger.allocate(A, {
      parentId: 'task-one',
      reservationId: 'paused-child',
      requestId: 'paused-child',
      costMicroCu: '10000',
      inputTokens: '1',
      outputTokens: '0',
      ...key('allocate-paused-child'),
    }),
    /active/i,
  );
  assert.equal((await remaining(f)).costMicroCu, '600000');
  await f.ledger.finishTask(A, {
    reservationId: 'task-one',
    outcome: 'COMPLETE',
    ...key('task-complete'),
  });
  assert.equal((await remaining(f)).costMicroCu, '880000');
});

test('terminal task releases only unused funds and pending child allocation survives until reconciliation', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await reserve(f, 'task-one', { kind: 'task', costMicroCu: '400000', inputTokens: '40' });
  await f.ledger.allocate(A, {
    parentId: 'task-one',
    reservationId: 'child-one',
    requestId: 'child-one',
    costMicroCu: '200000',
    inputTokens: '20',
    outputTokens: '0',
    ...key('allocate-child-one'),
  });
  await dispatch(f, 'child-one');
  await f.ledger.finishTask(A, {
    reservationId: 'task-one',
    outcome: 'CANCELLED',
    ...key('task-cancel'),
  });
  assert.equal((await remaining(f)).costMicroCu, '800000');
  assert.equal((await f.ledger.reservation(A, 'task-one')).outstanding.costMicroCu, '200000');
  await settle(f, 'child-one');
  assert.equal((await remaining(f)).costMicroCu, '880000');
  assert.equal((await f.ledger.reservation(A, 'task-one')).outstanding.costMicroCu, '0');
  await assert.rejects(
    f.ledger.allocate(A, {
      parentId: 'task-one',
      reservationId: 'new-child',
      requestId: 'new-child',
      costMicroCu: '10000',
      inputTokens: '1',
      outputTokens: '0',
      ...key('allocate-new-child'),
    }),
    /active/i,
  );
});

test('late task correction restores active parent hold and waiting timeout frees it', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await reserve(f, 'task-one', { kind: 'task', costMicroCu: '400000', inputTokens: '40' });
  await f.ledger.allocate(A, {
    parentId: 'task-one',
    reservationId: 'child-one',
    requestId: 'child-one',
    costMicroCu: '200000',
    inputTokens: '20',
    outputTokens: '0',
    ...key('allocate-child-one'),
  });
  await dispatch(f, 'child-one');
  f.time += 1000;
  await f.ledger.sweep(f.staff);
  await settle(f, 'child-one');
  assert.equal((await remaining(f)).costMicroCu, '600000');
  assert.equal((await f.ledger.reservation(A, 'task-one')).outstanding.costMicroCu, '280000');
  await f.ledger.taskState(A, {
    reservationId: 'task-one',
    state: 'AWAITING_APPROVAL',
    ...key('await-approval'),
  });
  f.time += 2000;
  assert.equal((await f.ledger.sweep(f.staff)).timedOut, 1);
  assert.equal((await remaining(f)).costMicroCu, '880000');
});

test('grants, authoritative usage, adjustments and sweep need trusted staff; resources are strictly owned', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await assert.rejects(
    f.ledger.grant(A, {
      userId: A,
      entitlementId: 'forged',
      kind: 'free',
      costMicroCu: '1',
      inputTokens: '1',
      outputTokens: '1',
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 1000).toISOString(),
      ...key('forged-grant'),
    }),
    /staff/i,
  );
  await assert.rejects(
    f.ledger.reserve(B, {
      entitlementId: 'allowance-a',
      reservationId: 'foreign',
      requestId: 'foreign',
      kind: 'request',
      costMicroCu: '1',
      inputTokens: '1',
      outputTokens: '0',
      ...key('foreign-reserve'),
    }),
    /not found/i,
  );
  await reserve(f);
  await assert.rejects(f.ledger.reservation(B, 'request-one'), /not found/i);
  assert.deepEqual((await f.ledger.usage(B)).entitlements, []);
  assert.deepEqual(await f.ledger.history(B), []);
  await assert.rejects(
    f.ledger.dispatch(A, {
      reservationId: 'request-one',
      modelId: 'ledger-fixture-model',
      ...key('forged-dispatch'),
    }),
    /staff/i,
  );
  await dispatch(f);
  await assert.rejects(
    f.ledger.settle(A, {
      reservationId: 'request-one',
      inputTokens: '0',
      outputTokens: '0',
      ...key('forged-settle'),
    }),
    /staff/i,
  );
  await assert.rejects(f.ledger.sweep(A), /staff/i);
  await assert.rejects(
    f.ledger.adjust(A, {
      entitlementId: 'allowance-a',
      costMicroCu: '1',
      inputTokens: '0',
      outputTokens: '0',
      type: 'adjust',
      reasonCode: 'LOCAL_CORRECTION',
      ...key('forged-adjust'),
    }),
    /staff/i,
  );
  await f.db.query("UPDATE users SET status='suspended' WHERE id=$1", [f.staff]);
  await assert.rejects(settle(f), /active|staff/i);
});

test('unknown rates, legacy placeholders, token/cost bounds and malformed payloads fail closed', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await reserve(f);
  await assert.rejects(
    f.ledger.dispatch(f.staff, {
      reservationId: 'request-one',
      modelId: SYNTHETIC_SEED.model,
      ...key('legacy-dispatch'),
    }),
    /model|rate/i,
  );
  await dispatch(f);
  await assert.rejects(settle(f, 'request-one', { inputTokens: '21' }), /bound/i);
  await assert.rejects(settle(f, 'request-one', { toolSurchargeCu: '1' }), /bound/i);
  await assert.rejects(reserve(f, 'bad-number', { costMicroCu: 1 }), /integer|amount/i);
  await assert.rejects(reserve(f, 'bad-field', { override: true }), /field|payload/i);
  await assert.rejects(reserve(f, 'not-funded', { costMicroCu: '900000' }), /fund|balance/i);
  assert.equal((await remaining(f)).costMicroCu, '800000');
  const before = (await f.ledger.history(A)).length;
  await assert.rejects(
    f.ledger.adjust(f.staff, {
      entitlementId: 'allowance-a',
      costMicroCu: '-900000',
      inputTokens: '0',
      outputTokens: '0',
      type: 'adjust',
      reasonCode: 'LOCAL_CORRECTION',
      ...key('negative-balance'),
    }),
    /balance/i,
  );
  assert.equal((await f.ledger.history(A)).length, before);
});

test('idempotency is semantic and scoped; refunds and expiry replay without duplicate rows', async (t) => {
  const f = await fixture(t);
  const g = await grant(f);
  assert.deepEqual(await grant(f), g);
  await assert.rejects(grant(f, { inputTokens: '101' }), /idempotency/i);
  await f.ledger.adjust(f.staff, {
    entitlementId: 'allowance-a',
    costMicroCu: '10',
    inputTokens: '1',
    outputTokens: '0',
    type: 'refund',
    reasonCode: 'LOCAL_REFUND',
    ...key('fixture-refund'),
  });
  await f.ledger.adjust(f.staff, {
    ...key('fixture-refund'),
    reasonCode: 'LOCAL_REFUND',
    type: 'refund',
    outputTokens: '0',
    inputTokens: '1',
    costMicroCu: '10',
    entitlementId: 'allowance-a',
  });
  assert.equal((await remaining(f)).costMicroCu, '1000010');
  f.time += 3600000;
  assert.equal((await allowance(f)).refusalReason, 'ENTITLEMENT_EXPIRED');
  await assert.rejects(reserve(f), /expired/i);
  await f.ledger.expire(f.staff, { entitlementId: 'allowance-a', ...key('expire-fixture') });
  await f.ledger.expire(f.staff, { entitlementId: 'allowance-a', ...key('expire-fixture') });
  assert.deepEqual(await remaining(f), { costMicroCu: '0', inputTokens: '0', outputTokens: '0' });
});

test('local storage admission keeps capacity to close existing holds and late corrections', async (t) => {
  const f = await fixture(t, { maxLedgerRows: 5, maxOperations: 8 });
  await grant(f);
  await reserve(f);
  await assert.rejects(reserve(f, 'storage-extra'), /storage/i);
  await dispatch(f);
  await f.ledger.cancel(A, { reservationId: 'request-one', ...key('storage-cancel') });
  f.time += 1000;
  await f.ledger.sweep(f.staff);
  await settle(f);
  assert.equal((await remaining(f)).costMicroCu, '880000');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM usage_ledger')).rows[0].n, 5);
});

test('file-backed ledger survives close/reopen with pending holds, snapshots, journals and reconciliation deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'free-ai-ledger-'));
  let f;
  try {
    f = await fixture(null, {}, directory);
    await grant(f);
    await reserve(f);
    await dispatch(f);
    await f.ledger.cancel(A, { reservationId: 'request-one', ...key('durable-cancel') });
    await f.db.close();
    f = null;
    const db = await createDatabase({ dataDir: directory });
    f = { db, staff: 'registry-local-reviewer', time: start + 1000, ledger: null };
    f.ledger = createLedger(db, { clock: () => f.time, reconciliationMs: 1000 });
    assert.equal((await remaining(f)).costMicroCu, '800000');
    assert.equal((await f.ledger.sweep(f.staff)).estimated, 1);
    await settle(f);
    assert.equal((await remaining(f)).costMicroCu, '880000');
  } finally {
    if (f) await f.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('stored amounts above the JS safe integer limit preserve every digit in reservations and owned history', async (t) => {
  const f = await fixture(t);
  await grant(f, { costMicroCu: '9007199254740993', inputTokens: '9007199254740993' });
  const r = await reserve(f, 'large-bound', {
    costMicroCu: '9007199254740993',
    inputTokens: '9007199254740993',
  });
  assert.equal(r.bound.costMicroCu, '9007199254740993');
  assert.equal(
    (await f.ledger.reservation(A, 'large-bound')).outstanding.inputTokens,
    '9007199254740993',
  );
  assert.equal((await f.ledger.history(A))[0].amountMicroCu, '9007199254740993');
  assert.equal((await f.ledger.history(A))[1].tokensIn, '-9007199254740993');
  await f.ledger.cancel(A, { reservationId: 'large-bound', ...key('cancel-large-bound') });
  assert.equal((await remaining(f)).costMicroCu, '9007199254740993');
});

test('dispatch snapshots retain exact rates through later registry repricing and reject unknown tool prices', async (t) => {
  const f = await fixture(t);
  await grant(f);
  await reserve(f);
  await assert.rejects(
    f.ledger.dispatch(f.staff, {
      reservationId: 'request-one',
      modelId: 'ledger-fixture-model',
      toolSurchargeCu: null,
      ...key('unknown-tool-price'),
    }),
    /invalid|unknown/i,
  );
  await dispatch(f);
  await f.registry.updateModel(
    f.staff,
    'ledger-fixture-model',
    { cuInputRate: '2000' },
    { idempotencyKey: 'synthetic-repricing', expectedRevision: 2 },
  );
  await assert.rejects(
    f.db.query("UPDATE provider_attempts SET price_snapshot='{}'::jsonb"),
    /append-only/,
  );
  await settle(f);
  assert.equal((await allowance(f)).spent.costMicroCu, '120000');
});

test('storage reserves both active-parent correction rows and its final release', async (t) => {
  const f = await fixture(t, { maxLedgerRows: 7 });
  await grant(f);
  await reserve(f, 'task-one', { kind: 'task', costMicroCu: '400000', inputTokens: '40' });
  await f.ledger.allocate(A, {
    parentId: 'task-one',
    reservationId: 'child-one',
    requestId: 'child-one',
    costMicroCu: '200000',
    inputTokens: '20',
    outputTokens: '0',
    ...key('allocate-child-one'),
  });
  await assert.rejects(reserve(f, 'unfunded-storage'), /storage/i);
  await dispatch(f, 'child-one');
  f.time += 1000;
  await f.ledger.sweep(f.staff);
  await settle(f, 'child-one');
  await f.ledger.finishTask(A, {
    reservationId: 'task-one',
    outcome: 'COMPLETE',
    ...key('final-release-task'),
  });
  assert.equal((await remaining(f)).costMicroCu, '880000');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM usage_ledger')).rows[0].n, 7);
});

test('maximum-length request identifiers reconcile and retain immutable staff attribution', async (t) => {
  const f = await fixture(t);
  await grant(f);
  const id = 'long-' + 'x'.repeat(155);
  await reserve(f, id, { idempotencyKey: 'reserve-long-identifier' });
  await f.ledger.dispatch(f.staff, {
    reservationId: id,
    modelId: 'ledger-fixture-model',
    ...key('dispatch-long-identifier'),
  });
  f.time += 1000;
  assert.equal((await f.ledger.sweep(f.staff)).estimated, 1);
  const ops = (
    await f.db.query(
      "SELECT actor_role FROM ledger_operations WHERE action IN ('grant','dispatch','deadline')",
    )
  ).rows;
  assert.equal(ops.length, 3);
  assert.equal(
    ops.every((r) => r.actor_role === 'owner'),
    true,
  );
});

test('zero funded balance cannot create a positive-cost dispatch marker', async (t) => {
  const f = await fixture(t);
  await grant(f, { costMicroCu: '0' });
  await reserve(f, 'no-funds', { costMicroCu: '0', inputTokens: '1' });
  await assert.rejects(dispatch(f, 'no-funds'), /bound/i);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_attempts')).rows[0].n, 0);
  assert.equal((await allowance(f)).refusalReason, null);
  await f.registry.updateModel(
    f.staff,
    'ledger-fixture-model',
    { cuInputRate: '0', cuOutputRate: '0', freeFlag: true },
    { idempotencyKey: 'zero-rate-synthetic', expectedRevision: 2 },
  );
  await dispatch(f, 'no-funds');
  await settle(f, 'no-funds', { inputTokens: '1' });
  assert.equal((await allowance(f)).spent.costMicroCu, '0');
  assert.equal((await remaining(f)).inputTokens, '99');
});

test('acknowledged ledger rows and hold state survive process exit without a graceful database close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'free-ai-ledger-crash-'));
  let db;
  try {
    const worker = fileURLToPath(new URL('./ledger-durability-worker.mjs', import.meta.url));
    const result = await promisify(execFile)(process.execPath, [worker, directory], {
      timeout: 30000,
      maxBuffer: 65536,
    });
    assert.match(result.stdout, /ACKNOWLEDGED_LEDGER_COMMIT/);
    db = await createDatabase({ dataDir: directory });
    const ledger = createLedger(db, { clock: () => start });
    const usage = await ledger.usage(A);
    assert.equal(usage.entitlements[0].remaining.costMicroCu, '800000');
    assert.equal((await ledger.reservation(A, 'crash-hold')).state, 'RESERVED');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM ledger_operations')).rows[0].n, 2);
  } finally {
    if (db) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('real owned ledger views run alongside multiple synthetic registry models and keep free/pack allowances isolated', async (t) => {
  const f = await fixture(null);
  const config = await loadConfig({}, { port: 0, limits: { chunkDelayMs: 0 } });
  const server = createApp({
    db: f.db,
    config,
    ledger: f.ledger,
    syntheticChatModelId: SYNTHETIC_SEED.model,
  });
  t.after(async () => {
    await server.shutdown();
    await f.db.close();
  });
  await grant(f);
  await grant(f, {
    entitlementId: 'pack-a',
    kind: 'pack',
    costMicroCu: '100000',
    inputTokens: '10',
    outputTokens: '10',
  });
  await grant(f, {
    userId: B,
    entitlementId: 'pack-b',
    kind: 'pack',
    costMicroCu: '500000',
    inputTokens: '50',
    outputTokens: '50',
  });
  await reserve(f);
  await server.ready;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function signIn(identity) {
    const bootstrap = await fetch(base + '/api/bootstrap');
    const data = await bootstrap.json();
    const cookie = bootstrap.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const login = await fetch(base + '/api/auth/local', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: base,
        'X-CSRF-Token': data.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identity, acceptedLegalVersion: data.legalVersion }),
    });
    assert.equal(login.status, 200);
    return login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  }
  const cookieA = await signIn('demo-alpha'),
    cookieB = await signIn('demo-beta');
  const usageA = await (await fetch(base + '/api/usage', { headers: { Cookie: cookieA } })).json();
  const usageB = await (await fetch(base + '/api/usage', { headers: { Cookie: cookieB } })).json();
  assert.equal(usageA.entitlements.length, 2);
  assert.equal(usageA.entitlements.find((e) => e.kind === 'free').remaining.costMicroCu, '800000');
  assert.equal(usageA.entitlements.find((e) => e.kind === 'pack').remaining.inputTokens, '10');
  assert.deepEqual(
    usageB.entitlements.map((e) => e.id),
    ['pack-b'],
  );
  const historyB = await (
    await fetch(base + '/api/usage/history', { headers: { Cookie: cookieB } })
  ).json();
  assert.deepEqual(
    historyB.history.map((e) => e.entitlementId),
    ['pack-b'],
  );
});
