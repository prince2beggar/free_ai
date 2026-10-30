import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createRegistry, seedRegistryReviewActor } from '../../packages/registry/index.mjs';
import { createLedger } from '../../packages/ledger/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const webRoot = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url));
const providerId = 'ledger-synthetic-provider';
const modelId = 'ledger-synthetic-model';
const entitlementId = 'ledger-example-entitlement-a';
const reservationId = 'ledger-example-request-a';
const requestId = 'ledger-example-request-ref-a';

async function registryRecord(db, area, id) {
  return (
    await db.query('SELECT data FROM registry_metadata WHERE area=$1 AND target_id=$2', [area, id])
  ).rows[0]?.data;
}

async function seedLedgerModel(db, actorId) {
  const registry = createRegistry(db);
  let provider = await registryRecord(db, 'provider', providerId);
  if (!provider) {
    provider = await registry.createProvider(
      actorId,
      {
        id: providerId,
        name: 'Synthetic ledger demonstrator provider',
        adapterKind: 'synthetic_mock',
        status: 'disabled',
        termsUrl: 'https://example.invalid/ledger-synthetic-fixture',
        termsReviewedAt: new Date().toISOString().slice(0, 10),
        dataPolicy: 'synthetic_only',
        allowsMultiuser: true,
        ownerApproved: true,
        quotaConfirmed: true,
      },
      { idempotencyKey: 'ledger-fixture-provider-create', expectedRevision: 0 },
    );
  }
  if (
    provider.adapterKind !== 'synthetic_mock' ||
    provider.dataPolicy !== 'synthetic_only' ||
    provider.baseUrl !== null ||
    provider.secretRef !== null ||
    !provider.ownerApproved ||
    !provider.quotaConfirmed ||
    !provider.allowsMultiuser
  ) {
    throw new Error('Ledger demonstrator requires its unchanged synthetic provider fixture.');
  }
  if (provider.status === 'disabled') {
    provider = await registry.updateProvider(
      actorId,
      providerId,
      { status: 'enabled' },
      {
        idempotencyKey: 'ledger-fixture-provider-enable',
        expectedRevision: provider.revision,
      },
    );
  }
  let model = await registryRecord(db, 'model', modelId);
  if (!model) {
    model = await registry.createModel(
      actorId,
      {
        id: modelId,
        providerId,
        externalName: modelId,
        displayName: 'Synthetic ledger arithmetic fixture',
        capabilities: ['text'],
        contextLimit: 1000,
        contextVerified: true,
        modelClass: 'synthetic',
        cuInputRate: '1000',
        cuOutputRate: '1000',
        ratesVerified: true,
        qualityKind: 'synthetic_fixture',
        freeFlag: true,
        status: 'disabled',
      },
      { idempotencyKey: 'ledger-fixture-model-create', expectedRevision: 0 },
    );
  }
  if (
    model.providerId !== providerId ||
    model.modelClass !== 'synthetic' ||
    model.cuInputRate !== '1000' ||
    model.cuOutputRate !== '1000' ||
    !model.ratesVerified ||
    !model.contextVerified ||
    model.qualityKind !== 'synthetic_fixture'
  ) {
    throw new Error('Ledger demonstrator requires its unchanged exact-rate synthetic fixture.');
  }
  if (model.status === 'disabled') {
    model = await registry.updateModel(
      actorId,
      modelId,
      { status: 'enabled' },
      { idempotencyKey: 'ledger-fixture-model-enable', expectedRevision: model.revision },
    );
  }
}

