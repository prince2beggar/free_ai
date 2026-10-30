import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import {
  createDatabase,
  migrateUp,
  migrateDown,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createAbuse } from '../../packages/abuse/index.mjs';
const A = SYNTHETIC_SEED.userA,
  B = SYNTHETIC_SEED.userB;
const source = { deviceToken: 'test-device-opaque-0000000000000001', ipAddress: '192.0.2.12' };
function proof(c) {
  for (let n = 0; n < 10000000; n++) {
    const bytes = createHash('sha256')
      .update(c.nonce + ':' + n)
      .digest();
    if (
      Array.from(
        { length: c.difficulty },
        (_, bit) => bytes[Math.floor(bit / 8)] & (128 >> (bit % 8)),
      ).every((x) => x === 0)
    )
      return { id: c.id, solution: String(n) };
  }
  throw new Error('Fixture proof search exceeded its bound.');
}
async function fixture(t, overrides = {}) {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 7 });
  await seedSynthetic(db);
  const f = { db, time: Date.parse('2026-10-13T00:00:00.000Z'), key: randomBytes(32) };
  await db.query(
    "INSERT INTO users(id,identity_provider,provider_subject,display_name,role,created_at) VALUES('abuse-staff','synthetic','abuse-staff','Synthetic abuse moderator','owner',$1)",
    [new Date(f.time).toISOString()],
  );
  await db.query('UPDATE users SET created_at=$1', [new Date(f.time).toISOString()]);
  f.abuse = createAbuse(db, {
    key: f.key,
    clock: () => f.time,
    challengeDifficulty: 4,
    ...overrides,
  });
  f.signup = async (userId = A, s = source) => {
    const c = await f.abuse.challenge(userId, { purpose: 'signup', source: s });
    return f.abuse.withTransaction((tx) =>
      f.abuse.signupInTransaction(tx, { userId, source: s, challenge: proof(c) }),
    );
  };
  f.ownedRequest = async (tx, userId, requestId) => {
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
  };
  f.admit = async (userId = A, s = source, challenge, requestId = randomUUID()) =>
    f.abuse.withTransaction(async (tx) => {
      await f.ownedRequest(tx, userId, requestId);
      return f.abuse.admitInTransaction(tx, { userId, source: s, challenge, requestId });
    });
  return f;
}
const code = (c) => (e) => e.code === c;
test('new accounts start at zero; trusted age/contact/good behavior derives configurable levels and reduced limits', async (t) => {
  const f = await fixture(t);
  const initial = await f.abuse.status(A);
  assert.equal(initial.trustLevel, 0);
  await assert.rejects(
    f.abuse.setTrustEvidence(B, {
      targetId: A,
      verifiedContact: true,
      goodBehavior: 100,
      reason: 'VERIFIED_LOCAL_EVIDENCE',
      idempotencyKey: 'bad',
    }),
    code('ABUSE_FORBIDDEN'),
  );
  f.time += 31 * 86400000;
  await f.abuse.setTrustEvidence('abuse-staff', {
    targetId: A,
    verifiedContact: true,
    goodBehavior: 100,
    reason: 'VERIFIED_LOCAL_EVIDENCE',
    idempotencyKey: 'trusted',
  });
  const trusted = await f.abuse.status(A);
  assert.equal(trusted.trustLevel, 3);
  assert.ok(trusted.limits.dailyRequests > initial.limits.dailyRequests);
  await assert.rejects(
    f.db.query('UPDATE users SET trust_level=4 WHERE id=$1', [A]),
    code('23514'),
  );
});
test('signup proof is server minted, verified, source/purpose bound, expires and is single use', async (t) => {
  const f = await fixture(t),
    c = await f.abuse.challenge(A, { purpose: 'signup', source });
  assert.equal(c.humanVerification, false);
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.signupInTransaction(tx, {
        userId: A,
        source,
        challenge: { id: c.id, solution: 'invalid' },
      }),
    ),
    code('INVALID_ABUSE'),
  );
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.signupInTransaction(tx, { userId: B, source, challenge: proof(c) }),
    ),
    code('ABUSE_CHALLENGE'),
  );
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.signupInTransaction(tx, {
        userId: A,
        source: { ...source, ipAddress: '198.51.100.1' },
        challenge: proof(c),
      }),
    ),
    code('ABUSE_CHALLENGE'),
  );
  await f.abuse.withTransaction((tx) =>
    f.abuse.signupInTransaction(tx, { userId: A, source, challenge: proof(c) }),
  );
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.signupInTransaction(tx, { userId: A, source, challenge: proof(c) }),
    ),
    code('ABUSE_CHALLENGE'),
  );
  const expired = await f.abuse.challenge(A, { purpose: 'signup', source });
  f.time += 120001;
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.signupInTransaction(tx, { userId: A, source, challenge: proof(expired) }),
    ),
    code('ABUSE_CHALLENGE'),
  );
});
test('burst challenge gates logical requests while attempt checks do not charge fallback/retry twice', async (t) => {
  const f = await fixture(t);
  await f.signup();
  const first = await f.admit();
  assert.equal(first.charged, true);
  await assert.rejects(f.admit(), code('ABUSE_CHALLENGE_REQUIRED'));
  const c = await f.abuse.challenge(A, { purpose: 'burst', source });
  await f.admit(A, source, proof(c));
  await f.abuse.withTransaction(async (tx) => {
    await f.abuse.assertAttemptInTransaction(tx, { userId: A, requestId: first.requestId });
    await f.abuse.assertAttemptInTransaction(tx, { userId: A, requestId: first.requestId });
  });
  assert.equal((await f.abuse.status(A)).usage.dailyRequests, 2);
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.assertAttemptInTransaction(tx, { userId: B, requestId: first.requestId }),
    ),
    code('ABUSE_FORBIDDEN'),
  );
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.assertAttemptInTransaction(tx, { userId: A, requestId: randomUUID() }),
    ),
    code('ABUSE_ADMISSION_REQUIRED'),
  );
});
test('concurrent per-device new-account cap survives replay, deletion and new account identifiers', async (t) => {
  const f = await fixture(t, { burstChallengeAfter: 100, newAccountDeviceRequests: 1 });
  await f.signup();
  await f.signup(B);
  const results = await Promise.allSettled([f.admit(A), f.admit(B)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'ABUSE_SOURCE_LIMIT');
  const r = results.find((x) => x.status === 'fulfilled').value;
  assert.equal(
    (
      await f.admit(
        r.userId ?? (results[0].status === 'fulfilled' ? A : B),
        source,
        undefined,
        r.requestId,
      )
    ).charged,
    false,
  );
  await f.db.query("UPDATE users SET status='deleted',deleted_at=$1 WHERE id=$2", [
    new Date(f.time).toISOString(),
    results[0].status === 'fulfilled' ? A : B,
  ]);
  await f.db.query(
    "INSERT INTO users(id,identity_provider,provider_subject,display_name,created_at) VALUES('replacement','synthetic','replacement','Synthetic replacement',$1)",
    [new Date(f.time).toISOString()],
  );
  await f.signup('replacement');
  await assert.rejects(f.admit('replacement'), code('ABUSE_SOURCE_LIMIT'));
});
test('IP-range cap and durable minimal cluster alert contain no raw source values', async (t) => {
  const f = await fixture(t, { burstChallengeAfter: 100, newAccountIpRequests: 1 });
  await f.signup();
  const other = { deviceToken: 'test-device-opaque-0000000000000002', ipAddress: '192.0.2.99' };
  await f.signup(B, other);
  await f.admit();
  await assert.rejects(f.admit(B, other), code('ABUSE_SOURCE_LIMIT'));
  const alerts = await f.abuse.listAlerts('abuse-staff');
  assert.ok(alerts.some((r) => r.sourceKind === 'ip_range' && r.accountCount === 2));
  await assert.rejects(f.abuse.listAlerts(B), code('ABUSE_FORBIDDEN'));
  const raw = await f.db.query('SELECT source_hash FROM abuse_sources');
  assert.ok(raw.rows.every((r) => /^[a-f0-9]{64}$/.test(r.source_hash)));
  const records =
    JSON.stringify((await f.db.query('SELECT * FROM abuse_events')).rows) +
    JSON.stringify(alerts) +
    JSON.stringify(raw.rows);
  assert.equal(records.includes(source.ipAddress), false);
  assert.equal(records.includes(source.deviceToken), false);
});
test('moderator actions require current permission, recheck saved replay and block every pending attempt', async (t) => {
  const f = await fixture(t);
  await f.signup();
  const r = await f.admit();
  const change = {
    targetId: A,
    action: 'ban',
    until: null,
    reason: 'ACCOUNT_ABUSE',
    idempotencyKey: 'ban-a',
  };
  await assert.rejects(f.abuse.moderate(B, change), code('ABUSE_FORBIDDEN'));
  await f.abuse.moderate('abuse-staff', change);
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.assertAttemptInTransaction(tx, { userId: A, requestId: r.requestId }),
    ),
    code('ABUSE_MODERATED'),
  );
  await f.db.query("UPDATE users SET role='user' WHERE id='abuse-staff'");
  await assert.rejects(f.abuse.moderate('abuse-staff', change), code('ABUSE_FORBIDDEN'));
  await assert.rejects(f.db.query('DELETE FROM abuse_events'), code('42501'));
  await assert.rejects(f.db.exec('TRUNCATE abuse_events'), code('42501'));
});
test('bounded storage refusal rolls back admission and source counters atomically', async (t) => {
  const f = await fixture(t, { maxAdmissions: 1, burstChallengeAfter: 100 });
  await f.signup();
  await f.admit();
  const before = (await f.abuse.status(A)).usage.dailyRequests;
  await assert.rejects(f.admit(), code('ABUSE_STORAGE_LIMIT'));
  assert.equal((await f.abuse.status(A)).usage.dailyRequests, before);
});

