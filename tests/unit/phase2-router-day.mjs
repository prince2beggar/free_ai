import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createRouterFixture, refreshRouterFairShare } from '../../tools/phase2/router-fixture.mjs';
test('daily policy refresh follows the configured local midnight, replays once and grants no new funds', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 6 });
  let time = Date.parse('2026-10-13T17:59:59.000Z');
  const clock = () => time;
  const f = await createRouterFixture(db, { clock });
  const before = (await db.query('SELECT count(*)::int AS n FROM usage_ledger')).rows[0].n;
  assert.equal((await db.query('SELECT count(*)::int AS n FROM capacity_job_runs')).rows[0].n, 1);
  time += 1000;
  const generation = await refreshRouterFairShare(f, { clock, dayOffsetMinutes: 360 });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM capacity_job_runs')).rows[0].n, 2);
  assert.deepEqual(await refreshRouterFairShare(f, { clock, dayOffsetMinutes: 360 }), generation);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM usage_ledger')).rows[0].n, before);
  assert.equal(
    (await f.governor.allowance(SYNTHETIC_SEED.userA)).createdAt,
    '2026-10-13T18:00:00.000Z',
  );
});
test('crossing local midnight during refresh commits only the new day generation', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await migrateUp(db, { throughVersion: 6 });
  let time = Date.parse('2026-10-12T18:00:00.000Z');
  let cross = false;
  const clock = () => {
    const captured = time;
    if (cross) {
      cross = false;
      time = Date.parse('2026-10-13T18:00:00.000Z');
    }
    return captured;
  };
  const f = await createRouterFixture(db, { clock });
  const before = (await db.query('SELECT count(*)::int AS n FROM usage_ledger')).rows[0].n;
  time = Date.parse('2026-10-13T17:59:59.999Z');
  cross = true;
  const generation = await refreshRouterFairShare(f, { clock });
  assert.deepEqual(await refreshRouterFairShare(f, { clock }), generation);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM capacity_job_runs')).rows[0].n, 2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM usage_ledger')).rows[0].n, before);
  assert.equal(
    (await f.governor.allowance(SYNTHETIC_SEED.userA)).createdAt,
    '2026-10-13T18:00:00.000Z',
  );
});
