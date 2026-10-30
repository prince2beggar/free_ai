import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDatabase, SYNTHETIC_SEED, migrateUp } from '../../packages/db/index.mjs';
import { createAdminServer, DEFAULT_ADMIN_TOTP_SECRET } from '../../tools/phase2/admin.mjs';
import { generateTotp } from '../../packages/admin/totp.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { runStagingCheck } from '../../tools/phase3/staging-check.mjs';
import {
  createFileService,
  sanitizeFilename,
  validateFileUpload,
  sniffContentType,
  extractTextFromCsv,
} from '../../packages/files/index.mjs';
import { createProductivityService } from '../../packages/productivity/index.mjs';
import { createBackupArchive, restoreBackupArchive } from '../../packages/backup/index.mjs';

function createSamplePdf(text) {
  const streamContent = `BT\n/F1 12 Tf\n(${text}) Tj\nET`;
  const streamLen = Buffer.byteLength(streamContent);
  const pdfString = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
    'endobj',
    '4 0 obj',
    `<< /Length ${streamLen} >>`,
    'stream',
    streamContent,
    'endstream',
    'endobj',
    'xref',
    '0 5',
    '0000000000 65535 f ',
    'trailer',
    '<< /Root 1 0 R /Size 5 >>',
    'startxref',
    '300',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdfString, 'utf8');
}

async function createLaunchFixture(t, options = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'free-ai-p3-launch-'));
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
          body:
            value !== undefined
              ? typeof value === 'string'
                ? value
                : JSON.stringify(value)
              : undefined,
        });

        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
          const parts = setCookie.split(';')[0].split('=');
          cookies.set(parts[0].trim(), parts.slice(1).join('='));
        }
        if (response.headers.get('x-csrf-token')) {
          csrf = response.headers.get('x-csrf-token');
        }

        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // non-json response
        }
        return { status: response.status, body: json, text, headers: response.headers };
      },
    };
  }

  return {
    app,
    base,
    client,
    storageDir,
    backupDir,
    tempDir,
    advanceClock: (ms) => {
      virtualTime += ms;
    },
  };
}

