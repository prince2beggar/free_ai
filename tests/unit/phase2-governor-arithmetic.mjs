import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeLimit,
  fairShareTokens,
  requestTokenCapacity,
  aggregateDailyTokens,
} from '../../packages/governor/arithmetic.mjs';

const MAX_INTEGER = 9223372036854775807n;

test('safe limits floor an exact configured factor and default to 0.8', () => {
  assert.equal(safeLimit('9'), 7n);
  assert.equal(safeLimit(3n, '0.333333333333333333333333333333333333333333333333333333333333'), 0n);
  assert.equal(safeLimit('100', '0.79'), 79n);
  assert.equal(safeLimit('100', '0.80'), 80n);
  assert.equal(safeLimit('0', '1'), 0n);
});

test('safe limits preserve integers above the binary floating-point safe range', () => {
  assert.equal(safeLimit('9007199254740993'), 7205759403792794n);
  assert.equal(safeLimit(MAX_INTEGER), 7378697629483820645n);
  assert.equal(safeLimit(MAX_INTEGER, '1'), MAX_INTEGER);
  assert.equal(safeLimit(MAX_INTEGER, '0'), 0n);
  assert.equal(safeLimit(MAX_INTEGER, `0.${'9'.repeat(62)}`), MAX_INTEGER - 1n);
});

test('safe limits reject malformed, unbounded, unknown, or floating-point factors', () => {
  for (const factor of [
    0.8,
    1,
    NaN,
    Infinity,
    null,
    {},
    [],
    true,
    '',
    '.8',
    '1.',
    '-0.1',
    '+0.8',
    '1e-1',
    ' 0.8',
    '0.8 ',
    '1.0001',
    '2',
    `0.${'9'.repeat(63)}`,
  ]) {
    assert.throws(() => safeLimit('100', factor), undefined, `factor ${String(factor)}`);
  }
});

test('fair share has TOKEN units, floors fractional shares, and follows a shrinking pool', () => {
  const base = { userTokenCap: '1000', expectedActiveUsers: '3' };
  assert.equal(fairShareTokens({ ...base, remainingTokens: '100' }), 33n);
  assert.equal(fairShareTokens({ ...base, remainingTokens: '80' }), 26n);
  assert.equal(fairShareTokens({ ...base, remainingTokens: '0' }), 0n);
});

test('fair share caps the allowance and never divides by zero expected users', () => {
  assert.equal(
    fairShareTokens({ userTokenCap: '20', remainingTokens: '100', expectedActiveUsers: '3' }),
    20n,
  );
  assert.equal(
    fairShareTokens({ userTokenCap: '1000', remainingTokens: '100', expectedActiveUsers: '0' }),
    100n,
  );
  assert.equal(
    fairShareTokens({ userTokenCap: '0', remainingTokens: '100', expectedActiveUsers: '0' }),
    0n,
  );
});

test('fair share uses exact large token quantities and configured active-user counts', () => {
  assert.equal(
    fairShareTokens({
      userTokenCap: MAX_INTEGER,
      remainingTokens: '9007199254740993',
      expectedActiveUsers: 3n,
    }),
    3002399751580331n,
  );
  assert.equal(
    fairShareTokens({
      userTokenCap: MAX_INTEGER,
      remainingTokens: MAX_INTEGER,
      expectedActiveUsers: MAX_INTEGER,
    }),
    1n,
  );
});

test('request-only conversion uses explicit conservative tokens per request', () => {
  assert.equal(requestTokenCapacity({ remainingRequests: '8', tokensPerRequest: '1000' }), 8000n);
  assert.equal(requestTokenCapacity({ remainingRequests: '0', tokensPerRequest: '1000' }), 0n);
  assert.equal(
    requestTokenCapacity({ remainingRequests: '9007199254740993', tokensPerRequest: 1n }),
    9007199254740993n,
  );
  assert.equal(
    requestTokenCapacity({ remainingRequests: 1n, tokensPerRequest: MAX_INTEGER }),
    MAX_INTEGER,
  );
});

