import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAdminServer, DEFAULT_ADMIN_TOTP_SECRET } from '../../tools/phase2/admin.mjs';
import { generateTotp } from '../../packages/admin/totp.mjs';
import { SYNTHETIC_SEED, migrateUp } from '../../packages/db/index.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { runStagingCheck } from '../../tools/phase3/staging-check.mjs';

async function createMonitoringFixture(t, options = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'free-ai-p3-monitoring-'));
  const storageDir = join(tempDir, 'files');
  const backupDir = join(tempDir, 'backups');
  await mkdir(storageDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  t.after(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  const webRoot = resolve('apps/web/dist');
  const baseConfig = await loadConfig({ storageDir, backupDir }, { webRoot, port: 0 });
  let virtualTime = Date.parse('2026-10-15T00:00:00.000Z');
  const clock = () => virtualTime;

  const app = await createAdminServer({
    fixtureOptions: {
      clock,
      abuseOptions: { challengeDifficulty: 4 },
      ...options,
    },
    config: baseConfig,
  });

  await migrateUp(app.db, { throughVersion: 10 });

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
    tempDir,
    storageDir,
    backupDir,
    client,
    get time() {
      return virtualTime;
    },
    advanceTime(ms) {
      virtualTime += ms;
    },
  };
}

test('Step 3.6 OPS-05: Extended health monitoring across Phase 3 subsystems', async (t) => {
  const f = await createMonitoringFixture(t);

  // 1. Verify admin.getHealthStatus directly with storage and backup paths
  const health = await f.admin.getHealthStatus({
    storageDir: f.storageDir,
    backupDir: f.backupDir,
  });
  assert.equal(health.database, 'ready');
  assert.equal(health.status, 'ok');
  assert.ok(health.storage);
  assert.equal(health.storage.status, 'ok');
  assert.equal(typeof health.storage.fileCount, 'number');
  assert.equal(typeof health.storage.totalBytes, 'number');
  assert.equal(health.storage.diskAccessible, true);

  assert.ok(health.backups);
  assert.equal(health.backups.status, 'ok');
  assert.equal(typeof health.backups.archiveCount, 'number');
  assert.equal(health.backups.backupDirAccessible, true);

  assert.ok(health.retention);
  assert.equal(health.retention.status, 'ok');

  assert.ok(health.productivity);
  assert.equal(health.productivity.status, 'ok');
  assert.deepEqual(health.productivity.presetsAvailable, ['writing', 'translation', 'summary']);
  assert.equal(health.productivity.banglaEvaluation, 'passed_100_percent');

  // 2. Verify public /health endpoint includes Phase 3 summaries
  const pubHealth = await f.client().call('/health');
  assert.equal(pubHealth.response.status, 200);
  assert.equal(pubHealth.json.status, 'ok');
  assert.ok(pubHealth.json.storage);
  assert.equal(pubHealth.json.storage.status, 'ok');
  assert.ok(pubHealth.json.backups);
  assert.equal(pubHealth.json.backups.status, 'ok');
  assert.ok(pubHealth.json.retention);
  assert.ok(pubHealth.json.productivity);

  // 3. Verify /api/health alias matches
  const apiHealth = await f.client().call('/api/health');
  assert.equal(apiHealth.response.status, 200);
  assert.equal(apiHealth.json.status, 'ok');

  // 4. Authenticated staff endpoint /admin/api/monitoring/health
  const staff = f.client();
  const unauth = await staff.call('/admin/api/monitoring/health');
  assert.equal(unauth.response.status, 401);

  const code = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, code);
  const staffHealth = await staff.call('/admin/api/monitoring/health');
  assert.equal(staffHealth.response.status, 200);
  assert.equal(staffHealth.json.ok, true);
  assert.equal(staffHealth.json.storage.status, 'ok');
  assert.equal(staffHealth.json.backups.status, 'ok');

  // 5. Test degraded status when a circuit breaker is open
  await f.db.query(
    `INSERT INTO router_breakers (id, failures, window_at, opened_until)
     VALUES ('test-breaker', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour')
     ON CONFLICT (id) DO UPDATE SET opened_until = CURRENT_TIMESTAMP + INTERVAL '1 hour'`,
  );
  const degradedHealth = await staff.call('/admin/api/monitoring/health');
  assert.equal(degradedHealth.json.status, 'degraded');
  assert.equal(degradedHealth.json.breakers.openCount >= 1, true);
});

