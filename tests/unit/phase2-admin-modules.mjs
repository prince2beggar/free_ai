import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAdminServer, DEFAULT_ADMIN_TOTP_SECRET } from '../../tools/phase2/admin.mjs';
import { generateTotp } from '../../packages/admin/totp.mjs';
import { SYNTHETIC_SEED } from '../../packages/db/index.mjs';

async function fixture(t, options = {}) {
  const app = await createAdminServer({
    fixtureOptions: {
      abuseOptions: { challengeDifficulty: 4 },
      ...options,
    },
  });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;

  function client() {
    const cookies = new Map();
    let csrf = '';
    return {
      cookies,
      async call(path, method = 'GET', value, extra = {}) {
        const response = await fetch(base + path, {
          method,
          headers: {
            Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
            ...(method === 'GET'
              ? {}
              : { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
            ...extra,
          },
          ...(value === undefined ? {} : { body: JSON.stringify(value) }),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const [k, v] = cookie.split(';')[0].split('=');
          if (v) cookies.set(k, v);
          else cookies.delete(k);
        }
        const text = await response.text();
        const json = text.startsWith('{') ? JSON.parse(text) : null;
        if (json?.csrfToken) csrf = json.csrfToken;
        return { response, text, json };
      },
      async loginStaff(userId = SYNTHETIC_SEED.userA, totpCode) {
        return this.call('/admin/api/auth/login', 'POST', { userId, totpCode });
      },
    };
  }

  return { ...app, client };
}

test('Step 2.7 M1: Overview dashboard live metrics aggregation', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  const dashRes = await staff.call('/admin/api/dashboard');
  assert.equal(dashRes.response.status, 200, dashRes.text);
  assert.equal(dashRes.json.ok, true);
  assert.equal(dashRes.json.syntheticOnly, true);
  assert.ok(dashRes.json.requests);
  assert.ok(typeof dashRes.json.requests.total === 'number');
  assert.ok(typeof dashRes.json.errors.rate === 'number');
  assert.ok(dashRes.json.freePoolRemaining);
  assert.ok(typeof dashRes.json.freePoolRemaining.tokens === 'string');
  assert.ok(dashRes.json.spend);
  assert.ok(typeof dashRes.json.spend.totalMicroCu === 'string');
  assert.ok(typeof dashRes.json.activeUsers === 'number');
  assert.ok(Array.isArray(dashRes.json.recentAlerts));
});

test('Step 2.7 M2: Providers lifecycle, test-call, and config rollback', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. List providers
  const listRes = await staff.call('/admin/api/providers');
  assert.equal(listRes.response.status, 200);
  assert.ok(Array.isArray(listRes.json.providers));

  // 2. Create new provider
  const createRes = await staff.call('/admin/api/providers', 'POST', {
    id: 'prov-test-synth',
    name: 'Synthetic Test Provider',
    adapterKind: 'synthetic_mock',
    status: 'enabled',
    dataPolicyFlag: 'synthetic_only',
    allowsMultiuser: true,
    reason: 'Create test provider',
  });
  assert.equal(createRes.response.status, 200, createRes.text);
  assert.equal(createRes.json.provider.id, 'prov-test-synth');
  assert.equal(createRes.json.provider.status, 'enabled');

  // 3. Test-call on provider
  const testCallRes = await staff.call('/admin/api/providers/prov-test-synth/test-call', 'POST');
  assert.equal(testCallRes.response.status, 200);
  assert.equal(testCallRes.json.healthy, true);
  assert.equal(testCallRes.json.providerId, 'prov-test-synth');

  // 4. Update provider status to disabled
  const patchRes = await staff.call('/admin/api/providers/prov-test-synth', 'PATCH', {
    status: 'disabled',
    reason: 'Emergency disable prov-test-synth',
  });
  assert.equal(patchRes.response.status, 200);
  assert.equal(patchRes.json.provider.status, 'disabled');

  // 5. Verify config history exists
  const histRes = await staff.call('/admin/api/config/history', 'POST', {
    entityType: 'registry_provider',
    entityId: 'prov-test-synth',
  });
  assert.equal(histRes.response.status, 200);
  assert.ok(histRes.json.history.length >= 2);

  // 6. Rollback to version 1 (enabled)
  const rollbackRes = await staff.call('/admin/api/config/rollback', 'POST', {
    entityType: 'registry_provider',
    entityId: 'prov-test-synth',
    targetVersion: 1,
    reason: 'Restore enabled provider',
  });
  assert.equal(rollbackRes.response.status, 200);
  assert.equal(rollbackRes.json.rollback.restoredData.status, 'enabled');

  // Verify provider is restored in DB
  const getRestored = await staff.call('/admin/api/providers');
  const restored = getRestored.json.providers.find((p) => p.id === 'prov-test-synth');
  assert.equal(restored.status, 'enabled');
});

test('Step 2.7 M3: Models lifecycle, CU rates, and config rollback', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. List models
  const listRes = await staff.call('/admin/api/models');
  assert.equal(listRes.response.status, 200);
  assert.ok(Array.isArray(listRes.json.models));

  // 2. Create new model
  const createRes = await staff.call('/admin/api/models', 'POST', {
    id: 'model-synth-v2',
    providerId: SYNTHETIC_SEED.provider,
    displayName: 'Synthetic Chat Model V2',
    capabilities: ['text', 'bangla', 'code'],
    contextLimit: 8192,
    modelClass: 'synthetic',
    cuInRatePer1k: 15,
    cuOutRatePer1k: 45,
    banglaScore: 92,
    freeFlag: true,
    status: 'enabled',
    reason: 'Initial model-synth-v2 deployment',
  });
  assert.equal(createRes.response.status, 200, createRes.text);
  assert.equal(createRes.json.model.id, 'model-synth-v2');
  assert.equal(createRes.json.model.banglaScore, 92);

  // 3. Update model CU rates
  const patchRes = await staff.call('/admin/api/models/model-synth-v2', 'PATCH', {
    cuInRatePer1k: 20,
    cuOutRatePer1k: 60,
    reason: 'Adjust CU rates after calibration',
  });
  assert.equal(patchRes.response.status, 200);
  assert.equal(patchRes.json.model.cuInRatePer1k, 20);

  // 4. Rollback to version 1
  const rollbackRes = await staff.call('/admin/api/config/rollback', 'POST', {
    entityType: 'registry_model',
    entityId: 'model-synth-v2',
    targetVersion: 1,
    reason: 'Restore original CU rates',
  });
  assert.equal(rollbackRes.response.status, 200);
  assert.equal(rollbackRes.json.rollback.restoredData.cuInRatePer1k, 15);
});

