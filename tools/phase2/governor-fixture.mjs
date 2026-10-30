import { readFile } from 'node:fs/promises';
import { seedSynthetic } from '../../packages/db/index.mjs';
import { createRegistry, seedRegistryReviewActor } from '../../packages/registry/index.mjs';

export const governorFixture = JSON.parse(
  await readFile(new URL('../../packages/governor/fixture.json', import.meta.url), 'utf8'),
);

async function registryRecord(db, area, id) {
  return (
    await db.query('SELECT data FROM registry_metadata WHERE area=$1 AND target_id=$2', [area, id])
  ).rows[0]?.data;
}

function unchanged(record, expected, label) {
  if (
    Object.entries(expected).some(
      ([key, value]) => JSON.stringify(record[key]) !== JSON.stringify(value),
    ) ||
    !['disabled', 'enabled'].includes(record.status)
  ) {
    throw new Error(`Governor demonstrator requires its unchanged synthetic ${label} fixture.`);
  }
}

/** Pure local fixture setup; callers own migration, database lifetime and the Governor clock. */
export async function seedGovernorFixture(db, governor, inputs = governorFixture) {
  const { provider: providerInput, modelMetadata, accountRef } = inputs;
  if (
    inputs.syntheticOnly !== true ||
    providerInput.adapterKind !== 'synthetic_mock' ||
    providerInput.baseUrl !== null ||
    providerInput.secretRef !== null ||
    providerInput.dataPolicy !== 'synthetic_only' ||
    providerInput.ownerApproved !== true ||
    providerInput.quotaConfirmed !== true ||
    providerInput.allowsMultiuser !== true ||
    modelMetadata.modelClass !== 'synthetic' ||
    modelMetadata.cuInputRate !== '0' ||
    modelMetadata.cuOutputRate !== '0' ||
    modelMetadata.contextVerified !== true ||
    modelMetadata.ratesVerified !== true ||
    modelMetadata.freeFlag !== true ||
    modelMetadata.qualityKind !== 'synthetic_fixture'
  ) {
    throw new Error('Governor demonstrator requires an explicitly synthetic fixture.');
  }
  await seedSynthetic(db);
  const staff = await seedRegistryReviewActor(db);
  const registry = createRegistry(db);
  const providerId = providerInput.id;
  let provider = await registryRecord(db, 'provider', providerId);
  if (!provider) {
    provider = await registry.createProvider(
      staff,
      { ...providerInput, status: 'disabled' },
      { idempotencyKey: `${providerId}-create`, expectedRevision: 0 },
    );
  }
  unchanged(provider, providerInput, 'provider');
  if (provider.status === 'disabled') {
    if (provider.revision !== 1) {
      throw new Error('Governor demonstrator cannot re-enable a changed provider fixture.');
    }
    await registry.updateProvider(
      staff,
      providerId,
      { status: 'enabled' },
      { idempotencyKey: `${providerId}-enable`, expectedRevision: provider.revision },
    );
  }
  const modelIds = [];
  for (const entry of inputs.models) {
    const input = { ...entry, providerId, ...modelMetadata };
    let model = await registryRecord(db, 'model', entry.id);
    if (!model) {
      model = await registry.createModel(
        staff,
        { ...input, status: 'disabled' },
        { idempotencyKey: `${entry.id}-create`, expectedRevision: 0 },
      );
    }
    unchanged(model, input, 'model');
    if (model.status === 'disabled') {
      if (model.revision !== 1) {
        throw new Error('Governor demonstrator cannot re-enable a changed model fixture.');
      }
      await registry.updateModel(
        staff,
        entry.id,
        { status: 'enabled' },
        { idempotencyKey: `${entry.id}-enable`, expectedRevision: model.revision },
      );
    }
    modelIds.push(entry.id);
  }
  const poolIds = [];
  for (const entry of inputs.pools) {
    const existing = (await db.query('SELECT status FROM capacity_pools WHERE id=$1', [entry.id]))
      .rows[0];
    if (existing && existing.status !== 'enabled') {
      throw new Error('Governor demonstrator requires its unchanged enabled synthetic pools.');
    }
    await governor.createPool(staff, {
      ...entry,
      providerId,
      ...(entry.scope === 'provider' ? {} : { accountRef }),
      tokensPerRequest: inputs.tokensPerRequest,
      limits:
        entry.limits ??
        inputs.windows.flatMap((window) =>
          ['requests', 'tokens'].map((metric) => ({
            id: `${entry.id}-${window.id}-${metric}`,
            metric,
            limit: window[metric],
            windowMs: window.windowMs,
            anchorAt: inputs.anchorAt,
            safetyFactor: inputs.safetyFactor,
          })),
        ),
      idempotencyKey: `${entry.id}-create`,
    });
    poolIds.push(entry.id);
  }
  for (const modelId of modelIds) {
    await governor.createRoute(staff, {
      modelId,
      accountRef,
      providerLimits: 'known',
      accountLimits: 'known',
      modelLimits: 'known',
      quotaConfirmed: true,
      idempotencyKey: `${modelId}-route`,
    });
  }
  return { staff, providerId, modelA: modelIds[0], modelB: modelIds[1], accountRef, poolIds };
}