test('actual owned chat row is mandatory, and another account cannot reuse its admission id', async (t) => {
  const f = await fixture(t);
  await f.signup();
  await f.signup(B);
  const requestId = randomUUID();
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.admitInTransaction(tx, { userId: A, source, requestId }),
    ),
    code('ABUSE_ADMISSION_REQUIRED'),
  );
  const admitted = await f.admit(A, source, undefined, requestId);
  await assert.rejects(f.admit(B, source, undefined, admitted.requestId), code('ABUSE_FORBIDDEN'));
  assert.equal((await f.abuse.status(B)).usage.dailyRequests, 0);
});

test('IPv4-mapped aliases and canonical IPv6 ranges share pseudonyms; zone identifiers fail safely', async (t) => {
  const f = await fixture(t, { burstChallengeAfter: 100, newAccountIpRequests: 1 });
  const c = await f.abuse.challenge(A, { purpose: 'signup', source });
  const mapped = { ...source, ipAddress: '::ffff:c000:020c' };
  await f.abuse.withTransaction((tx) =>
    f.abuse.signupInTransaction(tx, { userId: A, source: mapped, challenge: proof(c) }),
  );
  await f.admit(A, mapped);
  await f.signup(B, {
    ...source,
    deviceToken: 'test-device-opaque-0000000000000003',
    ipAddress: '::ffff:192.0.2.99',
  });
  await assert.rejects(
    f.admit(B, {
      ...source,
      deviceToken: 'test-device-opaque-0000000000000003',
      ipAddress: '192.0.2.99',
    }),
    code('ABUSE_SOURCE_LIMIT'),
  );
  const six = { ...source, ipAddress: '2001:db8:1234:5678::1' };
  const challenge = await f.abuse.challenge(B, { purpose: 'signup', source: six });
  await f.abuse.withTransaction((tx) =>
    f.abuse.signupInTransaction(tx, {
      userId: B,
      source: { ...six, ipAddress: '2001:0DB8:1234:5678:0000:0000:0000:9999' },
      challenge: proof(challenge),
    }),
  );
  await assert.rejects(
    f.abuse.challenge(A, { purpose: 'signup', source: { ...source, ipAddress: 'fe80::1%3' } }),
    code('INVALID_ABUSE'),
  );
});

