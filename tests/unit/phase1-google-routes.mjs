import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createDatabase, migrateUp, seedSynthetic } from '../../packages/db/index.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { createRepository } from '../../packages/api/repository.mjs';

const clientId = '123-synthetic.apps.googleusercontent.com';
const clientSecret = 'synthetic-secret-for-injected-transport';

test('Google mode requires complete loopback configuration and refuses provider activation', async () => {
  for (const env of [
    { PHASE1_MODE: 'LOCAL_GOOGLE' },
    { PHASE1_MODE: 'LOCAL_GOOGLE', GOOGLE_AUTH_ENABLED: 'false' },
    {
      PHASE1_MODE: 'LOCAL_GOOGLE',
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: clientSecret,
      GOOGLE_REDIRECT_URI: 'http://attacker.invalid/callback',
    },
    { PHASE1_MODE: 'LOCAL_GOOGLE', REAL_PROVIDERS_ENABLED: 'true' },
  ])
    await assert.rejects(loadConfig(env));
  const config = await loadConfig({
    PHASE1_MODE: 'LOCAL_GOOGLE',
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4174/api/auth/google/callback',
  });
  assert.equal(config.googleEnabled, true);
  assert.equal(config.realProvidersEnabled, false);
});

test('Google HTTP flow binds state, verifies signed identity, rotates sessions and rejects replay/demo login', async (t) => {
  const db = await createDatabase();
  await migrateUp(db);
  await seedSynthetic(db);
  const config = await loadConfig(
    {},
    {
      mode: 'LOCAL_GOOGLE',
      googleEnabled: true,
      port: 0,
      google: {
        clientId,
        clientSecret,
        redirectUri: 'http://127.0.0.1:0/api/auth/google/callback',
      },
    },
  );
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...pair.publicKey.export({ format: 'jwk' }),
    kid: 'local-route-test',
    alg: 'RS256',
    use: 'sig',
  };
  let nonce;
  let calls = 0;
  const server = createApp({
    db,
    config,
    googleTransport: async (url, options) => {
      calls++;
      assert.equal(options.redirect, 'error');
      if (url.endsWith('/token')) {
        const form = new URLSearchParams(options.body);
        assert.equal(form.get('client_secret'), clientSecret);
        assert.equal(form.get('grant_type'), 'authorization_code');
        assert.ok(form.get('code_verifier'));
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString(
          'base64url',
        );
        const payload = Buffer.from(
          JSON.stringify({
            iss: 'https://accounts.google.com',
            aud: clientId,
            sub: 'synthetic-route-subject',
            nonce,
            iat: now,
            exp: now + 300,
            email_verified: true,
          }),
        ).toString('base64url');
        const signature = sign(
          'RSA-SHA256',
          Buffer.from(`${header}.${payload}`),
          pair.privateKey,
        ).toString('base64url');
        return Response.json({
          access_token: 'synthetic-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          id_token: `${header}.${payload}.${signature}`,
        });
      }
      if (url.endsWith('/certs')) return Response.json({ keys: [jwk] });
      return Response.json({
        sub: 'synthetic-route-subject',
        email_verified: true,
        name: 'Synthetic Google tester',
      });
    },
  });
  await server.ready;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await server.shutdown();
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = new Map();
  let csrf;
  async function call(path, method = 'GET', value, extra = {}) {
    const response = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        Cookie: [...cookies].map(([name, val]) => `${name}=${val}`).join('; '),
        ...(method === 'GET'
          ? {}
          : { Origin: base, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }),
        ...extra,
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [name, val] = cookie.split(';')[0].split('=');
      cookies.set(name, val);
    }
    return response;
  }
  const boot = await (await call('/api/bootstrap')).json();
  csrf = boot.csrfToken;
  assert.equal(boot.googleEnabled, true);
  assert.equal(boot.localSignInEnabled, false);
  assert.ok(!JSON.stringify(boot).includes(clientSecret));
  assert.equal(
    (
      await call('/api/auth/local', 'POST', {
        identity: 'demo-alpha',
        acceptedLegalVersion: boot.legalVersion,
      })
    ).status,
    403,
  );
  assert.equal(
    (await call('/api/auth/google/start', 'POST', { acceptedLegalVersion: 'wrong' })).status,
    403,
  );
  const start = await (
    await call('/api/auth/google/start', 'POST', { acceptedLegalVersion: boot.legalVersion })
  ).json();
  const auth = new URL(start.authorizationUrl);
  nonce = auth.searchParams.get('nonce');
  assert.equal(auth.origin, 'https://accounts.google.com');
  const state = auth.searchParams.get('state');
  const callback = '/api/auth/google/callback?code=synthetic-code&state=' + state;
  assert.equal(
    (
      await call(callback.replace(state, 'forged'), 'GET', undefined, {
        'Sec-Fetch-Site': 'cross-site',
      })
    ).status,
    401,
  );
  assert.equal(calls, 0);
  const accepted = await call(callback, 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get('location'), '/');
  assert.equal(calls, 3);
  const account = await (await call('/api/account')).json();
  assert.equal(account.user.displayName, 'Synthetic Google tester');
  const stored = (await db.query("SELECT * FROM users WHERE identity_provider='google'")).rows[0];
  assert.equal(stored.email, null);
  assert.equal(stored.trust_level, 0);
  assert.equal((await call(callback)).status, 401);
  assert.equal(calls, 3);
  assert.equal(
    (await call('/health', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status,
    403,
  );
  assert.equal((await call(callback + '&state=duplicate')).status, 401);
  const updated = await (await call('/api/bootstrap')).json();
  csrf = updated.csrfToken;
  assert.equal((await call('/api/auth/logout', 'POST', {})).status, 200);
  assert.equal((await call('/api/account')).status, 401);
  async function startAgain() {
    const bootstrap = await (await call('/api/bootstrap')).json();
    csrf = bootstrap.csrfToken;
    const result = await (
      await call('/api/auth/google/start', 'POST', { acceptedLegalVersion: bootstrap.legalVersion })
    ).json();
    const target = new URL(result.authorizationUrl);
    nonce = target.searchParams.get('nonce');
    return (
      '/api/auth/google/callback?code=synthetic-code&state=' + target.searchParams.get('state')
    );
  }
  assert.equal((await call(await startAgain())).status, 303);
  csrf = (await (await call('/api/bootstrap')).json()).csrfToken;
  assert.equal((await call('/api/account/deletion', 'POST', {})).status, 200);
  assert.equal((await call(await startAgain())).status, 401);
  assert.equal(
    (await db.query("SELECT id FROM users WHERE identity_provider='google'")).rows.length,
    1,
  );
  const tombstone = (
    await db.query(
      "SELECT provider_subject,google_sub,email FROM users WHERE identity_provider='google'",
    )
  ).rows[0];
  assert.notEqual(tombstone.provider_subject, 'synthetic-route-subject');
  assert.equal(tombstone.google_sub, null);
  assert.equal(tombstone.email, null);
  await createRepository(db, config).deleteAccount(stored.id);
  const repeated = (await db.query('SELECT provider_subject FROM users WHERE id=$1', [stored.id]))
    .rows[0];
  assert.equal(repeated.provider_subject, tombstone.provider_subject);
  assert.equal((await call(await startAgain())).status, 401);
});