async function demonstrate(db, ledger, actorId) {
  const existing = (
    await db.query('SELECT id FROM ledger_entitlements WHERE id=$1', [entitlementId])
  ).rows[0];
  if (!existing) {
    const now = Date.now();
    await ledger.grant(actorId, {
      userId: SYNTHETIC_SEED.userA,
      entitlementId,
      kind: 'free',
      costMicroCu: '1000000',
      inputTokens: '100',
      outputTokens: '100',
      startsAt: new Date(now - 60000).toISOString(),
      endsAt: new Date(now + 86400000).toISOString(),
      idempotencyKey: 'ledger-example-grant-a',
    });
  }
  await ledger.reserve(SYNTHETIC_SEED.userA, {
    entitlementId,
    reservationId,
    requestId,
    kind: 'request',
    costMicroCu: '200000',
    inputTokens: '20',
    outputTokens: '0',
    idempotencyKey: 'ledger-example-reserve-a',
  });
  await ledger.dispatch(actorId, {
    reservationId,
    modelId,
    idempotencyKey: 'ledger-example-dispatch-a',
  });
  await ledger.settle(actorId, {
    reservationId,
    inputTokens: '12',
    outputTokens: '0',
    toolSurchargeCu: '0',
    idempotencyKey: 'ledger-example-settle-a',
  });
  await ledger.sweep(actorId);
  const counts = (
    await db.query(`SELECT
      (SELECT count(*)::int FROM usage_ledger) AS ledger_rows,
      (SELECT count(*)::int FROM ledger_operations) AS operations,
      (SELECT count(*)::int FROM registry_versions) AS registry_versions`)
  ).rows[0];
  const example = (
    await db.query(
      `SELECT
        coalesce(sum(amount_micro_cu),0)::text AS available_micro_cu,
        coalesce(-(sum(amount_micro_cu) FILTER(
          WHERE type='commit' OR reconciles_entry_id IS NOT NULL)),0)::text AS actual_spend_micro_cu
       FROM usage_ledger WHERE user_id=$1 AND entitlement_id=$2`,
      [SYNTHETIC_SEED.userA, entitlementId],
    )
  ).rows[0];
  console.log(
    JSON.stringify(
      {
        status: 'LOCAL_PHASE2_LEDGER_READY',
        syntheticOnly: true,
        account: await ledger.usage(SYNTHETIC_SEED.userA),
        history: await ledger.history(SYNTHETIC_SEED.userA),
        counts,
        example,
        credentialsRead: false,
        modelCallsMade: 0,
        realProvidersEnabled: false,
        staffWebRoutes: 'NOT_EXPOSED_BEFORE_STEP_2_6',
      },
      null,
      2,
    ),
  );
}

let db;
let server;
let timer;
let pendingSweep;
let lock;
let lockPath;
let closing;
async function close() {
  if (closing) return closing;
  closing = (async () => {
    clearInterval(timer);
    try {
      if (server) await server.shutdown();
      if (pendingSweep) await pendingSweep;
    } finally {
      try {
        if (db) await db.close();
      } finally {
        if (lock) {
          try {
            await lock.close();
          } finally {
            await unlink(lockPath);
          }
        }
      }
    }
  })();
  return closing;
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--serve')) {
    throw new Error('Only the optional --serve argument is supported.');
  }
  const directory = resolve(root, '.phase2-local/ledger-database');
  const localPath = relative(root, directory);
  if (
    isAbsolute(localPath) ||
    localPath.startsWith('..') ||
    (!localPath.startsWith('.phase2-local/') && !localPath.startsWith('.phase2-local\\'))
  ) {
    throw new Error('Invalid local ledger storage boundary.');
  }
  await mkdir(directory, { recursive: true });
  lockPath = resolve(root, '.phase2-local/ledger-launcher.lock');
  lock = await open(lockPath, 'wx');
  db = await createDatabase({ dataDir: directory });
  await migrateUp(db);
  await seedSynthetic(db);
  await migrateUp(db, { throughVersion: 4 });
  const actorId = await seedRegistryReviewActor(db);
  await seedLedgerModel(db, actorId);
  const ledger = createLedger(db);
  await demonstrate(db, ledger, actorId);
  if (args[0] === '--serve') {
    const settings = JSON.parse(
      await readFile(new URL('../phase1/settings.json', import.meta.url), 'utf8'),
    );
    if (
      !Number.isSafeInteger(settings.maintenanceIntervalMs) ||
      settings.maintenanceIntervalMs < 1000 ||
      settings.maintenanceIntervalMs > 3600000
    ) {
      throw new Error('Invalid local ledger maintenance interval.');
    }
    const config = await loadConfig({}, { port: 4177, webRoot });
    server = createApp({ db, config, ledger, syntheticChatModelId: SYNTHETIC_SEED.model });
    await server.ready;
    timer = setInterval(() => {
      if (pendingSweep || closing) return;
      pendingSweep = ledger
        .sweep(actorId)
        .catch(() => console.error('Local synthetic ledger reconciliation failed.'))
        .finally(() => {
          pendingSweep = undefined;
        });
    }, settings.maintenanceIntervalMs);
    timer.unref();
    server.on('error', () => {
      console.error('Local synthetic ledger preview could not listen on its configured port.');
      void close().catch(() => console.error('Local synthetic ledger shutdown failed.'));
      process.exitCode = 1;
    });
    server.listen(config.port, config.host, () =>
      console.log(`Local synthetic ledger preview: http://${config.host}:${config.port}`),
    );
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        void close().catch(() => {
          console.error('Local synthetic ledger shutdown failed.');
          process.exitCode = 1;
        });
      });
    }
  } else {
    await close();
  }
} catch {
  await close().catch(() => console.error('Local synthetic ledger cleanup failed.'));
  console.error(
    'Local synthetic ledger setup failed. Check migrations, fixture state or launcher lock.',
  );
  process.exitCode = 1;
}