test('incorrect numeric proof and a signup-purpose proof cannot authorize a burst', async (t) => {
  const f = await fixture(t);
  const c = await f.abuse.challenge(A, { purpose: 'signup', source });
  let solution = 0;
  while (
    Array.from(
      { length: c.difficulty },
      (_, bit) =>
        createHash('sha256')
          .update(c.nonce + ':' + solution)
          .digest()[Math.floor(bit / 8)] &
        (128 >> (bit % 8)),
    ).every((x) => x === 0)
  )
    solution++;
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.signupInTransaction(tx, {
        userId: A,
        source,
        challenge: { id: c.id, solution: String(solution) },
      }),
    ),
    code('ABUSE_CHALLENGE'),
  );
  await f.signup();
  await f.admit();
  await assert.rejects(f.admit(A, source, proof(c)), code('ABUSE_CHALLENGE'));
  await assert.rejects(
    f.admit(),
    (e) =>
      e.code === 'ABUSE_CHALLENGE_REQUIRED' &&
      e.challengeRequired === true &&
      typeof e.resetAt === 'string',
  );
});

test('proof deadline and usage windows are checked after awaited caller writes and roll back every admission change', async (t) => {
  const f = await fixture(t);
  const c = await f.abuse.challenge(A, { purpose: 'signup', source });
  await assert.rejects(
    f.abuse.withTransaction(async (tx) => {
      await f.abuse.signupInTransaction(tx, { userId: A, source, challenge: proof(c) });
      f.time += 120000;
    }),
    code('ABUSE_CHALLENGE'),
  );
  assert.equal(
    (await f.db.query('SELECT consumed_at FROM abuse_challenges WHERE id=$1', [c.id])).rows[0]
      .consumed_at,
    null,
  );
  await f.signup();
  const requestId = randomUUID();
  await assert.rejects(
    f.abuse.withTransaction(async (tx) => {
      await f.ownedRequest(tx, A, requestId);
      await f.abuse.admitInTransaction(tx, { userId: A, requestId, source });
      f.time += 60000;
    }),
    code('ABUSE_WINDOW'),
  );
  assert.equal(
    (await f.db.query('SELECT 1 FROM abuse_admissions WHERE request_id=$1', [requestId])).rows
      .length,
    0,
  );
  assert.equal(
    (await f.db.query('SELECT 1 FROM chat_requests WHERE id=$1', [requestId])).rows.length,
    0,
  );
  assert.equal((await f.abuse.status(A)).usage.dailyRequests, 0);
  f.time--;
  await assert.rejects(f.abuse.status(A), code('ABUSE_CLOCK'));
});

