import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDatabase,
  migrateUp,
  migrateDown,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createRegistry, seedRegistryReviewActor } from '../../packages/registry/index.mjs';

const research = JSON.parse(
  await readFile(new URL('../../docs/provider_research.json', import.meta.url), 'utf8'),
);
const pricing = JSON.parse(
  await readFile(new URL('../../docs/pricing_inputs.json', import.meta.url), 'utf8'),
);
async function fixture(t, options = {}) {
  const db = await createDatabase();
  await migrateUp(db);
  await seedSynthetic(db);
  await migrateUp(db, { throughVersion: 3 });
  const actor = await seedRegistryReviewActor(db);
  t.after(() => db.close());
  return { db, actor, registry: createRegistry(db, options) };
}
const operation = (key, expectedRevision = 0) => ({ idempotencyKey: key, expectedRevision });
const eligible = (id = 'fixture-provider') => ({
  id,
  name: 'Synthetic registry fixture',
  adapterKind: 'synthetic_mock',
  status: 'disabled',
  termsUrl: 'https://example.invalid/local-fixture-terms',
  termsReviewedAt: '2026-10-12',
  dataPolicy: 'synthetic_only',
  allowsMultiuser: true,
  ownerApproved: true,
  quotaConfirmed: true,
});
async function enabledProvider(f) {
  const created = await f.registry.createProvider(
    f.actor,
    eligible(),
    operation('fixture-provider-create'),
  );
  return f.registry.updateProvider(
    f.actor,
    created.id,
    { status: 'enabled' },
    operation('fixture-provider-enable', created.revision),
  );
}
const knownModel = (id = 'fixture-model') => ({
  id,
  providerId: 'fixture-provider',
  externalName: id,
  displayName: 'Synthetic exact-rate model',
  capabilities: ['text', 'bangla'],
  contextLimit: 4096,
  contextVerified: true,
  modelClass: 'synthetic',
  cuInputRate: '0.125',
  cuOutputRate: '2.5',
  ratesVerified: true,
  freeFlag: true,
  status: 'disabled',
});

test('Phase 2 migration is opt-in and reversible without changing Phase 1 schema/data', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  assert.deepEqual(await migrateUp(db), [1]);
  await seedSynthetic(db);
  await assert.rejects(db.query('SELECT * FROM registry_versions'));
  assert.deepEqual(await migrateUp(db, { throughVersion: 3 }), [2, 3]);
  assert.deepEqual(await migrateUp(db), []);
  assert.deepEqual(await migrateDown(db, { steps: 2 }), [3, 2]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 2);
  assert.deepEqual(await migrateUp(db, { throughVersion: 3 }), [2, 3]);
  await assert.rejects(migrateUp(db, { throughVersion: 999 }));
});

test('all sourced providers/models seed disabled with unknown actual quotas, rates and quality; reseed cannot overwrite edits', async (t) => {
  const f = await fixture(t);
  await f.registry.seed(f.actor, research, pricing);
  const providers = await f.registry.list(f.actor, 'provider');
  const candidates = providers.filter((p) => p.observations?.researchId);
  assert.equal(candidates.length, 4);
  for (const p of candidates) {
    assert.equal(p.status, 'disabled');
    assert.equal(p.ownerApproved, false);
    assert.equal(p.allowsMultiuser, false);
    assert.equal(p.quotaConfirmed, false);
    assert.equal(p.secretRef, null);
    assert.equal(p.baseUrl, null);
  }
  const models = (await f.registry.list(f.actor, 'model')).filter(
    (m) => m.observations?.researchOnly,
  );
  const expected = new Set(
    pricing.model_prices
      .filter((row) => typeof row.model_id === 'string')
      .map((row) => row.provider_id + '|' + row.model_id),
  ).size;
  assert.equal(models.length, expected);
  for (const m of models) {
    assert.equal(m.status, 'disabled');
    assert.equal(m.contextLimit, null);
    assert.equal(m.cuInputRate, null);
    assert.equal(m.banglaScore, null);
    assert.equal(m.agentReady, false);
    assert.equal(m.observations.actualModelQuota, null);
  }
  const counts = (await f.db.query('SELECT count(*)::int AS count FROM registry_versions')).rows[0]
    .count;
  const edited = await f.registry.updateProvider(
    f.actor,
    candidates[0].id,
    { name: 'Preserved synthetic review edit' },
    operation('research-edit-preserved', candidates[0].revision),
  );
  await f.registry.seed(f.actor, research, pricing);
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS count FROM registry_versions')).rows[0].count,
    counts + 1,
  );
  const reseeded = (await f.registry.list(f.actor, 'provider')).find(
    (item) => item.id === edited.id,
  );
  assert.equal(reseeded.name, edited.name);
  assert.equal(reseeded.revision, edited.revision);
  const gem = candidates.find((p) => p.id === 'gemini-developer-api');
  assert.equal(gem.dataPolicy, 'may_train');
  assert.equal(candidates.find((p) => p.id === 'groqcloud').dataPolicy, 'unknown');
});