test('Step 3.6 OPS-05: Phase 3 owner alert triggers, delivery attempts, and proof', async (t) => {
  const f = await createMonitoringFixture(t);
  const staff = f.client();
  const code = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, code);

  const delivered = [];
  f.admin.registerAlertSink('custom', async (alert) => {
    delivered.push(alert);
    return { status: 'SUCCESS', code: 200, body: { ack: true } };
  });

  const staffUser = await f.admin.getStaffUser(SYNTHETIC_SEED.userA);

  // 1. Storage alert
  const storageAlert = await f.admin.triggerStorageAlert(staffUser, {
    severity: 'warning',
    title: 'Storage usage at 85%',
    message: 'Active storage exceeded 85 MB threshold.',
    metadata: { currentBytes: 85 * 1024 * 1024, maxBytes: 100 * 1024 * 1024 },
  });
  assert.ok(storageAlert.alert.id);
  assert.equal(storageAlert.alert.kind, 'HEALTH_DEGRADED');
  assert.equal(storageAlert.alert.metadata.subsystem, 'storage');

  // 2. Backup alert
  const backupAlert = await f.admin.triggerBackupAlert(staffUser, {
    severity: 'critical',
    title: 'Backup checksum mismatch',
    message: 'Archive verification failed integrity check.',
    metadata: { archive: 'backup-test.enc', reason: 'SHA256_MISMATCH' },
  });
  assert.ok(backupAlert.alert.id);
  assert.equal(backupAlert.alert.metadata.subsystem, 'backup');

  // 3. Retention alert
  const retentionAlert = await f.admin.triggerRetentionAlert(staffUser, {
    severity: 'warning',
    title: 'Retention job overrun',
    message: 'Purge cycle exceeded expected duration.',
    metadata: { elapsedMs: 5200 },
  });
  assert.ok(retentionAlert.alert.id);
  assert.equal(retentionAlert.alert.metadata.subsystem, 'retention');

  // 4. Data incident alert (LEG-07)
  const dataAlert = await f.admin.triggerDataIncidentAlert(staffUser, {
    severity: 'critical',
    title: 'Potential unauthorized access attempt',
    message: 'High burst of anomalous requests detected.',
    metadata: { ipHash: 'test-hash-123' },
  });
  assert.ok(dataAlert.alert.id);
  assert.equal(dataAlert.alert.metadata.incidentType, 'data_incident');

  // 5. Test dispatch via API and verify append-only delivery attempt
  const dispatchRes = await staff.call('/admin/api/alerts/test', 'POST', {
    kind: 'HEALTH_DEGRADED',
    severity: 'critical',
    title: 'Storage quota emergency alert',
    message: 'Automated notification test',
    channel: 'custom',
    target: 'operator@example.invalid',
    metadata: { subsystem: 'storage', test: true },
  });
  assert.equal(dispatchRes.response.status, 200);
  assert.equal(dispatchRes.json.delivery.ok, true);
  assert.equal(dispatchRes.json.alert.status, 'DELIVERED');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].title, 'Storage quota emergency alert');

  // Verify delivery attempt record in database
  const attemptsRes = await f.db.query(
    `SELECT * FROM alert_delivery_attempts WHERE alert_id = $1`,
    [dispatchRes.json.alert.id],
  );
  assert.equal(attemptsRes.rows.length, 1);
  assert.equal(attemptsRes.rows[0].status, 'SUCCESS');
  assert.equal(attemptsRes.rows[0].channel, 'custom');
});

