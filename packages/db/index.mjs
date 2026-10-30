import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('./migrations/001_phase1.up.sql', import.meta.url);
const rollbackUrl = new URL('./migrations/001_phase1.down.sql', import.meta.url);
const up = await readFile(migrationUrl, 'utf8');
const down = await readFile(rollbackUrl, 'utf8');
const registryUp = await readFile(
  new URL('./migrations/002_registry.up.sql', import.meta.url),
  'utf8',
);
const registryDown = await readFile(
  new URL('./migrations/002_registry.down.sql', import.meta.url),
  'utf8',
);
const registryBoundsUp = await readFile(
  new URL('./migrations/003_registry_bounds.up.sql', import.meta.url),
  'utf8',
);
const registryBoundsDown = await readFile(
  new URL('./migrations/003_registry_bounds.down.sql', import.meta.url),
  'utf8',
);
const ledgerUp = await readFile(new URL('./migrations/004_ledger.up.sql', import.meta.url), 'utf8');
const ledgerDown = await readFile(
  new URL('./migrations/004_ledger.down.sql', import.meta.url),
  'utf8',
);
const governorUp = await readFile(
  new URL('./migrations/005_governor.up.sql', import.meta.url),
  'utf8',
);
const governorDown = await readFile(
  new URL('./migrations/005_governor.down.sql', import.meta.url),
  'utf8',
);
const routerUp = await readFile(new URL('./migrations/006_router.up.sql', import.meta.url), 'utf8');
const routerDown = await readFile(
  new URL('./migrations/006_router.down.sql', import.meta.url),
  'utf8',
);
const abuseUp = await readFile(new URL('./migrations/007_abuse.up.sql', import.meta.url), 'utf8');
const abuseDown = await readFile(
  new URL('./migrations/007_abuse.down.sql', import.meta.url),
  'utf8',
);
const adminUp = await readFile(new URL('./migrations/008_admin.up.sql', import.meta.url), 'utf8');
const adminDown = await readFile(
  new URL('./migrations/008_admin.down.sql', import.meta.url),
  'utf8',
);
const monitoringUp = await readFile(
  new URL('./migrations/009_monitoring.up.sql', import.meta.url),
  'utf8',
);
const monitoringDown = await readFile(
  new URL('./migrations/009_monitoring.down.sql', import.meta.url),
  'utf8',
);
const filesUp = await readFile(new URL('./migrations/010_files.up.sql', import.meta.url), 'utf8');
const filesDown = await readFile(
  new URL('./migrations/010_files.down.sql', import.meta.url),
  'utf8',
);
const keyPoolUp = await readFile(
  new URL('./migrations/011_key_pool.up.sql', import.meta.url),
  'utf8',
);
const keyPoolDown = await readFile(
  new URL('./migrations/011_key_pool.down.sql', import.meta.url),
  'utf8',
);

export const migrations = Object.freeze([
  Object.freeze({
    version: 1,
    name: 'phase1_local_synthetic',
    up,
    down,
    checksum: createHash('sha256').update(up).digest('hex'),
  }),
  Object.freeze({
    version: 2,
    name: 'phase2_registry',
    up: registryUp,
    down: registryDown,
    checksum: createHash('sha256').update(registryUp).digest('hex'),
  }),
  Object.freeze({
    version: 3,
    name: 'phase2_registry_bounds',
    up: registryBoundsUp,
    down: registryBoundsDown,
    checksum: createHash('sha256').update(registryBoundsUp).digest('hex'),
  }),
  Object.freeze({
    version: 4,
    name: 'phase2_local_ledger',
    up: ledgerUp,
    down: ledgerDown,
    checksum: createHash('sha256').update(ledgerUp).digest('hex'),
  }),
  Object.freeze({
    version: 5,
    name: 'phase2_local_governor',
    up: governorUp,
    down: governorDown,
    checksum: createHash('sha256').update(governorUp).digest('hex'),
  }),
  Object.freeze({
    version: 6,
    name: 'phase2_local_router',
    up: routerUp,
    down: routerDown,
    checksum: createHash('sha256').update(routerUp).digest('hex'),
  }),
  Object.freeze({
    version: 7,
    name: 'phase2_local_abuse',
    up: abuseUp,
    down: abuseDown,
    checksum: createHash('sha256').update(abuseUp).digest('hex'),
  }),
  Object.freeze({
    version: 8,
    name: 'phase2_local_admin',
    up: adminUp,
    down: adminDown,
    checksum: createHash('sha256').update(adminUp).digest('hex'),
  }),
  Object.freeze({
    version: 9,
    name: 'phase2_local_monitoring',
    up: monitoringUp,
    down: monitoringDown,
    checksum: createHash('sha256').update(monitoringUp).digest('hex'),
  }),
  Object.freeze({
    version: 10,
    name: 'phase3_files',
    up: filesUp,
    down: filesDown,
    checksum: createHash('sha256').update(filesUp).digest('hex'),
  }),
  Object.freeze({
    version: 11,
    name: 'phase3_key_pool',
    up: keyPoolUp,
    down: keyPoolDown,
    checksum: createHash('sha256').update(keyPoolUp).digest('hex'),
  }),
]);

