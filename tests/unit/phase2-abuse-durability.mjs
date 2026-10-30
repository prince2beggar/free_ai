import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createAbuse } from '../../packages/abuse/index.mjs';

function proof(challenge) {
  for (let solution = 0; solution < 1000000; solution++) {
    const bytes = createHash('sha256')
      .update(challenge.nonce + ':' + solution)
      .digest();
    if (
      Array.from(
        { length: challenge.difficulty },
        (_, bit) => bytes[Math.floor(bit / 8)] & (128 >> (bit % 8)),
      ).every((bit) => bit === 0)
    )
      return { id: challenge.id, solution: String(solution) };
  }
  throw new Error('Synthetic proof search exceeded its bound.');
}
const code = (expected) => (error) => error.code === expected;

test('file reopen preserves source/user caps, challenges, cluster alerts and moderation receipts; key replacement fails closed', async () => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'free-ai-abuse-'));
  let db;
  const time = Date.parse('2026-10-14T00:00:00.000Z'),
    key = randomBytes(32);
  const source = { deviceToken: 'test-persistent-device-000000000001', ipAddress: '192.0.2.10' };
  const otherDevice = { ...source, deviceToken: 'test-persistent-device-000000000002' };
  const A = SYNTHETIC_SEED.userA,
    B = SYNTHETIC_SEED.userB;
  const options = {
    key,
    clock: () => time,
    challengeDifficulty: 4,
    burstChallengeAfter: 100,
    newAccountDeviceRequests: 1,
    newAccountIpRequests: 1,
  };
  async function open() {
    db = await createDatabase({ dataDir: directory });
    await migrateUp(db, { throughVersion: 7 });
    return createAbuse(db, options);
  }
  async function signup(abuse, userId, observedSource) {
    const challenge = await abuse.challenge(userId, { purpose: 'signup', source: observedSource });
    const solution = proof(challenge);
    await abuse.withTransaction((tx) =>
      abuse.signupInTransaction(tx, { userId, source: observedSource, challenge: solution }),
    );
    return solution;
  }
  async function admit(abuse, userId, observedSource, requestId = randomUUID()) {
    return abuse.withTransaction(async (tx) => {
      const exists = (await tx.query('SELECT 1 FROM chat_requests WHERE id=$1', [requestId])).rows
        .length;
      if (!exists) {
        const conversationId = randomUUID();
        await tx.query('INSERT INTO conversations(id,user_id) VALUES($1,$2)', [
          conversationId,
          userId,
        ]);
        await tx.query(
          'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES($1,$2,$3,$1,$4)',
          [requestId, userId, conversationId, 'a'.repeat(64)],
        );
      }
      return abuse.admitInTransaction(tx, { userId, requestId, source: observedSource });
    });
  }
  try {
    let abuse = await open();
    await seedSynthetic(db);
    await db.query(
      "INSERT INTO users(id,identity_provider,provider_subject,display_name,role,created_at) VALUES('durable-abuse-staff','synthetic','durable-abuse-staff','Synthetic durable moderator','owner',$1)",
      [new Date(time).toISOString()],
    );
    await db.query('UPDATE users SET created_at=$1', [new Date(time).toISOString()]);
    const consumed = await signup(abuse, A, source);
    await signup(abuse, B, source);
    const admission = await admit(abuse, A, source);
    const operation = {
      targetId: B,
      action: 'throttle',
      until: new Date(time + 3600000).toISOString(),
      reason: 'CLUSTER_RISK',
      idempotencyKey: 'durable-moderation',
    };
    const receipt = await abuse.moderate('durable-abuse-staff', operation);
    const counters = (
      await db.query(
        'SELECT scope,owner_key,window_at,used FROM abuse_counters ORDER BY scope,owner_key',
      )
    ).rows;
    const alerts = await abuse.listAlerts('durable-abuse-staff');
    assert.equal(alerts.length, 2);
    assert.equal((await abuse.status(A)).usage.dailyRequests, 1);
    const events = Number(
      (await db.query('SELECT count(*)::integer AS n FROM abuse_events')).rows[0].n,
    );
    await db.close();
    db = null;

    abuse = await open();
    assert.deepEqual(
      (
        await db.query(
          'SELECT scope,owner_key,window_at,used FROM abuse_counters ORDER BY scope,owner_key',
        )
      ).rows,
      counters,
    );
    assert.equal((await abuse.status(A)).usage.dailyRequests, 1);
    assert.deepEqual(await abuse.listAlerts('durable-abuse-staff'), alerts);
    assert.deepEqual(await abuse.moderate('durable-abuse-staff', operation), receipt);
    assert.equal(
      Number((await db.query('SELECT count(*)::integer AS n FROM abuse_events')).rows[0].n),
      events,
    );
    assert.equal((await admit(abuse, A, source, admission.requestId)).charged, false);
    await assert.rejects(
      abuse.withTransaction((tx) =>
        abuse.signupInTransaction(tx, { userId: A, source, challenge: consumed }),
      ),
      code('ABUSE_CHALLENGE'),
    );
    await assert.rejects(admit(abuse, B, source), code('ABUSE_SOURCE_LIMIT'));
    await signup(abuse, B, otherDevice);
    await assert.rejects(admit(abuse, B, otherDevice), code('ABUSE_SOURCE_LIMIT'));
    assert.equal((await abuse.status(B)).usage.dailyRequests, 0);
    const beforeReplacement = (
      await db.query(
        'SELECT scope,owner_key,window_at,used FROM abuse_counters ORDER BY scope,owner_key',
      )
    ).rows;
    const replacement = createAbuse(db, { ...options, key: randomBytes(32) });
    let entered = false;
    await assert.rejects(
      replacement.withTransaction(async () => {
        entered = true;
      }),
      code('ABUSE_KEY_MISMATCH'),
    );
    assert.equal(entered, false);
    assert.deepEqual(
      (
        await db.query(
          'SELECT scope,owner_key,window_at,used FROM abuse_counters ORDER BY scope,owner_key',
        )
      ).rows,
      beforeReplacement,
    );
    await assert.rejects(replacement.status(A), code('ABUSE_KEY_MISMATCH'));
    assert.equal((await abuse.status(A)).usage.dailyRequests, 1);
    await db.close();
    db = null;
    abuse = await open();
    assert.equal((await abuse.status(A)).usage.dailyRequests, 1);
    assert.equal((await abuse.status(B)).moderation.action, 'throttle');
  } finally {
    if (db) await db.close();
    const absoluteDirectory = resolve(directory),
      owned = relative(tempRoot, absoluteDirectory);
    assert.ok(
      owned &&
        !isAbsolute(owned) &&
        !owned.startsWith('..') &&
        basename(absoluteDirectory).startsWith('free-ai-abuse-'),
    );
    assert.equal(await realpath(absoluteDirectory), absoluteDirectory);
    await rm(absoluteDirectory, { recursive: true, force: true });
  }
});
