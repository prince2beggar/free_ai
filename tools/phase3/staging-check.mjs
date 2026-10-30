#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { access, mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createDatabase, migrateUp } from '../../packages/db/index.mjs';
import { createAdmin } from '../../packages/admin/index.mjs';

export async function runStagingCheck(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const dbPath = options.dbPath ?? resolve(cwd, '.phase3-local/db');
  const storageDir = options.storageDir ?? resolve(cwd, '.phase3-local/files');
  const backupDir = options.backupDir ?? resolve(cwd, '.phase3-local/backups');
  const strict = options.strict ?? false;

  const checks = [];

  function recordCheck(name, category, passed, message, details = {}) {
    checks.push({ name, category, passed, message, details });
  }

  // 1. Environment & Platform Parity Check
  try {
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const validNode = nodeMajor >= 20;
    recordCheck(
      'Node.js Runtime Version',
      'environment',
      validNode,
      validNode
        ? `Node.js ${process.version} meets runtime baseline (>= v20)`
        : `Node.js ${process.version} is below required v20 baseline`,
      { version: process.version, nodeMajor },
    );
  } catch (err) {
    recordCheck('Node.js Runtime Version', 'environment', false, err.message);
  }

  // 2. Storage Directory Parity Check
  try {
    await mkdir(storageDir, { recursive: true });
    const probeFile = resolve(storageDir, `.staging-probe-${Date.now()}.tmp`);
    await writeFile(probeFile, 'staging-probe-data', 'utf8');
    const readBack = await readFile(probeFile, 'utf8');
    await unlink(probeFile);
    const passed = readBack === 'staging-probe-data';
    recordCheck(
      'File Storage Isolation and Permissions',
      'storage',
      passed,
      passed
        ? `Storage directory verified with read/write/unlink at ${storageDir}`
        : 'Storage probe content mismatch',
      { storageDir },
    );
  } catch (err) {
    recordCheck('File Storage Isolation and Permissions', 'storage', false, err.message, {
      storageDir,
    });
  }

  // 3. Backup Directory Parity Check
  try {
    await mkdir(backupDir, { recursive: true });
    const probeFile = resolve(backupDir, `.staging-probe-backup-${Date.now()}.tmp`);
    await writeFile(probeFile, 'backup-probe-data', 'utf8');
    const readBack = await readFile(probeFile, 'utf8');
    await unlink(probeFile);
    const passed = readBack === 'backup-probe-data';
    recordCheck(
      'Backup Directory Isolation and Permissions',
      'backups',
      passed,
      passed
        ? `Backup directory verified with read/write/unlink at ${backupDir}`
        : 'Backup probe content mismatch',
      { backupDir },
    );
  } catch (err) {
    recordCheck('Backup Directory Isolation and Permissions', 'backups', false, err.message, {
      backupDir,
    });
  }

  // 4. Database Migrations Parity Check
  let db = options.db ?? null;
  const shouldCloseDb = !options.db && !options.keepDbOpen;
  try {
    if (!db) {
      db = await createDatabase({ dataDir: dbPath });
    }
    if (options.migrate) {
      await migrateUp(db, { throughVersion: 10 });
    }
    let appliedVersions = [];
    try {
      const migrationRes = await db.query(
        `SELECT version, name FROM schema_migrations ORDER BY version ASC`,
      );
      appliedVersions = migrationRes.rows.map((r) => Number(r.version));
    } catch {
      // schema_migrations table does not exist yet
    }
    const expectedVersions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const hasAll = expectedVersions.every((v) => appliedVersions.includes(v));
    recordCheck(
      'Database Migrations 001..010 Applied',
      'database',
      hasAll,
      hasAll
        ? `All migrations 001..010 verified in schema_migrations (Total: ${appliedVersions.length})`
        : `Missing migrations: expected 1..10, found ${appliedVersions.length > 0 ? appliedVersions.join(', ') : 'none (unmigrated database)'}`,
      { appliedVersions },
    );

    // 5. Critical Database Tables Parity Check
    const requiredTables = [
      'users',
      'messages',
      'providers',
      'router_breakers',
      'files',
      'owner_alerts',
      'alert_delivery_attempts',
      'admin_audit_log',
    ];
    const tablesRes = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));
    const missingTables = requiredTables.filter((t) => !existingTables.has(t));
    const tablesPassed = missingTables.length === 0;
    recordCheck(
      'Critical Database Tables Presence',
      'database',
      tablesPassed,
      tablesPassed
        ? `All ${requiredTables.length} core tables verified in public schema`
        : `Missing tables: ${missingTables.join(', ')}`,
      { requiredTables, missingTables },
    );

    // 6. Router Circuit Breakers Parity Check
    const breakersRes = await db.query(
      `SELECT count(*)::int as count FROM router_breakers WHERE opened_until > CURRENT_TIMESTAMP`,
    );
    const openCount = breakersRes.rows[0]?.count ?? 0;
    const breakersPassed = openCount === 0;
    recordCheck(
      'Router Circuit Breaker Baseline',
      'routing',
      breakersPassed,
      breakersPassed
        ? 'Zero open circuit breakers in baseline state'
        : `Unexpected open circuit breakers: ${openCount}`,
      { openCount },
    );

    // 7. Subsystem Monitoring Telemetry Parity Check
    const admin = createAdmin(db, { storageDir, backupDir });
    const health = await admin.getHealthStatus({ storageDir, backupDir });
    const hasSubsystems =
      health.storage &&
      health.backups &&
      health.retention &&
      health.productivity &&
      health.database === 'ready';
    recordCheck(
      'Extended Health Monitoring Telemetry',
      'monitoring',
      Boolean(hasSubsystems),
      hasSubsystems
        ? `All Phase 3 subsystems reporting in health check (status: ${health.status})`
        : 'Missing subsystem telemetry in health report',
      { status: health.status, database: health.database },
    );
  } catch (err) {
    recordCheck('Database Parity Check', 'database', false, err.message);
  } finally {
    if (db && shouldCloseDb) {
      try {
        await db.close?.();
      } catch {
        // ignore close error
      }
    }
  }

  // 8. Incident Runbooks Parity Check
  const requiredRunbooks = [
    'README.md',
    'PROVIDER_OUTAGE.md',
    'QUOTA_EXHAUSTION.md',
    'ABUSE_WAVE.md',
    'DATA_INCIDENT_AND_NOTIFICATIONS.md',
    'BACKUP_AND_STORAGE_INCIDENT.md',
  ];
  const runbooksDir = resolve(cwd, 'docs/RUNBOOKS');
  const missingRunbooks = [];
  for (const rb of requiredRunbooks) {
    try {
      await access(resolve(runbooksDir, rb), fsConstants.R_OK);
    } catch {
      missingRunbooks.push(rb);
    }
  }
  const runbooksPassed = missingRunbooks.length === 0;
  recordCheck(
    'Incident Runbooks Documentation Parity',
    'runbooks',
    runbooksPassed,
    runbooksPassed
      ? `All ${requiredRunbooks.length} required operational runbooks verified in docs/RUNBOOKS`
      : `Missing runbooks: ${missingRunbooks.join(', ')}`,
    { requiredRunbooks, missingRunbooks },
  );

  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = checks.length - passedCount;
  const ok = failedCount === 0;

  return {
    ok,
    timestamp: new Date().toISOString(),
    totalChecks: checks.length,
    passedCount,
    failedCount,
    checks,
  };
}

