#!/usr/bin/env node

/**
 * Phase 3 Retention and Deletion Job CLI
 * Executes scheduled data cleanup for files and conversations (FILE-05, PRIV-05, T3.2).
 */

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase, migrateUp } from '../../packages/db/index.mjs';
import { runRetentionJob } from '../../packages/files/index.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  const { values } = parseArgs({
    options: {
      'file-days': { type: 'string', default: '30' },
      'grace-days': { type: 'string', default: '7' },
      'conv-days': { type: 'string', default: '30' },
      'storage-dir': { type: 'string', default: '.phase3-local/files' },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const fileRetentionDays = Number(values['file-days']);
  const softDeleteGraceDays = Number(values['grace-days']);
  const conversationRetentionDays = Number(values['conv-days']);
  const storageBaseDir = resolve(repoRoot, values['storage-dir']);
  const dryRun = Boolean(values['dry-run']);

  console.log('--- Phase 3 Retention & Deletion Job ---');
  console.log(`Storage Dir:                   ${storageBaseDir}`);
  console.log(`File Retention Days:           ${fileRetentionDays}`);
  console.log(`Soft Delete Grace Days:        ${softDeleteGraceDays}`);
  console.log(`Conversation Retention Days:   ${conversationRetentionDays}`);
  console.log(`Dry Run:                       ${dryRun}`);

  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });

  try {
    const summary = await runRetentionJob({
      db,
      storageBaseDir,
      fileRetentionDays,
      softDeleteGraceDays,
      conversationRetentionDays,
      dryRun,
    });

    console.log('\n--- Execution Results ---');
    console.log(`Files Expired:                 ${summary.filesExpired}`);
    console.log(`Files Purged:                  ${summary.filesPurged}`);
    console.log(`Disk Bytes Freed:              ${summary.diskBytesFreed}`);
    console.log(`Conversations Purged:          ${summary.conversationsPurged}`);
    console.log(`Duration (ms):                 ${summary.durationMs}`);
    console.log(`Status:                        ${summary.success ? 'SUCCESS' : 'FAILED'}`);

    if (summary.errors.length > 0) {
      console.error('\nErrors encountered:', summary.errors);
      process.exit(1);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('Fatal retention job error:', err);
  process.exit(1);
});
