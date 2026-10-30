import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createApp } from '../../packages/api/server.mjs';

function usage(owner) {
  return {
    syntheticOnly: true,
    unit: 'tokens',
    entitlements: [
      {
        id: `${owner}-free`,
        kind: 'free',
        status: 'active',
        startsAt: '2026-10-13T00:00:00Z',
        endsAt: '2026-10-13T02:00:00Z',
        timeLeftSeconds: 7200,
        remaining: { costMicroCu: '999111', inputTokens: '9007199254740993', outputTokens: '2000' },
        spent: { costMicroCu: '17', inputTokens: '40', outputTokens: '10' },
        estimated: true,
        refusalReason: null,
      },
      {
        id: `${owner}-pack`,
        kind: 'pack',
        status: 'expired',
        startsAt: '2026-10-12T00:00:00Z',
        endsAt: '2026-10-13T00:00:00Z',
        timeLeftSeconds: 0,
        remaining: { costMicroCu: '0', inputTokens: '0', outputTokens: '0' },
        spent: { costMicroCu: '100', inputTokens: '30', outputTokens: '20' },
        estimated: false,
        refusalReason: 'ENTITLEMENT_EXPIRED',
      },
    ],
  };
}
function history(owner) {
  return [
    {
      id: `${owner}-entry`,
      entitlementId: `${owner}-free`,
      type: 'commit',
      amountMicroCu: '-17',
      tokensIn: '-40',
      tokensOut: '-10',
      reservationId: `${owner}-reservation`,
      estimateFlag: true,
      reconcilesEntryId: null,
      reasonCode: 'RECONCILIATION_DEADLINE',
      createdAt: '2026-10-13T00:00:00Z',
    },
  ];
}
function ownedLedger() {
  const calls = [];
  return {
    calls,
    async usage(owner) {
      assert.ok([SYNTHETIC_SEED.userA, SYNTHETIC_SEED.userB].includes(owner));
      calls.push(['usage', owner]);
      return usage(owner);
    },
    async history(owner) {
      assert.ok([SYNTHETIC_SEED.userA, SYNTHETIC_SEED.userB].includes(owner));
      calls.push(['history', owner]);
      return history(owner);
    },
  };
}
async function fixture(t, ledger) {
  const db = await createDatabase();
  await migrateUp(db);
  await seedSynthetic(db);
  const config = await loadConfig(
    {},
    {
      port: 0,
      limits: { chunkDelayMs: 0 },
    },
  );
  const server = createApp({ db, config, ledger });
  await server.ready;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await server.shutdown();
    await db.close();
  });
  function client() {
    const cookies = new Map();
    let csrf = '';
    return {
      async request(path, method = 'GET', value = {}) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            Cookie: [...cookies].map(([key, val]) => `${key}=${val}`).join('; '),
            ...(!['GET', 'HEAD'].includes(method)
              ? { Origin: base, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }
              : {}),
          },
          ...(!['GET', 'HEAD'].includes(method) ? { body: JSON.stringify(value) } : {}),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const [name, val] = cookie.split(';')[0].split('=');
          if (val) cookies.set(name, val);
          else cookies.delete(name);
        }
        const payload = method === 'HEAD' ? null : await response.json();
        if (payload?.csrfToken) csrf = payload.csrfToken;
        return { response, payload };
      },
      async signIn(identity = 'demo-alpha') {
        const bootstrap = await this.request('/api/bootstrap');
        const login = await this.request('/api/auth/local', 'POST', {
          identity,
          acceptedLegalVersion: bootstrap.payload.legalVersion,
        });
        assert.equal(login.response.status, 200);
        return login.payload.user.id;
      },
    };
  }
  return { db, server, base, client };
}

test('usage and history require a session before invoking the ledger', async (t) => {
  const ledger = ownedLedger();
  const f = await fixture(t, ledger);
  const c = f.client();
  for (const path of ['/api/usage', '/api/usage/history']) {
    const result = await c.request(path);
    assert.equal(result.response.status, 401);
    assert.equal(result.payload.error.code, 'SIGN_IN_REQUIRED');
  }
  assert.deepEqual(ledger.calls, []);
});

