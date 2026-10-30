import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import {
  createBackupArchive,
  listBackups,
  restoreBackupArchive,
  verifyBackupArchive,
} from '../../packages/backup/index.mjs';
import { createAdminServer, DEFAULT_ADMIN_TOTP_SECRET } from '../../tools/phase2/admin.mjs';
import { generateTotp } from '../../packages/admin/totp.mjs';
import { loadConfig } from '../../packages/api/config.mjs';

test('SEC-10 & OPS-04: Encrypted backup archive creation with AES-256-GCM and SHA-256 checksum', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'freeai-backup-test-'));
  const storageDir = join(tempDir, 'files');
  const backupDir = join(tempDir, 'backups');
  await mkdir(storageDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  // Seed sample database records
  const convId = 'conv-backup-001';
  await db.query(`INSERT INTO conversations(id, user_id, title) VALUES ($1, $2, $3)`, [
    convId,
    SYNTHETIC_SEED.userA,
    'Backup Source Chat',
  ]);
  await db.query(
    `INSERT INTO messages(id, conversation_id, user_id, role, content) VALUES ($1, $2, $3, $4, $5)`,
    ['msg-backup-001', convId, SYNTHETIC_SEED.userA, 'user', 'Confidential project notes'],
  );

  // Seed sample storage files
  const file1Path = join(storageDir, 'user-a', 'document.txt');
  await mkdir(join(storageDir, 'user-a'), { recursive: true });
  await writeFile(file1Path, 'Secret user text document content', 'utf8');

  t.after(async () => {
    await db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  const passphrase = 'SuperSecurePassphrase2026!';
  const backupResult = await createBackupArchive({
    db,
    storageBaseDir: storageDir,
    passphrase,
    outputDir: backupDir,
    metadata: { env: 'test', operator: 'antigravity' },
  });

  assert.ok(backupResult.filePath, 'Backup file path returned');
  assert.ok(backupResult.fileName.endsWith('.enc.json'), 'File name has .enc.json suffix');
  assert.ok(backupResult.sizeBytes > 0, 'Size bytes is positive');
  assert.equal(backupResult.ciphertextSha256.length, 64, 'SHA-256 is 64 hex chars');

  // Verify raw archive content on disk
  const rawArchive = await readFile(backupResult.filePath, 'utf8');
  assert.doesNotMatch(
    rawArchive,
    /Confidential project notes/,
    'Plaintext message is NOT in raw archive',
  );
  assert.doesNotMatch(
    rawArchive,
    /Secret user text document content/,
    'Plaintext file content is NOT in raw archive',
  );

  const envelope = JSON.parse(rawArchive);
  assert.equal(envelope.magic, 'FREEAI_ENC_BACKUP_V1', 'Magic header matches');
  assert.equal(envelope.formatVersion, 1, 'Format version is 1');
  assert.equal(envelope.algorithm, 'aes-256-gcm', 'Algorithm is aes-256-gcm');
  assert.equal(envelope.kdf.name, 'scrypt', 'Key derivation is scrypt');
  assert.equal(envelope.iv.length, 24, '12-byte IV is 24 hex characters');
  assert.equal((envelope.tag ?? envelope.authTag).length, 32, '16-byte tag is 32 hex characters');
  assert.equal(envelope.manifestSummary.metadata.operator, 'antigravity', 'Metadata preserved');
  assert.ok(envelope.manifestSummary.tableCount >= 50, 'All tables included in count');
  assert.equal(envelope.manifestSummary.fileCount, 1, 'File count matches');

  // Verify listBackups sees the created archive
  const list = await listBackups({ backupDir });
  assert.equal(list.length, 1, '1 backup listed');
  assert.equal(list[0].fileName, backupResult.fileName);
  assert.equal(list[0].sha256, backupResult.ciphertextSha256);
});

test('T3.3 & OPS-04: Full database and file storage restoration from encrypted backup', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'freeai-restore-test-'));
  const srcStorage = join(tempDir, 'src-files');
  const dstStorage = join(tempDir, 'dst-files');
  const backupDir = join(tempDir, 'backups');
  await mkdir(srcStorage, { recursive: true });
  await mkdir(dstStorage, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  const srcDb = await createDatabase();
  await migrateUp(srcDb, { throughVersion: 10 });
  await seedSynthetic(srcDb);

  // Insert records into source database
  const convId = 'conv-restore-999';
  await srcDb.query(`INSERT INTO conversations(id, user_id, title) VALUES ($1, $2, $3)`, [
    convId,
    SYNTHETIC_SEED.userA,
    'Restore Test Chat',
  ]);
  await srcDb.query(
    `INSERT INTO messages(id, conversation_id, user_id, role, content) VALUES ($1, $2, $3, $4, $5)`,
    ['msg-restore-999', convId, SYNTHETIC_SEED.userA, 'user', 'Data to be restored'],
  );
  const csvContent = 'name,age\nAlice,30\nBob,25\n';
  const sha = createHash('sha256').update(csvContent).digest('hex');
  await srcDb.query(
    `INSERT INTO files(id, user_id, filename, sanitized_name, mime_type, size_bytes, sha256, storage_path, extracted_text, text_chars, estimated_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      'f-restore-001',
      SYNTHETIC_SEED.userA,
      'test.csv',
      'test.csv',
      'text/csv',
      Buffer.byteLength(csvContent, 'utf8'),
      sha,
      'user-a/test.csv',
      csvContent,
      csvContent.length,
      7,
    ],
  );

  // Write physical file
  const srcFileDir = join(srcStorage, 'user-a');
  await mkdir(srcFileDir, { recursive: true });
  await writeFile(join(srcFileDir, 'test.csv'), 'name,age\nAlice,30\nBob,25\n', 'utf8');

  // Create encrypted backup
  const passphrase = 'RestoreVerificationPassphrase2026!';
  const backup = await createBackupArchive({
    db: srcDb,
    storageBaseDir: srcStorage,
    passphrase,
    outputDir: backupDir,
  });

  await srcDb.close();

  // Create clean target database
  const targetDb = await createDatabase();

  t.after(async () => {
    await targetDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // Test Dry-Run Restore
  const dryResult = await restoreBackupArchive({
    archivePath: backup.filePath,
    passphrase,
    targetDb,
    targetStorageBaseDir: dstStorage,
    dryRun: true,
  });
  assert.equal(dryResult.dryRun, true, 'Dry run reported');
  assert.equal(dryResult.verified, true, 'Archive verified in dry-run');

  // Actual Restore
  const restoreResult = await restoreBackupArchive({
    archivePath: backup.filePath,
    passphrase,
    targetDb,
    targetStorageBaseDir: dstStorage,
    dryRun: false,
  });

  assert.equal(restoreResult.success, true, 'Restore reported success');
  assert.equal(restoreResult.schemaVersion, 10, 'Schema version matches migration 10');
  assert.ok(restoreResult.tablesRestored > 0, 'Tables restored');
  assert.equal(restoreResult.filesRestored, 1, '1 file restored');

  // Verify target DB data matches source
  const usersRes = await targetDb.query('SELECT id FROM users ORDER BY id');
  assert.equal(usersRes.rows.length, 2, '2 seeded users restored');

  const convRes = await targetDb.query('SELECT * FROM conversations WHERE id = $1', [convId]);
  assert.equal(convRes.rows.length, 1, 'Conversation restored');
  assert.equal(convRes.rows[0].title, 'Restore Test Chat');

  const msgRes = await targetDb.query('SELECT * FROM messages WHERE id = $1', ['msg-restore-999']);
  assert.equal(msgRes.rows.length, 1, 'Message restored');
  assert.equal(msgRes.rows[0].content, 'Data to be restored');

  const fileRes = await targetDb.query('SELECT * FROM files WHERE id = $1', ['f-restore-001']);
  assert.equal(fileRes.rows.length, 1, 'File record restored');
  assert.equal(fileRes.rows[0].sanitized_name, 'test.csv');

  // Verify restored physical storage file
  const restoredFileContent = await readFile(join(dstStorage, 'user-a', 'test.csv'), 'utf8');
  assert.equal(restoredFileContent, 'name,age\nAlice,30\nBob,25\n', 'File contents match exactly');
});

test('SEC-10: Decryption authentication failure and tampering rejection', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'freeai-tamper-test-'));
  const backupDir = join(tempDir, 'backups');
  await mkdir(backupDir, { recursive: true });

  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  t.after(async () => {
    await db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  const correctPassphrase = 'CorrectPassphrase#123';
  const backup = await createBackupArchive({
    db,
    passphrase: correctPassphrase,
    outputDir: backupDir,
  });

  // 1. Wrong passphrase must throw INVALID_PASSPHRASE_OR_CORRUPT_ARCHIVE
  await assert.rejects(
    async () => {
      await verifyBackupArchive({
        archivePath: backup.filePath,
        passphrase: 'WrongPassphrase#999',
      });
    },
    (err) => err.code === 'INVALID_PASSPHRASE_OR_CORRUPT_ARCHIVE',
    'Rejects incorrect passphrase',
  );

  // 2. Tampered ciphertext must throw SHA-256 mismatch or decryption failure
  const envelope = JSON.parse(await readFile(backup.filePath, 'utf8'));
  const tamperedCiphertext = Buffer.from(envelope.ciphertext, 'base64');
  tamperedCiphertext[10] ^= 0xff; // flip bits

  // Case A: Tampered ciphertext without updating SHA-256
  const tamperedEnvelopeA = {
    ...envelope,
    ciphertext: tamperedCiphertext.toString('base64'),
  };
  await assert.rejects(
    async () => {
      await verifyBackupArchive({
        archiveContent: tamperedEnvelopeA,
        passphrase: correctPassphrase,
      });
    },
    /checksum mismatch/,
    'Rejects tampered ciphertext with checksum mismatch',
  );

  // Case B: Tampered ciphertext with forged SHA-256; AES-GCM authTag must fail
  const forgedSha = createHash('sha256').update(tamperedCiphertext).digest('hex');
  const tamperedEnvelopeB = {
    ...envelope,
    ciphertext: tamperedCiphertext.toString('base64'),
    ciphertextSha256: forgedSha,
  };
  await assert.rejects(
    async () => {
      await verifyBackupArchive({
        archiveContent: tamperedEnvelopeB,
        passphrase: correctPassphrase,
      });
    },
    (err) => err.code === 'INVALID_PASSPHRASE_OR_CORRUPT_ARCHIVE',
    'AES-256-GCM auth tag rejects forged ciphertext',
  );

  // 3. Invalid magic header
  const badMagicEnvelope = { ...envelope, magic: 'MALICIOUS_BACKUP_V1' };
  await assert.rejects(
    async () => {
      await verifyBackupArchive({
        archiveContent: badMagicEnvelope,
        passphrase: correctPassphrase,
      });
    },
    /Invalid backup archive/,
    'Rejects invalid magic header',
  );
});

test('HTTP API: /admin/api/backups creation, list, verify, and restore endpoints', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'freeai-api-backup-test-'));
  const backupDir = join(tempDir, 'backups');
  const storageDir = join(tempDir, 'files');
  await mkdir(backupDir, { recursive: true });
  await mkdir(storageDir, { recursive: true });

  const app = await createAdminServer({
    fixtureOptions: {
      abuseOptions: { challengeDifficulty: 4 },
    },
    config: await loadConfig(
      { backupDir, storageDir },
      { webRoot: resolve('apps/web/dist'), port: 0 },
    ),
  });

  t.after(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

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
      async staffLogin(userId = SYNTHETIC_SEED.userA) {
        const totp = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
        const r = await this.call('/admin/api/auth/login', 'POST', { userId, totpCode: totp });
        assert.equal(r.response.status, 200, r.text);
        assert.equal(r.json.ok, true);
        assert.equal(r.json.mfaVerified, true);
        csrf = r.json.session.csrfToken;
      },
    };
  }

  // 1. Unauthenticated request to /admin/api/backups is rejected
  const guest = client();
  const unauth = await guest.call('/admin/api/backups', 'GET');
  assert.equal(unauth.response.status, 401, 'Guest rejected with 401');

  // 2. Staff login with super_admin role
  const staff = client();
  await staff.staffLogin();

  // 3. Create backup via POST /admin/api/backups
  const passphrase = 'ApiBackupPassphrase2026!';
  const createRes = await staff.call('/admin/api/backups', 'POST', {
    passphrase,
    metadata: { source: 'api-test' },
  });
  assert.equal(createRes.response.status, 200, createRes.text);
  assert.equal(createRes.json.ok, true);
  assert.ok(createRes.json.backup.fileName, 'Backup filename returned');
  assert.ok(createRes.json.backup.ciphertextSha256, 'SHA-256 returned');
  const backupPath = createRes.json.backup.filePath;

  // 4. List backups via GET /admin/api/backups
  const listRes = await staff.call('/admin/api/backups', 'GET');
  assert.equal(listRes.response.status, 200, listRes.text);
  assert.equal(listRes.json.ok, true);
  assert.ok(listRes.json.backups.length >= 1, 'At least 1 backup in list');

  // 5. Verify backup via POST /admin/api/backups/verify
  const verifyRes = await staff.call('/admin/api/backups/verify', 'POST', {
    archivePath: backupPath,
    passphrase,
  });
  assert.equal(verifyRes.response.status, 200, verifyRes.text);
  assert.equal(verifyRes.json.ok, true);
  assert.equal(verifyRes.json.valid, true);
  assert.ok(verifyRes.json.manifest.database, 'Manifest returned');

  // 6. Restore backup with dryRun=true via POST /admin/api/backups/restore
  const dryRestore = await staff.call('/admin/api/backups/restore', 'POST', {
    archivePath: backupPath,
    passphrase,
    dryRun: true,
  });
  assert.equal(dryRestore.response.status, 200, dryRestore.text);
  assert.equal(dryRestore.json.ok, true);
  assert.equal(dryRestore.json.restore.dryRun, true);

  // 7. Rejection with invalid passphrase on restore
  const badRestore = await staff.call('/admin/api/backups/restore', 'POST', {
    archivePath: backupPath,
    passphrase: 'WrongPassphrase!',
  });
  assert.equal(badRestore.response.status, 400, 'Rejects invalid passphrase on restore with 400');
  assert.equal(badRestore.json.error.code, 'INVALID_BACKUP_PASSPHRASE');
});
