import test from 'node:test';
import assert from 'node:assert/strict';
import { countSyntheticContextTokens, prepareContext } from '../../packages/router/context.mjs';
import { resolveRoutingSelection, rankRoutingCandidates } from '../../packages/router/policy.mjs';

const provider = (id = 'synthetic-provider', patch = {}) => ({
  id,
  adapterKind: 'synthetic_mock',
  status: 'enabled',
  termsUrl: 'https://example.invalid/synthetic-terms',
  termsReviewedAt: '2026-10-12',
  allowsMultiuser: true,
  ownerApproved: true,
  quotaConfirmed: true,
  dataPolicy: 'synthetic_only',
  ...patch,
});
const model = (id = 'synthetic-model', patch = {}) => ({
  id,
  providerId: 'synthetic-provider',
  status: 'enabled',
  capabilities: ['text', 'english', 'bangla', 'code'],
  modelClass: 'synthetic',
  contextVerified: true,
  contextLimit: 4096,
  cuInputRate: '0',
  cuOutputRate: '0',
  ratesVerified: true,
  freeFlag: true,
  qualityKind: 'unknown',
  banglaScore: null,
  codingScore: null,
  ...patch,
});
const policy = (patch = {}) => ({
  id: 'synthetic-policy',
  version: 1,
  mode: 'auto',
  modelClasses: ['synthetic'],
  requiredCapabilities: ['text'],
  allowPaid: true,
  ranking: ['quality', 'latency', 'cost'],
  presets: {
    general: { requiredCapabilities: [] },
    coding: { requiredCapabilities: ['code'], ranking: ['quality', 'cost', 'latency'] },
    writing: { requiredCapabilities: ['text'], ranking: ['latency', 'quality', 'cost'] },
    research: { requiredCapabilities: ['long_context'] },
  },
  ...patch,
});
const messages = [{ role: 'user', content: 'current' }];
function rank(options = {}) {
  const activePolicy = options.policy ?? policy();
  return rankRoutingCandidates({
    providers: [provider()],
    models: [model()],
    policy: activePolicy,
    selection: resolveRoutingSelection(activePolicy, { language: 'en', ...options.overrides }),
    messages,
    systemPrompt: '',
    maxOutputTokens: 8,
    contextAction: 'refuse',
    fundedBalanceMicroCu: '0',
    latencyByModel: {},
    ...options,
  });
}

test('synthetic context count includes system, every turn and Unicode codepoints exactly', () => {
  const history = [
    { role: 'user', content: 'বাংলা🙂' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'x' },
  ];
  const expected = Array.from('sysবাংলা🙂okx').length;
  assert.equal(countSyntheticContextTokens({ messages: history, systemPrompt: 'sys' }), expected);
  const result = prepareContext({
    messages: history,
    systemPrompt: 'sys',
    model: model('bounded', { contextLimit: expected + 5 }),
    maxOutputTokens: 5,
    warningRatio: 0.8,
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalTokens, result.contextLimit);
  assert.deepEqual(result.warnings, ['CONTEXT_NEAR_LIMIT']);
  assert.equal(result.tokenCountKind, 'synthetic_codepoint');
});

test('unknown, zero, unverified and non-synthetic context metadata never become a wildcard', () => {
  for (const patch of [
    { contextLimit: null },
    { contextLimit: 0 },
    { contextVerified: false },
    { modelClass: 'unknown' },
  ]) {
    assert.equal(
      prepareContext({ messages, model: model('bad', patch), maxOutputTokens: 8 }).code,
      'CONTEXT_UNVERIFIED',
    );
  }
});

test('overflow refuses until explicit trim and protects the newest user plus later output', () => {
  const history = [
    { role: 'user', content: 'old'.repeat(10) },
    { role: 'assistant', content: 'reply'.repeat(5) },
    { role: 'user', content: 'next' },
    { role: 'assistant', content: 'answer' },
    { role: 'user', content: 'newest' },
    { role: 'assistant', content: 'partial' },
  ];
  const input = {
    messages: history,
    systemPrompt: 'SYS',
    model: model('bounded', { contextLimit: 25 }),
    maxOutputTokens: 8,
  };
  const refused = prepareContext(input);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'CONTEXT_ACTION_REQUIRED');
  assert.equal(refused.messages.length, history.length);
  const trimmed = prepareContext({ ...input, action: 'trim' });
  assert.equal(trimmed.ok, true);
  assert.equal(trimmed.removedMessages, 4);
  assert.deepEqual(trimmed.messages, history.slice(4));
  assert.equal(trimmed.totalTokens, 24);
  assert.ok(trimmed.totalTokens <= trimmed.contextLimit);
  assert.equal(history.length, 6);
  assert.deepEqual(
    prepareContext({ ...input, action: 'trim', model: model('tiny', { contextLimit: 23 }) }).code,
    'CONTEXT_CURRENT_TURN_TOO_LARGE',
  );
});