test('Step 2.7 M4: Routing policy editor, AP-06 simulator dry run, and capacity views', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. Get routing policies
  const polRes = await staff.call('/admin/api/routing/policies');
  assert.equal(polRes.response.status, 200);
  assert.ok(Array.isArray(polRes.json.policies));
  const activePolicy = polRes.json.policies[0];
  assert.ok(activePolicy);

  // 2. AP-06 Simulator dry run with test prompt
  const simRes = await staff.call('/admin/api/routing/simulate', 'POST', {
    prompt: 'Can you help me write a poem in Bangla?',
    language: 'bn',
    taskPreset: 'writing',
    mode: 'auto',
  });
  assert.equal(simRes.response.status, 200, simRes.text);
  assert.equal(simRes.json.ok, true);
  assert.equal(simRes.json.simulatedOnly, true);
  assert.ok(simRes.json.selection);
  assert.ok(simRes.json.selection.modelId);
  assert.ok(typeof simRes.json.selection.estimatedCostMicroCu === 'number');
  assert.ok(Array.isArray(simRes.json.candidates));

  // 3. Update routing policy
  const updateRes = await staff.call('/admin/api/routing/policies', 'POST', {
    id: activePolicy.id,
    data: {
      ...activePolicy.data,
      ranking: ['quality', 'cost', 'latency'],
    },
    reason: 'Prioritize quality ranking in policy',
  });
  assert.equal(updateRes.response.status, 200);
  assert.equal(updateRes.json.policy.version, activePolicy.version + 1);

  // 4. View breakers and capacity pools
  const breakersRes = await staff.call('/admin/api/routing/breakers');
  assert.equal(breakersRes.response.status, 200);
  assert.ok(Array.isArray(breakersRes.json.breakers));

  const capRes = await staff.call('/admin/api/routing/capacity');
  assert.equal(capRes.response.status, 200);
  assert.ok(Array.isArray(capRes.json.pools));
});

