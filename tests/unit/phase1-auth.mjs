import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, generateKeyPairSync, sign } from 'node:crypto';
import { loadConfig, validateConfig } from '../../packages/api/config.mjs';
import {
  hashToken,
  verifyGoogleIdToken,
  cookieValue,
  sessionCookie,
} from '../../packages/api/auth.mjs';

test('local configuration refuses public binding, live flags and invalid bounds', async () => {
  const config = await loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.googleEnabled, false);
  assert.throws(() => validateConfig({ ...config, host: '0.0.0.0' }));
  assert.throws(() => validateConfig({ ...config, googleEnabled: true }));
  assert.throws(() =>
    validateConfig({ ...config, limits: { ...config.limits, maxOutputTokens: 0 } }),
  );
  await assert.rejects(loadConfig({ PHASE1_MODE: 'production' }));
  await assert.rejects(loadConfig({ GOOGLE_AUTH_ENABLED: 'true' }));
});

test('cookies are HttpOnly SameSite and production helper always forces Secure', () => {
  assert.match(sessionCookie('opaque-value', 60, true), /HttpOnly; SameSite=Lax/);
  assert.match(sessionCookie('opaque-value', 60, false), /; Secure/);
  assert.equal(cookieValue('x=one; local_session=two', 'local_session'), 'two');
  assert.equal(cookieValue('local_session=one; local_session=two', 'local_session'), null);
  assert.equal(hashToken('test-opaque-value').length, 64);
  assert.notEqual(hashToken('test-opaque-value'), 'test-opaque-value');
});

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...pair.publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
function tokenFor(changes = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: 'synthetic-client',
      sub: 'subject-1',
      nonce: 'test-nonce',
      iat: 1000,
      exp: 1600,
      email_verified: true,
      ...changes,
    }),
  ).toString('base64url');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    pair.privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
test('OIDC identity requires a signature, exact issuer/audience/nonce and expiry', async () => {
  const options = { keys: [jwk], clientId: 'synthetic-client', nonce: 'test-nonce', now: 1100 };
  assert.equal((await verifyGoogleIdToken(tokenFor(), options)).sub, 'subject-1');
  for (const changes of [
    { iss: 'https://attacker.invalid' },
    { aud: 'other-client' },
    { nonce: 'other-nonce' },
    { exp: 1099 },
    { iat: 1500 },
    { email_verified: false },
    { azp: 'other-client' },
  ]) {
    await assert.rejects(verifyGoogleIdToken(tokenFor(changes), options));
  }
  const forged = tokenFor().split('.');
  forged[2] = randomBytes(256).toString('base64url');
  await assert.rejects(verifyGoogleIdToken(forged.join('.'), options));
  await assert.rejects(verifyGoogleIdToken(tokenFor(), { ...options, keys: [] }));
});
