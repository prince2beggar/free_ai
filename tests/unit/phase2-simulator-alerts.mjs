import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAdminServer, DEFAULT_ADMIN_TOTP_SECRET } from '../../tools/phase2/admin.mjs';
import { generateTotp } from '../../packages/admin/totp.mjs';
import { SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { routerFixture } from '../../tools/phase2/router-fixture.mjs';
import { AppError } from '../../packages/api/errors.mjs';

async function fixture(t, options = {}) {
  let virtualTime = Date.parse('2026-10-13T00:00:00.000Z');
  const clock = () => virtualTime;
  const app = await createAdminServer({
    fixtureOptions: {
      clock,
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

  return {
    ...app,
    client,
    get time() {
      return virtualTime;
    },
    advanceTime(ms) {
      virtualTime += ms;
    },
  };
}

async function prepareChat(
  f,
  { actor = SYNTHETIC_SEED.userA, routing = {}, content = 'Chaos test' } = {},
) {
  const requestId = randomUUID();
  const conversationId = randomUUID();
  const nowIso = new Date(f.time).toISOString();
  await f.db.query('INSERT INTO conversations(id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
    conversationId,
    actor,
  ]);
  await f.db.query(
    'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash) VALUES($1,$2,$3,$1,$4)',
    [requestId, actor, conversationId, 'x'.repeat(64)],
  );
  await f.db.query(
    'INSERT INTO abuse_admissions(request_id,user_id,source_key,trust_level,day_at,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [requestId, actor, 'a'.repeat(64), 3, nowIso, nowIso],
  );
  await f.db.query(
    "INSERT INTO messages(id,user_id,conversation_id,role,content,request_id) VALUES($1,$2,$3,'user',$4,$5)",
    [randomUUID(), actor, conversationId, content, requestId],
  );
  const messages = [{ role: 'user', content }];
  await f.router.prepare(actor, { requestId, conversationId, messages, language: 'en', routing });
  return { requestId, conversationId, messages, language: 'en', routing };
}

test('Step 2.8 AP-06: Routing simulator dry-run with prompt, language, presets, and tier constraints', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  const ledgerBefore = (await f.db.query('SELECT count(*)::int as count FROM usage_ledger')).rows[0]
    .count;
  const holdsBefore = (
    await f.db.query('SELECT count(*)::int as count FROM router_accounting_holds')
  ).rows[0].count;

  // 1. Simulate Bangla writing prompt
  const bnRes = await staff.call('/admin/api/routing/simulate', 'POST', {
    prompt: 'আমার সোনার বাংলা আমি তোমায় ভালোবাসি',
    language: 'bn',
    taskPreset: 'writing',
    mode: 'auto',
    tier: 'free',
  });
  assert.equal(bnRes.response.status, 200, bnRes.text);
  assert.equal(bnRes.json.ok, true);
  assert.equal(bnRes.json.simulatedOnly, true);
  assert.equal(bnRes.json.input.language, 'bn');
  assert.equal(bnRes.json.input.taskPreset, 'writing');
  assert.ok(bnRes.json.selection);
  assert.ok(bnRes.json.selection.modelId);
  assert.ok(bnRes.json.selection.qualityScore >= 50);
  assert.ok(typeof bnRes.json.selection.estimatedCostMicroCu === 'number');
  assert.ok(Array.isArray(bnRes.json.candidates));

  // 2. Simulate Coding prompt
  const codeRes = await staff.call('/admin/api/routing/simulate', 'POST', {
    prompt: 'function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }',
    language: 'en',
    taskPreset: 'coding',
    mode: 'auto',
    tier: 'free',
  });
  assert.equal(codeRes.response.status, 200);
  assert.equal(codeRes.json.selection.modelId, routerFixture.models[0].id);

  // 3. Free tier constraint excludes paid models
  const freeRes = await staff.call('/admin/api/routing/simulate', 'POST', {
    prompt: 'Test prompt for tier check',
    language: 'en',
    tier: 'free',
  });
  assert.equal(freeRes.response.status, 200);
  const paidCandidate = freeRes.json.candidates.find((c) => c.modelId.includes('paid'));
  assert.equal(paidCandidate, undefined);
  const paidRejected = freeRes.json.rejected.find((r) => r.modelId.includes('paid'));
  assert.ok(paidRejected);
  assert.equal(paidRejected.reason, 'INSUFFICIENT_BALANCE');

  // 4. Zero accounting side-effects verification (dry-run integrity)
  const ledgerAfter = (await f.db.query('SELECT count(*)::int as count FROM usage_ledger')).rows[0]
    .count;
  const holdsAfter = (
    await f.db.query('SELECT count(*)::int as count FROM router_accounting_holds')
  ).rows[0].count;
  assert.equal(ledgerAfter, ledgerBefore);
  assert.equal(holdsAfter, holdsBefore);

  // 5. Verification that simulation is audited
  const auditRows = (
    await f.db.query("SELECT * FROM admin_audit_log WHERE action = 'ROUTING_SIMULATED'")
  ).rows;
  assert.ok(auditRows.length >= 3);
});

test('Step 2.8 AP-06: Routing simulator circuit breaker awareness', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  const modelA = routerFixture.models[0].id;

  // Open circuit breaker for model A
  await f.db.query(
    `INSERT INTO router_breakers (id, failures, window_at, opened_until)
     VALUES ($1, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour')
     ON CONFLICT (id) DO UPDATE SET failures = 5, opened_until = CURRENT_TIMESTAMP + INTERVAL '1 hour'`,
    [`model-${modelA}`],
  );

  // Simulate routing: model A should be rejected as CIRCUIT_OPEN
  const simRes = await staff.call('/admin/api/routing/simulate', 'POST', {
    prompt: 'Hello circuit test',
    language: 'en',
    taskPreset: 'general',
  });
  assert.equal(simRes.response.status, 200);
  assert.notEqual(simRes.json.selection.modelId, modelA);
  const rejectedA = simRes.json.rejected.find((r) => r.modelId === modelA);
  assert.ok(rejectedA);
  assert.equal(rejectedA.reason, 'CIRCUIT_OPEN');
});

test('Step 2.8 OPS-05: Health endpoints report system and component health', async (t) => {
  const f = await fixture(t);

  // 1. Public /health endpoint
  const pubHealth = await f.client().call('/health');
  assert.equal(pubHealth.response.status, 200);
  assert.equal(pubHealth.json.status, 'ok');
  assert.equal(pubHealth.json.database, 'ready');
  assert.ok(typeof pubHealth.json.uptimeSeconds === 'number');
  assert.ok(pubHealth.json.providers);
  assert.ok(pubHealth.json.breakers);
  assert.equal(pubHealth.json.breakers.openCount, 0);
  assert.ok(pubHealth.json.capacity);

  // 2. Public /api/health alias
  const apiHealth = await f.client().call('/api/health');
  assert.equal(apiHealth.response.status, 200);
  assert.equal(apiHealth.json.status, 'ok');

  // 3. Staff monitoring health endpoint requires auth
  const unauth = await f.client().call('/admin/api/monitoring/health');
  assert.equal(unauth.response.status, 401);

  // 4. Staff monitoring health endpoint with staff session
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  const staffHealth = await staff.call('/admin/api/monitoring/health');
  assert.equal(staffHealth.response.status, 200);
  assert.equal(staffHealth.json.ok, true);
  assert.equal(staffHealth.json.status, 'ok');
  assert.equal(staffHealth.json.database, 'ready');
  assert.ok(staffHealth.json.providers.total >= 1);
  assert.equal(staffHealth.json.breakers.openCount, 0);
});

test('Step 2.8 OPS-05: Owner alert creation, delivery proof, append-only attempts, and retries', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // Track delivered alerts in custom sink
  const deliveredAlerts = [];
  let sinkShouldFail = false;
  f.admin.registerAlertSink('custom', async (alert) => {
    if (sinkShouldFail) {
      return { status: 'FAILURE', code: 503, error: 'Sink network timeout' };
    }
    deliveredAlerts.push(alert);
    return { status: 'SUCCESS', code: 200, body: { ack: true } };
  });

  // 1. Create and dispatch owner alert
  const alertRes = await staff.call('/admin/api/alerts/test', 'POST', {
    kind: 'PROVIDER_OUTAGE',
    severity: 'critical',
    title: 'Primary provider unresponsive',
    message: 'Upstream gateway timed out on 3 consecutive attempts',
    channel: 'custom',
    target: 'ops-oncall@example.invalid',
    metadata: { providerId: 'synthetic-provider', consecutiveFailures: 3 },
  });
  assert.equal(alertRes.response.status, 200, alertRes.text);
  assert.equal(alertRes.json.alert.status, 'DELIVERED');
  assert.equal(alertRes.json.delivery.ok, true);
  assert.equal(alertRes.json.delivery.status, 'DELIVERED');

  // Verify delivery sink received alert payload
  assert.equal(deliveredAlerts.length, 1);
  assert.equal(deliveredAlerts[0].kind, 'PROVIDER_OUTAGE');
  assert.equal(deliveredAlerts[0].severity, 'critical');
  assert.equal(deliveredAlerts[0].target, 'ops-oncall@example.invalid');

  // Verify delivery attempt record in append-only table
  const alertId = alertRes.json.alert.id;
  const attempts = (
    await f.db.query('SELECT * FROM alert_delivery_attempts WHERE alert_id = $1', [alertId])
  ).rows;
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'SUCCESS');
  assert.equal(attempts[0].response_code, 200);

  // Verify append-only protection on alert_delivery_attempts
  await assert.rejects(
    f.db.query('UPDATE alert_delivery_attempts SET status = $1 WHERE id = $2', [
      'FAILURE',
      attempts[0].id,
    ]),
    /append-only/i,
  );
  await assert.rejects(
    f.db.query('DELETE FROM alert_delivery_attempts WHERE id = $1', [attempts[0].id]),
    /append-only/i,
  );

  // 2. Transient failure & retry flow
  sinkShouldFail = true;

  const failAlertRes = await staff.call('/admin/api/alerts/test', 'POST', {
    kind: 'CAPACITY_EXHAUSTED',
    severity: 'warning',
    title: 'Free pool buffer low',
    message: 'Free pool remaining tokens below 10%',
    channel: 'custom',
    target: 'webhook://ops.internal',
    metadata: { poolRemaining: '500' },
  });
  assert.equal(failAlertRes.response.status, 200, failAlertRes.text);
  assert.equal(failAlertRes.json.alert.status, 'PENDING');
  assert.equal(failAlertRes.json.delivery.ok, false);

  const failAlertId = failAlertRes.json.alert.id;

  // Retry delivery after sink recovers
  sinkShouldFail = false;
  const retryRes = await staff.call(`/admin/api/alerts/${failAlertId}/retry`, 'POST', {});
  assert.equal(retryRes.response.status, 200, retryRes.text);
  assert.equal(retryRes.json.alert.status, 'DELIVERED');
  assert.equal(retryRes.json.delivery.ok, true);

  // Verify two attempt records: one FAILURE and one SUCCESS
  const retryAttempts = (
    await f.db.query(
      'SELECT * FROM alert_delivery_attempts WHERE alert_id = $1 ORDER BY attempted_at ASC',
      [failAlertId],
    )
  ).rows;
  assert.equal(retryAttempts.length, 2);
  assert.equal(retryAttempts[0].status, 'FAILURE');
  assert.equal(retryAttempts[0].response_code, 503);
  assert.equal(retryAttempts[1].status, 'SUCCESS');
  assert.equal(retryAttempts[1].response_code, 200);

  // 3. List alerts with filter
  const listRes = await staff.call('/admin/api/alerts?kind=PROVIDER_OUTAGE');
  assert.equal(listRes.response.status, 200);
  assert.equal(listRes.json.ok, true);
  assert.ok(listRes.json.alerts.length >= 1);
  assert.equal(listRes.json.alerts[0].kind, 'PROVIDER_OUTAGE');
  assert.ok(Array.isArray(listRes.json.alerts[0].attempts));

  // 4. Overview dashboard displays recent alerts
  const overviewRes = await staff.call('/admin/api/dashboard');
  assert.equal(overviewRes.response.status, 200);
  assert.ok(overviewRes.json.recentAlerts.length >= 2);
});