test('Step 2.7 M5: Users search, details, moderation (suspend/restore), tier, and balance adjust', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. Search users
  const searchRes = await staff.call('/admin/api/users?query=user');
  assert.equal(searchRes.response.status, 200);
  assert.ok(Array.isArray(searchRes.json.users));
  assert.ok(searchRes.json.users.length >= 2);

  // 2. Get user details for userB
  const detailsRes = await staff.call('/admin/api/users/' + SYNTHETIC_SEED.userB);
  assert.equal(detailsRes.response.status, 200);
  assert.equal(detailsRes.json.user.id, SYNTHETIC_SEED.userB);
  assert.equal(detailsRes.json.user.status, 'active');

  // 3. Moderate user: suspend
  const suspendRes = await staff.call(
    '/admin/api/users/' + SYNTHETIC_SEED.userB + '/moderate',
    'POST',
    {
      action: 'suspend',
      reason: 'ACCOUNT_ABUSE',
      until: new Date(Date.now() + 3600000).toISOString(),
    },
  );
  assert.equal(suspendRes.response.status, 200);
  assert.equal(suspendRes.json.status, 'suspended');

  // Verify status in user details
  const suspendedDetails = await staff.call('/admin/api/users/' + SYNTHETIC_SEED.userB);
  assert.equal(suspendedDetails.json.user.status, 'suspended');
  assert.equal(suspendedDetails.json.moderation.action, 'suspend');

  // 4. Restore user
  const restoreRes = await staff.call(
    '/admin/api/users/' + SYNTHETIC_SEED.userB + '/moderate',
    'POST',
    {
      action: 'none',
      reason: 'REVIEW_COMPLETE',
    },
  );
  assert.equal(restoreRes.response.status, 200);
  assert.equal(restoreRes.json.status, 'active');

  // 5. Update user tier
  const tierRes = await staff.call('/admin/api/users/' + SYNTHETIC_SEED.userB + '/tier', 'POST', {
    tier: 'funded',
    reason: 'Pilot VIP upgrade',
  });
  assert.equal(tierRes.response.status, 200);
  assert.equal(tierRes.json.tier, 'funded');

  // 6. Adjust user balance
  // Create an entitlement for userB first so balance adjust can target it
  const entId = randomUUID();
  await f.db.query(
    `INSERT INTO ledger_entitlements (id, user_id, kind, status, starts_at, ends_at)
     VALUES ($1, $2, 'free', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day')`,
    [entId, SYNTHETIC_SEED.userB],
  );

  const adjRes = await staff.call(
    '/admin/api/users/' + SYNTHETIC_SEED.userB + '/adjust-balance',
    'POST',
    {
      entitlementId: entId,
      costMicroCu: 50000,
      inputTokens: 500,
      outputTokens: 250,
      type: 'adjust',
      reasonCode: 'LOCAL_CORRECTION',
      reason: 'Compensatory adjustment for test glitch',
    },
  );
  assert.equal(adjRes.response.status, 200, adjRes.text);
  assert.equal(adjRes.json.ok, true);
  assert.equal(adjRes.json.adjusted.costMicroCu, 50000);
});

test('Step 2.7 M6: Staff MFA reset and staff activity logging', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. Create a second staff user
  const newStaffRes = await staff.call('/admin/api/staff', 'POST', {
    userId: SYNTHETIC_SEED.userB,
    roleId: 'operator',
    totpSecret: 'MZXW633PN5XW6MZXW633PN5XW6MZXW63',
  });
  assert.equal(newStaffRes.response.status, 200);

  // 2. Reset MFA for the second staff user
  const resetRes = await staff.call(
    '/admin/api/staff/' + SYNTHETIC_SEED.userB + '/mfa-reset',
    'POST',
    {
      reason: 'Security team requested credentials rotation',
    },
  );
  assert.equal(resetRes.response.status, 200);
  assert.equal(resetRes.json.ok, true);
  assert.ok(resetRes.json.newTotpSecret);
  assert.notEqual(resetRes.json.newTotpSecret, 'MZXW633PN5XW6MZXW633PN5XW6MZXW63');

  // 3. Inspect staff activity
  const actRes = await staff.call('/admin/api/staff/' + SYNTHETIC_SEED.userA + '/activity');
  assert.equal(actRes.response.status, 200);
  assert.ok(Array.isArray(actRes.json.activity));
  assert.ok(actRes.json.activity.length > 0);
});

test('Step 2.7 M11: Abuse alerts and moderation queue views', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. Seed an abuse alert
  await f.db.query(
    `INSERT INTO abuse_alerts (id, source_kind, source_hash, window_at, account_count, rule, created_at)
     VALUES ($1, 'device', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', CURRENT_TIMESTAMP, 5, 'ACCOUNT_CLUSTER', CURRENT_TIMESTAMP)
     ON CONFLICT DO NOTHING`,
    [randomUUID()],
  );

  const alertsRes = await staff.call('/admin/api/abuse/alerts');
  assert.equal(alertsRes.response.status, 200);
  assert.ok(Array.isArray(alertsRes.json.alerts));
  assert.ok(alertsRes.json.alerts.length >= 1);

  // 2. View moderation queue
  const modRes = await staff.call('/admin/api/abuse/moderations');
  assert.equal(modRes.response.status, 200);
  assert.ok(Array.isArray(modRes.json.moderations));
});

