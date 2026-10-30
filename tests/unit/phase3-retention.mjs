import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  createFileService,
  getUserStorageUsage,
  runRetentionJob,
} from '../../packages/files/index.mjs';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

test('FILE-05 & PRIV-05: User storage quota calculation and enforcement', async (t) => {
  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  const testDir = resolve(repoRoot, '.phase3-test-quota-' + Date.now());
  const quotaBytes = 3000; // Small quota for testing

  const fileService = createFileService({
    db,
    storageDir: testDir,
    options: {
      maxUserStorageBytes: quotaBytes,
    },
  });

  const userId = SYNTHETIC_SEED.userA;

  t.after(async () => {
    await db.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Initial storage usage is 0
  const initialUsage = await fileService.getStorageUsage({ userId });
  assert.equal(initialUsage.usedBytes, 0);
  assert.equal(initialUsage.fileCount, 0);
  assert.equal(initialUsage.quotaBytes, quotaBytes);
  assert.equal(initialUsage.remainingBytes, quotaBytes);
  assert.equal(initialUsage.isQuotaExceeded, false);

  const directUsage = await getUserStorageUsage({ db, userId, maxUserStorageBytes: quotaBytes });
  assert.equal(directUsage.usedBytes, 0);

  // 2. Upload file 1 (1200 bytes) -> succeeds
  const buf1 = Buffer.alloc(1200, 'A');
  const file1 = await fileService.upload({
    userId,
    filename: 'doc1.txt',
    buffer: buf1,
  });
  assert.ok(file1.id);

  const usageAfter1 = await fileService.getStorageUsage({ userId });
  assert.equal(usageAfter1.usedBytes, 1200);
  assert.equal(usageAfter1.fileCount, 1);
  assert.equal(usageAfter1.remainingBytes, 1800);
  assert.equal(usageAfter1.isQuotaExceeded, false);

  // 3. Upload file 2 (2000 bytes) -> 1200 + 2000 = 3200 > 3000 -> STORAGE_QUOTA_EXCEEDED
  const buf2 = Buffer.alloc(2000, 'B');
  await assert.rejects(
    async () => {
      await fileService.upload({
        userId,
        filename: 'doc2.txt',
        buffer: buf2,
      });
    },
    (err) => {
      assert.equal(err.code, 'STORAGE_QUOTA_EXCEEDED');
      assert.equal(err.status, 413);
      assert.ok(err.message.includes('User storage quota exceeded'));
      return true;
    },
  );

  // Verify storage usage did not change after rejected upload
  const usageAfterRejection = await fileService.getStorageUsage({ userId });
  assert.equal(usageAfterRejection.usedBytes, 1200);
  assert.equal(usageAfterRejection.fileCount, 1);

  // 4. Delete file 1 -> storage is freed
  const deleted = await fileService.deleteFile({ userId, fileId: file1.id });
  assert.equal(deleted, true);

  const usageAfterDelete = await fileService.getStorageUsage({ userId });
  assert.equal(usageAfterDelete.usedBytes, 0);
  assert.equal(usageAfterDelete.fileCount, 0);
  assert.equal(usageAfterDelete.remainingBytes, quotaBytes);

  // 5. Now upload file 2 (2000 bytes) -> succeeds
  const file2 = await fileService.upload({
    userId,
    filename: 'doc2.txt',
    buffer: buf2,
  });
  assert.ok(file2.id);

  const usageAfter2 = await fileService.getStorageUsage({ userId });
  assert.equal(usageAfter2.usedBytes, 2000);
  assert.equal(usageAfter2.fileCount, 1);
});

test('FILE-05 & T3.2: Retention cleanup expires old files and unlinks disk storage', async (t) => {
  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  const testDir = resolve(repoRoot, '.phase3-test-retention-' + Date.now());
  const fileService = createFileService({
    db,
    storageDir: testDir,
  });

  const userId = SYNTHETIC_SEED.userA;

  t.after(async () => {
    await db.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Upload two files
  const fileA = await fileService.upload({
    userId,
    filename: 'old_file.txt',
    buffer: Buffer.from('Old document created long ago for retention testing.', 'utf8'),
  });
  const fileB = await fileService.upload({
    userId,
    filename: 'fresh_file.txt',
    buffer: Buffer.from('Fresh document created recently.', 'utf8'),
  });

  // Verify physical files exist on disk
  const fullPathA = resolve(testDir, fileA.storage_path);
  const fullPathB = resolve(testDir, fileB.storage_path);
  const statBeforeA = await stat(fullPathA);
  const statBeforeB = await stat(fullPathB);
  assert.ok(statBeforeA.size > 0);
  assert.ok(statBeforeB.size > 0);

  // Backdate fileA to 40 days ago
  const fortyDaysAgo = new Date(Date.now() - 40 * 86400000).toISOString();
  await db.query(`UPDATE files SET created_at = $1 WHERE id = $2;`, [fortyDaysAgo, fileA.id]);

  // 2. Test dry-run: reports 1 file to expire without modifying anything
  const dryRunSummary = await fileService.runRetentionJob({
    fileRetentionDays: 30,
    dryRun: true,
  });
  assert.equal(dryRunSummary.filesExpired, 1);
  assert.equal(dryRunSummary.dryRun, true);

  // Verify fileA is still active and on disk
  const fileAStillActive = await fileService.getFile({ userId, fileId: fileA.id });
  assert.ok(fileAStillActive);
  assert.equal(fileAStillActive.status, 'ready');

  // 3. Execute actual retention job with 30 days retention
  const retentionSummary = await fileService.runRetentionJob({
    fileRetentionDays: 30,
    softDeleteGraceDays: 7,
    dryRun: false,
  });

  assert.equal(retentionSummary.filesExpired, 1);
  assert.ok(retentionSummary.diskBytesFreed > 0);
  assert.equal(retentionSummary.success, true);

  // 4. Old file is now expired (deleted) and no longer accessible
  const fileAAfterExpiry = await fileService.getFile({ userId, fileId: fileA.id });
  assert.equal(fileAAfterExpiry, null);

  // Physical file on disk for fileA should be unlinked
  await assert.rejects(async () => stat(fullPathA), /ENOENT/);

  // Fresh fileB is still completely intact
  const fileBAfter = await fileService.getFile({ userId, fileId: fileB.id });
  assert.ok(fileBAfter);
  assert.equal(fileBAfter.status, 'ready');
  const statBAfter = await stat(fullPathB);
  assert.ok(statBAfter.size > 0);

  // 5. Hard purge of soft-deleted files past grace days:
  // Backdate fileA's deleted_at to 15 days ago
  const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString();
  await db.query(`UPDATE files SET deleted_at = $1 WHERE id = $2;`, [fifteenDaysAgo, fileA.id]);

  const purgeSummary = await fileService.runRetentionJob({
    fileRetentionDays: 30,
    softDeleteGraceDays: 7,
  });
  assert.equal(purgeSummary.filesPurged, 1);

  // Record is permanently purged from files table
  const checkPurgedDb = await db.query('SELECT id FROM files WHERE id = $1;', [fileA.id]);
  assert.equal(checkPurgedDb.rows.length, 0);
});

test('PRIV-05: Retention job purges stale and soft-deleted conversations', async (t) => {
  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  const testDir = resolve(repoRoot, '.phase3-test-conv-retention-' + Date.now());
  const userId = SYNTHETIC_SEED.userA;

  t.after(async () => {
    await db.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // Seed 3 conversations:
  // Conv 1: Stale active conversation created 45 days ago
  const conv1Id = `conv_stale_${randomUUID().slice(0, 8)}`;
  const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86400000).toISOString();
  await db.query(
    `INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES ($1, $2, 'Old chat', $3, $3);`,
    [conv1Id, userId, fortyFiveDaysAgo],
  );
  await db.query(
    `INSERT INTO messages (id, conversation_id, user_id, role, content) VALUES ($1, $2, $3, 'user', 'Old message text');`,
    [`msg_1_${randomUUID().slice(0, 8)}`, conv1Id, userId],
  );

  // Conv 2: Soft-deleted conversation deleted 15 days ago
  const conv2Id = `conv_deleted_${randomUUID().slice(0, 8)}`;
  const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString();
  await db.query(
    `INSERT INTO conversations (id, user_id, title, created_at, deleted_at) VALUES ($1, $2, 'Deleted chat', $3, $3);`,
    [conv2Id, userId, fifteenDaysAgo],
  );
  await db.query(
    `INSERT INTO messages (id, conversation_id, user_id, role, content) VALUES ($1, $2, $3, 'user', 'Deleted message text');`,
    [`msg_2_${randomUUID().slice(0, 8)}`, conv2Id, userId],
  );

  // Conv 3: Fresh active conversation created today
  const conv3Id = `conv_fresh_${randomUUID().slice(0, 8)}`;
  await db.query(`INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, 'Fresh chat');`, [
    conv3Id,
    userId,
  ]);
  await db.query(
    `INSERT INTO messages (id, conversation_id, user_id, role, content) VALUES ($1, $2, $3, 'user', 'Fresh message text');`,
    [`msg_3_${randomUUID().slice(0, 8)}`, conv3Id, userId],
  );

  // Run retention cleanup with 30 days conversation retention & 7 days soft delete grace
  const summary = await runRetentionJob({
    db,
    storageBaseDir: testDir,
    fileRetentionDays: 30,
    softDeleteGraceDays: 7,
    conversationRetentionDays: 30,
  });

  assert.equal(summary.conversationsPurged, 2);
  assert.equal(summary.success, true);

  // Conv 1 and Conv 2 must be purged completely
  const conv1Check = await db.query('SELECT id FROM conversations WHERE id = $1;', [conv1Id]);
  assert.equal(conv1Check.rows.length, 0);

  const conv2Check = await db.query('SELECT id FROM conversations WHERE id = $1;', [conv2Id]);
  assert.equal(conv2Check.rows.length, 0);

  // Conv 3 must still exist with its messages
  const conv3Check = await db.query('SELECT id FROM conversations WHERE id = $1;', [conv3Id]);
  assert.equal(conv3Check.rows.length, 1);

  const conv3Msgs = await db.query('SELECT id FROM messages WHERE conversation_id = $1;', [
    conv3Id,
  ]);
  assert.equal(conv3Msgs.rows.length, 1);
});

test('HTTP API: GET /api/files/storage, quota enforcement, and cleanup endpoints', async (t) => {
  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  const config = await loadConfig({}, { port: 0, limits: { chunkDelayMs: 0 } });
  const testStorageBase = resolve(repoRoot, '.phase3-test-api-retention-' + Date.now());

  const fileService = createFileService({
    db,
    storageDir: testStorageBase,
    options: {
      maxUserStorageBytes: 5000, // 5 KB quota for testing
    },
  });

  const server = createApp({
    db,
    config,
    files: fileService,
  });

  await server.ready;
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + server.address().port;

  t.after(async () => {
    await server.shutdown();
    await rm(testStorageBase, { recursive: true, force: true });
    await db.close();
  });

  // Helper: Sign in
  async function signIn(identity) {
    const bootstrap = await fetch(base + '/api/bootstrap');
    const data = await bootstrap.json();
    const cookie = bootstrap.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');

    const login = await fetch(base + '/api/auth/local', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: base,
        'X-CSRF-Token': data.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identity, acceptedLegalVersion: data.legalVersion }),
    });
    assert.equal(login.status, 200);
    const loginCookies = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');

    const csrfMatch = loginCookies.match(/local_csrf=([a-zA-Z0-9_-]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : data.csrfToken;

    return {
      cookies: loginCookies,
      csrfToken,
    };
  }

  // 1. Sign in as User A
  const clientA = await signIn('demo-alpha');

  // 2. GET /api/files/storage returns initial storage
  const storageRes = await fetch(base + '/api/files/storage', {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(storageRes.status, 200);
  const storageJson = await storageRes.json();
  assert.equal(storageJson.ok, true);
  assert.equal(storageJson.storage.usedBytes, 0);
  assert.equal(storageJson.storage.fileCount, 0);
  assert.equal(storageJson.storage.quotaBytes, 5000);
  assert.equal(storageJson.storage.remainingBytes, 5000);

  // 3. User A uploads file within quota (2000 bytes)
  const uploadRes1 = await fetch(base + '/api/files/upload', {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: 'sample1.txt',
      contentBase64: Buffer.alloc(2000, 'x').toString('base64'),
    }),
  });
  assert.equal(uploadRes1.status, 201);
  const file1Id = (await uploadRes1.json()).file.id;

  // 4. Check storage usage reflects 2000 bytes used
  const storageResAfter1 = await fetch(base + '/api/files/storage', {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(storageResAfter1.status, 200);
  const storageJson1 = await storageResAfter1.json();
  assert.equal(storageJson1.storage.usedBytes, 2000);
  assert.equal(storageJson1.storage.fileCount, 1);
  assert.equal(storageJson1.storage.remainingBytes, 3000);

  // 5. User A tries to upload 4000 bytes (2000 + 4000 = 6000 > 5000) -> 413 STORAGE_QUOTA_EXCEEDED
  const overQuotaRes = await fetch(base + '/api/files/upload', {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: 'huge.txt',
      contentBase64: Buffer.alloc(4000, 'y').toString('base64'),
    }),
  });
  assert.equal(overQuotaRes.status, 413);
  const overQuotaErr = await overQuotaRes.json();
  assert.equal(overQuotaErr.error.code, 'STORAGE_QUOTA_EXCEEDED');

  // 6. User B checks storage -> User B has 0 bytes used (User isolation / IDOR)
  const clientB = await signIn('demo-beta');
  const storageResB = await fetch(base + '/api/files/storage', {
    headers: { Cookie: clientB.cookies },
  });
  assert.equal(storageResB.status, 200);
  assert.equal((await storageResB.json()).storage.usedBytes, 0);

  // 7. Maintenance cleanup endpoint POST /api/files/cleanup
  // Unauthenticated -> 401
  const unauthCleanup = await fetch(base + '/api/files/cleanup', {
    method: 'POST',
    headers: { Origin: base },
  });
  assert.equal(unauthCleanup.status, 401);

  // User A runs cleanup with dryRun: true
  const cleanupRes = await fetch(base + '/api/files/cleanup', {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(cleanupRes.status, 200);
  const cleanupJson = await cleanupRes.json();
  assert.equal(cleanupJson.ok, true);
  assert.equal(cleanupJson.summary.dryRun, true);
  assert.equal(cleanupJson.summary.success, true);

  // 8. User A deletes file 1 -> storage quota is immediately restored
  const deleteRes = await fetch(base + `/api/files/${file1Id}`, {
    method: 'DELETE',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
    },
  });
  assert.equal(deleteRes.status, 200);

  const storageAfterDelete = await fetch(base + '/api/files/storage', {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(storageAfterDelete.status, 200);
  assert.equal((await storageAfterDelete.json()).storage.usedBytes, 0);
});
