#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createDatabase, migrateUp } from '../../packages/db/index.mjs';
import {
  createBackupArchive,
  listBackups,
  restoreBackupArchive,
  verifyBackupArchive,
} from '../../packages/backup/index.mjs';

function printHelp() {
  console.log(`
Free AI Encrypted Backup CLI (Step 3.5: SEC-10, OPS-04, T3.3)

Usage:
  node tools/phase3/backup.mjs <command> [options]

Commands:
  create    Create an AES-256-GCM encrypted backup archive of database and files
  verify    Verify integrity, checksum, and decrypt manifest of an archive
  restore   Restore database and files from an encrypted backup archive
  list      List available backup archives in backup directory

Options:
  --passphrase <string>   Secret passphrase for key derivation (min 8 chars)
  --archive <path>        Path to encrypted backup archive (.enc.json)
  --out <filename>        Target output filename for created backup
  --dir <path>            Backup directory (default: .phase3-local/backups)
  --storage-dir <path>    Storage directory for files (default: .phase3-local/files)
  --db <path>             PGlite database data directory
  --dry-run               Simulate restore/verification without mutating database
  --help, -h              Show this help message

Examples:
  node tools/phase3/backup.mjs create --passphrase "my-secure-pass"
  node tools/phase3/backup.mjs verify --archive ./data/backups/freeai-backup-xxx.enc.json --passphrase "my-secure-pass"
  node tools/phase3/backup.mjs restore --archive ./data/backups/freeai-backup-xxx.enc.json --passphrase "my-secure-pass" --dry-run
  node tools/phase3/backup.mjs list
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  const options = {
    passphrase: { type: 'string' },
    archive: { type: 'string' },
    out: { type: 'string' },
    dir: { type: 'string', default: '.phase3-local/backups' },
    'storage-dir': { type: 'string', default: '.phase3-local/files' },
    db: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  };

  const { values } = parseArgs({
    args: args.slice(1),
    options,
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const backupDir = resolve(values.dir);
  const storageDir = resolve(values['storage-dir']);

  switch (command) {
    case 'create': {
      if (!values.passphrase || values.passphrase.length < 8) {
        console.error('Error: --passphrase (min 8 chars) is required to create a backup.');
        process.exit(1);
      }
      console.log(`Connecting to database...`);
      const db = await createDatabase(values.db ? { dataDir: resolve(values.db) } : {});
      try {
        console.log(`Creating encrypted backup in ${backupDir}...`);
        const result = await createBackupArchive({
          db,
          storageBaseDir: storageDir,
          passphrase: values.passphrase,
          outputDir: backupDir,
          fileName: values.out,
          metadata: { trigger: 'cli', timestamp: new Date().toISOString() },
        });
        console.log(`\n✓ Encrypted Backup Created Successfully!`);
        console.log(`  File:        ${result.fileName}`);
        console.log(`  Path:        ${result.filePath}`);
        console.log(`  Size:        ${result.sizeBytes} bytes`);
        console.log(`  SHA-256:     ${result.ciphertextSha256}`);
        console.log(
          `  Tables:      ${result.manifestSummary.tableCount} tables (${result.manifestSummary.totalRows} rows)`,
        );
        console.log(
          `  Files:       ${result.manifestSummary.fileCount} files (${result.manifestSummary.totalFileBytes} bytes)`,
        );
      } finally {
        await db.close();
      }
      break;
    }

    case 'verify': {
      if (!values.archive) {
        console.error('Error: --archive path is required for verification.');
        process.exit(1);
      }
      if (!values.passphrase) {
        console.error('Error: --passphrase is required to verify and decrypt.');
        process.exit(1);
      }
      const archivePath = resolve(values.archive);
      console.log(`Verifying backup archive: ${archivePath}...`);
      const verified = await verifyBackupArchive({
        archivePath,
        passphrase: values.passphrase,
      });
      console.log(`\n✓ Backup Archive Verified Successfully!`);
      console.log(`  Format:      ${verified.summary.magic ?? 'FREEAI_ENC_BACKUP_V1'}`);
      console.log(`  Created:     ${verified.summary.createdAt}`);
      console.log(`  Schema Ver:  Migration ${verified.summary.schemaVersion}`);
      console.log(
        `  Tables:      ${verified.summary.tableCount} tables (${verified.summary.totalRows} rows)`,
      );
      console.log(
        `  Files:       ${verified.summary.fileCount} files (${verified.summary.totalFileBytes} bytes)`,
      );
      break;
    }

    case 'restore': {
      if (!values.archive) {
        console.error('Error: --archive path is required for restore.');
        process.exit(1);
      }
      if (!values.passphrase) {
        console.error('Error: --passphrase is required for restore.');
        process.exit(1);
      }
      const archivePath = resolve(values.archive);
      const isDryRun = Boolean(values['dry-run']);
      console.log(`Initiating restore from ${archivePath} (dry-run: ${isDryRun})...`);

      let db = null;
      if (!isDryRun) {
        db = await createDatabase(values.db ? { dataDir: resolve(values.db) } : {});
      }

      try {
        const result = await restoreBackupArchive({
          archivePath,
          passphrase: values.passphrase,
          targetDb: db,
          targetStorageBaseDir: storageDir,
          dryRun: isDryRun,
        });

        if (isDryRun) {
          console.log(`\n✓ Dry-Run Verification Passed!`);
          console.log(`  Archive is valid and can be safely restored.`);
          console.log(
            `  Tables to restore: ${result.summary.tableCount} (${result.summary.totalRows} rows)`,
          );
          console.log(
            `  Files to restore:  ${result.summary.fileCount} (${result.summary.totalFileBytes} bytes)`,
          );
        } else {
          console.log(`\n✓ Restore Completed Successfully!`);
          console.log(`  Restored at:     ${result.restoredAt}`);
          console.log(`  Schema Version:  ${result.schemaVersion}`);
          console.log(`  Tables Restored: ${result.tablesRestored}`);
          console.log(`  Rows Restored:   ${result.totalRowsRestored}`);
          console.log(`  Files Restored:  ${result.filesRestored}`);
        }
      } finally {
        if (db) await db.close();
      }
      break;
    }

    case 'list': {
      console.log(`Scanning backups in ${backupDir}...`);
      const backups = await listBackups({ backupDir });
      if (backups.length === 0) {
        console.log('No backup archives found.');
      } else {
        console.log(`\nFound ${backups.length} backup archive(s):\n`);
        for (const b of backups) {
          console.log(`- ${b.fileName}`);
          console.log(`  Created:    ${b.createdAt}`);
          console.log(`  Size:       ${b.sizeBytes} bytes`);
          console.log(`  Tables:     ${b.totalRows} rows`);
          console.log(`  Files:      ${b.fileCount} files (${b.totalFileBytes} bytes)`);
          console.log(`  SHA-256:    ${b.sha256}`);
          console.log('');
        }
      }
      break;
    }

    default:
      console.error(`Unknown command: '${command}'. Run with --help for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n✖ Command failed: ${err.message}`);
  process.exit(1);
});