test('Step 3.6 OPS-05 & Status Page: GET /api/status and static status assets', async (t) => {
  const f = await createMonitoringFixture(t);
  const client = f.client();

  // 1. GET /api/status without authentication (publicly accessible)
  const statusRes = await client.call('/api/status');
  assert.equal(statusRes.response.status, 200);
  assert.equal(statusRes.json.status, 'operational');
  assert.equal(typeof statusRes.json.uptimeSeconds, 'number');
  assert.ok(Array.isArray(statusRes.json.components));
  assert.equal(statusRes.json.components.length, 5);

  const componentIds = statusRes.json.components.map((c) => c.id);
  assert.ok(componentIds.includes('ai_router'));
  assert.ok(componentIds.includes('file_processing'));
  assert.ok(componentIds.includes('database'));
  assert.ok(componentIds.includes('backups_retention'));
  assert.ok(componentIds.includes('usage_ledger'));

  // 2. Open circuit breaker and check /api/status degradation
  await f.db.query(
    `INSERT INTO router_breakers (id, failures, window_at, opened_until)
     VALUES ('provider-synthetic', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour')
     ON CONFLICT (id) DO UPDATE SET failures = 5, opened_until = CURRENT_TIMESTAMP + INTERVAL '1 hour'`,
  );
  const degradedStatus = await client.call('/api/status');
  assert.equal(degradedStatus.json.status, 'degraded_performance');
  const routerComp = degradedStatus.json.components.find((c) => c.id === 'ai_router');
  assert.equal(routerComp.status, 'degraded_performance');

  // 3. Clear breaker
  await f.db.query(`DELETE FROM router_breakers WHERE id = 'provider-synthetic'`);

  // 4. Verify static status assets served with security headers
  const htmlRes = await client.call('/status');
  assert.equal(htmlRes.response.status, 200);
  assert.ok(htmlRes.response.headers.get('content-type')?.includes('text/html'));
  assert.equal(htmlRes.response.headers.get('cache-control'), 'no-store');
  assert.equal(htmlRes.response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(htmlRes.text.includes('Free AI Workspace · System Status'));
  assert.ok(htmlRes.text.includes('/status.css'));
  assert.ok(htmlRes.text.includes('/status.js'));

  const cssRes = await client.call('/status.css');
  assert.equal(cssRes.response.status, 200);
  assert.ok(cssRes.response.headers.get('content-type')?.includes('text/css'));

  const jsRes = await client.call('/status.js');
  assert.equal(jsRes.response.status, 200);
  assert.ok(jsRes.response.headers.get('content-type')?.includes('javascript'));
});

test('Step 3.6 OPS-07: Staging environment parity tool validation', async (t) => {
  const f = await createMonitoringFixture(t);

  // Run staging parity check with fixture database and isolated directories
  const result = await runStagingCheck({
    db: f.db,
    storageDir: f.storageDir,
    backupDir: f.backupDir,
    strict: true,
    keepDbOpen: true,
  });

  assert.equal(
    result.ok,
    true,
    `Staging check failed: ${JSON.stringify(result.checks.filter((c) => !c.passed))}`,
  );
  assert.equal(result.failedCount, 0);
  assert.equal(result.passedCount >= 8, true);

  const checkNames = result.checks.map((c) => c.name);
  assert.ok(checkNames.includes('Node.js Runtime Version'));
  assert.ok(checkNames.includes('File Storage Isolation and Permissions'));
  assert.ok(checkNames.includes('Backup Directory Isolation and Permissions'));
  assert.ok(checkNames.includes('Database Migrations 001..010 Applied'));
  assert.ok(checkNames.includes('Critical Database Tables Presence'));
  assert.ok(checkNames.includes('Router Circuit Breaker Baseline'));
  assert.ok(checkNames.includes('Extended Health Monitoring Telemetry'));
  assert.ok(checkNames.includes('Incident Runbooks Documentation Parity'));
});

test('Step 3.6 OPS-08 & LEG-07: Incident runbooks and notification workflow verification', async () => {
  const runbooksDir = resolve(process.cwd(), 'docs/RUNBOOKS');
  const requiredFiles = [
    'README.md',
    'PROVIDER_OUTAGE.md',
    'QUOTA_EXHAUSTION.md',
    'ABUSE_WAVE.md',
    'DATA_INCIDENT_AND_NOTIFICATIONS.md',
    'BACKUP_AND_STORAGE_INCIDENT.md',
  ];

  for (const file of requiredFiles) {
    const content = await readFile(resolve(runbooksDir, file), 'utf8');
    assert.ok(content.length > 500, `Runbook ${file} is too short or empty.`);
    assert.ok(
      content.includes('Trigger') ||
        content.includes('Conditions') ||
        content.includes('Incident Classification'),
      `${file} missing triggers section`,
    );
    assert.ok(
      content.includes('Mitigation') || content.includes('Automated') || content.includes('Action'),
      `${file} missing mitigation/action section`,
    );
  }

  // Specifically verify LEG-07 data incident notification requirements
  const dataIncidentContent = await readFile(
    resolve(runbooksDir, 'DATA_INCIDENT_AND_NOTIFICATIONS.md'),
    'utf8',
  );
  assert.ok(dataIncidentContent.includes('LEG-07'), 'Missing LEG-07 reference');
  assert.ok(
    dataIncidentContent.includes('72 Hours'),
    'Missing 72-hour regulatory notification timeline',
  );
  assert.ok(
    dataIncidentContent.includes('FORMAL NOTICE OF DATA SECURITY INCIDENT'),
    'Missing regulatory notice template',
  );
  assert.ok(
    dataIncidentContent.includes(
      'Important Security Notice Regarding Your Free AI Workspace Account',
    ),
    'Missing user notice template',
  );
  assert.ok(dataIncidentContent.includes('Containment'), 'Missing immediate containment section');
});
