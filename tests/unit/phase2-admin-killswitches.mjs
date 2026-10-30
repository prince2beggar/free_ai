import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createAdmin } from '../../packages/admin/index.mjs';

test('kill switches lifecycle, RBAC enforcement, and hierarchical checks (T2.5)', async (t) => {
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
    roleId: 'operator',
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  });
  const auditorStaff = await admin.createStaffUser(null, {
    userId: SYNTHETIC_SEED.userB,
    roleId: 'auditor',
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  });

  await admin.seedKillSwitches(superStaff.id);

  // Auditor cannot toggle kill switches (403)
  await assert.rejects(
    () =>
      admin.setKillSwitch(auditorStaff, {
        id: 'provider:groq',
        enabled: true,
        reason: 'Unauthorized test',
      }),
    (err) => err.code === 'INSUFFICIENT_PERMISSIONS' && err.status === 403,
  );

  // Operator enables provider kill switch
  const result = await admin.setKillSwitch(superStaff, {
    id: 'provider:groq',
    enabled: true,
    reason: 'Upstream rate limit spike',
  });
  assert.equal(result.id, 'provider:groq');
  assert.equal(result.enabled, true);
  assert.equal(result.version, 1);

  // Switch is active directly (T2.5)
  assert.equal(await admin.isKillSwitchActive('provider:groq'), true);
  assert.equal(await admin.isKillSwitchActive('provider:other'), false);

  // Model under that provider is also disabled hierarchically
  assert.equal(await admin.isKillSwitchActive('model:groq:llama-3-8b'), true);
  assert.equal(await admin.isKillSwitchActive('model:other:chat'), false);

  // Global all_ai kill switch disables everything
  await admin.setKillSwitch(superStaff, {
    id: 'all_ai',
    enabled: true,
    reason: 'Emergency platform maintenance',
  });
  assert.equal(await admin.isKillSwitchActive('provider:other'), true);
  assert.equal(await admin.isKillSwitchActive('model:other:chat'), true);

  // Re-enable global switch
  await admin.setKillSwitch(superStaff, {
    id: 'all_ai',
    enabled: false,
    reason: 'Maintenance complete',
  });
  assert.equal(await admin.isKillSwitchActive('provider:other'), false);
  // provider:groq remains specifically disabled
  assert.equal(await admin.isKillSwitchActive('provider:groq'), true);

  // Config revision history is recorded
  const history = await admin.getConfigHistory('kill_switch', 'provider:groq');
  assert.equal(history.length, 1);
  assert.equal(history[0].action, 'update');
  assert.equal(history[0].afterData.enabled, true);
});
