import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { migrateUp } from '../db/index.mjs';

const defaultsUrl = new URL('./defaults.json', import.meta.url);
const defaults = JSON.parse(await readFile(defaultsUrl, 'utf8'));

export const BACKUP_MAGIC = 'FREEAI_ENC_BACKUP_V1';
export const BACKUP_FORMAT_VERSION = 1;

export const RESTORE_TABLE_ORDER = Object.freeze([
  'schema_migrations',
  'users',
  'sessions',
  'oauth_states',
  'providers',
  'models',
  'registry_metadata',
  'registry_versions',
  'routing_policies',
  'chat_requests',
  'conversations',
  'routing_records',
  'messages',
  'ledger_entitlements',
  'ledger_reservations',
  'usage_ledger',
  'ledger_operations',
  'ledger_alerts',
  'ledger_storage_guard',
  'usage_events',
  'capacity_storage_guard',
  'capacity_pools',
  'capacity_limits',
  'capacity_routes',
  'capacity_counters',
  'capacity_reservations',
  'capacity_allocations',
  'capacity_job_runs',
  'capacity_fair_share',
  'capacity_operations',
  'capacity_events',
  'router_storage_guard',
  'router_policy_versions',
  'router_requests',
  'router_attempts',
  'router_breakers',
  'router_daily_counters',
  'router_accounting_holds',
  'router_events',
  'abuse_admissions',
  'abuse_alerts',
  'abuse_challenges',
  'abuse_counters',
  'abuse_daily_token_counters',
  'abuse_events',
  'abuse_moderation',
  'abuse_profiles',
  'abuse_sources',
  'abuse_storage_guard',
  'staff_roles',
  'staff_users',
  'staff_sessions',
  'kill_switches',
  'config_revisions',
  'admin_audit_log',
  'owner_alerts',
  'alert_delivery_attempts',
  'provider_attempts',
  'audit_events',
  'deletion_requests',
  'files',
]);

async function collectFilesRecursively(dir, rootDir = dir) {
  const entries = [];
  try {
    const list = await readdir(dir, { withFileTypes: true });
    for (const item of list) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        const sub = await collectFilesRecursively(fullPath, rootDir);
        entries.push(...sub);
      } else if (item.isFile()) {
        const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
        const content = await readFile(fullPath);
        const hash = createHash('sha256').update(content).digest('hex');
        entries.push({
          relativePath: relPath,
          size: content.length,
          sha256: hash,
          contentBase64: content.toString('base64'),
        });
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return entries;
}

function deriveKey(
  passphrase,
  salt,
  { N = defaults.scryptN, r = defaults.scryptR, p = defaults.scryptP } = {},
) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('Backup passphrase must be at least 8 characters long.');
  }
  return scryptSync(passphrase, salt, defaults.keyLength, { N, r, p });
}