export const SYNTHETIC_SEED = Object.freeze({
  userA: 'synthetic-user-a',
  userB: 'synthetic-user-b',
  provider: 'synthetic-provider',
  model: 'synthetic-chat-v1',
  legalVersion: 'local-draft-v2',
});

function safeDatabaseError(error) {
  const code =
    typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'DBERR';
  const messages = {
    23503: 'Database foreign key violation',
    23505: 'Database unique constraint violation',
    23514: 'Database check constraint violation',
    23502: 'Database required field missing',
    42501: 'Database append-only table cannot be modified',
    '42P01': 'Database table does not exist',
  };
  const safe = new Error(messages[code] ?? 'Database operation failed');
  safe.name = 'DatabaseError';
  safe.code = code;
  return safe;
}

function queryClient(client) {
  return Object.freeze({
    async query(sql, params = []) {
      try {
        return await client.query(sql, params);
      } catch (error) {
        throw safeDatabaseError(error);
      }
    },
    async exec(sql) {
      try {
        return await client.exec(sql);
      } catch (error) {
        throw safeDatabaseError(error);
      }
    },
  });
}

/** Embedded PostgreSQL is a local/test engine; this does not connect to a hosted database. */
export async function createDatabase({ dataDir } = {}) {
  const engine = new PGlite(dataDir);
  try {
    await engine.waitReady;
  } catch (error) {
    throw safeDatabaseError(error);
  }
  const client = queryClient(engine);
  return Object.freeze({
    ...client,
    async transaction(callback) {
      return engine.transaction((transaction) => callback(queryClient(transaction)));
    },
    async close() {
      await engine.close();
    },
  });
}

async function migrationTable(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

export async function migrateUp(db, { throughVersion = 1 } = {}) {
  if (
    !Number.isInteger(throughVersion) ||
    !migrations.some((migration) => migration.version === throughVersion)
  )
    throw new Error('Invalid target migration version');
  await migrationTable(db);
  return db.transaction(async (tx) => {
    const applied = (
      await tx.query('SELECT version, checksum FROM schema_migrations ORDER BY version')
    ).rows;
    for (const record of applied) {
      const migration = migrations.find((candidate) => candidate.version === record.version);
      if (!migration || migration.checksum !== record.checksum) {
        throw new Error('Migration checksum mismatch; no schema change performed');
      }
    }
    const changed = [];
    for (const migration of migrations) {
      if (migration.version > throughVersion) continue;
      if (applied.some((record) => record.version === migration.version)) continue;
      await tx.exec(migration.up);
      await tx.query('INSERT INTO schema_migrations(version,name,checksum) VALUES ($1,$2,$3)', [
        migration.version,
        migration.name,
        migration.checksum,
      ]);
      changed.push(migration.version);
    }
    return changed;
  });
}

/** Only use down migrations on explicitly authorized disposable/local data. */
export async function migrateDown(db, { steps = 1 } = {}) {
  if (!Number.isInteger(steps) || steps < 1 || steps > migrations.length) {
    throw new Error('Invalid rollback step count');
  }
  await migrationTable(db);
  return db.transaction(async (tx) => {
    const applied = (
      await tx.query('SELECT version, checksum FROM schema_migrations ORDER BY version DESC')
    ).rows;
    const changed = [];
    for (const record of applied.slice(0, steps)) {
      const migration = migrations.find((candidate) => candidate.version === record.version);
      if (!migration || migration.checksum !== record.checksum) {
        throw new Error('Migration checksum mismatch; no schema change performed');
      }
      await tx.exec(migration.down);
      await tx.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version]);
      changed.push(migration.version);
    }
    return changed;
  });
}

