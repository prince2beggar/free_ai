import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createAdmin } from '../../packages/admin/index.mjs';

test('append-only audit log immutability and querying (AP-05)', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 8 });

  const admin = createAdmin(db);
  await admin.seedSystemRoles();

  await db.query(
    `INSERT INTO users (id, identity_provider, provider_subject, display_name)
     VALUES ($1, 'synthetic', 'subA', 'Admin Alpha')
     ON CONFLICT DO NOTHING`,
    [SYNTHETIC_SEED.userA],
  );

  const staff = await admin.createStaffUser(null, {
    userId: SYNTHETIC_SEED.userA,
    roleId: 'super_admin',
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  });

  // Record audit events
  await admin.recordAudit(staff, {
    action: 'TEST_ACTION_1',
    targetType: 'provider',
    targetId: 'groq',
    metadata: { key: 'val1' },
  });
  await admin.recordAudit(staff, {
    action: 'TEST_ACTION_2',
    targetType: 'model',
    targetId: 'llama-3',
    metadata: { key: 'val2' },
  });

  const logs = await admin.getAuditLog({ limit: 10 });
  assert.equal(logs.length >= 2, true);
  assert.equal(logs[0].action, 'TEST_ACTION_2');
  assert.equal(logs[1].action, 'TEST_ACTION_1');

  // Filter by targetType
  const providerLogs = await admin.getAuditLog({ targetType: 'provider' });
  assert.equal(providerLogs.length, 1);
  assert.equal(providerLogs[0].target_id, 'groq');

  // Immutability tests: updates and deletes are rejected by database trigger
  await assert.rejects(
    () => db.query('UPDATE admin_audit_log SET action = $1', ['TAMPERED']),
    (err) => err.code === '42501',
  );

  await assert.rejects(
    () => db.query('DELETE FROM admin_audit_log WHERE action = $1', ['TEST_ACTION_1']),
    (err) => err.code === '42501',
  );

  await assert.rejects(
    () => db.query('TRUNCATE admin_audit_log'),
    (err) => err.code === '42501',
  );
});