test('ordinary users cannot mutate, list, inspect history or probe rollback; staff role override is rejected', async (t) => {
  const f = await fixture(t);
  const user = SYNTHETIC_SEED.userA;
  await assert.rejects(
    f.registry.createProvider(user, eligible(), operation('user-create-attempt')),
    { code: 'REGISTRY_FORBIDDEN' },
  );
  await assert.rejects(f.registry.list(user, 'provider'), { code: 'REGISTRY_FORBIDDEN' });
  await assert.rejects(f.registry.history(user, 'provider', 'fixture-provider'), {
    code: 'REGISTRY_FORBIDDEN',
  });
  await assert.rejects(
    f.registry.rollback(user, 'provider', 'missing', 1, operation('user-rollback-attempt')),
    { code: 'REGISTRY_FORBIDDEN' },
  );
  assert.throws(() => createRegistry(f.db, { staffRoles: ['user'] }), {
    code: 'REGISTRY_CONFIG_INVALID',
  });
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS count FROM registry_versions')).rows[0].count,
    0,
  );
});

test('every provider activation gate is enforced transactionally; complete synthetic fixtures can enable', async (t) => {
  const f = await fixture(t);
  const p = await f.registry.createProvider(
    f.actor,
    eligible(),
    operation('provider-create-valid'),
  );
  for (const patch of [
    { allowsMultiuser: false },
    { termsUrl: null },
    { termsReviewedAt: null },
    { ownerApproved: false },
    { quotaConfirmed: false },
    { dataPolicy: 'unknown' },
  ]) {
    await assert.rejects(
      f.registry.updateProvider(
        f.actor,
        p.id,
        { status: 'enabled', ...patch },
        operation('gate-' + Object.keys(patch)[0], 1),
      ),
      { code: 'PROVIDER_ELIGIBILITY_REQUIRED' },
    );
  }
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS count FROM registry_versions')).rows[0].count,
    1,
  );
  const on = await f.registry.updateProvider(
    f.actor,
    p.id,
    { status: 'enabled' },
    operation('provider-enable-valid', 1),
  );
  assert.equal(on.status, 'enabled');
  assert.equal(on.revision, 2);
});

test('external activation stays disabled even with claimed complete flags; direct SQL also refuses it', async (t) => {
  const f = await fixture(t);
  const p = await f.registry.createProvider(
    f.actor,
    {
      ...eligible('external-fixture'),
      adapterKind: 'external',
      baseUrl: 'https://api.example.invalid',
      secretRef: 'env:FIXTURE_PROVIDER_KEY',
    },
    operation('external-provider-create'),
  );
  await assert.rejects(
    f.registry.updateProvider(
      f.actor,
      p.id,
      { status: 'enabled' },
      operation('external-enable-attempt', 1),
    ),
    { code: 'LIVE_PROVIDER_DEFERRED' },
  );
  await assert.rejects(f.db.query("UPDATE providers SET status='enabled' WHERE id=$1", [p.id]), {
    code: '23514',
  });
  assert.equal(
    (await f.db.query('SELECT status FROM providers WHERE id=$1', [p.id])).rows[0].status,
    'disabled',
  );
});

test('model fields preserve exact decimal strings and ownership, with context/rate/quality activation guards', async (t) => {
  const f = await fixture(t);
  await enabledProvider(f);
  const m = await f.registry.createModel(f.actor, knownModel(), operation('model-create-valid'));
  assert.equal(m.cuInputRate, '0.125');
  assert.equal(m.cuOutputRate, '2.5');
  for (const patch of [
    { contextVerified: false },
    { contextLimit: null },
    { ratesVerified: false },
    { cuInputRate: null },
    { capabilities: [] },
  ])
    await assert.rejects(
      f.registry.updateModel(
        f.actor,
        m.id,
        { status: 'enabled', ...patch },
        operation('model-gate-' + Object.keys(patch)[0], 1),
      ),
      { code: 'MODEL_EVIDENCE_REQUIRED' },
    );
  await assert.rejects(
    f.registry.updateModel(
      f.actor,
      m.id,
      { cuInputRate: 0.125 },
      operation('float-rate-attempt', 1),
    ),
    { code: 'INVALID_MODEL' },
  );
  await assert.rejects(
    f.registry.updateModel(
      f.actor,
      m.id,
      { providerId: 'other-provider' },
      operation('owner-change-attempt', 1),
    ),
    { code: 'REGISTRY_IDENTITY_IMMUTABLE' },
  );
  await assert.rejects(
    f.registry.updateModel(
      f.actor,
      m.id,
      { agentReady: true },
      operation('agent-ready-attempt', 1),
    ),
    { code: 'QUALITY_UNVERIFIED' },
  );
  const on = await f.registry.updateModel(
    f.actor,
    m.id,
    { status: 'enabled' },
    operation('model-enable-valid', 1),
  );
  assert.equal(on.status, 'enabled');
});