test('usage, history and account pass only the session owner and preserve integer/estimate evidence', async (t) => {
  const ledger = ownedLedger();
  const f = await fixture(t, ledger);
  const alpha = f.client();
  const beta = f.client();
  assert.equal(await alpha.signIn(), SYNTHETIC_SEED.userA);
  assert.equal(await beta.signIn('demo-beta'), SYNTHETIC_SEED.userB);
  for (const [c, owner, other] of [
    [alpha, SYNTHETIC_SEED.userA, SYNTHETIC_SEED.userB],
    [beta, SYNTHETIC_SEED.userB, SYNTHETIC_SEED.userA],
  ]) {
    const summary = await c.request('/api/usage');
    assert.equal(summary.response.status, 200);
    assert.deepEqual(summary.payload, usage(owner));
    assert.equal(summary.response.headers.get('cache-control'), 'no-store');
    const entries = await c.request('/api/usage/history');
    assert.equal(entries.response.status, 200);
    assert.deepEqual(entries.payload, { syntheticOnly: true, history: history(owner) });
    const account = await c.request('/api/account');
    assert.equal(account.response.status, 200);
    assert.deepEqual(account.payload.ledgerUsage, usage(owner));
    assert.equal(
      JSON.stringify([summary.payload, entries.payload, account.payload]).includes(other),
      false,
    );
  }
  assert.deepEqual(ledger.calls, [
    ['usage', SYNTHETIC_SEED.userA],
    ['history', SYNTHETIC_SEED.userA],
    ['usage', SYNTHETIC_SEED.userA],
    ['usage', SYNTHETIC_SEED.userB],
    ['history', SYNTHETIC_SEED.userB],
    ['usage', SYNTHETIC_SEED.userB],
  ]);
});

test('usage routes reject query owner overrides and all writes without invoking ledger methods', async (t) => {
  const ledger = ownedLedger();
  const f = await fixture(t, ledger);
  const c = f.client();
  await c.signIn();
  for (const path of ['/api/usage', '/api/usage/history']) {
    const override = await c.request(`${path}?userId=${SYNTHETIC_SEED.userB}`);
    assert.equal(override.response.status, 400);
    assert.equal(override.payload.error.code, 'INVALID_REQUEST');
    for (const method of ['POST', 'PATCH', 'DELETE', 'HEAD']) {
      const denied = await c.request(path, method);
      assert.equal(denied.response.status, 405);
      if (denied.payload) assert.equal(denied.payload.error.code, 'METHOD_NOT_ALLOWED');
    }
  }
  const pathOverride = await c.request(`/api/usage/${SYNTHETIC_SEED.userB}`);
  assert.equal(pathOverride.response.status, 404);
  assert.deepEqual(ledger.calls, []);
});

test('default Phase 1 has no ledger routes and preserves its account response', async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.signIn();
  for (const path of ['/api/usage', '/api/usage/history'])
    assert.equal((await c.request(path)).response.status, 404);
  const account = await c.request('/api/account');
  assert.equal(account.response.status, 200);
  assert.deepEqual(Object.keys(account.payload).sort(), ['usage', 'user']);
});

test('failed ledger reads return a safe failure without falling back to an inaccurate summary', async (t) => {
  const ledger = {
    usage: async () => {
      throw new Error('private accounting failure');
    },
    history: async () => {
      throw new Error('private accounting failure');
    },
  };
  const f = await fixture(t, ledger);
  const c = f.client();
  await c.signIn();
  for (const path of ['/api/usage', '/api/usage/history', '/api/account']) {
    const result = await c.request(path);
    assert.equal(result.response.status, 503);
    assert.equal(result.payload.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(JSON.stringify(result.payload).includes('private accounting failure'), false);
  }
});
