import { readFile } from 'node:fs/promises';
import { seedSynthetic, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createRegistry, seedRegistryReviewActor } from '../../packages/registry/index.mjs';
import { createLedger } from '../../packages/ledger/index.mjs';
import { createGovernor } from '../../packages/governor/index.mjs';
import { createSyntheticGateway } from '../../packages/gateway/index.mjs';
import { createRouter } from '../../packages/router/index.mjs';

export const routerFixture = JSON.parse(
  await readFile(new URL('../../packages/router/fixture.json', import.meta.url), 'utf8'),
);
const defaults = JSON.parse(
  await readFile(new URL('../../packages/router/defaults.json', import.meta.url), 'utf8'),
);
const replies = JSON.parse(
  await readFile(new URL('../../packages/gateway/synthetic.json', import.meta.url), 'utf8'),
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
    !['enabled', 'disabled'].includes(record.status)
  )
    throw new Error(`Router demonstrator requires its unchanged synthetic ${label} fixture.`);
  if (record.status === 'disabled' && record.revision !== 1)
    throw new Error(`Router demonstrator cannot re-enable an operator-disabled ${label} fixture.`);
}

/** Local synthetic setup only. Caller owns migrations and database lifetime. */
export async function createRouterFixture(
  db,
  { clock = Date.now, gatewayOverrides = {}, routerOptions = {} } = {},
) {
  if (
    routerFixture.syntheticOnly !== true ||
    typeof clock !== 'function' ||
    !gatewayOverrides ||
    typeof gatewayOverrides !== 'object' ||
    Array.isArray(gatewayOverrides) ||
    !routerOptions ||
    typeof routerOptions !== 'object' ||
    Array.isArray(routerOptions) ||
    ['staffActorId', 'clock', 'gateways'].some((key) => Object.hasOwn(routerOptions, key))
  )
    throw new Error('Router demonstrator requires its trusted synthetic configuration.');
  await seedSynthetic(db);
  const staff = await seedRegistryReviewActor(db);
  const registry = createRegistry(db);
  const ledger = createLedger(db, {
    clock,
    reconciliationMs: routerOptions.reconciliationMs ?? defaults.reconciliationMs,
  });
  const governorOptions = {
    clock,
    expectedActiveUsers: routerFixture.expectedActiveUsers,
    reconciliationMs: routerOptions.reconciliationMs ?? defaults.reconciliationMs,
    reservationTtlMs: routerOptions.reservationTtlMs ?? defaults.reservationTtlMs,
  };
  const governor = createGovernor(db, governorOptions);
  const { provider: providerInput, modelMetadata, accountRef } = routerFixture;
  let provider = await registryRecord(db, 'provider', providerInput.id);
  if (!provider)
    provider = await registry.createProvider(
      staff,
      { ...providerInput, status: 'disabled' },
      { idempotencyKey: `${providerInput.id}-create`, expectedRevision: 0 },
    );
  unchanged(provider, providerInput, 'provider');
  if (provider.status === 'disabled')
    await registry.updateProvider(
      staff,
      provider.id,
      { status: 'enabled' },
      { idempotencyKey: `${provider.id}-enable`, expectedRevision: provider.revision },
    );

  const gateways = {};
  for (const entry of routerFixture.models) {
    const input = { ...modelMetadata, ...entry, providerId: providerInput.id };
    let model = await registryRecord(db, 'model', entry.id);
    if (!model)
      model = await registry.createModel(
        staff,
        { ...input, status: 'disabled' },
        { idempotencyKey: `${entry.id}-create`, expectedRevision: 0 },
      );
    unchanged(model, input, 'model');
    if (model.status === 'disabled')
      await registry.updateModel(
        staff,
        model.id,
        { status: 'enabled' },
        { idempotencyKey: `${model.id}-enable`, expectedRevision: model.revision },
      );
    gateways[entry.id] = createSyntheticGateway({
      providerId: providerInput.id,
      modelId: entry.id,
      replies,
      ...routerFixture.gateway,
    });
  }
  if (Object.keys(gatewayOverrides).some((key) => !Object.hasOwn(gateways, key)))
    throw new Error(
      'Router demonstrator gateway overrides must name a configured synthetic model.',
    );
  Object.assign(gateways, gatewayOverrides);

  for (const pool of routerFixture.pools) {
    const existing = (await db.query('SELECT status FROM capacity_pools WHERE id=$1', [pool.id]))
      .rows[0];
    if (existing && existing.status !== 'enabled')
      throw new Error('Router demonstrator cannot re-enable an operator-disabled capacity pool.');
    await governor.createPool(staff, {
      ...pool,
      providerId: providerInput.id,
      ...(pool.scope === 'provider' ? {} : { accountRef }),
      tokensPerRequest: routerFixture.tokensPerRequest,
      limits: routerFixture.windows.flatMap((window) =>
        ['requests', 'tokens'].map((metric) => ({
          id: `${pool.id}-${window.id}-${metric}`,
          metric,
          limit: window[metric],
          windowMs: window.windowMs,
          anchorAt: routerFixture.anchorAt,
          safetyFactor: routerFixture.safetyFactor,
        })),
      ),
      idempotencyKey: `${pool.id}-create`,
    });
  }
  for (const model of routerFixture.models)
    await governor.createRoute(staff, {
      modelId: model.id,
      accountRef,
      providerLimits: 'known',
      accountLimits: 'known',
      modelLimits: 'known',
      quotaConfirmed: true,
      idempotencyKey: `${model.id}-route`,
    });
  for (const { user, ...grant } of routerFixture.grants)
    await ledger.grant(staff, {
      ...grant,
      userId: SYNTHETIC_SEED[user],
      idempotencyKey: `${grant.entitlementId}-grant`,
    });

  const router = createRouter(db, { ...routerOptions, staffActorId: staff, gateways, clock });
  await router.configurePolicy(staff, {
    policy: defaults.policy,
    expectedVersion: 0,
    idempotencyKey: 'router-synthetic-policy-configure',
  });
  const time = clock();
  if (!Number.isSafeInteger(time)) throw new Error('Invalid synthetic Router fixture clock.');
  const fairShareContext = {
    db,
    staff,
    governorOptions,
    dayOffsetMinutes: routerOptions.dayOffsetMinutes ?? defaults.dayOffsetMinutes,
  };
  await refreshRouterFairShare(fairShareContext);
  return {
    ...fairShareContext,
    router,
    ledger,
    governor,
    staff,
    providerId: providerInput.id,
    modelA: routerFixture.models[0].id,
    modelB: routerFixture.models[1].id,
    paidModel: routerFixture.models[2].id,
    accountRef,
    entitlements: Object.fromEntries(
      routerFixture.grants.map((grant) => [
        `${grant.user}${grant.kind === 'free' ? 'Free' : 'Pack'}`,
        grant.entitlementId,
      ]),
    ),
  };
}