// CLI Execution
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      'storage-dir': { type: 'string' },
      'backup-dir': { type: 'string' },
      strict: { type: 'boolean' },
      migrate: { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: false,
  });

  try {
    const report = await runStagingCheck({
      dbPath: values.db,
      storageDir: values['storage-dir'],
      backupDir: values['backup-dir'],
      strict: values.strict,
      migrate: values.migrate,
    });

    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('='.repeat(70));
      console.log(`STAGING ENVIRONMENT PARITY REPORT (OPS-07)`);
      console.log(`Timestamp: ${report.timestamp}`);
      console.log(`Result: ${report.ok ? '✓ ALL CHECKS PASSED' : '✗ CHECKS FAILED'}`);
      console.log(
        `Summary: ${report.passedCount}/${report.totalChecks} passed (${report.failedCount} failed)`,
      );
      console.log('='.repeat(70));
      for (const check of report.checks) {
        const mark = check.passed ? '✓ PASS' : '✗ FAIL';
        console.log(`[${mark}] [${check.category.toUpperCase()}] ${check.name}: ${check.message}`);
      }
      console.log('='.repeat(70));
    }

    process.exit(report.ok ? 0 : 1);
  } catch (err) {
    console.error('Fatal staging check error:', err);
    process.exit(1);
  }
}