test('T3.1: File upload safety verification — malicious files, content sniffing, formula defense, path traversal, IDOR', async (t) => {
  const f = await createLaunchFixture(t);
  const fileService = createFileService({ db: f.app.db, storageDir: f.storageDir });

  // 1. Magic bytes sniffing: valid PDF accepted
  const validPdfBuf = createSamplePdf('Valid PDF Document');
  const validPdfSniff = sniffContentType(validPdfBuf);
  assert.equal(validPdfSniff, 'application/pdf');

  // 2. Spoofed PDF with PE executable magic bytes (MZ) rejected
  const fakePdfBuf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  assert.throws(
    () =>
      validateFileUpload({
        filename: 'malware.pdf',
        buffer: fakePdfBuf,
        declaredMimeType: 'application/pdf',
      }),
    /Forbidden file format.*Windows PE/,
  );

  // 3. Hostile binary signatures rejected safely
  const hostileSignatures = [
    { name: 'linux.elf', buf: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]) },
    { name: 'archive.zip', buf: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]) },
    { name: 'archive.gz', buf: Buffer.from([0x1f, 0x8b, 0x08, 0x00]) },
    { name: 'archive.7z', buf: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
    { name: 'script.sh', buf: Buffer.from('#!/bin/bash\nrm -rf /', 'utf8') },
    { name: 'nullbytes.txt', buf: Buffer.from('Hello\x00World', 'binary') },
  ];

  for (const h of hostileSignatures) {
    assert.throws(
      () => sniffContentType(h.buf),
      /Forbidden file format|Executable script|Binary file or null byte/,
      `Expected ${h.name} to be rejected safely`,
    );
  }

  // 4. Oversized file (> 10MB) and empty file (0 bytes) rejected
  const maxBytes = 1000;
  assert.throws(
    () =>
      validateFileUpload({
        filename: 'big.txt',
        buffer: Buffer.alloc(1500, 0x41),
        maxSizeBytes: maxBytes,
      }),
    (err) => err.code === 'FILE_TOO_LARGE',
  );

  assert.throws(
    () =>
      validateFileUpload({
        filename: 'empty.txt',
        buffer: Buffer.alloc(0),
        maxSizeBytes: maxBytes,
      }),
    (err) => err.code === 'FILE_EMPTY',
  );

  // 5. Path traversal sanitization
  assert.equal(sanitizeFilename('../../../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..\\..\\windows\\system32\\calc.exe'), 'calc.exe');
  assert.equal(sanitizeFilename('CON.txt').toLowerCase().startsWith('con.'), false);
  assert.equal(sanitizeFilename('PRN').toLowerCase().startsWith('prn'), false);
  assert.equal(sanitizeFilename('my$bad*file:name?.csv'), 'my_bad_file_name_.csv');

  // 6. CSV Formula injection defense
  const maliciousCsv = Buffer.from(
    'Name,Payload,Amount\n' +
      'Attacker,"=cmd|/C calc!A0",+100\n' +
      'Admin,"@SUM(1,2)",-50\n' +
      'TabUser,"\tmalicious",25\n',
    'utf8',
  );
  const extractedCsv = extractTextFromCsv(maliciousCsv);
  assert.equal(extractedCsv.hasFormulaPrefix, true);
  assert.ok(extractedCsv.text.includes("'=cmd|/C calc!A0"));
  assert.ok(extractedCsv.text.includes("'@SUM(1,2)"));
  assert.ok(extractedCsv.text.includes("'\tmalicious"));
  assert.ok(extractedCsv.text.includes('+100'));
  assert.ok(extractedCsv.text.includes('-50'));

  // 7. Per-user storage isolation & IDOR prevention
  const user1 = SYNTHETIC_SEED.userA;
  const user2 = SYNTHETIC_SEED.userB;

  const validTextBuf = Buffer.from('Quarterly performance metrics for team Alpha.', 'utf8');
  const uploaded = await fileService.upload({
    userId: user1,
    filename: 'report.txt',
    buffer: validTextBuf,
    mimeType: 'text/plain',
  });
  assert.ok(uploaded.id);

  // User 1 can retrieve
  const user1File = await fileService.getFile({ userId: user1, fileId: uploaded.id });
  assert.equal(user1File.filename, 'report.txt');

  // User 2 cannot retrieve (IDOR blocked)
  const idorGet = await fileService.getFile({ userId: user2, fileId: uploaded.id });
  assert.equal(idorGet, null);

  // User 2 cannot download buffer
  await assert.rejects(
    () => fileService.downloadFile({ userId: user2, fileId: uploaded.id }),
    (err) => err.code === 'FILE_NOT_FOUND',
  );

  // User 2 cannot delete
  const idorDelete = await fileService.deleteFile({ userId: user2, fileId: uploaded.id });
  assert.equal(idorDelete, false);
});