test('Step 2.8 OPS-06: Provider outage chaos test with automatic fallback, circuit breaker, and fault isolation', async (t) => {
  const modelA = routerFixture.models[0];
  const modelB = routerFixture.models[1];

  let failModelA = true;
  let modelBCalled = false;

  const overrides = {
    [modelA.id]: {
      synthetic: true,
      providerId: routerFixture.provider.id,
      modelId: modelA.id,
      health: () => ({ synthetic: true, available: !failModelA }),
      async *stream() {
        if (failModelA) {
          throw new AppError(
            503,
            'SIMULATED_PROVIDER_OUTAGE',
            'Primary provider hard network drop',
          );
        }
        yield { text: 'Model A recovery response' };
      },
    },
    [modelB.id]: {
      synthetic: true,
      providerId: routerFixture.provider.id,
      modelId: modelB.id,
      health: () => ({ synthetic: true, available: true }),
      async *stream() {
        modelBCalled = true;
        yield { text: 'Model B fallback succeeded' };
      },
    },
  };

  const f = await fixture(t, {
    gatewayOverrides: overrides,
    routerOptions: {
      maxRetries: 0,
      maxFallbacks: 1,
      breakerFailures: 2,
      coolOffMs: 2000,
    },
  });

  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // Connect owner alert sink
  const outageAlerts = [];
  f.admin.registerAlertSink('in_app', async (alert) => {
    outageAlerts.push(alert);
    return { status: 'SUCCESS', code: 200 };
  });

  // 1. Initial user request: Model A fails, Router transparently falls back to Model B
  const chatData1 = await prepareChat(f, {
    content: 'Chaos test request 1',
    routing: { mode: 'manual', modelId: modelA.id },
  });

  const stream1 = f.router.stream(SYNTHETIC_SEED.userA, chatData1);
  const chunks1 = [];
  for await (const chunk of stream1) {
    if (chunk.type === 'delta') chunks1.push(chunk.text);
  }
  // User receives complete output from fallback model B!
  assert.equal(chunks1.join(''), 'Model B fallback succeeded');
  assert.equal(modelBCalled, true);

  // Check router attempts: Attempt 1 on model A failed, Attempt 2 on model B succeeded
  const attempts1 = (
    await f.db.query('SELECT * FROM router_attempts WHERE request_id = $1 ORDER BY ordinal ASC', [
      chatData1.requestId,
    ])
  ).rows;
  assert.equal(attempts1.length, 2);
  assert.equal(attempts1[0].model_id, modelA.id);
  assert.equal(attempts1[0].state, 'PENDING_RECONCILIATION');
  assert.equal(attempts1[1].model_id, modelB.id);
  assert.equal(attempts1[1].state, 'COMPLETE');

  // Breaker for Model A recorded 1 failure (threshold is 2)
  const breakerState1 = (
    await f.db.query('SELECT * FROM router_breakers WHERE id = $1', [`model-${modelA.id}`])
  ).rows[0];
  assert.equal(breakerState1.failures, 1);
  assert.equal(breakerState1.opened_until, null);

  // 2. Second user request: Model A fails again -> trips circuit breaker to OPEN
  modelBCalled = false;
  const chatData2 = await prepareChat(f, {
    content: 'Chaos test request 2',
    routing: { mode: 'manual', modelId: modelA.id },
  });

  const stream2 = f.router.stream(SYNTHETIC_SEED.userA, chatData2);
  // Provider breaker trips upon 2nd failure, blocking all routes on the provider
  await assert.rejects(
    async () => {
      for await (const chunk of stream2) {
        if (chunk) continue;
      }
    },
    (err) => err.code === 'NO_ELIGIBLE_MODELS',
  );

  // Circuit breaker for Model A and Provider are now OPEN
  const breakerState2 = (
    await f.db.query('SELECT * FROM router_breakers WHERE id = $1', [`model-${modelA.id}`])
  ).rows[0];
  assert.ok(breakerState2.failures >= 2);
  assert.ok(breakerState2.opened_until !== null);

  const providerBreaker = (
    await f.db.query('SELECT * FROM router_breakers WHERE id = $1', [
      `provider-${routerFixture.provider.id}`,
    ])
  ).rows[0];
  assert.ok(providerBreaker.failures >= 2);
  assert.ok(providerBreaker.opened_until !== null);

  // Create owner alert for the provider/model breaker trip
  await f.admin.createOwnerAlert(null, {
    kind: 'CIRCUIT_BREAKER_OPEN',
    severity: 'critical',
    title: `Circuit breaker opened for provider ${routerFixture.provider.id}`,
    message: `Provider ${routerFixture.provider.id} breached failure threshold (2 failures). Traffic isolated.`,
    channel: 'in_app',
    metadata: { providerId: routerFixture.provider.id, failures: providerBreaker.failures },
  });

  // 3. Third user request: While breaker is OPEN, provider is blocked!
  // Fast rejection at admission with 503 NO_ELIGIBLE_MODELS without making any external calls
  await assert.rejects(
    prepareChat(f, { content: 'Chaos test request 3' }),
    (err) => err.code === 'NO_ELIGIBLE_MODELS',
  );

  // 4. Fault isolation verification: Rest of the application is completely unaffected
  // - Health endpoint reports status degraded but reachable and responsive
  const healthRes = await f.client().call('/health');
  assert.equal(healthRes.response.status, 200);
  assert.equal(healthRes.json.status, 'degraded');
  assert.ok(healthRes.json.breakers.openCount >= 1);

  // - Admin control center, audit log, and user management remain 100% operational
  const usersRes = await staff.call('/admin/api/users');
  assert.equal(usersRes.response.status, 200);
  assert.ok(usersRes.json.users.length >= 2);

  // 5. Recovery test: Clock advances past coolOffMs (2000 ms), circuit breaker closes
  f.advanceTime(2500);
  failModelA = false;

  const chatData4 = await prepareChat(f, {
    content: 'Chaos test recovery request',
    routing: { mode: 'manual', modelId: modelA.id },
  });
  const stream4 = f.router.stream(SYNTHETIC_SEED.userA, chatData4);
  const chunks4 = [];
  for await (const chunk of stream4) {
    if (chunk.type === 'delta') chunks4.push(chunk.text);
  }
  // Model A is restored and serves traffic again!
  assert.equal(chunks4.join(''), 'Model A recovery response');
});

test('Step 2.8 Capacity Dashboard: Live metrics, counters, and breaker views', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // 1. Capacity pools and limits view
  const capRes = await staff.call('/admin/api/routing/capacity');
  assert.equal(capRes.response.status, 200);
  assert.ok(Array.isArray(capRes.json.pools));
  assert.ok(Array.isArray(capRes.json.limits));

  // 2. Circuit breakers view
  const breakersRes = await staff.call('/admin/api/routing/breakers');
  assert.equal(breakersRes.response.status, 200);
  assert.ok(Array.isArray(breakersRes.json.breakers));

  // 3. Overview dashboard live metrics (accessible via /dashboard or /overview)
  const overviewRes = await staff.call('/admin/api/overview');
  assert.equal(overviewRes.response.status, 200);
  assert.ok(overviewRes.json.freePoolRemaining);
  assert.ok(typeof overviewRes.json.activeBreakers === 'number');
  assert.ok(Array.isArray(overviewRes.json.recentAlerts));

  const dashRes = await staff.call('/admin/api/dashboard');
  assert.equal(dashRes.response.status, 200);
  assert.equal(dashRes.json.ok, true);
});
