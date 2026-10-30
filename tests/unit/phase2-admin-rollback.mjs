import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createAdmin } from '../../packages/admin/index.mjs';

test('config revisions append-only immutability and one-click rollback (AP-03, T2.6)', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 8 });

  const admin = createAdmin(db);
  await admin.seedSystemRoles();

  await db.query(
    `INSERT INTO users (id, identity_provider, provider_subject, display_name)
     VALUES ($1, 'synthetic', 'subA', 'Admin Alpha'), ($2, 'synthetic', 'subB', 'Auditor Beta')
     ON CONFLICT DO NOTHING`,
    [SYNTHETIC_SEED.userA, SYNTHETIC_SEED.userB],
  );

  const superStaff = await admin.createStaffUser(null, {
    userId: SYNTHETIC_SEED.userA,
    roleId: 'super_admin',
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  });
  const auditorStaff = await admin.createStaffUser(null, {
    userId: SYNTHETIC_SEED.userB,
    roleId: 'auditor',
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  });

  // 1. Kill switch config versioning
  await admin.setKillSwitch(superStaff, {
    id: 'free_tier',
    enabled: true,
    reason: 'Disable free tier v1',
  }); // version 1
  await admin.setKillSwitch(superStaff, {
    id: 'free_tier',
    enabled: false,
    reason: 'Re-enable free tier v2',
  }); // version 2

  let history = await admin.getConfigHistory('kill_switch', 'free_tier');
  assert.equal(history.length, 2);
  assert.equal(history[0].version, 2);
  assert.equal(history[0].afterData.enabled, false);
  assert.equal(history[1].version, 1);
  assert.equal(history[1].afterData.enabled, true);

  // 2. Append-only immutability check
  await assert.rejects(
    () => db.query('UPDATE config_revisions SET reason = $1 WHERE version = 1', ['Tampered']),
    (err) => err.code === '42501',
  );
  await assert.rejects(
    () => db.query('DELETE FROM config_revisions WHERE version = 1'),
    (err) => err.code === '42501',
  );

  // 3. Rollback permission check (auditor cannot rollback)
  await assert.rejects(
    () =>
      admin.rollbackConfig(auditorStaff, {
        entityType: 'kill_switch',
        entityId: 'free_tier',
        targetVersion: 1,
      }),
    (err) => err.code === 'INSUFFICIENT_PERMISSIONS' && err.status === 403,
  );

  // 4. Super admin performs rollback to version 1
  const rollbackResult = await admin.rollbackConfig(superStaff, {
    entityType: 'kill_switch',
    entityId: 'free_tier',
    targetVersion: 1,
    reason: 'Emergency rollback to version 1',
  });

  assert.equal(rollbackResult.entityId, 'free_tier');
  assert.equal(rollbackResult.restoredVersion, 1);
  assert.equal(rollbackResult.newVersion, 3);
  assert.equal(rollbackResult.restoredData.enabled, true);

  // Verify switch is restored to version 1 state (enabled = true)
  assert.equal(await admin.isKillSwitchActive('free_tier'), true);

  // History now shows 3 revisions, newest is rollback
  history = await admin.getConfigHistory('kill_switch', 'free_tier');
  assert.equal(history.length, 3);
  assert.equal(history[0].version, 3);
  assert.equal(history[0].action, 'rollback');
  assert.equal(history[0].afterData.enabled, true);
});

test('routing policy rollback restores prior routing behavior (T2.6)', async (t) => {
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
    roleId: 'operator',
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  });

  // Seed initial policy v1
  const policy1 = { mode: 'auto', modelClasses: ['general'], allowPaid: false };
  await db.query(`INSERT INTO routing_policies (id, version, data) VALUES ($1, 1, $2)`, [
    'policy-main',
    JSON.stringify(policy1),
  ]);
  await admin.recordConfigRevision(staff, {
    entityType: 'routing_policy',
    entityId: 'policy-main',
    action: 'create',
    beforeData: null,
    afterData: policy1,
    reason: 'Initial policy v1',
  });

  // Update policy v2
  const policy2 = {
    mode: 'manual',
    modelId: 'paid-model',
    modelClasses: ['general'],
    allowPaid: true,
  };
  await db.query(`UPDATE routing_policies SET version = 2, data = $1 WHERE id = $2`, [
    JSON.stringify(policy2),
    'policy-main',
  ]);
  await admin.recordConfigRevision(staff, {
    entityType: 'routing_policy',
    entityId: 'policy-main',
    action: 'update',
    beforeData: policy1,
    afterData: policy2,
    reason: 'Update to paid manual policy v2',
  });

  // Current policy is v2
  const current = (await db.query('SELECT * FROM routing_policies WHERE id = $1', ['policy-main']))
    .rows[0];
  assert.equal(current.version, 2);

  // Rollback to v1 (T2.6)
  const rolledBack = await admin.rollbackConfig(staff, {
    entityType: 'routing_policy',
    entityId: 'policy-main',
    targetVersion: 1,
    reason: 'Rollback policy to v1',
  });
  assert.equal(rolledBack.restoredVersion, 1);
  assert.deepEqual(rolledBack.restoredData, policy1);

  // Active policy in database is now restored to policy1
  const restored = (await db.query('SELECT * FROM routing_policies WHERE id = $1', ['policy-main']))
    .rows[0];
  const restoredData =
    typeof restored.data === 'string' ? JSON.parse(restored.data) : restored.data;
  assert.equal(restoredData.mode, 'auto');
  assert.equal(restoredData.allowPaid, false);
});