test('request conversion rejects zero conversion, unsafe overflow, and oversized inputs', () => {
  assert.throws(() => requestTokenCapacity({ remainingRequests: '1', tokensPerRequest: '0' }));
  assert.throws(() =>
    requestTokenCapacity({ remainingRequests: MAX_INTEGER, tokensPerRequest: '2' }),
  );
  assert.throws(() =>
    requestTokenCapacity({ remainingRequests: '9223372036854775808', tokensPerRequest: '1' }),
  );
  assert.throws(() =>
    requestTokenCapacity({ remainingRequests: '0', tokensPerRequest: MAX_INTEGER + 1n }),
  );
});

test('all integer inputs reject coercion, noncanonical text, negatives, and overflow', () => {
  const malformed = [
    0,
    1,
    NaN,
    Infinity,
    null,
    undefined,
    {},
    [],
    true,
    '',
    '01',
    '-0',
    '-1',
    -1n,
    '+1',
    '1.0',
    '1e3',
    ' 1',
    '1 ',
    '9223372036854775808',
    MAX_INTEGER + 1n,
    '9'.repeat(1000),
  ];
  for (const value of malformed) {
    assert.throws(() => safeLimit(value));
    for (const field of ['userTokenCap', 'remainingTokens', 'expectedActiveUsers']) {
      assert.throws(() =>
        fairShareTokens({
          userTokenCap: '100',
          remainingTokens: '100',
          expectedActiveUsers: '1',
          [field]: value,
        }),
      );
    }
    for (const field of ['remainingRequests', 'tokensPerRequest']) {
      assert.throws(() =>
        requestTokenCapacity({ remainingRequests: '10', tokensPerRequest: '10', [field]: value }),
      );
    }
  }
});

test('structured quantity functions reject missing or malformed objects', () => {
  for (const value of [undefined, null, {}, [], '100', 100, true]) {
    assert.throws(() => fairShareTokens(value));
    assert.throws(() => requestTokenCapacity(value));
  }
});

const route = (values = {}) => ({
  providerId: 'provider-a',
  accountRef: 'account-a',
  modelId: 'model-a',
  providerRemainingTokens: null,
  accountRemainingTokens: '100',
  modelRemainingTokens: null,
  ...values,
});

test('daily capacity counts models sharing one account once', () => {
  assert.equal(aggregateDailyTokens([route(), route({ modelId: 'model-b' })]), 100n);
  assert.equal(
    aggregateDailyTokens([
      route({ accountRemainingTokens: null, providerRemainingTokens: '100' }),
      route({ modelId: 'model-b', accountRemainingTokens: null, providerRemainingTokens: '100' }),
    ]),
    100n,
  );
});

test('daily capacity clamps independent accounts to their shared provider cap', () => {
  assert.equal(
    aggregateDailyTokens([
      route({ providerRemainingTokens: '150' }),
      route({ providerRemainingTokens: '150', accountRef: 'account-b' }),
    ]),
    150n,
  );
});

test('daily capacity sums independent providers and keeps tuple identities distinct', () => {
  assert.equal(aggregateDailyTokens([route(), route({ providerId: 'provider-b' })]), 200n);
  assert.equal(
    aggregateDailyTokens([
      route({ providerId: 'a_b', accountRef: 'c' }),
      route({ providerId: 'a', accountRef: 'b_c' }),
    ]),
    200n,
  );
  assert.equal(
    aggregateDailyTokens([
      route({ providerId: '__proto__' }),
      route({ providerId: 'constructor' }),
    ]),
    200n,
  );
});

test('daily capacity respects model caps and an exhausted model leaves another available', () => {
  assert.equal(
    aggregateDailyTokens([
      route({ modelRemainingTokens: '20' }),
      route({ modelId: 'model-b', modelRemainingTokens: '30' }),
    ]),
    50n,
  );
  assert.equal(
    aggregateDailyTokens([
      route({ modelRemainingTokens: '0' }),
      route({ modelId: 'model-b', modelRemainingTokens: '30' }),
    ]),
    30n,
  );
  assert.equal(
    aggregateDailyTokens([route({ accountRemainingTokens: '0', modelRemainingTokens: '20' })]),
    0n,
  );
  assert.equal(aggregateDailyTokens([route({ providerRemainingTokens: '0' })]), 0n);
  assert.equal(
    aggregateDailyTokens([route({ accountRemainingTokens: null, modelRemainingTokens: '25' })]),
    25n,
  );
});