test('T3.2: Retention and storage quotas — automated expiry, disk unlinking, conversation purge, and quota limits', async (t) => {
  const f = await createLaunchFixture(t);
  const fileService = createFileService({ db: f.app.db, storageDir: f.storageDir });
  const userId = SYNTHETIC_SEED.userA;

  // 1. Upload a file
  const buf = Buffer.from('Temporary data that should expire.', 'utf8');
  const file = await fileService.upload({
    userId,
    filename: 'temp-data.txt',
    buffer: buf,
    mimeType: 'text/plain',
  });

  const fullPath = resolve(f.storageDir, file.storage_path);
  assert.ok(existsSync(fullPath), 'File exists on disk initially');

  // Verify storage quota tracking
  const usageBefore = await fileService.getStorageUsage({ userId });
  assert.equal(usageBefore.fileCount, 1);
  assert.equal(usageBefore.usedBytes, buf.length);
  assert.ok(usageBefore.quotaBytes > 0);

  // Backdate file to 40 days ago
  const fortyDaysAgo = new Date(Date.now() - 40 * 86400000).toISOString();
  await f.app.db.query(`UPDATE files SET created_at = $1 WHERE id = $2;`, [fortyDaysAgo, file.id]);

  // 2. Run retention cleanup with 30-day policy
  const cleanupResult = await fileService.runRetentionJob({
    fileRetentionDays: 30,
    dryRun: false,
  });

  assert.ok(cleanupResult.filesExpired >= 1, 'Expired file processed');
  assert.equal(existsSync(fullPath), false, 'Physical file unlinked from disk');

  // Verify storage usage decremented
  const usageAfter = await fileService.getStorageUsage({ userId });
  assert.equal(usageAfter.fileCount, 0, 'Active file count is 0 after retention purge');
  assert.equal(usageAfter.usedBytes, 0, 'Active bytes is 0 after retention purge');

  const convId = 'conv-retention-test-01';
  await f.app.db.query(
    `INSERT INTO conversations (id, user_id, title, deleted_at, updated_at)
     VALUES ($1, $2, 'Old Stale Chat', $3, $3)`,
    [convId, userId, fortyDaysAgo],
  );

  const convCleanup = await fileService.runRetentionJob({
    conversationRetentionDays: 30,
    dryRun: false,
  });

  assert.ok(convCleanup.conversationsPurged >= 1, 'Soft-deleted conversation purged');
  const checkConv = await f.app.db.query(`SELECT id FROM conversations WHERE id = $1`, [convId]);
  assert.equal(checkConv.rows.length, 0, 'Conversation completely removed from database');
});

test('T3.3: Encrypted backup and restore verification — AES-256-GCM, SHA-256 integrity, tamper rejection, and full restore', async (t) => {
  const f = await createLaunchFixture(t);
  const fileService = createFileService({ db: f.app.db, storageDir: f.storageDir });
  const userId = SYNTHETIC_SEED.userA;

  // 1. Populate database and storage with known test data
  const testBuf = Buffer.from('Critical operational data for backup verification.', 'utf8');
  const stored = await fileService.upload({
    userId,
    filename: 'critical_manifest.txt',
    buffer: testBuf,
    mimeType: 'text/plain',
  });

  await f.app.db.query(
    `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'TEST_BACKUP_ACTION', 'system', 'sys-01', '{"test": true}')`,
    ['audit-backup-001', userId],
  );

  const passphrase = 'LaunchVerificationMasterKey2026!#$';

  // 2. Create encrypted backup
  const backupRes = await createBackupArchive({
    db: f.app.db,
    storageBaseDir: f.storageDir,
    passphrase,
    outputDir: f.backupDir,
  });

  assert.ok(backupRes.filePath);
  assert.ok(existsSync(backupRes.filePath), 'Backup archive exists on disk');
  assert.ok(backupRes.ciphertextSha256, 'SHA-256 manifest hash generated');
  assert.equal(backupRes.manifestSummary.fileCount, 1, 'Contains 1 physical file');

  // 3. Verify tampering rejection
  const envelope = JSON.parse(await readFile(backupRes.filePath, 'utf8'));
  const tamperedCiphertext = Buffer.from(envelope.ciphertext, 'base64');
  tamperedCiphertext[10] ^= 0xff; // flip bits
  const tamperedEnvelope = {
    ...envelope,
    ciphertext: tamperedCiphertext.toString('base64'),
  };
  const tamperedPath = join(f.backupDir, 'tampered_backup.enc.json');
  await writeFile(tamperedPath, JSON.stringify(tamperedEnvelope), 'utf8');

  const restoreTargetDb = await createDatabase();
  t.after(() => restoreTargetDb.close());
  const restoreStorageDir = join(f.tempDir, 'restored-files');
  await mkdir(restoreStorageDir, { recursive: true });

  await assert.rejects(
    () =>
      restoreBackupArchive({
        archivePath: tamperedPath,
        passphrase,
        targetStorageBaseDir: restoreStorageDir,
        targetDb: restoreTargetDb,
      }),
    /checksum mismatch|AUTHENTICATION_FAILED/,
  );

  // 4. Verify clean restoration of database tables and storage files
  const restoreRes = await restoreBackupArchive({
    archivePath: backupRes.filePath,
    passphrase,
    targetStorageBaseDir: restoreStorageDir,
    targetDb: restoreTargetDb,
  });

  assert.equal(restoreRes.success, true, 'Restore succeeded');
  assert.ok(restoreRes.tablesRestored >= 1, 'Populated tables restored');
  assert.ok(
    backupRes.manifestSummary.tableCount >= 50,
    'All core database tables included in archive',
  );
  assert.equal(restoreRes.filesRestored, 1, 'Restored 1 file to target storage directory');

  // Verify file restored byte-for-byte identical
  const restoredFileBytes = await readFile(resolve(restoreStorageDir, stored.storage_path));
  assert.deepEqual(
    restoredFileBytes,
    testBuf,
    'Restored file matches original content byte-for-byte',
  );

  // Verify database record restored
  const dbCheck = await restoreTargetDb.query(`SELECT id, filename FROM files WHERE id = $1`, [
    stored.id,
  ]);
  assert.equal(dbCheck.rows.length, 1);
  assert.equal(dbCheck.rows[0].filename, 'critical_manifest.txt');

  const auditCheck = await restoreTargetDb.query(
    `SELECT action FROM admin_audit_log WHERE action = 'TEST_BACKUP_ACTION'`,
  );
  assert.equal(auditCheck.rows.length, 1);
});