test('trim preserves complete retained turn order and never silently summarizes', () => {
  const history = [
    { role: 'user', content: 'a'.repeat(30) },
    { role: 'assistant', content: 'old' },
    { role: 'user', content: 'keep' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'current' },
  ];
  const input = {
    messages: history,
    model: model('short', { contextLimit: 20 }),
    maxOutputTokens: 4,
  };
  assert.deepEqual(prepareContext({ ...input, action: 'trim' }).messages, history.slice(2));
  assert.equal(prepareContext({ ...input, action: 'summarize' }).code, 'SUMMARY_UNAVAILABLE');
  assert.throws(() => prepareContext({ ...input, action: 'unknown' }), { code: 'INVALID_CONTEXT' });
  assert.throws(() => countSyntheticContextTokens({ messages: [] }), { code: 'INVALID_CONTEXT' });
});

test('per-request presets and explicit model choice merge trusted task requirements', () => {
  const selected = resolveRoutingSelection(policy(), {
    modelId: 'coding-model',
    preset: 'coding',
    language: 'bn',
    requiredCapabilities: ['tools'],
  });
  assert.equal(selected.mode, 'manual');
  assert.equal(selected.modelId, 'coding-model');
  assert.deepEqual(selected.requiredCapabilities, ['text', 'code', 'tools', 'bangla']);
  assert.deepEqual(selected.ranking, ['quality', 'cost', 'latency']);
  assert.throws(() => resolveRoutingSelection(policy(), { preset: 'invented' }), {
    code: 'INVALID_ROUTING_SELECTION',
  });
  assert.throws(() => resolveRoutingSelection(policy(), { mode: 'manual' }), {
    code: 'INVALID_ROUTING_SELECTION',
  });
});

test('capability, class, context and exact verified rate filters reject unsafe candidates', () => {
  const invalid = [
    model('no-language', { capabilities: ['text'] }),
    model('no-text', { capabilities: ['english'] }),
    model('unknown-class', { modelClass: 'unknown' }),
    model('unknown-context', { contextLimit: null }),
    model('zero-context', { contextLimit: 0 }),
    model('unverified-context', { contextVerified: false }),
    model('unknown-rates', { ratesVerified: false }),
    model('source-price', { cuInputRate: null, observations: { input_per_1m: '0' } }),
    model('float-rate', { cuOutputRate: 0.1 }),
    model('missing-context-room', { contextLimit: 10 }),
  ];
  const result = rank({ models: [model('safe'), ...invalid] });
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.model.id),
    ['safe'],
  );
  assert.equal(result.rejected.length, invalid.length);
  assert.equal(
    result.rejected.find((entry) => entry.modelId === 'unknown-context').reason,
    'CONTEXT_UNVERIFIED',
  );
  assert.equal(
    result.rejected.find((entry) => entry.modelId === 'source-price').reason,
    'MODEL_RATES_UNKNOWN',
  );
  assert.equal(
    result.rejected.find((entry) => entry.modelId === 'missing-context-room').reason,
    'CONTEXT_ACTION_REQUIRED',
  );
});