test('daily capacity deduplicates exact routes and accepts equivalent integer snapshots', () => {
  assert.equal(
    aggregateDailyTokens([route(), route(), route({ accountRemainingTokens: 100n })]),
    100n,
  );
  assert.equal(aggregateDailyTokens([]), 0n);
  assert.equal(aggregateDailyTokens(Array.from({ length: 1000 }, () => route())), 100n);
});

test('daily capacity rejects conflicting snapshots for each shared quota identity', () => {
  assert.throws(() =>
    aggregateDailyTokens([
      route({ providerRemainingTokens: '150' }),
      route({ providerRemainingTokens: '151', accountRef: 'account-b' }),
    ]),
  );
  assert.throws(() =>
    aggregateDailyTokens([route(), route({ accountRemainingTokens: '101', modelId: 'model-b' })]),
  );
  assert.throws(() =>
    aggregateDailyTokens([
      route({ modelRemainingTokens: '20' }),
      route({ modelRemainingTokens: '21' }),
    ]),
  );
  assert.throws(() =>
    aggregateDailyTokens([
      route({ providerRemainingTokens: '100' }),
      route({ providerRemainingTokens: null, modelId: 'model-b' }),
    ]),
  );
  assert.throws(() =>
    aggregateDailyTokens([
      route(),
      route({ accountRemainingTokens: null, modelId: 'model-b', modelRemainingTokens: '20' }),
    ]),
  );
});

test('daily capacity allows exact large intermediate sums when ancestors clamp them', () => {
  assert.equal(
    aggregateDailyTokens([
      route({ accountRemainingTokens: MAX_INTEGER }),
      route({ accountRemainingTokens: MAX_INTEGER, modelId: 'model-b' }),
    ]),
    MAX_INTEGER,
  );
  assert.equal(
    aggregateDailyTokens([
      route({ providerRemainingTokens: MAX_INTEGER, accountRemainingTokens: MAX_INTEGER }),
      route({
        providerRemainingTokens: MAX_INTEGER,
        accountRemainingTokens: MAX_INTEGER,
        accountRef: 'account-b',
      }),
    ]),
    MAX_INTEGER,
  );
  assert.equal(
    aggregateDailyTokens([route({ accountRemainingTokens: '9007199254740993' })]),
    9007199254740993n,
  );
});

test('daily capacity rejects overflow in independent provider totals', () => {
  assert.throws(() =>
    aggregateDailyTokens([
      route({ accountRemainingTokens: MAX_INTEGER }),
      route({ providerId: 'provider-b', accountRemainingTokens: '1' }),
    ]),
  );
});

test('daily capacity rejects missing bounds, malformed caps, and missing own fields', () => {
  assert.throws(() => aggregateDailyTokens([route({ accountRemainingTokens: null })]));
  const invalid = [
    0,
    NaN,
    Infinity,
    undefined,
    true,
    {},
    [],
    '-1',
    -1n,
    '01',
    '1e2',
    MAX_INTEGER + 1n,
  ];
  for (const field of [
    'providerRemainingTokens',
    'accountRemainingTokens',
    'modelRemainingTokens',
  ]) {
    for (const value of invalid)
      assert.throws(() => aggregateDailyTokens([route({ [field]: value })]));
    const missing = route();
    delete missing[field];
    assert.throws(() => aggregateDailyTokens([missing]));
  }
  assert.throws(() => aggregateDailyTokens([Object.create(route())]));
});

test('daily capacity bounds input lists and validates every route identity', () => {
  for (const value of [undefined, null, {}, '100', 100, true, Array(1001).fill(route())]) {
    assert.throws(() => aggregateDailyTokens(value));
  }
  for (const value of [null, undefined, {}, [], 100, 'route'])
    assert.throws(() => aggregateDailyTokens([value]));
  for (const field of ['providerId', 'accountRef', 'modelId']) {
    for (const value of [null, undefined, 1, {}, '', ' a', 'a b', 'a\n', 'a/b', 'a'.repeat(81)]) {
      assert.throws(() => aggregateDailyTokens([route({ [field]: value })]));
    }
    const missing = route();
    delete missing[field];
    assert.throws(() => aggregateDailyTokens([missing]));
  }
});
