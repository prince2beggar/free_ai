import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createGovernor } from '../../packages/governor/index.mjs';
import { governorFixture, seedGovernorFixture } from './governor-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let db;
let lock;
let lockPath;

async function close() {
  try {
    if (db) {
      await db.close();
      db = undefined;
    }
  } finally {
    if (lock) {
      try {
        await lock.close();
      } finally {
        lock = undefined;
        await unlink(lockPath);
      }
    }
  }
}

try {
  if (process.argv.length !== 2) throw new Error('The Governor demonstrator accepts no arguments.');
  const directory = resolve(root, '.phase2-local/governor-database');
  const localPath = relative(root, directory);
  if (
    isAbsolute(localPath) ||
    localPath.startsWith('..') ||
    (!localPath.startsWith('.phase2-local/') && !localPath.startsWith('.phase2-local\\'))
  ) {
    throw new Error('Invalid local Governor storage boundary.');
  }
  await mkdir(directory, { recursive: true });
  lockPath = resolve(root, '.phase2-local/governor-launcher.lock');
  lock = await open(lockPath, 'wx');
  db = await createDatabase({ dataDir: directory });
  await migrateUp(db, { throughVersion: 5 });
  const governor = createGovernor(db);
  const fixture = await seedGovernorFixture(db, governor);
  for (const entry of governorFixture.examples) {
    await governor.reserve(SYNTHETIC_SEED.userA, {
      reservationId: entry.reservationId,
      requestId: entry.requestId,
      modelId: entry.modelId,
      accountRef: fixture.accountRef,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      idempotencyKey: `${entry.reservationId}-reserve`,
    });
    await governor.dispatch(fixture.staff, {
      reservationId: entry.reservationId,
      idempotencyKey: `${entry.reservationId}-dispatch`,
    });
    await governor.settle(fixture.staff, {
      reservationId: entry.reservationId,
      inputTokens: entry.actualInputTokens,
      outputTokens: entry.actualOutputTokens,
      idempotencyKey: `${entry.reservationId}-settle`,
    });
  }
  await governor.sweep(fixture.staff);
  await governor.runFairShare(fixture.staff, {
    idempotencyKey: governorFixture.fairShareIdempotencyKey,
  });
  const snapshots = [];
  for (const modelId of [fixture.modelA, fixture.modelB]) {
    snapshots.push(
      await governor.snapshot(fixture.staff, { modelId, accountRef: fixture.accountRef }),
    );
  }
  console.log(
    JSON.stringify(
      {
        status: 'LOCAL_PHASE2_GOVERNOR_READY',
        syntheticOnly: true,
        snapshots,
        allowance: await governor.allowance(SYNTHETIC_SEED.userA),
        credentialsRead: false,
        modelCallsMade: 0,
        ledgerGrantsMade: 0,
        realProvidersEnabled: false,
        staffWebRoutes: 'NOT_EXPOSED_BEFORE_STEP_2_6',
        chatCoupling: 'DEFERRED_TO_STEP_2_4',
      },
      null,
      2,
    ),
  );
  await close();
} catch {
  await close().catch(() => console.error('Local synthetic Governor cleanup failed.'));
  console.error(
    'Local synthetic Governor setup failed. Check migrations, fixture state or launcher lock.',
  );
  process.exitCode = 1;
}