export async function createBackupArchive({
  db,
  storageBaseDir,
  passphrase,
  outputDir = defaults.defaultBackupDir,
  fileName,
  metadata = {},
}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('Valid database client is required for backup.');
  }
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('Backup passphrase must be at least 8 characters long.');
  }

  // 1. Collect database tables and rows
  const tablesRes = await db.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `);
  const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));

  const tableDump = {};
  const tableCounts = {};
  let totalRows = 0;

  for (const tableName of RESTORE_TABLE_ORDER) {
    if (existingTables.has(tableName)) {
      const rows = (await db.query(`SELECT * FROM "${tableName}"`)).rows;
      tableDump[tableName] = rows;
      tableCounts[tableName] = rows.length;
      totalRows += rows.length;
    }
  }
  // Include any extra tables created in newer migrations not yet in RESTORE_TABLE_ORDER
  for (const tableName of existingTables) {
    if (!tableDump[tableName]) {
      const rows = (await db.query(`SELECT * FROM "${tableName}"`)).rows;
      tableDump[tableName] = rows;
      tableCounts[tableName] = rows.length;
      totalRows += rows.length;
    }
  }

  // Determine latest migration version
  let schemaVersion = 0;
  if (tableDump.schema_migrations && tableDump.schema_migrations.length > 0) {
    schemaVersion = Math.max(...tableDump.schema_migrations.map((m) => m.version));
  }

  // 2. Collect uploaded storage files
  let files = [];
  let totalFileBytes = 0;
  if (storageBaseDir) {
    files = await collectFilesRecursively(storageBaseDir);
    totalFileBytes = files.reduce((acc, f) => acc + f.size, 0);
  }

  const createdAt = new Date().toISOString();
  const manifest = {
    magic: BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    database: {
      schemaVersion,
      tables: tableCounts,
      totalRows,
    },
    files: {
      fileCount: files.length,
      totalBytes: totalFileBytes,
    },
    metadata,
  };

  const payload = JSON.stringify({
    manifest,
    database: {
      schemaVersion,
      tables: tableDump,
    },
    files,
  });

  // 3. Encrypt payload with AES-256-GCM
  const salt = randomBytes(defaults.saltLength);
  const iv = randomBytes(defaults.ivLength);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv(defaults.algorithm, key, iv);
  const ciphertextBuffer = Buffer.concat([
    cipher.update(Buffer.from(payload, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const ciphertextSha256 = createHash('sha256').update(ciphertextBuffer).digest('hex');

  const envelope = {
    magic: BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    algorithm: defaults.algorithm,
    kdf: {
      name: defaults.keyDerivation,
      salt: salt.toString('hex'),
      keyLength: defaults.keyLength,
      N: defaults.scryptN,
      r: defaults.scryptR,
      p: defaults.scryptP,
    },
    iv: iv.toString('hex'),
    tag: authTag.toString('hex'),
    ciphertext: ciphertextBuffer.toString('base64'),
    ciphertextSha256,
    manifestSummary: {
      createdAt,
      schemaVersion,
      tableCount: Object.keys(tableDump).length,
      totalRows,
      fileCount: files.length,
      totalFileBytes,
      metadata,
    },
  };

  const archiveJson = JSON.stringify(envelope, null, 2);
  const outName =
    fileName ?? `freeai-backup-${createdAt.replace(/[:.]/g, '-').replace('T', '_')}.enc.json`;
  const resolvedDir = resolve(outputDir);
  await mkdir(resolvedDir, { recursive: true });
  const outPath = join(resolvedDir, outName);
  await writeFile(outPath, archiveJson, 'utf8');

  return {
    filePath: outPath,
    fileName: outName,
    sizeBytes: Buffer.byteLength(archiveJson, 'utf8'),
    ciphertextSha256,
    manifestSummary: envelope.manifestSummary,
  };
}

export async function verifyBackupArchive({ archivePath, archiveContent, passphrase }) {
  let content = archiveContent;
  if (!content) {
    if (!archivePath) throw new Error('Either archivePath or archiveContent must be provided.');
    content = JSON.parse(await readFile(archivePath, 'utf8'));
  } else if (typeof content === 'string') {
    content = JSON.parse(content);
  }

  if (content.magic !== BACKUP_MAGIC) {
    throw new Error(
      `Invalid backup archive: missing or incorrect magic header '${content.magic}'.`,
    );
  }
  if (!defaults.supportedArchiveVersions.includes(content.formatVersion)) {
    throw new Error(`Unsupported backup format version: ${content.formatVersion}`);
  }

  const ciphertextBuffer = Buffer.from(content.ciphertext, 'base64');
  const actualHash = createHash('sha256').update(ciphertextBuffer).digest('hex');
  if (actualHash !== content.ciphertextSha256) {
    throw new Error('Backup integrity verification failed: ciphertext SHA-256 checksum mismatch.');
  }

  const salt = Buffer.from(content.kdf.salt, 'hex');
  const iv = Buffer.from(content.iv, 'hex');
  const authTag = Buffer.from(content.tag ?? content.authTag, 'hex');
  const key = deriveKey(passphrase, salt, content.kdf);

  let decrypted;
  try {
    const decipher = createDecipheriv(content.algorithm || defaults.algorithm, key, iv);
    decipher.setAuthTag(authTag);
    decrypted = Buffer.concat([decipher.update(ciphertextBuffer), decipher.final()]);
  } catch (err) {
    const error = new Error('Invalid backup passphrase or corrupted archive data.');
    error.code = 'INVALID_PASSPHRASE_OR_CORRUPT_ARCHIVE';
    error.cause = err;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(decrypted.toString('utf8'));
  } catch (err) {
    throw new Error('Failed to parse decrypted backup payload as JSON.');
  }

  return {
    valid: true,
    manifest: payload.manifest,
    summary: content.manifestSummary,
    payload,
  };
}

export async function restoreBackupArchive({
  archivePath,
  archiveContent,
  passphrase,
  targetDb,
  targetStorageBaseDir,
  dryRun = false,
}) {
  const verified = await verifyBackupArchive({ archivePath, archiveContent, passphrase });
  const { payload } = verified;

  if (dryRun) {
    return {
      dryRun: true,
      verified: true,
      manifest: payload.manifest,
      summary: verified.summary,
    };
  }

  if (!targetDb || typeof targetDb.query !== 'function') {
    throw new Error('Target database client is required for restore.');
  }

  // 1. Reset target database schema and replay migrations
  const schemaVersion = payload.database.schemaVersion ?? 10;
  await targetDb.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrateUp(targetDb, { throughVersion: schemaVersion });
  await targetDb.exec('DELETE FROM schema_migrations;');

  // 2. Insert rows in topological order
  const tables = payload.database.tables ?? {};
  let totalRowsRestored = 0;
  let tablesRestored = 0;

  const tableOrder = [...RESTORE_TABLE_ORDER];
  for (const tableName of Object.keys(tables)) {
    if (!tableOrder.includes(tableName)) {
      tableOrder.push(tableName);
    }
  }

  for (const tableName of tableOrder) {
    const rows = tables[tableName];
    if (!rows || rows.length === 0) continue;
    tablesRestored++;
    for (const row of rows) {
      const keys = Object.keys(row);
      const cols = keys.map((k) => `"${k}"`).join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const values = keys.map((k) => row[k]);
      const identityTables = new Set([
        'messages',
        'config_revisions',
        'registry_versions',
        'usage_ledger',
        'capacity_allocations',
        'capacity_fair_share',
      ]);
      const overriding = identityTables.has(tableName) ? 'OVERRIDING SYSTEM VALUE' : '';
      await targetDb.query(
        `INSERT INTO "${tableName}" (${cols}) ${overriding} VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values,
      );
      totalRowsRestored++;
    }
  }

  // 3. Restore files to targetStorageBaseDir if provided
  let filesRestored = 0;
  if (targetStorageBaseDir && Array.isArray(payload.files)) {
    const resolvedBase = resolve(targetStorageBaseDir);
    await mkdir(resolvedBase, { recursive: true });

    for (const file of payload.files) {
      // Path traversal security check
      if (
        !file.relativePath ||
        file.relativePath.includes('..') ||
        file.relativePath.includes('\0') ||
        file.relativePath.startsWith('/') ||
        file.relativePath.startsWith('\\')
      ) {
        throw new Error(`Suspicious file path in backup archive: ${file.relativePath}`);
      }
      const targetFilePath = resolve(resolvedBase, file.relativePath);
      if (!targetFilePath.startsWith(resolvedBase)) {
        throw new Error(`Path traversal attempt detected: ${file.relativePath}`);
      }
      await mkdir(dirname(targetFilePath), { recursive: true });
      const buffer = Buffer.from(file.contentBase64, 'base64');
      const hash = createHash('sha256').update(buffer).digest('hex');
      if (hash !== file.sha256) {
        throw new Error(`Integrity check failed for restored file: ${file.relativePath}`);
      }
      await writeFile(targetFilePath, buffer);
      filesRestored++;
    }
  }

  return {
    dryRun: false,
    success: true,
    restoredAt: new Date().toISOString(),
    schemaVersion,
    tablesRestored,
    totalRowsRestored,
    filesRestored,
    manifest: payload.manifest,
  };
}

