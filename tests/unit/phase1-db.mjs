import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDatabase,
  migrateUp,
  migrateDown,
  seedSynthetic,
  runRetention,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';

async function withDatabase(callback) {
  const db = await createDatabase();
  try {
    await callback(db);
  } finally {
    await db.close();
  }
}

test('reversible PostgreSQL migration runs on seeded data and can be reapplied', async () => {
  await withDatabase(async (db) => {
    assert.deepEqual(await migrateUp(db), [1]);
    await seedSynthetic(db);
    assert.equal((await db.query('SELECT count(*)::INTEGER AS count FROM users')).rows[0].count, 2);
    assert.deepEqual(await migrateUp(db), []);
    assert.deepEqual(await migrateDown(db), [1]);
    assert.equal(
      (await db.query('SELECT count(*)::INTEGER AS count FROM schema_migrations')).rows[0].count,
      0,
    );
    await assert.rejects(db.query('SELECT * FROM users'), /does not exist/);
    assert.deepEqual(await migrateUp(db), [1]);
    await seedSynthetic(db);
    assert.equal((await db.query('SELECT count(*)::INTEGER AS count FROM users')).rows[0].count, 2);
  });
});

test('synthetic seed is idempotent and external provider activation is denied', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    await seedSynthetic(db);
    const providers = (
      await db.query(
        'SELECT id, adapter_kind, status, secret_ref, base_url FROM providers ORDER BY id',
      )
    ).rows;
    assert.equal(providers.length, 2);
    const synthetic = providers.find((provider) => provider.id === SYNTHETIC_SEED.provider);
    assert.deepEqual(synthetic, {
      id: SYNTHETIC_SEED.provider,
      adapter_kind: 'synthetic_mock',
      status: 'enabled',
      secret_ref: null,
      base_url: null,
    });
    assert.equal(
      providers.find((provider) => provider.adapter_kind === 'external').status,
      'disabled',
    );
    await assert.rejects(
      db.query("UPDATE providers SET status = 'enabled' WHERE adapter_kind = 'external'"),
      /check constraint/,
    );
    const models = (await db.query('SELECT id, agent_ready, bangla_score, free_flag FROM models'))
      .rows;
    assert.equal(models.length, 1);
    assert.equal(models[0].agent_ready, false);
    assert.equal(models[0].bangla_score, null);
    assert.equal(models[0].free_flag, true);
  });
});

test('transaction failure rolls back every write rather than leaving partial state', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query('INSERT INTO conversations(id,user_id,title) VALUES ($1,$2,$3)', [
          'rolled-back',
          SYNTHETIC_SEED.userA,
          'Synthetic',
        ]);
        await tx.query('INSERT INTO conversations(id,user_id,title) VALUES ($1,$2,$3)', [
          'invalid-owner',
          'nonexistent-user',
          'Synthetic',
        ]);
      }),
      /foreign key/,
    );
    assert.equal(
      (await db.query('SELECT count(*)::INTEGER AS count FROM conversations')).rows[0].count,
      0,
    );
  });
});

test('ownership foreign keys reject messages and requests from another user', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    await db.query('INSERT INTO conversations(id,user_id,title) VALUES ($1,$2,$3)', [
      'owned-a',
      SYNTHETIC_SEED.userA,
      'Synthetic',
    ]);
    await assert.rejects(
      db.query(
        'INSERT INTO messages(id,conversation_id,user_id,role,content) VALUES ($1,$2,$3,$4,$5)',
        ['wrong-user', 'owned-a', SYNTHETIC_SEED.userB, 'user', 'Synthetic'],
      ),
      /foreign key/,
    );
    await assert.rejects(
      db.query(
        'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5)',
        ['wrong-owner', SYNTHETIC_SEED.userB, 'owned-a', 'request-a', 'hash-a'],
      ),
      /foreign key/,
    );
    await db.query(
      'INSERT INTO messages(id,conversation_id,user_id,role,content) VALUES ($1,$2,$3,$4,$5)',
      ['right-user', 'owned-a', SYNTHETIC_SEED.userA, 'user', 'Synthetic'],
    );
    assert.equal(
      (await db.query('SELECT count(*)::INTEGER AS count FROM messages')).rows[0].count,
      1,
    );
  });
});