test('provider eligibility and external transport remain fail-closed in local routing', () => {
  for (const patch of [
    { status: 'disabled' },
    { allowsMultiuser: false },
    { ownerApproved: false },
    { quotaConfirmed: false },
    { termsUrl: null },
    { termsReviewedAt: null },
    { dataPolicy: 'unknown' },
    { adapterKind: 'external' },
  ]) {
    const result = rank({ providers: [provider('synthetic-provider', patch)] });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.rejected.length, 1);
  }
  assert.equal(rank({ providers: [] }).candidates.length, 0);
});

test('manual, pinned and free-only cannot use an incompatible or forbidden fallback', () => {
  const models = [model('free'), model('paid', { freeFlag: false, cuInputRate: '1' })];
  assert.deepEqual(
    rank({ models, overrides: { modelId: 'paid' }, fundedBalanceMicroCu: '1000' }).candidates.map(
      (entry) => entry.model.id,
    ),
    ['paid'],
  );
  assert.equal(rank({ models, overrides: { modelId: 'paid' } }).candidates.length, 0);
  assert.deepEqual(
    rank({ models, overrides: { mode: 'free-only' }, fundedBalanceMicroCu: '1000' }).candidates.map(
      (entry) => entry.model.id,
    ),
    ['free'],
  );
  const pinnedPolicy = policy({ mode: 'pinned', modelId: 'free' });
  assert.throws(() => resolveRoutingSelection(pinnedPolicy, { modelId: 'paid' }), {
    code: 'PINNED_MODEL_REQUIRED',
  });
  assert.deepEqual(
    rank({ models, policy: pinnedPolicy }).candidates.map((entry) => entry.model.id),
    ['free'],
  );
  assert.equal(rank({ models, overrides: { preset: 'research' } }).candidates.length, 0);
});

test('auto always prefers eligible free models and positive-cost routes require exact funding', () => {
  const models = [
    model('paid', {
      freeFlag: false,
      cuInputRate: '0.01',
      qualityKind: 'synthetic_fixture',
      banglaScore: 100,
    }),
    model('free'),
  ];
  assert.equal(
    rank({ models, fundedBalanceMicroCu: '2', overrides: { language: 'bn' } }).candidates[0].model
      .id,
    'free',
  );
  const exact = rank({ models: [models[0]], fundedBalanceMicroCu: '1' });
  assert.equal(exact.candidates[0].estimatedCostMicroCu, '1');
  assert.equal(rank({ models: [model('priced-free', { cuInputRate: '1' })] }).candidates.length, 0);
  assert.equal(rank({ models: [model('zero-paid', { freeFlag: false })] }).candidates.length, 0);
});

test('quality ranking only uses labeled synthetic scores and unknown latency stays unknown', () => {
  const models = [
    model('fake-score', { qualityKind: 'unknown', codingScore: 100 }),
    model('verified-low', { qualityKind: 'synthetic_fixture', codingScore: 60 }),
    model('verified-high', { qualityKind: 'synthetic_fixture', codingScore: 90 }),
    model('unknown'),
  ];
  const result = rank({
    models,
    overrides: { preset: 'coding' },
    latencyByModel: { unknown: 1, 'verified-high': 10 },
  });
  assert.deepEqual(
    result.candidates.map((entry) => entry.model.id),
    ['verified-high', 'verified-low', 'unknown', 'fake-score'],
  );
  assert.equal(
    result.candidates.find((entry) => entry.model.id === 'fake-score').qualityScore,
    null,
  );
  assert.equal(
    result.candidates.find((entry) => entry.model.id === 'verified-low').latencyMs,
    null,
  );
  assert.deepEqual(
    rank({
      models,
      overrides: { preset: 'coding' },
      policy: policy({ minQualityScore: 70 }),
    }).candidates.map((entry) => entry.model.id),
    ['verified-high'],
  );
});