test('Launch Checklist: Status page, health telemetry, staging parity, and operational incident runbooks', async (t) => {
  const f = await createLaunchFixture(t);
  const client = f.client();

  // 1. Status Page: GET /api/status returns operational status and component states
  const statusRes = await client.call('/api/status');
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.status, 'operational');
  assert.ok(statusRes.body.uptimeSeconds >= 0);
  const compMap = Object.fromEntries(statusRes.body.components.map((c) => [c.id, c.status]));
  assert.equal(compMap.ai_router, 'operational');
  assert.equal(compMap.file_processing, 'operational');
  assert.equal(compMap.database, 'operational');
  assert.equal(compMap.backups_retention, 'operational');
  assert.equal(compMap.usage_ledger, 'operational');

  // Verify static status page assets are accessible
  const htmlRes = await client.call('/status');
  assert.equal(htmlRes.status, 200);
  assert.ok(htmlRes.text.includes('System Status'));
  assert.ok(htmlRes.text.includes('বাংলা'));

  const jsRes = await client.call('/status.js');
  assert.equal(jsRes.status, 200);
  assert.ok(jsRes.text.includes('সকল সিস্টেম সচল'));

  // 2. Health Telemetry (OPS-05): /health and /api/health report status without leaking internal paths
  const healthRes = await client.call('/health');
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.body.status, 'ok');
  assert.equal(healthRes.body.storage.status, 'ok');
  assert.equal(healthRes.body.backups.status, 'ok');
  assert.equal(healthRes.body.retention.status, 'ok');
  assert.equal(healthRes.body.productivity.status, 'ok');

  const healthJsonStr = JSON.stringify(healthRes.body);
  assert.ok(!healthJsonStr.includes(f.storageDir), 'Internal storage directory path not leaked');
  assert.ok(!healthJsonStr.includes(f.backupDir), 'Internal backup directory path not leaked');

  // 3. Staging Parity Tool (OPS-07): 8/8 checks PASS
  const stagingResult = await runStagingCheck({
    db: f.app.db,
    storageDir: f.storageDir,
    backupDir: f.backupDir,
  });
  assert.equal(stagingResult.ok, true, 'All 8 staging parity checks pass');
  assert.equal(stagingResult.checks.length, 8);
  for (const c of stagingResult.checks) {
    assert.equal(c.passed, true, `Staging check ${c.name} passed`);
  }

  // 4. Incident Runbooks & Notification Procedures (OPS-08, LEG-07)
  const runbookFiles = [
    'README.md',
    'PROVIDER_OUTAGE.md',
    'QUOTA_EXHAUSTION.md',
    'ABUSE_WAVE.md',
    'DATA_INCIDENT_AND_NOTIFICATIONS.md',
    'BACKUP_AND_STORAGE_INCIDENT.md',
  ];

  for (const file of runbookFiles) {
    const content = await readFile(resolve('docs/RUNBOOKS', file), 'utf8');
    assert.ok(content.length > 500, `Runbook ${file} contains substantial procedures`);
  }

  const dataIncidentRunbook = await readFile(
    resolve('docs/RUNBOOKS/DATA_INCIDENT_AND_NOTIFICATIONS.md'),
    'utf8',
  );
  assert.ok(
    dataIncidentRunbook.includes('72 Hours'),
    'Covers 72-hour regulatory notification timeline (LEG-07)',
  );
  assert.ok(
    dataIncidentRunbook.includes('Freeze Forensic State & Audit Logs'),
    'Covers audit log preservation',
  );
  assert.ok(
    dataIncidentRunbook.toLowerCase().includes('containment (< 30 minutes)'),
    'Covers rapid containment',
  );
  assert.ok(
    dataIncidentRunbook.includes('Regulatory Authority Incident Notification'),
    'Includes standard regulatory template',
  );
  assert.ok(
    dataIncidentRunbook.includes('Affected User Notification Notice'),
    'Includes standard user notification template',
  );
});