export async function listBackups({ backupDir = defaults.defaultBackupDir } = {}) {
  const resolvedDir = resolve(backupDir);
  const backups = [];
  try {
    const files = await readdir(resolvedDir);
    for (const file of files) {
      if (file.endsWith('.enc.json') || file.endsWith('.enc')) {
        const fullPath = join(resolvedDir, file);
        try {
          const stats = await stat(fullPath);
          const raw = await readFile(fullPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed.magic === BACKUP_MAGIC) {
            backups.push({
              fileName: file,
              filePath: fullPath,
              sizeBytes: stats.size,
              createdAt: parsed.manifestSummary?.createdAt ?? stats.birthtime.toISOString(),
              schemaVersion: parsed.manifestSummary?.schemaVersion ?? 0,
              totalRows: parsed.manifestSummary?.totalRows ?? 0,
              fileCount: parsed.manifestSummary?.fileCount ?? 0,
              totalFileBytes: parsed.manifestSummary?.totalFileBytes ?? 0,
              sha256: parsed.ciphertextSha256,
              metadata: parsed.manifestSummary?.metadata ?? {},
            });
          }
        } catch {
          // ignore corrupted/non-json files in directory listing
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return backups;
}

export function createBackupService({
  db,
  storageBaseDir,
  backupDir = defaults.defaultBackupDir,
} = {}) {
  return Object.freeze({
    createBackup: (options = {}) =>
      createBackupArchive({
        db,
        storageBaseDir,
        outputDir: backupDir,
        ...options,
      }),
    verifyBackup: (options = {}) => verifyBackupArchive(options),
    restoreBackup: (options = {}) =>
      restoreBackupArchive({
        targetDb: db,
        targetStorageBaseDir: storageBaseDir,
        ...options,
      }),
    listBackups: (options = {}) => listBackups({ backupDir, ...options }),
  });
}