test('throttle and current trust token caps override an older saved admission and expire with audit', async (t) => {
  const f = await fixture(t, { burstChallengeAfter: 100 });
  await f.signup();
  const r = await f.admit();
  await f.abuse.moderate('abuse-staff', {
    targetId: A,
    action: 'throttle',
    until: new Date(f.time + 3600000).toISOString(),
    reason: 'AUTOMATION_RISK',
    idempotencyKey: 'throttle-a',
  });
  const status = await f.abuse.status(A);
  assert.equal(status.limits.dailyRequests, 1);
  assert.equal(status.limits.dailyTokens, 500);
  await assert.rejects(f.admit(), code('ABUSE_USER_LIMIT'));
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.assertAttemptInTransaction(tx, {
        userId: A,
        requestId: r.requestId,
        inputTokens: '501',
        outputTokens: '0',
      }),
    ),
    code('ABUSE_TOKEN_LIMIT'),
  );
  const day = status.resetAt;
  await f.db.query(
    'INSERT INTO abuse_daily_token_counters(user_id,day_at,used_tokens) VALUES($1,$2,499)',
    [A, new Date(Date.parse(day) - 86400000).toISOString()],
  );
  await assert.rejects(
    f.abuse.withTransaction((tx) =>
      f.abuse.assertAttemptInTransaction(tx, {
        userId: A,
        requestId: r.requestId,
        inputTokens: 1n,
        outputTokens: 1n,
      }),
    ),
    code('ABUSE_TOKEN_LIMIT'),
  );
  f.time += 3600000;
  const after = await f.abuse.status(A);
  assert.equal(after.moderation.action, 'none');
  assert.equal(after.limits.dailyTokens, 1000);
  assert.equal(
    (await f.db.query("SELECT 1 FROM abuse_events WHERE kind='MODERATION_EXPIRED'")).rows.length,
    1,
  );
});

