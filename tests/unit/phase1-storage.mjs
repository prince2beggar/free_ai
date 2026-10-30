import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createRepository } from '../../packages/api/repository.mjs';
import { hashToken } from '../../packages/api/auth.mjs';

async function fixture(t, limits) {
  const db = await createDatabase();
  await migrateUp(db);
  await seedSynthetic(db);
  t.after(() => db.close());
  const config = await loadConfig({}, { limits });
  return { db, repository: createRepository(db, config) };
}

test('audit admission rolls back writes at capacity while reserving account deletion evidence', async (t) => {
  const { db, repository } = await fixture(t, { maxAuditEvents: 6 });
  await repository.acceptLegal(SYNTHETIC_SEED.userA);
  await repository.createSession(
    SYNTHETIC_SEED.userA,
    hashToken(randomUUID()),
    hashToken(randomUUID()),
  );
  await repository.createConversation(SYNTHETIC_SEED.userA, 'Synthetic first');
  await assert.rejects(
    repository.createConversation(SYNTHETIC_SEED.userA, 'Must roll back'),
    (error) => error.code === 'LOCAL_STORAGE_FULL',
  );
  assert.equal((await repository.listConversations(SYNTHETIC_SEED.userA)).length, 1);
  await repository.deleteAccount(SYNTHETIC_SEED.userA);
  assert.equal(
    (
      await db.query('SELECT COUNT(*) AS n FROM conversations WHERE user_id=$1', [
        SYNTHETIC_SEED.userA,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query('SELECT COUNT(*) AS n FROM sessions WHERE user_id=$1', [SYNTHETIC_SEED.userA]))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("SELECT COUNT(*) AS n FROM audit_events WHERE action='account_deleted'"))
      .rows[0].n,
    1,
  );
  assert.ok(Number((await db.query('SELECT COUNT(*) AS n FROM audit_events')).rows[0].n) <= 6);
});

test('usage storage reserves pending calls across users and deletion cannot reopen capacity', async (t) => {
  const { db, repository } = await fixture(t, { maxUsageEvents: 1 });
  const firstConversation = await repository.createConversation(
    SYNTHETIC_SEED.userA,
    'Synthetic A',
  );
  const secondConversation = await repository.createConversation(
    SYNTHETIC_SEED.userB,
    'Synthetic B',
  );
  const registry = await repository.registry();
  const admit = (userId, conversationId) =>
    repository.admit({
      userId,
      conversationId: conversationId.id,
      key: randomUUID(),
      requestHash: hashToken(randomUUID()),
      content: 'Synthetic input',
      registry,
    });
  const first = await admit(SYNTHETIC_SEED.userA, firstConversation);
  await assert.rejects(
    admit(SYNTHETIC_SEED.userB, secondConversation),
    (error) => error.code === 'LOCAL_STORAGE_FULL',
  );
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM chat_requests')).rows[0].n), 1);
  await repository.finish({
    userId: SYNTHETIC_SEED.userA,
    requestId: first.requestId,
    content: 'Synthetic output',
    status: 'complete',
    latencyMs: 1,
  });
  await repository.deleteConversation(SYNTHETIC_SEED.userA, firstConversation.id);
  await assert.rejects(
    admit(SYNTHETIC_SEED.userB, secondConversation),
    (error) => error.code === 'LOCAL_STORAGE_FULL',
  );
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM usage_events')).rows[0].n), 1);
});