/** Original synthetic development fixtures, not customer identities or model-quality evidence. */
export async function seedSynthetic(db) {
  await db.transaction(async (tx) => {
    for (const [id, subject, name, locale] of [
      [SYNTHETIC_SEED.userA, 'fixture-a', 'Synthetic user A', 'en'],
      [SYNTHETIC_SEED.userB, 'fixture-b', 'Synthetic user B', 'bn'],
    ]) {
      await tx.query(
        `INSERT INTO users(id,identity_provider,provider_subject,display_name,locale)
        VALUES ($1,'synthetic',$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [id, subject, name, locale],
      );
    }
    await tx.query(
      `INSERT INTO providers(id,name,adapter_kind,status,data_policy_flag,allows_multiuser)
      VALUES ($1,'Local synthetic mock','synthetic_mock','enabled','synthetic_only',FALSE)
      ON CONFLICT (id) DO NOTHING`,
      [SYNTHETIC_SEED.provider],
    );
    await tx.query(`INSERT INTO providers(id,name,adapter_kind,base_url,status,terms_url,data_policy_flag,allows_multiuser)
      VALUES ('groq-research-disabled','Groq research candidate (disabled)','external',NULL,'disabled',
      'https://console.groq.com/docs/legal/services-agreement','unknown',FALSE) ON CONFLICT (id) DO NOTHING`);
    await tx.query(
      `INSERT INTO models(id,provider_id,external_name,display_name,context_limit,model_class,free_flag,status)
      VALUES ($1,$2,$1,'Canned synthetic chat',4096,'synthetic',TRUE,'enabled')
      ON CONFLICT (id) DO NOTHING`,
      [SYNTHETIC_SEED.model, SYNTHETIC_SEED.provider],
    );
  });
}

/**
 * Trusted local maintenance only; no endpoint exposes this function.
 * Audit/usage expiration is deliberately deferred: PGlite 0.5.9 keeps a superuser
 * session identity even with a restricted startup username, so an isolated
 * maintenance privilege cannot be demonstrated. Their immutability stays intact.
 */
export async function runRetention(
  db,
  {
    auditRetentionDays = 30,
    usageRetentionDays = 30,
    deletedAccountRetentionDays = 30,
    batchLimit = 100,
    timeoutMs = 5000,
  } = {},
) {
  for (const days of [auditRetentionDays, usageRetentionDays, deletedAccountRetentionDays]) {
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error('Invalid retention days');
  }
  if (
    !Number.isInteger(batchLimit) ||
    batchLimit < 1 ||
    batchLimit > 1000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  ) {
    throw new Error('Invalid retention execution bounds');
  }
  const started = Date.now();
  const counts = await db.transaction(async (tx) => {
    const remove = async (sql, params) => {
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining < 1) throw new Error('Retention deadline exceeded; changes rolled back');
      await tx.query("SELECT set_config('statement_timeout',$1,TRUE)", [`${remaining}ms`]);
      return (await tx.query(sql, params)).rows.length;
    };
    const sessions = await remove(
      `WITH expired AS (
      SELECT id FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL
      ORDER BY expires_at, id LIMIT $1
    ) DELETE FROM sessions WHERE id IN (SELECT id FROM expired) RETURNING id`,
      [batchLimit],
    );
    const oauthStates = await remove(
      `WITH expired AS (
      SELECT state_hash FROM oauth_states WHERE expires_at <= CURRENT_TIMESTAMP
      ORDER BY expires_at, state_hash LIMIT $1
    ) DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM expired) RETURNING state_hash`,
      [batchLimit],
    );
    const deletionRequests = await remove(
      `WITH expired AS (
      SELECT id FROM deletion_requests WHERE status = 'complete'
      AND completed_at < CURRENT_TIMESTAMP - ($2::INTEGER * INTERVAL '1 day')
      ORDER BY completed_at, id LIMIT $1
    ) DELETE FROM deletion_requests WHERE id IN (SELECT id FROM expired) RETURNING id`,
      [batchLimit, deletedAccountRetentionDays],
    );
    const users = await remove(
      `WITH expired AS (
      SELECT id FROM users u WHERE status = 'deleted'
      AND deleted_at < CURRENT_TIMESTAMP - ($2::INTEGER * INTERVAL '1 day')
      AND NOT EXISTS (SELECT 1 FROM usage_events WHERE user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM deletion_requests WHERE user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM conversations WHERE user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM chat_requests WHERE user_id = u.id)
      ORDER BY deleted_at, id LIMIT $1
    ) DELETE FROM users WHERE id IN (SELECT id FROM expired) RETURNING id`,
      [batchLimit, deletedAccountRetentionDays],
    );
    return { sessions, oauthStates, deletionRequests, users, auditEvents: 0, usageEvents: 0 };
  });
  return {
    counts,
    deferred: ['audit_events', 'usage_events'],
    reason:
      'Isolated privileged retention connection is not available in the embedded local engine',
    elapsedMs: Date.now() - started,
  };
}