test('stable tie ordering and exact decimal costs survive shuffled registry input', () => {
  const models = [model('z'), model('a'), model('m')];
  const ordered = ['a', 'm', 'z'];
  assert.deepEqual(
    rank({ models }).candidates.map((entry) => entry.model.id),
    ordered,
  );
  assert.deepEqual(
    rank({ models: [...models].reverse() }).candidates.map((entry) => entry.model.id),
    ordered,
  );
  const priced = [
    model('large', { cuInputRate: '999999999999.999999', freeFlag: false }),
    model('small', { cuInputRate: '999999999999.999998', freeFlag: false }),
  ];
  assert.deepEqual(
    rank({
      models: priced,
      policy: policy({ ranking: ['cost'] }),
      fundedBalanceMicroCu: '9223372036854775807',
      messages: [{ role: 'user', content: 'a'.repeat(100000) }],
    }).candidates.map((entry) => entry.model.id),
    [],
  );
  for (const item of priced) item.contextLimit = 100100;
  const result = rank({
    models: priced,
    policy: policy({ ranking: ['cost'] }),
    fundedBalanceMicroCu: '9223372036854775807',
    messages: [{ role: 'user', content: 'a'.repeat(100000) }],
  });
  assert.deepEqual(
    result.candidates.map((entry) => entry.model.id),
    ['small', 'large'],
  );
  assert.equal(result.candidates[0].estimatedCostMicroCu, '999999999999999998');
});

test('policy and per-request requirements reject unknown class wildcards and invalid overrides', () => {
  assert.throws(() => resolveRoutingSelection(policy({ modelClasses: [] }), {}), {
    code: 'INVALID_ROUTING_POLICY',
  });
  assert.throws(() => resolveRoutingSelection(policy({ modelClasses: ['unknown'] }), {}), {
    code: 'INVALID_ROUTING_POLICY',
  });
  assert.throws(() => resolveRoutingSelection(policy(), { modelClass: 'unknown' }), {
    code: 'INVALID_ROUTING_SELECTION',
  });
  assert.throws(() => resolveRoutingSelection(policy(), { requiredCapabilities: ['invented'] }), {
    code: 'INVALID_ROUTING_SELECTION',
  });
  assert.throws(() => resolveRoutingSelection(policy(), { allowPaid: true }), {
    code: 'INVALID_ROUTING_SELECTION',
  });
});

test('direct selection cannot bypass pinned, free-only, capability or verified quality policy', () => {
  const baseSelection = resolveRoutingSelection(policy(), { language: 'en' });
  assert.throws(
    () => rank({ policy: policy({ mode: 'pinned', modelId: 'chosen' }), selection: baseSelection }),
    { code: 'PINNED_MODEL_REQUIRED' },
  );
  assert.equal(
    rank({
      policy: policy({ mode: 'free-only' }),
      selection: { ...baseSelection, freeOnly: false, allowPaid: true },
      models: [model('paid', { freeFlag: false })],
      fundedBalanceMicroCu: '1000',
    }).candidates.length,
    0,
  );
  assert.equal(
    rank({
      policy: policy({ requiredCapabilities: ['text', 'tools'] }),
      selection: { ...baseSelection, requiredCapabilities: [] },
    }).candidates.length,
    0,
  );
  assert.equal(
    rank({
      policy: policy({ minQualityScore: 70 }),
      selection: { ...baseSelection, minQualityScore: null },
    }).candidates.length,
    0,
  );
  assert.throws(() => rank({ fundedBalanceMicroCu: 'invalid' }), {
    code: 'INVALID_ROUTING_SELECTION',
  });
  assert.throws(() => rank({ latencyByModel: null }), { code: 'INVALID_ROUTING_SELECTION' });
});
