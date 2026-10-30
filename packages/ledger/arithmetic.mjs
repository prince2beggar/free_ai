export const MICRO_CU_PER_CU = 10000n;

const MAX_INTEGER = 9223372036854775807n;
const MAX_DECIMAL_LENGTH = 64;
const TOKENS_PER_RATE_UNIT = 1000n;

export function integer(value, { signed = false } = {}) {
  if (typeof signed !== 'boolean') throw new Error('Invalid integer sign option.');
  if (
    typeof value !== 'bigint' &&
    !(
      typeof value === 'string' &&
      value.length <= 20 &&
      /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(value)
    )
  ) {
    throw new Error('Expected a canonical integer string or bigint.');
  }
  const result = typeof value === 'bigint' ? value : BigInt(value);
  if (result > MAX_INTEGER || result < -MAX_INTEGER || (!signed && result < 0n)) {
    throw new Error('Integer is outside the supported accounting range.');
  }
  return result;
}

function decimal(value) {
  if (
    typeof value !== 'string' ||
    value.length > MAX_DECIMAL_LENGTH ||
    !/^[0-9]+(?:\.[0-9]+)?$/.test(value)
  ) {
    throw new Error('Expected a bounded nonnegative plain decimal string.');
  }
  const [whole, fraction = ''] = value.split('.');
  return { numerator: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
}

export function costMicroCu(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new Error('Expected token quantities and exact decimal rates.');
  }
  const inputTokens = integer(usage.inputTokens);
  const outputTokens = integer(usage.outputTokens);
  const inputRate = decimal(usage.cuInputRate);
  const outputRate = decimal(usage.cuOutputRate);
  const surcharge = decimal(Object.hasOwn(usage, 'toolSurchargeCu') ? usage.toolSurchargeCu : '0');
  const scale = [inputRate.scale, outputRate.scale, surcharge.scale].reduce(
    (largest, current) => (current > largest ? current : largest),
    1n,
  );
  const totalNumerator =
    inputTokens * inputRate.numerator * (scale / inputRate.scale) +
    outputTokens * outputRate.numerator * (scale / outputRate.scale) +
    TOKENS_PER_RATE_UNIT * surcharge.numerator * (scale / surcharge.scale);
  const microNumerator = totalNumerator * MICRO_CU_PER_CU;
  const denominator = scale * TOKENS_PER_RATE_UNIT;
  // Round only the combined exact total; rounding components independently overcharges.
  return integer((microNumerator + denominator - 1n) / denominator);
}

export function floorTokenGrant(value) {
  const amount = decimal(value);
  return integer(amount.numerator / amount.scale);
}
