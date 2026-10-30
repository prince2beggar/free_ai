import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createAdmin } from '../../packages/admin/index.mjs';
import { generateTotp } from '../../packages/admin/totp.mjs';

test('staff authentication lifecycle and MFA enforcement (T2.7)', async (t) => {
  let currentTime = 1700000000000;
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 8 });

  const admin = createAdmin(db, { clock: () => currentTime });
  await admin.seedSystemRoles();

  await db.query(
    `INSERT INTO users (id, identity_provider, provider_subject, display_name)
     VALUES ($1, 'synthetic', 'subA', 'Admin Alpha')
     ON CONFLICT DO NOTHING`,
    [SYNTHETIC_SEED.userA],
  );

  const totpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  await admin.createStaffUser(null, {
    userId: SYNTHETIC_SEED.userA,
    roleId: 'operator',
    totpSecret,
  });

  // Create new session: begins unverified (MFA pending)
  const session = await admin.createSession(SYNTHETIC_SEED.userA, false);
  assert.equal(session.mfaVerified, false);

  // Protected access without MFA verification fails with 403 MFA_REQUIRED (T2.7)
  await assert.rejects(
    () => admin.authenticateSession(session.token, { requireMfa: true }),
    (err) => err.code === 'MFA_REQUIRED' && err.status === 403,
  );

  // Invalid MFA code fails
  await assert.rejects(
    () => admin.verifySessionMfa(session.token, '000000'),
    (err) => err.code === 'INVALID_MFA_CODE' && err.status === 400,
  );

  // Valid TOTP verification elevates session
  const validCode = generateTotp(totpSecret, currentTime, 30);
  const verifyResult = await admin.verifySessionMfa(session.token, validCode);
  assert.equal(verifyResult.ok, true);
  assert.equal(verifyResult.mfaVerified, true);

  // Authenticate now succeeds with MFA satisfied
  const authenticated = await admin.authenticateSession(session.token, { requireMfa: true });
  assert.equal(authenticated.id, SYNTHETIC_SEED.userA);
  assert.equal(authenticated.mfaVerified, true);
  assert.equal(authenticated.role.id, 'operator');

  // Session expiry after TTL
  currentTime += 901 * 1000; // past 900s TTL
  const expired = await admin.authenticateSession(session.token, { requireMfa: false });
  assert.equal(expired, null);
});

test('staff session revocation and account suspension', async (t) => {
  const currentTime = 1700000000000;
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 8 });

  const admin = createAdmin(db, { clock: () => currentTime });
  await admin.seedSystemRoles();

  await db.query(
    `INSERT INTO users (id, identity_provider, provider_subject, display_name)
     VALUES ($1, 'synthetic', 'subB', 'Admin Beta')
     ON CONFLICT DO NOTHING`,
    [SYNTHETIC_SEED.userB],
  );

  const totpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  await admin.createStaffUser(null, {
    userId: SYNTHETIC_SEED.userB,
    roleId: 'auditor',
    totpSecret,
  });

  const session = await admin.createSession(SYNTHETIC_SEED.userB, true);
  const valid = await admin.authenticateSession(session.token);
  assert.equal(valid.id, SYNTHETIC_SEED.userB);

  // Explicit session revocation
  await admin.revokeSession(session.token);
  const revoked = await admin.authenticateSession(session.token);
  assert.equal(revoked, null);

  // Suspended staff user cannot authenticate even with valid session
  const session2 = await admin.createSession(SYNTHETIC_SEED.userB, true);
  await db.query(`UPDATE staff_users SET status = 'suspended' WHERE id = $1`, [
    SYNTHETIC_SEED.userB,
  ]);
  const suspended = await admin.authenticateSession(session2.token);
  assert.equal(suspended, null);
});
