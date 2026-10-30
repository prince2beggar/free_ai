import { integer } from '../ledger/arithmetic.mjs';

const MAX_DECIMAL_LENGTH = 64;
const MAX_AGGREGATE_ROUTES = 1000;

export function safeLimit(limit, safetyFactor = '0.8') {
  const amount = integer(limit);
  if (
    typeof safetyFactor !== 'string' ||
    safetyFactor.length > MAX_DECIMAL_LENGTH ||
    !/^[0-9]+(?:\.[0-9]+)?$/.test(safetyFactor)
  ) {
    throw new Error('Expected a bounded nonnegative plain decimal safety factor.');
  }
  const [whole, fraction = ''] = safetyFactor.split('.');
  const numerator = BigInt(whole + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  if (numerator > denominator) throw new Error('Safety factor must be between zero and one.');
  // Floor only after exact multiplication; binary floats can enlarge a safety limit.
  return integer((amount * numerator) / denominator);
}

export function fairShareTokens({ userTokenCap, remainingTokens, expectedActiveUsers }) {
  const cap = integer(userTokenCap);
  const remaining = integer(remainingTokens);
  const expectedUsers = integer(expectedActiveUsers);
  const share = remaining / (expectedUsers > 0n ? expectedUsers : 1n);
  return share < cap ? share : cap;
}

export function requestTokenCapacity({ remainingRequests, tokensPerRequest }) {
  const requests = integer(remainingRequests);
  const tokens = integer(tokensPerRequest);
  if (tokens === 0n) throw new Error('Conservative tokens per request must be positive.');
  // This configured conversion informs token allowance; request limits still apply separately.
  return integer(requests * tokens);
}

function quotaNode(nodes, identity, remaining) {
  if (nodes.has(identity)) {
    const existing = nodes.get(identity);
    if (existing.remaining !== remaining) throw new Error('Conflicting shared quota snapshots.');
    return existing;
  }
  const node = { remaining, children: new Map() };
  nodes.set(identity, node);
  return node;
}

function clampTokens(total, cap) {
  return cap !== null && cap < total ? cap : total;
}

export function aggregateDailyTokens(routes) {
  if (!Array.isArray(routes) || routes.length > MAX_AGGREGATE_ROUTES) {
    throw new Error('Expected a bounded list of daily quota routes.');
  }
  const identityFields = ['providerId', 'accountRef', 'modelId'];
  const capacityFields = [
    'providerRemainingTokens',
    'accountRemainingTokens',
    'modelRemainingTokens',
  ];
  const fields = [...identityFields, ...capacityFields];
  const providers = new Map();
  for (const route of routes) {
    if (
      !route ||
      typeof route !== 'object' ||
      Array.isArray(route) ||
      Object.keys(route).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(route, field)) ||
      identityFields.some((field) => {
        const value = route[field];
        return (
          typeof value !== 'string' ||
          value.length === 0 ||
          value.length > 80 ||
          /[^A-Za-z0-9_-]/.test(value)
        );
      })
    ) {
      throw new Error('Expected complete daily quota route identities and capacity fields.');
    }
    const caps = capacityFields.map((field) =>
      route[field] === null ? null : integer(route[field]),
    );
    if (caps.every((cap) => cap === null))
      throw new Error('Every route needs a finite daily token bound.');
    const provider = quotaNode(providers, route.providerId, caps[0]);
    const account = quotaNode(provider.children, route.accountRef, caps[1]);
    quotaNode(account.children, route.modelId, caps[2]);
  }

  let total = 0n;
  for (const provider of providers.values()) {
    let providerTotal = 0n;
    for (const account of provider.children.values()) {
      let accountTotal = 0n;
      for (const model of account.children.values()) {
        const bounds = [provider.remaining, account.remaining, model.remaining].filter(
          (cap) => cap !== null,
        );
        accountTotal += bounds.reduce((smallest, cap) => (cap < smallest ? cap : smallest));
      }
      providerTotal += clampTokens(accountTotal, account.remaining);
    }
    total += clampTokens(providerTotal, provider.remaining);
  }
  // Ancestors can clamp sums exceeding signed64; only the final independent total is bounded.
  return integer(total);
}