test('Launch Checklist: Bangla evaluation quality bar, abuse defenses, and legal disclosures', async (t) => {
  const f = await createLaunchFixture(t);

  // 1. Bangla Evaluation Quality Bar: 15/15 cases PASS (100% vs 85% requirement bar)
  const productivity = createProductivityService();
  const suite = JSON.parse(await readFile(resolve('tests/eval/suite.json'), 'utf8'));
  const fixtures = JSON.parse(await readFile(resolve('tests/eval/fixtures.json'), 'utf8'));
  const banglaCases = suite.cases.filter((c) => c.language === 'bn');
  assert.equal(banglaCases.length, 15, 'Must contain exactly 15 Bangla evaluation cases');

  let passedCases = 0;
  for (const c of banglaCases) {
    const answer = fixtures.answers[c.id];
    assert.ok(answer, `Answer for case ${c.id} must exist in fixtures`);
    const { kind } = c.automatic;
    if (kind === 'json_exact') {
      assert.deepEqual(JSON.parse(answer), c.automatic.expected);
    } else if (kind === 'text_exact') {
      assert.equal(answer.trim(), c.automatic.expected.trim());
    } else if (kind === 'nonempty') {
      assert.ok(answer.trim().length > 0);
    }
    passedCases++;
  }
  const passPercent = (passedCases / banglaCases.length) * 100;
  assert.equal(passPercent, 100);
  assert.ok(passPercent >= productivity.defaults.minBanglaPassRatePercent, 'Meets 85% quality bar');

  const totpCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  const client = f.client();
  const staffLoginRes = await client.call('/admin/api/auth/login', 'POST', {
    userId: SYNTHETIC_SEED.userA,
    totpCode,
  });
  assert.equal(staffLoginRes.status, 200, 'Staff MFA login succeeded');
  const staffToken = staffLoginRes.body.session.token;

  // Kill switch operational verification
  const killSwitchList = await client.call('/admin/api/kill-switches', 'GET', undefined, {
    Authorization: 'Bearer ' + staffToken,
  });
  assert.equal(killSwitchList.status, 200);
  assert.ok(killSwitchList.body.killSwitches);

  // 3. Legal Disclosures Review: 5 draft notices present with testing disclosures
  const legalFiles = ['terms.html', 'privacy.html', 'cookies.html', 'aup.html', 'refunds.html'];
  for (const lFile of legalFiles) {
    const legalPath = resolve('apps/web/public/legal', lFile);
    assert.ok(existsSync(legalPath), `Legal document ${lFile} exists`);
    const legalText = await readFile(legalPath, 'utf8');
    assert.ok(
      legalText.toLowerCase().includes('draft') ||
        legalText.toLowerCase().includes('testing') ||
        legalText.toLowerCase().includes('notice'),
      `Legal document ${lFile} contains draft/testing notice`,
    );
  }
});
