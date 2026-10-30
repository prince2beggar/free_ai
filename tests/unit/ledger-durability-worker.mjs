// Developer-written durability probe, launched only against a disposable temp DB.
import { resolve, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { seedRegistryReviewActor } from '../../packages/registry/index.mjs';
import { createLedger } from '../../packages/ledger/index.mjs';

const directory = resolve(process.argv[2]);
const child = relative(resolve(tmpdir()), directory);
if (
  isAbsolute(child) ||
  child.startsWith('..') ||
  !basename(directory).startsWith('free-ai-ledger-crash-')
)
  throw new Error('Disposable durability directory required.');
const time = Date.parse('2026-10-13T00:00:00Z');
const db = await createDatabase({ dataDir: directory });
await migrateUp(db, { throughVersion: 4 });
await seedSynthetic(db);
const staff = await seedRegistryReviewActor(db);
const ledger = createLedger(db, { clock: () => time });
await ledger.grant(staff, {
  userId: SYNTHETIC_SEED.userA,
  entitlementId: 'crash-entitlement',
  kind: 'free',
  costMicroCu: '1000000',
  inputTokens: '100',
  outputTokens: '100',
  startsAt: new Date(time).toISOString(),
  endsAt: new Date(time + 3600000).toISOString(),
  idempotencyKey: 'crash-grant-commit',
});
await ledger.reserve(SYNTHETIC_SEED.userA, {
  entitlementId: 'crash-entitlement',
  reservationId: 'crash-hold',
  requestId: 'crash-request',
  kind: 'request',
  costMicroCu: '200000',
  inputTokens: '20',
  outputTokens: '0',
  idempotencyKey: 'crash-reserve-commit',
});
console.log('ACKNOWLEDGED_LEDGER_COMMIT');
// Deliberately skip close(): the next process must observe acknowledged writes.
process.exit(0);
