import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createRouterFixture, routerFixture } from '../../tools/phase2/router-fixture.mjs';
test('file reopen recovers uncertain Router work, preserves captures and durable family retry budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'free-ai-router-'));
  let db;
  let time = Date.parse('2026-10-13T00:00:00.000Z'),
    calls = 0;
  const A = SYNTHETIC_SEED.userA,
    conversationId = randomUUID(),
    requestId = randomUUID(),
    content = 'Persistent synthetic request';
  const gateways = Object.fromEntries(
    routerFixture.models.map((m) => [
      m.id,
      {
        synthetic: true,
        providerId: routerFixture.provider.id,
        modelId: m.id,
        health: () => ({ synthetic: true }),
        async *stream() {
          calls++;
          yield { text: 'synthetic answer' };
        },
      },
    ]),
  );
  const options = {
    clock: () => time,
    gatewayOverrides: gateways,
    routerOptions: { reconciliationMs: 1000 },
  };
  async function reopen() {
    db = await createDatabase({ dataDir: directory });
    await migrateUp(db, { throughVersion: 6 });
    return createRouterFixture(db, options);
  }
  async function chat(id) {
    await db.query(
      'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES($1,$2,$3,$1,$4)',
      [id, A, conversationId, 'x'.repeat(64)],
    );
    await db.query(
      "INSERT INTO messages(id,user_id,conversation_id,role,content,request_id) VALUES($1,$2,$3,'user',$4,$5)",
      [randomUUID(), A, conversationId, content, id],
    );
  }
  try {
    let f = await reopen();
    await db.query('INSERT INTO conversations(id,user_id) VALUES($1,$2)', [conversationId, A]);
    await chat(requestId);
    const data = {
      requestId,
      conversationId,
      messages: [{ role: 'user', content }],
      language: 'en',
      routing: {},
    };
    await f.router.prepare(A, data);
    const iterator = f.router.stream(A, data);
    assert.equal((await iterator.next()).value.type, 'attempt');
    assert.equal(calls, 1);
    await db.close();
    db = null;
    f = await reopen();
    assert.equal((await f.router.recover()).recovered, 1);
    assert.equal(calls, 1);
    assert.equal((await f.router.result(A, requestId)).attempts[0].state, 'PENDING_RECONCILIATION');
    time += 1000;
    assert.equal((await f.router.sweep()).estimated, 1);
    assert.equal((await f.router.result(A, requestId)).attempts[0].state, 'ESTIMATED');
    const retryId = randomUUID();
    await chat(retryId);
    const retry = { ...data, requestId: retryId, routing: { action: 'retry', retryOf: requestId } };
    await f.router.prepare(A, retry);
    for await (const event of f.router.stream(A, retry)) assert.equal(typeof event.type, 'string');
    assert.equal(calls, 2);
    await db.close();
    db = null;
    f = await reopen();
    assert.equal((await f.router.result(A, requestId)).retryBudgetRemaining, 0);
    assert.equal((await f.router.result(A, retryId)).state, 'COMPLETE');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM router_attempts')).rows[0].n, 2);
  } finally {
    if (db) await db.close();
    const owned = relative(tmpdir(), directory);
    assert.ok(owned && !isAbsolute(owned) && !owned.startsWith('..'));
    await rm(directory, { recursive: true, force: true });
  }
});
