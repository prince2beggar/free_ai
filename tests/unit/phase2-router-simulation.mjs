import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createRouterFixture, routerFixture } from '../../tools/phase2/router-fixture.mjs';
test('staff dry-run uses versioned policy and sample funding without transport or accounting mutations', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 6 });
  let calls = 0;
  const gateways = Object.fromEntries(
    routerFixture.models.map((m) => [
      m.id,
      {
        synthetic: true,
        providerId: routerFixture.provider.id,
        modelId: m.id,
        health: () => ({ synthetic: true }),
        async *stream() {
          calls++;
          yield { text: 'unused' };
        },
      },
    ]),
  );
  const f = await createRouterFixture(db, { gatewayOverrides: gateways });
  const sample = {
    targetUserId: SYNTHETIC_SEED.userA,
    messages: [{ role: 'user', content: 'Synthetic simulator sample' }],
    language: 'en',
    routing: {},
  };
  async function counts() {
    return (
      await db.query(
        'SELECT (SELECT count(*) FROM usage_ledger)::int AS ledger,(SELECT count(*) FROM capacity_reservations)::int AS holds,(SELECT count(*) FROM router_events)::int AS events',
      )
    ).rows[0];
  }
  const before = await counts(),
    first = await f.router.simulate(f.staff, sample);
  assert.equal(first.policyVersion, 1);
  assert.equal(first.candidates[0].modelId, f.modelA);
  assert.equal(first.callsMade, 0);
  assert.equal(calls, 0);
  assert.deepEqual(await counts(), before);
  await assert.rejects(f.router.simulate(SYNTHETIC_SEED.userA, sample), {
    code: 'ROUTER_FORBIDDEN',
  });
  const defaults = JSON.parse(
    await readFile(new URL('../../packages/router/defaults.json', import.meta.url), 'utf8'),
  );
  await f.router.configurePolicy(f.staff, {
    policy: { ...defaults.policy, version: 2, mode: 'pinned', modelId: f.modelB },
    expectedVersion: 1,
    idempotencyKey: 'simulation-policy-version-two',
  });
  const second = await f.router.simulate(f.staff, sample);
  assert.equal(second.policyVersion, 2);
  assert.deepEqual(
    second.candidates.map((c) => c.modelId),
    [f.modelB],
  );
  assert.equal(calls, 0);
});