test('Step 2.7 M14: Secrets vault write-only rotation and emergency revoke', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. List secrets - must be write-only and NEVER expose raw secret
  const listRes = await staff.call('/admin/api/secrets');
  assert.equal(listRes.response.status, 200);
  assert.ok(Array.isArray(listRes.json.secrets));
  for (const s of listRes.json.secrets) {
    assert.equal(s.writeOnly, true);
    assert.equal(s.secretValue, undefined);
  }

  // 2. Rotate secret for synthetic provider
  const rotateRes = await staff.call('/admin/api/secrets', 'POST', {
    providerId: SYNTHETIC_SEED.provider,
    secretValue: 'synthetic-vault-mock-secret-key-12345678',
    reason: 'Monthly secret key rotation',
  });
  assert.equal(rotateRes.response.status, 200);
  assert.equal(rotateRes.json.ok, true);
  assert.equal(rotateRes.json.writeOnly, true);
  assert.ok(rotateRes.json.secretRef.startsWith('sec-'));

  // 3. Confirm raw secret is not returned in listing
  const afterList = await staff.call('/admin/api/secrets');
  const target = afterList.json.secrets.find((s) => s.providerId === SYNTHETIC_SEED.provider);
  assert.ok(target.hasSecret);
  assert.equal(target.secretValue, undefined);

  // 4. Emergency revoke secret
  const revokeRes = await staff.call(
    '/admin/api/secrets/' + SYNTHETIC_SEED.provider + '/revoke',
    'POST',
    {
      reason: 'Emergency provider decommission',
    },
  );
  assert.equal(revokeRes.response.status, 200);
  assert.equal(revokeRes.json.secretRef, null);
});

test('Step 2.7 M16 & AP-10: Searchable audit log and CSV export with logged export audit event', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. Query audit log with filter
  const auditRes = await staff.call('/admin/api/audit', 'POST', {
    limit: 20,
    action: 'STAFF_MFA_VERIFIED',
  });
  assert.equal(auditRes.response.status, 200);
  assert.ok(Array.isArray(auditRes.json.auditLogs));

  // 2. Export audit log to CSV
  const exportRes = await staff.call('/admin/api/audit/export?limit=50');
  assert.equal(exportRes.response.status, 200);
  assert.ok(exportRes.text.includes('"id","actor_id","action","target_type"'));
  assert.ok(exportRes.text.includes('STAFF_MFA_VERIFIED'));

  // 3. AP-10 verification: The export itself MUST record an immutable audit log entry
  const checkAudit = await staff.call('/admin/api/audit', 'POST', {
    action: 'AUDIT_LOG_EXPORTED',
  });
  assert.equal(checkAudit.response.status, 200);
  assert.ok(checkAudit.json.auditLogs.length >= 1);
  assert.equal(checkAudit.json.auditLogs[0].action, 'AUDIT_LOG_EXPORTED');
});

test('Step 2.7 RBAC: Permission enforcement on module operations (AP-02)', async (t) => {
  const f = await fixture(t);
  const superAdmin = f.client();
  const adminCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await superAdmin.loginStaff(SYNTHETIC_SEED.userA, adminCode);

  // 1. Create an auditor staff account (only has audit:read and user:read)
  const auditorSecret = 'MZXW633PN5XW6MZXW633PN5XW6MZXW63';
  await superAdmin.call('/admin/api/staff', 'POST', {
    userId: SYNTHETIC_SEED.userB,
    roleId: 'auditor',
    totpSecret: auditorSecret,
  });

  // 2. Sign in as auditor
  const auditor = f.client();
  const auditorCode = generateTotp(auditorSecret);
  await auditor.loginStaff(SYNTHETIC_SEED.userB, auditorCode);

  // 3. Auditor CAN read audit log and users
  const auditCheck = await auditor.call('/admin/api/audit');
  assert.equal(auditCheck.response.status, 200);
  const userCheck = await auditor.call('/admin/api/users');
  assert.equal(userCheck.response.status, 200);

  // 4. Auditor CANNOT moderate user (lacks user:moderate) -> 403 INSUFFICIENT_PERMISSIONS
  const modFail = await auditor.call(
    '/admin/api/users/' + SYNTHETIC_SEED.userA + '/moderate',
    'POST',
    {
      action: 'suspend',
    },
  );
  assert.equal(modFail.response.status, 403);
  assert.equal(modFail.json.error.code, 'INSUFFICIENT_PERMISSIONS');

  // 5. Auditor CANNOT update provider (lacks provider:manage) -> 403 INSUFFICIENT_PERMISSIONS
  const provFail = await auditor.call('/admin/api/providers', 'POST', {
    id: 'prov-bad',
    name: 'Bad Provider',
  });
  assert.equal(provFail.response.status, 403);
  assert.equal(provFail.json.error.code, 'INSUFFICIENT_PERMISSIONS');

  // 6. Auditor CANNOT reset staff MFA (lacks staff:manage) -> 403 INSUFFICIENT_PERMISSIONS
  const mfaFail = await auditor.call(
    '/admin/api/staff/' + SYNTHETIC_SEED.userA + '/mfa-reset',
    'POST',
  );
  assert.equal(mfaFail.response.status, 403);
  assert.equal(mfaFail.json.error.code, 'INSUFFICIENT_PERMISSIONS');
});
