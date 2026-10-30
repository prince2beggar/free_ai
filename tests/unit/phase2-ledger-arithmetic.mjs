import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MICRO_CU_PER_CU,
  integer,
  costMicroCu,
  floorTokenGrant,
} from '../../packages/ledger/arithmetic.mjs';

const maxInteger = 9223372036854775807n;
const usage = (overrides = {}) => ({
  inputTokens: '0',
  outputTokens: '0',
  cuInputRate: '0',
  cuOutputRate: '0',
  ...overrides,
});

test('micro-CU scale and integer boundaries preserve values beyond Number precision', () => {
  assert.equal(MICRO_CU_PER_CU, 10000n);
  assert.equal(integer('9007199254740993'), 9007199254740993n);
  assert.equal(integer(maxInteger), maxInteger);
  assert.equal(integer('9223372036854775807'), maxInteger);
  assert.equal(integer('-9223372036854775807', { signed: true }), -maxInteger);
  assert.equal(integer(-1n, { signed: true }), -1n);
  assert.equal(integer('0'), 0n);
});

test('integer parsing rejects imprecise numbers, noncanonical strings, negatives and overflow', () => {
  for (const value of [
    1,
    9007199254740993,
    null,
    undefined,
    true,
    '01',
    '+1',
    '-0',
    '1.0',
    '1e3',
    ' 1',
    '1 ',
    '',
    '9'.repeat(100000),
    maxInteger + 1n,
    -maxInteger - 1n,
    '-9223372036854775808',
  ]) {
    assert.throws(() => integer(value, { signed: true }), Error);
  }
  assert.throws(() => integer('-1'), Error);
  assert.throws(() => integer(-1n), Error);
  assert.throws(() => integer('1', { signed: 'true' }), Error);
});

test('cost adds input, output and surcharge exactly and rounds the whole positive cost once', () => {
  assert.equal(
    costMicroCu(
      usage({
        inputTokens: '1',
        outputTokens: '1',
        cuInputRate: '0.04',
        cuOutputRate: '0.04',
        toolSurchargeCu: '0.00002',
      }),
    ),
    1n,
  );
  assert.equal(
    costMicroCu(
      usage({
        inputTokens: '1000',
        outputTokens: '1000',
        cuInputRate: '0.125',
        cuOutputRate: '2.5',
      }),
    ),
    26250n,
  );
  assert.equal(
    costMicroCu(usage({ inputTokens: '3', cuInputRate: '0.123456', toolSurchargeCu: '0.000001' })),
    4n,
  );
});

test('sub-micro costs round up while exact zero remains zero', () => {
  assert.equal(costMicroCu(usage()), 0n);
  assert.equal(costMicroCu(usage({ inputTokens: '1', cuInputRate: '0.00000000000001' })), 1n);
  assert.equal(costMicroCu(usage({ toolSurchargeCu: '0.00000000000000000001' })), 1n);
  assert.equal(costMicroCu(usage({ inputTokens: 0n, outputTokens: 0n })), 0n);
});

test('large tokens and cost boundaries never pass through binary floating point', () => {
  assert.equal(
    costMicroCu(usage({ inputTokens: '9007199254740993', cuInputRate: '0.1' })),
    9007199254740993n,
  );
  assert.equal(costMicroCu(usage({ inputTokens: maxInteger, cuInputRate: '0.1' })), maxInteger);
  assert.throws(
    () => costMicroCu(usage({ inputTokens: maxInteger, cuInputRate: '0.100001' })),
    Error,
  );
  assert.throws(
    () =>
      costMicroCu(
        usage({ inputTokens: maxInteger, cuInputRate: '0.1', toolSurchargeCu: '0.000001' }),
      ),
    Error,
  );
  assert.throws(() => costMicroCu(usage({ toolSurchargeCu: '922337203685477.5808' })), Error);
});

test('unknown, negative, malformed and oversized rates fail even when token use is zero', () => {
  for (const field of ['cuInputRate', 'cuOutputRate', 'toolSurchargeCu']) {
    for (const value of [
      null,
      undefined,
      -1,
      0,
      1n,
      false,
      'unknown',
      '-0.1',
      '-0',
      '+1',
      '.1',
      '1.',
      '1e-3',
      ' 0',
      '0 ',
      '',
      '0'.repeat(65),
      '0.'.padEnd(100000, '1'),
    ]) {
      assert.throws(
        () => costMicroCu(usage({ [field]: value })),
        Error,
        `${field}: ${typeof value}`,
      );
    }
  }
  const missingInputRate = usage();
  delete missingInputRate.cuInputRate;
  assert.throws(() => costMicroCu(missingInputRate), Error);
  const missingOutputRate = usage();
  delete missingOutputRate.cuOutputRate;
  assert.throws(() => costMicroCu(missingOutputRate), Error);
  assert.throws(() => costMicroCu(), Error);
  assert.throws(() => costMicroCu(null), Error);
});

test('invalid token quantities and rounded overflow cannot create a persisted cost', () => {
  for (const field of ['inputTokens', 'outputTokens']) {
    for (const value of [undefined, null, '1.5', '01', '-1', -1n, 1, maxInteger + 1n]) {
      assert.throws(() => costMicroCu(usage({ [field]: value })), Error);
    }
  }
  assert.throws(() => costMicroCu(usage({ toolSurchargeCu: '922337203685477.580700001' })), Error);
});

test('token grants floor exact nonnegative decimals without losing integer precision', () => {
  assert.equal(floorTokenGrant('0.999999999999999999999999'), 0n);
  assert.equal(floorTokenGrant('12.99999'), 12n);
  assert.equal(floorTokenGrant('9007199254740993.9999'), 9007199254740993n);
  assert.equal(floorTokenGrant('9223372036854775807.9'), maxInteger);
  assert.equal(floorTokenGrant('00012.100'), 12n);
  assert.equal(floorTokenGrant('0'), 0n);
  for (const value of [null, undefined, 1, 1n, '-0', '-1', '1e3', '.9', '1.', '9'.repeat(65)]) {
    assert.throws(() => floorTokenGrant(value), Error);
  }
  assert.throws(() => floorTokenGrant('9223372036854775808'), Error);
});
