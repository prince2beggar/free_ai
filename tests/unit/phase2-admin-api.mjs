import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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
      async proof(purpose = 'signup') {
        const r = await this.call('/api/abuse/challenges', 'POST', { purpose });
        assert.equal(r.response.status, 200, r.text);
        const c = r.json.challenge;
        for (let n = 0; n < 1048576; n++) {
          const digest = createHash('sha256')
            .update(c.nonce + ':' + n)
            .digest();
          let valid = true;
          for (let bit = 0; bit < c.difficulty; bit++)
            if ((digest[Math.floor(bit / 8)] >> (7 - (bit % 8))) & 1) {
              valid = false;
              break;
            }
          if (valid) return { id: c.id, solution: String(n) };
        }
        throw new Error('Bounded proof search exhausted.');
      },
      async loginUser(identity = 'demo-beta') {
        const b = await this.call('/api/bootstrap');
        const challenge = await this.proof();
        const r = await this.call('/api/auth/local', 'POST', {
          identity,
          acceptedLegalVersion: b.json.legalVersion,
          challenge,
        });
        assert.equal(r.response.status, 200, r.text);
        return r.json.user;
      },
      async loginStaff(userId = SYNTHETIC_SEED.userA, totpCode) {
        return this.call('/admin/api/auth/login', 'POST', { userId, totpCode });
      },
      async conversation() {
        return (
          await this.call('/api/conversations', 'POST', { title: 'Admin API synthetic chat' })
        ).json.conversation.id;
      },
      send(id, { key = randomUUID(), content = 'Synthetic message', challenge } = {}) {
        return this.call(
          '/api/conversations/' + id + '/messages',
          'POST',
          {
            content,
            language: 'en',
            routing: { mode: 'auto' },
            ...(challenge ? { challenge } : {}),
          },
          { 'Idempotency-Key': key },
        );
      },
    };
  }

  return { ...app, client };
}

test('AP-01 & T2.7: separate admin scope, user sessions 403 on /admin/*, unauthenticated 401', async (t) => {
  const f = await fixture(t);
  const userClient = f.client();
  const anonClient = f.client();

  // Root /admin status is accessible to browser bootstrap
  const root = await anonClient.call('/admin');
  assert.equal(root.response.status, 200);
  assert.equal(root.json.module, 'admin_control_center');
  assert.equal(root.json.mfaRequired, true);

  // Unauthenticated /admin/api/status returns 401 STAFF_AUTHENTICATION_REQUIRED
  const anonStatus = await anonClient.call('/admin/api/status');
  assert.equal(anonStatus.response.status, 401);
  assert.equal(anonStatus.json.error.code, 'STAFF_AUTHENTICATION_REQUIRED');

  // Sign in as regular non-staff user (demo-beta is not in staff_users)
  const regularUser = await userClient.loginUser('demo-beta');
  assert.ok(regularUser.id);

  // User session accessing /admin/* returns 403 ADMIN_FORBIDDEN (AP-01)
  const forbiddenRoot = await userClient.call('/admin');
  assert.equal(forbiddenRoot.response.status, 403);
  assert.equal(forbiddenRoot.json.error.code, 'ADMIN_FORBIDDEN');

  const forbiddenApi = await userClient.call('/admin/api/status');
  assert.equal(forbiddenApi.response.status, 403);
  assert.equal(forbiddenApi.json.error.code, 'ADMIN_FORBIDDEN');
});