test('cached privileged replay is a stable receipt and rechecks current staff permission', async (t) => {
  const f = await fixture(t);
  const input = {
    targetId: A,
    verifiedContact: true,
    goodBehavior: 20,
    reason: 'VERIFIED_LOCAL_EVIDENCE',
    idempotencyKey: 'evidence-replay',
  };
  const first = await f.abuse.setTrustEvidence('abuse-staff', input);
  assert.deepEqual(await f.abuse.setTrustEvidence('abuse-staff', input), first);
  await assert.rejects(
    f.abuse.setTrustEvidence('abuse-staff', { ...input, goodBehavior: 21 }),
    code('ABUSE_IDEMPOTENCY_CONFLICT'),
  );
  const moderation = {
    targetId: B,
    action: 'suspend',
    until: new Date(f.time + 1000).toISOString(),
    reason: 'ACCOUNT_ABUSE',
    idempotencyKey: 'suspend-replay',
  };
  const suspended = await f.abuse.moderate('abuse-staff', moderation);
  await assert.rejects(
    f.abuse.challenge(B, { purpose: 'signup', source }),
    code('ABUSE_MODERATED'),
  );
  f.time += 1000;
  assert.deepEqual(await f.abuse.moderate('abuse-staff', moderation), suspended);
  assert.equal((await f.abuse.status(B)).moderation.action, 'none');
  await f.db.query("UPDATE users SET role='support' WHERE id='abuse-staff'");
  await assert.rejects(f.abuse.setTrustEvidence('abuse-staff', input), code('ABUSE_FORBIDDEN'));
});

test('moderation expiry can consume its reserved closure event when ordinary audit storage is full', async (t) => {
  const f = await fixture(t, { maxEvents: 6, moderationEventReserve: 1, burstChallengeAfter: 100 });
  await f.signup();
  await f.signup(B);
  await f.admit();
  await f.abuse.moderate('abuse-staff', {
    targetId: A,
    action: 'suspend',
    until: new Date(f.time + 1000).toISOString(),
    reason: 'ACCOUNT_ABUSE',
    idempotencyKey: 'reserved-suspend',
  });
  await f.abuse.setTrustEvidence('abuse-staff', {
    targetId: B,
    verifiedContact: false,
    goodBehavior: 1,
    reason: 'VERIFIED_LOCAL_EVIDENCE',
    idempotencyKey: 'fill-audit',
  });
  await assert.rejects(
    f.abuse.setTrustEvidence('abuse-staff', {
      targetId: B,
      verifiedContact: false,
      goodBehavior: 2,
      reason: 'VERIFIED_LOCAL_EVIDENCE',
      idempotencyKey: 'audit-full',
    }),
    code('ABUSE_STORAGE_LIMIT'),
  );
  f.time += 1000;
  assert.equal((await f.abuse.status(A)).moderation.action, 'none');
  assert.equal(
    Number((await f.db.query('SELECT count(*)::integer AS n FROM abuse_events')).rows[0].n),
    6,
  );
});

test('migration seven up/down/reapply preserves seeded Phase1 identities and restores its original trust constraint', async (t) => {
  const f = await fixture(t);
  await f.signup();
  const before = (
    await f.db.query('SELECT id,identity_provider,provider_subject FROM users ORDER BY id')
  ).rows;
  assert.deepEqual(await migrateDown(f.db, { steps: 1 }), [7]);
  assert.deepEqual(
    (await f.db.query('SELECT id,identity_provider,provider_subject FROM users ORDER BY id')).rows,
    before,
  );
  await f.db.query('UPDATE users SET trust_level=4 WHERE id=$1', [A]);
  await f.db.query('UPDATE users SET trust_level=0 WHERE id=$1', [A]);
  assert.deepEqual(await migrateUp(f.db, { throughVersion: 7 }), [7]);
  await assert.rejects(
    f.db.query('UPDATE users SET trust_level=4 WHERE id=$1', [A]),
    code('23514'),
  );
  assert.equal(
    Number((await f.db.query('SELECT count(*)::integer AS n FROM abuse_profiles')).rows[0].n),
    0,
  );
});

