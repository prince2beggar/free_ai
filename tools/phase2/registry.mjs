import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, migrateUp, seedSynthetic } from '../../packages/db/index.mjs';
import { createRegistry, seedRegistryReviewActor } from '../../packages/registry/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sources = [
  [
    'docs/provider_research.json',
    'ce3098cd0e26a5c9994742982fe9c156d0746d73478f972e4c903c40a7ff4d36',
  ],
  ['docs/pricing_inputs.json', '0279139e8a308066961e78d1f67736e0a39954d81a938f28977ec17950fce7c4'],
];
let db;
try {
  const inputs = [];
  for (const [path, expected] of sources) {
    const raw = await readFile(resolve(root, path));
    if (createHash('sha256').update(raw).digest('hex') !== expected)
      throw new Error('Research snapshot changed; review before seed refresh.');
    inputs.push(JSON.parse(raw.toString('utf8')));
  }
  const directory = resolve(root, '.phase2-local/registry-database');
  await mkdir(directory, { recursive: true });
  db = await createDatabase({ dataDir: directory });
  await migrateUp(db);
  await seedSynthetic(db);
  await migrateUp(db, { throughVersion: 3 });
  const actorId = await seedRegistryReviewActor(db);
  const registry = createRegistry(db);
  await registry.seed(actorId, inputs[0], inputs[1]);
  const providers = await registry.list(actorId, 'provider');
  const models = await registry.list(actorId, 'model');
  console.log(
    JSON.stringify(
      {
        status: 'LOCAL_PHASE2_REGISTRY_READY',
        syntheticOnly: true,
        researchProviders: providers
          .filter((provider) => provider.observations?.researchId)
          .map((provider) => ({
            id: provider.id,
            status: provider.status,
            ownerApproved: provider.ownerApproved,
            allowsMultiuser: provider.allowsMultiuser,
            quotaConfirmed: provider.quotaConfirmed,
            dataPolicy: provider.dataPolicy,
          })),
        researchModels: models.filter((model) => model.observations?.researchOnly).length,
        registryVersions: (await db.query('SELECT count(*)::int AS count FROM registry_versions'))
          .rows[0].count,
        realProvidersEnabled: providers.filter(
          (provider) => provider.adapterKind === 'external' && provider.status === 'enabled',
        ).length,
        credentialsRead: false,
        modelCallsMade: 0,
        staffWebRoutes: 'NOT_EXPOSED_BEFORE_STEP_2_6',
        nextStep: '2.2 usage ledger',
      },
      null,
      2,
    ),
  );
} catch {
  console.error('Local registry setup failed. Review scope, source snapshots and migrations.');
  process.exitCode = 1;
} finally {
  if (db) await db.close();
}