test('operation replay, conflicting idempotency and concurrent stale edits never lose a revision', async (t) => {
  const f = await fixture(t);
  const p = eligible();
  const args = operation('stable-provider-create');
  const first = await f.registry.createProvider(f.actor, p, args);
  assert.deepEqual(await f.registry.createProvider(f.actor, p, args), first);
  const reordered = Object.fromEntries(Object.entries(p).reverse());
  assert.deepEqual(await f.registry.createProvider(f.actor, reordered, args), first);
  await assert.rejects(
    f.registry.createProvider(f.actor, { ...p, name: 'Different fixture' }, args),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
  const results = await Promise.allSettled([
    f.registry.updateProvider(
      f.actor,
      p.id,
      { name: 'Fixture one' },
      operation('concurrent-edit-one', 1),
    ),
    f.registry.updateProvider(
      f.actor,
      p.id,
      { name: 'Fixture two' },
      operation('concurrent-edit-two', 1),
    ),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.find((r) => r.status === 'rejected').reason.code,
    'REGISTRY_REVISION_CONFLICT',
  );
  assert.equal(
    (await f.db.query('SELECT revision FROM registry_metadata WHERE target_id=$1', [p.id])).rows[0]
      .revision,
    2,
  );
});

test('rollback appends a new revision and restores eligible behavior; history and audit cannot be edited/deleted/truncated', async (t) => {
  const f = await fixture(t);
  const on = await enabledProvider(f);
  const off = await f.registry.updateProvider(
    f.actor,
    on.id,
    { status: 'disabled' },
    operation('disable-fixture-provider', on.revision),
  );
  const restored = await f.registry.rollback(
    f.actor,
    'provider',
    on.id,
    on.revision,
    operation('rollback-fixture-provider', off.revision),
  );
  assert.equal(restored.status, 'enabled');
  assert.equal(restored.revision, 4);
  const history = await f.registry.history(f.actor, 'provider', on.id);
  assert.equal(history.length, 4);
  assert.ok(history.every((entry) => entry.actor_id === f.actor));
  const auditRoles = (
    await f.db.query(
      "SELECT actor_role FROM audit_events WHERE action LIKE 'registry_%' AND actor_id=$1",
      [f.actor],
    )
  ).rows;
  assert.ok(auditRoles.length > 0 && auditRoles.every((entry) => entry.actor_role === 'owner'));
  for (const sql of [
    "UPDATE registry_versions SET reason_code='ROLLBACK'",
    'DELETE FROM registry_versions',
    'TRUNCATE registry_versions',
    'DELETE FROM audit_events',
  ])
    await assert.rejects(f.db.exec(sql), { code: '42501' });
});

test('rollback rechecks current parent eligibility instead of reviving an unsafe historical model', async (t) => {
  const f = await fixture(t);
  const p = await enabledProvider(f);
  const m = await f.registry.createModel(
    f.actor,
    { ...knownModel(), status: 'enabled' },
    operation('model-create-enabled'),
  );
  const off = await f.registry.updateModel(
    f.actor,
    m.id,
    { status: 'disabled' },
    operation('model-disable-for-rollback', m.revision),
  );
  await f.registry.updateProvider(
    f.actor,
    p.id,
    { status: 'disabled' },
    operation('parent-disable-for-rollback', p.revision),
  );
  await assert.rejects(
    f.registry.rollback(
      f.actor,
      'model',
      m.id,
      m.revision,
      operation('unsafe-model-rollback', off.revision),
    ),
    { code: 'MODEL_EVIDENCE_REQUIRED' },
  );
  assert.equal(
    (await f.db.query('SELECT revision FROM registry_metadata WHERE target_id=$1', [m.id])).rows[0]
      .revision,
    2,
  );
});

test('storage bounds roll back metadata and base-row changes while retaining terminal audit capacity', async (t) => {
  const f = await fixture(t, { maxVersions: 1 });
  const p = await f.registry.createProvider(
    f.actor,
    eligible(),
    operation('bounded-provider-create'),
  );
  await assert.rejects(
    f.registry.updateProvider(
      f.actor,
      p.id,
      { name: 'Do not persist' },
      operation('bounded-provider-update', 1),
    ),
    { code: 'LOCAL_STORAGE_FULL' },
  );
  assert.equal(
    (await f.db.query('SELECT name FROM providers WHERE id=$1', [p.id])).rows[0].name,
    p.name,
  );
  assert.equal(
    (await f.db.query('SELECT revision FROM registry_metadata WHERE target_id=$1', [p.id])).rows[0]
      .revision,
    1,
  );
});

test('secret values, malformed dates and identity changes are rejected without storing raw input in audit', async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { secretRef: 'inline-secret-value-is-not-a-reference' },
    { termsReviewedAt: '2026-99-01' },
    { baseUrl: 'https://user:password@example.invalid' },
    { secretValue: 'never-store-this-value' },
    { id: 123 },
  ])
    await assert.rejects(
      f.registry.createProvider(
        f.actor,
        { ...eligible(), ...patch },
        operation('bad-fields-attempt'),
      ),
    );
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS count FROM registry_versions')).rows[0].count,
    0,
  );
  const p = await f.registry.createProvider(f.actor, eligible(), operation('safe-provider-create'));
  await assert.rejects(
    f.registry.updateProvider(
      f.actor,
      p.id,
      { id: 'different-id' },
      operation('identity-change-attempt', 1),
    ),
    { code: 'REGISTRY_IDENTITY_IMMUTABLE' },
  );
  const audit = JSON.stringify((await f.db.query('SELECT metadata FROM audit_events')).rows);
  assert.ok(
    !audit.includes('never-store') && !audit.includes('password') && !audit.includes('secretRef'),
  );
});