test('usage and audit evidence is append-only and requests remain idempotent', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    await db.query('INSERT INTO conversations(id,user_id,title) VALUES ($1,$2,$3)', [
      'conversation-a',
      SYNTHETIC_SEED.userA,
      'Synthetic',
    ]);
    const requestSql =
      'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5)';
    await db.query(requestSql, [
      'request-a',
      SYNTHETIC_SEED.userA,
      'conversation-a',
      'stable-a',
      'hash-a',
    ]);
    await assert.rejects(
      db.query(requestSql, [
        'request-b',
        SYNTHETIC_SEED.userA,
        'conversation-a',
        'stable-a',
        'hash-a',
      ]),
      /unique constraint/,
    );
    await db.query(
      'INSERT INTO usage_events(id,user_id,request_id,model_id,input_tokens,output_tokens,latency_ms,outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      ['usage-a', SYNTHETIC_SEED.userA, 'request-a', SYNTHETIC_SEED.model, 12, 24, 0, 'complete'],
    );
    await db.query(
      'INSERT INTO audit_events(id,actor_id,action,target_id,metadata) VALUES ($1,$2,$3,$4,$5)',
      ['audit-a', SYNTHETIC_SEED.userA, 'synthetic.test', 'conversation-a', '{}'],
    );
    for (const table of ['usage_events', 'audit_events']) {
      await assert.rejects(
        db.query(`UPDATE ${table} SET created_at = CURRENT_TIMESTAMP`),
        /append-only/,
      );
      await assert.rejects(db.query(`DELETE FROM ${table}`), /append-only/);
      await assert.rejects(db.exec(`TRUNCATE ${table}`), /append-only/);
    }
    await assert.rejects(db.query('UPDATE usage_events SET cost_micro_cu = 1'), /append-only/);
    await assert.rejects(
      db.query(
        'INSERT INTO usage_events(id,user_id,request_id,model_id,input_tokens,output_tokens,latency_ms,outcome,cost_micro_cu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          'usage-b',
          SYNTHETIC_SEED.userA,
          'request-b',
          SYNTHETIC_SEED.model,
          1,
          1,
          0,
          'complete',
          1,
        ],
      ),
      /check constraint/,
    );
    assert.equal(
      (await db.query('SELECT count(*)::INTEGER AS count FROM usage_events')).rows[0].count,
      1,
    );
  });
});

test('database errors contain SQLSTATE but never SQL or parameter values', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    const privateFixture = 'SYNTHETIC_PRIVATE_PARAMETER_DO_NOT_LOG';
    try {
      await db.query('INSERT INTO conversations(id,user_id,title) VALUES ($1,$2,$3)', [
        'sensitive-row',
        privateFixture,
        'Synthetic',
      ]);
      assert.fail('Expected a foreign key violation');
    } catch (error) {
      assert.equal(error.code, '23503');
      assert.equal(error.name, 'DatabaseError');
      assert.equal(error.detail, undefined);
      assert.equal(error.query, undefined);
      assert.equal(error.cause, undefined);
      assert.equal(String(error).includes(privateFixture), false);
      assert.equal(String(error).includes('INSERT INTO'), false);
    }
  });
});

test('bounded retention expires sessions/state and explicitly defers immutable audit/usage', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    for (const [id, expired] of [
      ['expired-a', true],
      ['expired-b', true],
      ['current', false],
    ]) {
      await db.query(
        `INSERT INTO sessions(id,user_id,token_hash,csrf_hash,created_at,expires_at)
        VALUES ($1,$2,$1,$1,CURRENT_TIMESTAMP - INTERVAL '2 days',
        CURRENT_TIMESTAMP + ($3::INTEGER * INTERVAL '1 day'))`,
        [id, SYNTHETIC_SEED.userA, expired ? -1 : 1],
      );
    }
    await db.query(`INSERT INTO oauth_states(state_hash,verifier,nonce,browser_hash,created_at,expires_at)
      VALUES ('expired-state','synthetic-verifier','synthetic-nonce','synthetic-browser',
      CURRENT_TIMESTAMP - INTERVAL '2 days',CURRENT_TIMESTAMP - INTERVAL '1 day')`);
    await db.query(`INSERT INTO audit_events(id,action,created_at)
      VALUES ('old-audit','synthetic.retention',CURRENT_TIMESTAMP - INTERVAL '90 days')`);
    const report = await runRetention(db, { batchLimit: 1 });
    assert.equal(report.counts.sessions, 1);
    assert.equal(report.counts.oauthStates, 1);
    assert.deepEqual(report.deferred, ['audit_events', 'usage_events']);
    assert.equal(report.counts.auditEvents, 0);
    assert.equal(
      (await db.query('SELECT count(*)::INTEGER AS count FROM audit_events')).rows[0].count,
      1,
    );
    assert.equal(
      (await db.query('SELECT count(*)::INTEGER AS count FROM sessions')).rows[0].count,
      2,
    );
    await assert.rejects(db.query('DELETE FROM audit_events'), /append-only/);
    await assert.rejects(runRetention(db, { batchLimit: 0 }), /execution bounds/);
    await assert.rejects(runRetention(db, { usageRetentionDays: 0 }), /retention days/);
  });
});