test('outer commit hook observes the final guard write, survives facade spreads and rejects stale caller snapshots', async (t) => {
  const f = await fixture(t);
  await f.signup();
  let finalGuardWritten = false;
  const wrapped = {
    ...f.db,
    transaction: (callback) =>
      f.db.transaction((tx) =>
        callback({
          ...tx,
          query: async (sql, params) => {
            const result = await tx.query(sql, params);
            if (sql.startsWith('UPDATE abuse_storage_guard')) {
              finalGuardWritten = true;
              f.time++;
            }
            return result;
          },
        }),
      ),
  };
  const abuse = createAbuse(wrapped, { key: f.key, clock: () => f.time, challengeDifficulty: 4 });
  const expiry = f.time + 1,
    requestId = randomUUID();
  await assert.rejects(
    abuse.withTransaction(async (tx) => {
      const adapter = { ...tx };
      adapter.onBeforeCommit((time) => {
        assert.equal(finalGuardWritten, true);
        if (time >= expiry) throw new Error('TEST_COMMIT_WINDOW_EXPIRED');
      });
      await f.ownedRequest(tx, A, requestId);
      await abuse.admitInTransaction(tx, { userId: A, requestId, source });
    }),
    /TEST_COMMIT_WINDOW_EXPIRED/,
  );
  assert.equal(
    (await f.db.query('SELECT 1 FROM chat_requests WHERE id=$1', [requestId])).rows.length,
    0,
  );
  assert.equal((await f.abuse.status(A)).usage.dailyRequests, 0);
});

test('commit hooks reject async callbacks before allowing a caller to schedule unguarded work', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.abuse.withTransaction(async (tx) => {
      tx.onBeforeCommit(async () => {});
    }),
    code('INVALID_ABUSE'),
  );
  const exists = await f.db.query('SELECT last_time FROM abuse_storage_guard WHERE id=1');
  assert.equal(exists.rows[0].last_time, null);
});

test('server-owned identity refresh restores expired suspension, preserves bans and never reactivates deleted users', async (t) => {
  const f = await fixture(t);
  await f.signup();
  await f.signup(B);
  await f.abuse.moderate('abuse-staff', {
    targetId: A,
    action: 'suspend',
    until: new Date(f.time + 1000).toISOString(),
    reason: 'ACCOUNT_ABUSE',
    idempotencyKey: 'refresh-suspend',
  });
  assert.equal((await f.abuse.refreshIdentity(A)).status, 'suspended');
  f.time += 1000;
  assert.equal((await f.abuse.refreshIdentity(A)).status, 'active');
  await f.abuse.moderate('abuse-staff', {
    targetId: B,
    action: 'ban',
    until: null,
    reason: 'ACCOUNT_ABUSE',
    idempotencyKey: 'refresh-ban',
  });
  const banned = await f.abuse.refreshIdentity(B);
  assert.equal(banned.status, 'suspended');
  assert.equal(banned.moderationAction, 'ban');
  await f.db.query("UPDATE users SET status='deleted',deleted_at=$1 WHERE id=$2", [
    new Date(f.time).toISOString(),
    A,
  ]);
  await assert.rejects(f.abuse.refreshIdentity(A), code('ABUSE_FORBIDDEN'));
  assert.equal(
    (await f.db.query('SELECT status FROM users WHERE id=$1', [A])).rows[0].status,
    'deleted',
  );
  await f.db.query(
    "INSERT INTO users(id,identity_provider,provider_subject,display_name) VALUES('real-identity','google','real-identity','Rejected real identity')",
  );
  await assert.rejects(f.abuse.refreshIdentity('real-identity'), code('ABUSE_FORBIDDEN'));
});

test('trust policy keeps level zero concurrency smallest', async () => {
  const { readFile } = await import('node:fs/promises');
  const defaults = JSON.parse(
    (
      await readFile(new URL('../../packages/abuse/defaults.json', import.meta.url), 'utf8')
    ).replace(/^\uFEFF/, ''),
  );
  const levels = structuredClone(defaults.trustLevels);
  levels[0].concurrency = 2;
  assert.throws(
    () => createAbuse({}, { key: randomBytes(32), trustLevels: levels }),
    code('INVALID_ABUSE_CONFIG'),
  );
});