test('public operation options cannot inject stored observations or forge version actions', async (t) => {
  const f = await fixture(t);
  for (const extra of [
    { observations: { secretValue: 'synthetic-untrusted-value' } },
    { action: 'seed' },
    { unrelated: true },
  ]) {
    await assert.rejects(
      f.registry.createProvider(f.actor, eligible(), {
        ...operation('reject-operation-options'),
        ...extra,
      }),
      { code: 'INVALID_REGISTRY_FIELDS' },
    );
  }
  await assert.rejects(f.registry.createProvider(f.actor, null, operation('reject-null-input')), {
    code: 'INVALID_REGISTRY_FIELDS',
  });
  const p = await f.registry.createProvider(
    f.actor,
    eligible(),
    operation('options-provider-create'),
  );
  await assert.rejects(
    f.registry.updateProvider(f.actor, 'absent-provider', eligible('absent-provider'), {
      ...operation('reject-update-seed'),
      action: 'seed',
    }),
    { code: 'INVALID_REGISTRY_FIELDS' },
  );
  await assert.rejects(
    f.registry.rollback(f.actor, 'provider', p.id, 1, {
      ...operation('reject-rollback-options', 1),
      observations: { secretValue: 'synthetic-untrusted-value' },
    }),
    { code: 'INVALID_REGISTRY_FIELDS' },
  );
  assert.equal(
    (await f.db.query('SELECT count(*)::int AS count FROM registry_versions')).rows[0].count,
    1,
  );
  const evidence = JSON.stringify((await f.db.query('SELECT data FROM registry_metadata')).rows);
  assert.ok(!evidence.includes('synthetic-untrusted-value'));
});

test('seed observations discard unrecognized fields and refuse oversized approved source fields', async (t) => {
  const f = await fixture(t);
  const supplied = structuredClone(pricing);
  supplied.model_prices[0].secretValue = 'synthetic-untrusted-secret';
  supplied.model_prices[0].padding = 'x'.repeat(1024 * 1024);
  await f.registry.seed(f.actor, research, supplied);
  const models = await f.registry.list(f.actor, 'model');
  assert.ok(!JSON.stringify(models).includes('synthetic-untrusted-secret'));
  assert.ok(!JSON.stringify(models).includes('padding'));
  const overlong = structuredClone(pricing);
  overlong.model_prices[0].model_id = 'x'.repeat(1024 * 1024);
  await assert.rejects(f.registry.seed(f.actor, research, overlong), {
    code: 'REGISTRY_SOURCE_INVALID',
  });
  const sized = await fixture(t, { maxRecordBytes: 2048 });
  const p = await sized.registry.createProvider(
    sized.actor,
    eligible(),
    operation('bounded-record-create'),
  );
  await assert.rejects(sized.registry.seed(sized.actor, research, pricing), {
    code: 'REGISTRY_RECORD_TOO_LARGE',
  });
  assert.equal((await sized.registry.history(sized.actor, 'provider', p.id)).length, 1);
  await assert.rejects(
    f.db.query(
      "INSERT INTO registry_metadata(area,target_id,revision,data) VALUES('model','overlong-direct',1,$1::jsonb)",
      [JSON.stringify({ padding: 'x'.repeat(65537) })],
    ),
    { code: '23514' },
  );
});
