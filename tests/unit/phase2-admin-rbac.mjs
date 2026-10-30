import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createAdmin } from '../../packages/admin/index.mjs';

test('RBAC system roles and permission hierarchy', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 8 });

  const admin = createAdmin(db);
  await admin.seedSystemRoles();

  const roles = await admin.listRoles();
  assert.equal(roles.length, 4);
  const superAdminRole = roles.find((r) => r.id === 'super_admin');
  const operatorRole = roles.find((r) => r.id === 'operator');
  const moderatorRole = roles.find((r) => r.id === 'moderator');
  const auditorRole = roles.find((r) => r.id === 'auditor');

  assert(superAdminRole);
  assert(operatorRole);
  assert(moderatorRole);
  assert(auditorRole);

  const superStaff = { id: 'staff-1', role: superAdminRole };
  const operatorStaff = { id: 'staff-2', role: operatorRole };
  const moderatorStaff = { id: 'staff-3', role: moderatorRole };
  const auditorStaff = { id: 'staff-4', role: auditorRole };

  // Super admin has all permissions
  assert.equal(admin.hasPermission(superStaff, 'kill_switch:manage'), true);
  assert.equal(admin.hasPermission(superStaff, 'staff:manage'), true);
  assert.equal(admin.hasPermission(superStaff, 'audit:read'), true);

  // Operator can manage kill switches and config, but not staff
  assert.equal(admin.hasPermission(operatorStaff, 'kill_switch:manage'), true);
  assert.equal(admin.hasPermission(operatorStaff, 'config:rollback'), true);
  assert.equal(admin.hasPermission(operatorStaff, 'staff:manage'), false);

  // Moderator can moderate users, but cannot toggle kill switches
  assert.equal(admin.hasPermission(moderatorStaff, 'user:moderate'), true);
  assert.equal(admin.hasPermission(moderatorStaff, 'kill_switch:manage'), false);

  // Auditor can read audit, but cannot mutate anything
  assert.equal(admin.hasPermission(auditorStaff, 'audit:read'), true);
  assert.equal(admin.hasPermission(auditorStaff, 'user:moderate'), false);
  assert.equal(admin.hasPermission(auditorStaff, 'config:rollback'), false);

  assert.throws(
    () => admin.assertHasPermission(auditorStaff, 'kill_switch:manage'),
    (err) => err.code === 'INSUFFICIENT_PERMISSIONS' && err.status === 403,
  );
});

test('RBAC custom role creation, update and protection', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 8 });

  const admin = createAdmin(db);
  await admin.seedSystemRoles();

  // Create staff user for userA
  await db.query(
    `INSERT INTO users (id, identity_provider, provider_subject, display_name)
     VALUES ($1, 'synthetic', 'subA', 'Admin Alpha')
     ON CONFLICT DO NOTHING`,
    [SYNTHETIC_SEED.userA],
  );
  const superStaff = await admin.createStaffUser(null, {
    userId: SYNTHETIC_SEED.userA,
    roleId: 'super_admin',
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  });

  // Create custom role
  const custom = await admin.createRole(superStaff, {
    id: 'support_tier2',
    name: 'Tier 2 Support',
    description: 'User investigation and moderation role',
    permissions: ['user:read', 'user:moderate'],
  });
  assert.equal(custom.id, 'support_tier2');
  assert.deepEqual(
    typeof custom.permissions === 'string' ? JSON.parse(custom.permissions) : custom.permissions,
    ['user:read', 'user:moderate'],
  );

  // Rejects invalid permissions
  await assert.rejects(
    () =>
      admin.createRole(superStaff, {
        id: 'bad_role',
        name: 'Bad Role',
        permissions: ['invalid:perm'],
      }),
    (err) => err.code === 'INVALID_PERMISSIONS',
  );

  // Update role
  const updated = await admin.updateRole(superStaff, {
    id: 'support_tier2',
    name: 'Tier 2 Support Senior',
    permissions: ['user:read', 'user:moderate', 'audit:read'],
  });
  assert.equal(updated.name, 'Tier 2 Support Senior');

  // Protection: cannot modify super_admin system role
  await assert.rejects(
    () =>
      admin.updateRole(superStaff, {
        id: 'super_admin',
        permissions: ['user:read'],
      }),
    (err) => err.code === 'SYSTEM_ROLE_PROTECTED',
  );
});
