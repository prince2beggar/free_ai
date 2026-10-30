import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrateUp, migrateDown } from '../../packages/db/index.mjs';
import { createKeyPoolService, maskApiKey } from '../../packages/gateway/key_pool.mjs';
import { createUniversalFreeGateway } from '../../packages/gateway/free_providers.mjs';

async function withDatabase(callback) {
  const db = await createDatabase();
  try {
    await migrateUp(db, { throughVersion: 11 });
    await callback(db);
  } finally {
    await db.close();
  }
}

test('Key Pool: maskApiKey masks tokens securely', () => {
  assert.equal(maskApiKey('mock_gh_1234567890abcdef'), 'mock_gh_••••cdef');
  assert.equal(maskApiKey('short'), '••••••••');
  assert.equal(maskApiKey(''), '••••••••');
  assert.equal(maskApiKey(null), '••••••••');
});

test('Key Pool: Migration 11 creates api_key_pool table and is reversible', async () => {
  const db = await createDatabase();
  try {
    const applied = await migrateUp(db, { throughVersion: 11 });
    assert.ok(applied.includes(11));

    const check = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'api_key_pool'",
    );
    assert.equal(check.rows.length, 1);

    // Test rollback of 1 step (migration 11)
    const rolledBack = await migrateDown(db, { steps: 1 });
    assert.deepEqual(rolledBack, [11]);

    const checkAfter = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'api_key_pool'",
    );
    assert.equal(checkAfter.rows.length, 0);
  } finally {
    await db.close();
  }
});

test('Key Pool: Validation rejects invalid providers, labels, and keys', async () => {
  await withDatabase(async (db) => {
    const pool = createKeyPoolService({ db });

    // Invalid provider
    await assert.rejects(
      pool.addKey({ provider: 'invalid_llm', label: 'Test', apiKey: 'mock_gh_1234567890' }),
      (err) => err.code === 'INVALID_PROVIDER',
    );

    // Empty label
    await assert.rejects(
      pool.addKey({ provider: 'github', label: '   ', apiKey: 'mock_gh_1234567890' }),
      (err) => err.code === 'INVALID_LABEL',
    );

    // Short API key
    await assert.rejects(
      pool.addKey({ provider: 'github', label: 'Test', apiKey: 'short' }),
      (err) => err.code === 'INVALID_API_KEY',
    );

    // Invalid expiry
    await assert.rejects(
      pool.addKey({
        provider: 'github',
        label: 'Test',
        apiKey: 'mock_gh_1234567890',
        expiresAt: 'not-a-valid-date',
      }),
      (err) => err.code === 'INVALID_EXPIRY',
    );
  });
});

test('Key Pool: Full lifecycle — add, list, update status, usage, and delete', async () => {
  await withDatabase(async (db) => {
    const pool = createKeyPoolService({ db });

    // 1. Add keys
    const k1 = await pool.addKey({
      provider: 'github',
      label: 'GitHub Primary',
      apiKey: 'mock_gh_11112222333344445555',
    });
    const k2 = await pool.addKey({
      provider: 'github',
      label: 'GitHub Backup',
      apiKey: 'mock_gh_99998888777766665555',
    });
    const k3 = await pool.addKey({
      provider: 'groq',
      label: 'Groq Cloud Free',
      apiKey: 'mock_groq_abcdef1234567890ghij',
    });

    assert.equal(k1.provider, 'github');
    assert.equal(k1.status, 'active');
    assert.equal(k1.keyMask, 'mock_gh_••••5555');

    // 2. List keys
    const list = await pool.listKeys();
    assert.equal(list.length, 3);
    // Raw api_key must never be exposed
    for (const item of list) {
      assert.equal(item.api_key, undefined);
      assert.ok(item.keyMask.includes('••••'));
    }

    // 3. Status update (blocking)
    await pool.updateKeyStatus(k2.id, 'blocked');
    const afterBlock = await pool.getActiveKeys('github');
    assert.equal(afterBlock.length, 1);
    assert.equal(afterBlock[0].id, k1.id);

    // Re-activate
    await pool.updateKeyStatus(k2.id, 'active');
    const afterUnblock = await pool.getActiveKeys('github');
    assert.equal(afterUnblock.length, 2);

    // 4. Record usage
    await pool.recordUsage(k1.id);
    await pool.recordUsage(k1.id);
    const updatedList = await pool.listKeys();
    const foundK1 = updatedList.find((x) => x.id === k1.id);
    assert.equal(foundK1.requestsUsed, 2);

    // 5. Delete key
    await pool.deleteKey(k3.id);
    const listAfterDelete = await pool.listKeys();
    assert.equal(listAfterDelete.length, 2);
    assert.equal(
      listAfterDelete.some((x) => x.id === k3.id),
      false,
    );
  });
});

