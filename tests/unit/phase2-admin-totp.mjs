import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode,
  base32Decode,
  generateTotp,
  verifyTotp,
} from '../../packages/admin/totp.mjs';

test('base32 encode and decode round-trip', () => {
  const original = Buffer.from('AntigravityTestSecret12345', 'utf8');
  const encoded = base32Encode(original);
  assert.equal(typeof encoded, 'string');
  const decoded = base32Decode(encoded);
  assert.deepEqual(decoded, original);
});

test('base32 decode throws on invalid character', () => {
  assert.throws(() => base32Decode('INVALID189!'), /Invalid base32/);
});

test('TOTP generates 6-digit code matching verification at same timestamp', () => {
  const secret = 'JBSWY3DPEHPK3PXP'; // standard RFC test secret
  const time = 1700000000000;
  const code = generateTotp(secret, time, 30);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, time, 30, 0), true);
});

test('TOTP verification accepts valid code within tolerance window', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const time = 1700000000000;
  const previousStepCode = generateTotp(secret, time - 30000, 30);
  const nextStepCode = generateTotp(secret, time + 30000, 30);

  // Window 1 allows +-1 step
  assert.equal(verifyTotp(secret, previousStepCode, time, 30, 1), true);
  assert.equal(verifyTotp(secret, nextStepCode, time, 30, 1), true);

  // Window 0 rejects outside step
  assert.equal(verifyTotp(secret, previousStepCode, time, 30, 0), false);
  assert.equal(verifyTotp(secret, nextStepCode, time, 30, 0), false);
});

test('TOTP rejects malformed or incorrect codes', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const time = 1700000000000;
  assert.equal(verifyTotp(secret, '000000', time, 30, 1), false);
  assert.equal(verifyTotp(secret, '12345', time, 30, 1), false);
  assert.equal(verifyTotp(secret, 'abcdef', time, 30, 1), false);
  assert.equal(verifyTotp(secret, '', time, 30, 1), false);
});