test('AP-04 & T2.7: staff authentication, step-up MFA elevation, and session logout', async (t) => {
  const f = await fixture(t);
  const staffClient = f.client();

  // Invalid staff ID returns 401
  const badLogin = await staffClient.loginStaff('non-existent-user');
  assert.equal(badLogin.response.status, 401);

  // Login without TOTP code returns session requiring MFA elevation
  const initialLogin = await staffClient.loginStaff(SYNTHETIC_SEED.userA);
  assert.equal(initialLogin.response.status, 200);
  assert.equal(initialLogin.json.mfaRequired, true);
  assert.equal(initialLogin.json.mfaVerified, false);

  // Calling protected endpoint before MFA returns 403 MFA_REQUIRED
  const preMfaStatus = await staffClient.call('/admin/api/status');
  assert.equal(preMfaStatus.response.status, 403);
  assert.equal(preMfaStatus.json.error.code, 'MFA_REQUIRED');

  // MFA verification with invalid code fails 400
  const badMfa = await staffClient.call('/admin/api/auth/mfa', 'POST', { totpCode: '000000' });
  assert.equal(badMfa.response.status, 400);
  assert.equal(badMfa.json.error.code, 'INVALID_MFA_CODE');

  // MFA verification with correct TOTP code succeeds and elevates session
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  const goodMfa = await staffClient.call('/admin/api/auth/mfa', 'POST', { totpCode: validCode });
  assert.equal(goodMfa.response.status, 200);
  assert.equal(goodMfa.json.ok, true);
  assert.equal(goodMfa.json.mfaVerified, true);

  // Now protected endpoint succeeds
  const postMfaStatus = await staffClient.call('/admin/api/status');
  assert.equal(postMfaStatus.response.status, 200);
  assert.equal(postMfaStatus.json.staff.id, SYNTHETIC_SEED.userA);
  assert.equal(postMfaStatus.json.staff.role.id, 'super_admin');
  assert.equal(postMfaStatus.json.staff.mfaVerified, true);

  // Logout revokes session
  const logout = await staffClient.call('/admin/api/auth/logout', 'POST', {});
  assert.equal(logout.response.status, 200);

  // Subsequent call returns 401
  const afterLogout = await staffClient.call('/admin/api/status');
  assert.equal(afterLogout.response.status, 401);
});

test('T2.5, AP-09 & T2.6, AP-03: kill switch toggles immediately block chat; rollback restores behavior', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const user = f.client();

  // Authenticate staff with one-step TOTP
  const totp = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  const staffLogin = await staff.loginStaff(SYNTHETIC_SEED.userA, totp);
  assert.equal(staffLogin.response.status, 200);
  assert.equal(staffLogin.json.mfaVerified, true);

  // Authenticate user and create conversation
  await user.loginUser('demo-beta');
  const convId = await user.conversation();

  // First chat message succeeds normally
  const msg1 = await user.send(convId, { content: 'Hello before kill switch' });
  assert.equal(msg1.response.status, 200);

  // Staff enables all_ai kill switch (T2.5)
  const toggleOn = await staff.call('/admin/api/kill-switches', 'POST', {
    id: 'all_ai',
    enabled: true,
    reason: 'Emergency testing of kill switch',
  });
  assert.equal(toggleOn.response.status, 200);
  assert.equal(toggleOn.json.switch.enabled, true);

  // Chat message immediately blocked with 503 KILL_SWITCH_ACTIVE
  const blockedMsg = await user.send(convId, { content: 'Hello during kill switch' });
  assert.equal(blockedMsg.response.status, 503);
  assert.equal(blockedMsg.json.error.code, 'KILL_SWITCH_ACTIVE');

  // Staff inspects config history (AP-03)
  const hist = await staff.call('/admin/api/config/history', 'POST', {
    entityType: 'kill_switch',
    entityId: 'all_ai',
  });
  assert.equal(hist.response.status, 200);
  assert.ok(hist.json.history.length >= 2);

  // Staff rolls back kill switch to version 1 (which had enabled: false) (T2.6, AP-03)
  const rollback = await staff.call('/admin/api/config/rollback', 'POST', {
    entityType: 'kill_switch',
    entityId: 'all_ai',
    targetVersion: 1,
    reason: 'Rollback emergency switch',
  });
  assert.equal(rollback.response.status, 200);
  assert.equal(rollback.json.ok, true);
  assert.equal(rollback.json.rollback.restoredData.enabled, false);

  // Chat request succeeds again immediately (solve burst proof if prompted)
  const burstProof = await user.proof('burst');
  const msg2 = await user.send(convId, { content: 'Hello after rollback', challenge: burstProof });
  assert.equal(msg2.response.status, 200, msg2.text);

  // Inspect audit log (AP-05)
  const audit = await staff.call('/admin/api/audit', 'POST', { limit: 10 });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.json.auditLogs.length > 0);
  const actions = audit.json.auditLogs.map((e) => e.action);
  assert.ok(actions.includes('KILL_SWITCH_TOGGLED'));
  assert.ok(actions.includes('CONFIG_ROLLBACK'));
});