test('Key Pool: Round-Robin rotation cycles evenly across active keys', async () => {
  await withDatabase(async (db) => {
    const pool = createKeyPoolService({ db });

    const keyA = await pool.addKey({
      provider: 'github',
      label: 'Token A',
      apiKey: 'mock_gh_AAAAAAAAAAAAAA1111',
    });
    const keyB = await pool.addKey({
      provider: 'github',
      label: 'Token B',
      apiKey: 'mock_gh_BBBBBBBBBBBBBB2222',
    });

    // Successive rotations should cycle: A -> B -> A -> B
    const r1 = await pool.rotateKey('github');
    const r2 = await pool.rotateKey('github');
    const r3 = await pool.rotateKey('github');
    const r4 = await pool.rotateKey('github');

    assert.equal(r1.id, keyA.id);
    assert.equal(r2.id, keyB.id);
    assert.equal(r3.id, keyA.id);
    assert.equal(r4.id, keyB.id);
  });
});

test('Key Pool: Rate-limited keys are temporarily excluded from active rotation', async () => {
  await withDatabase(async (db) => {
    const pool = createKeyPoolService({ db });

    const keyA = await pool.addKey({
      provider: 'github',
      label: 'Token A',
      apiKey: 'mock_gh_AAAAAAAAAAAAAA1111',
    });
    const keyB = await pool.addKey({
      provider: 'github',
      label: 'Token B',
      apiKey: 'mock_gh_BBBBBBBBBBBBBB2222',
    });

    // Mark keyA as rate-limited
    pool.markRateLimited(keyA.id, 60);

    // Only keyB should be returned
    const active = await pool.getActiveKeys('github');
    assert.equal(active.length, 1);
    assert.equal(active[0].id, keyB.id);

    const rotated = await pool.rotateKey('github');
    assert.equal(rotated.id, keyB.id);
  });
});

test('Key Pool: Expired keys are automatically excluded from active pool', async () => {
  await withDatabase(async (db) => {
    const pool = createKeyPoolService({ db });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await pool.addKey({
      provider: 'github',
      label: 'Expired Key',
      apiKey: 'mock_gh_EXPIRED1234567890',
      expiresAt: yesterday,
    });
    const validKey = await pool.addKey({
      provider: 'github',
      label: 'Valid Key',
      apiKey: 'mock_gh_VALID1234567890123',
      expiresAt: tomorrow,
    });

    const active = await pool.getActiveKeys('github');
    assert.equal(active.length, 1);
    assert.equal(active[0].id, validKey.id);

    const list = await pool.listKeys();
    assert.equal(list.length, 2);
    const expiredItem = list.find((x) => x.label === 'Expired Key');
    assert.equal(expiredItem.isExpired, true);
  });
});

test('Universal Gateway: Integrates with Key Pool with zero spending', async () => {
  await withDatabase(async (db) => {
    const pool = createKeyPoolService({ db });

    await pool.addKey({
      provider: 'github',
      label: 'Active Key #1',
      apiKey: 'mock_gh_SYNTHETIC_TOKEN_1',
    });

    const gateway = createUniversalFreeGateway({
      keyPoolService: pool,
      replies: {
        en: 'Fallback response when network is mocked.',
      },
      chunkChars: 10,
      chunkDelayMs: 0,
    });

    assert.equal(gateway.synthetic, true);
    assert.equal(gateway.isUniversal, true);

    const activeKeys = await pool.getActiveKeys('github');
    assert.equal(activeKeys.length, 1);
    assert.equal(activeKeys[0].label, 'Active Key #1');
  });
});