test('assistant messages require persisted synthetic routing provenance', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    await db.query('INSERT INTO conversations(id,user_id,title) VALUES ($1,$2,$3)', [
      'conversation-a',
      SYNTHETIC_SEED.userA,
      'Synthetic',
    ]);
    await db.query(
      'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5)',
      ['request-a', SYNTHETIC_SEED.userA, 'conversation-a', 'stable-a', 'hash-a'],
    );
    await assert.rejects(
      db.query(
        'INSERT INTO messages(id,conversation_id,user_id,role,content) VALUES ($1,$2,$3,$4,$5)',
        [
          'assistant-a',
          'conversation-a',
          SYNTHETIC_SEED.userA,
          'assistant',
          'Canned synthetic response',
        ],
      ),
      /check constraint/,
    );
    await db.query(
      'INSERT INTO routing_records(id,request_id,user_id,provider_id,model_id,external_model,run_kind) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        'route-a',
        'request-a',
        SYNTHETIC_SEED.userA,
        SYNTHETIC_SEED.provider,
        SYNTHETIC_SEED.model,
        SYNTHETIC_SEED.model,
        'synthetic_mock',
      ],
    );
    await db.query(
      'INSERT INTO messages(id,conversation_id,user_id,role,content,provider_id,model_id,routing_record_id,request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        'assistant-a',
        'conversation-a',
        SYNTHETIC_SEED.userA,
        'assistant',
        'Canned synthetic response',
        SYNTHETIC_SEED.provider,
        SYNTHETIC_SEED.model,
        'route-a',
        'request-a',
      ],
    );
    assert.equal(
      (await db.query('SELECT run_kind FROM routing_records')).rows[0].run_kind,
      'synthetic_mock',
    );
  });
});

test('migration checksum mismatch stops without changing existing data', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    await db.query("UPDATE schema_migrations SET checksum = 'modified' WHERE version = 1");
    await assert.rejects(migrateUp(db), /checksum/);
    assert.equal((await db.query('SELECT count(*)::INTEGER AS count FROM users')).rows[0].count, 2);
  });
});

test('message sequence preserves user/assistant insertion order when timestamps tie', async () => {
  await withDatabase(async (db) => {
    await migrateUp(db);
    await seedSynthetic(db);
    await db.query('INSERT INTO conversations(id,user_id,title) VALUES ($1,$2,$3)', [
      'ordered-conversation',
      SYNTHETIC_SEED.userA,
      'Synthetic ordering regression',
    ]);
    await db.transaction(async (tx) => {
      for (const [request, userMessage, assistantMessage] of [
        ['ordered-request-1', 'z-user-first', 'a-assistant-second'],
        ['ordered-request-2', 'y-user-third', 'b-assistant-fourth'],
      ]) {
        await tx.query(
          'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$1,$1)',
          [request, SYNTHETIC_SEED.userA, 'ordered-conversation'],
        );
        await tx.query(
          "INSERT INTO routing_records(id,request_id,user_id,provider_id,model_id,external_model,run_kind) VALUES ($1,$1,$2,$3,$4,$4,'synthetic_mock')",
          [request, SYNTHETIC_SEED.userA, SYNTHETIC_SEED.provider, SYNTHETIC_SEED.model],
        );
        await tx.query(
          "INSERT INTO messages(id,conversation_id,user_id,role,content,request_id) VALUES ($1,$2,$3,'user','Synthetic user message',$4)",
          [userMessage, 'ordered-conversation', SYNTHETIC_SEED.userA, request],
        );
        await tx.query(
          "INSERT INTO messages(id,conversation_id,user_id,role,content,provider_id,model_id,routing_record_id,request_id) VALUES ($1,$2,$3,'assistant','Canned synthetic response',$4,$5,$6,$6)",
          [
            assistantMessage,
            'ordered-conversation',
            SYNTHETIC_SEED.userA,
            SYNTHETIC_SEED.provider,
            SYNTHETIC_SEED.model,
            request,
          ],
        );
      }
    });
    const rows = (
      await db.query(
        'SELECT id,role,created_at,sequence_no FROM messages WHERE conversation_id=$1 ORDER BY sequence_no',
        ['ordered-conversation'],
      )
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.id),
      ['z-user-first', 'a-assistant-second', 'y-user-third', 'b-assistant-fourth'],
    );
    assert.deepEqual(
      rows.map((row) => row.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
    assert.equal(new Set(rows.map((row) => row.created_at.getTime())).size, 1);
    assert.equal(new Set(rows.map((row) => row.sequence_no)).size, 4);
    const recent = (
      await db.query(
        'SELECT id FROM messages WHERE conversation_id=$1 ORDER BY sequence_no DESC LIMIT 2',
        ['ordered-conversation'],
      )
    ).rows.reverse();
    assert.deepEqual(
      recent.map((row) => row.id),
      ['y-user-third', 'b-assistant-fourth'],
    );
  });
});