/** One immutable policy generation per configured local usage day, with no money grant. */
export async function refreshRouterFairShare(
  fixture,
  {
    clock = fixture.governorOptions.clock,
    dayOffsetMinutes = fixture.dayOffsetMinutes ?? defaults.dayOffsetMinutes,
  } = {},
) {
  if (
    typeof clock !== 'function' ||
    !Number.isInteger(dayOffsetMinutes) ||
    Math.abs(dayOffsetMinutes) > 840
  )
    throw new Error('Invalid synthetic fair-share day.');
  const dayOf = (time) => {
    if (!Number.isSafeInteger(time)) throw new Error('Invalid synthetic fair-share clock.');
    return new Date(time + dayOffsetMinutes * 60000).toISOString().slice(0, 10);
  };
  const crossed = new Error('Synthetic fair-share day changed before completion.');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fixture.db.transaction(async (tx) => {
        await tx.query('SELECT last_time FROM capacity_storage_guard WHERE id=1 FOR UPDATE');
        const day = dayOf(clock());
        const guardedClock = () => {
          const time = clock();
          if (dayOf(time) !== day) throw crossed;
          return time;
        };
        const governor = createGovernor(
          { ...tx, transaction: (body) => body(tx) },
          { ...fixture.governorOptions, clock: guardedClock },
        );
        const result = await governor.runFairShare(fixture.staff, {
          idempotencyKey: `router-synthetic-fair-share-${day}`,
        });
        // Also guard cached replay; no awaited application write follows this check.
        guardedClock();
        return result;
      });
    } catch (error) {
      if (error !== crossed || attempt === 1) throw error;
    }
  }
}
