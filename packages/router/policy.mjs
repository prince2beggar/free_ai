import { AppError } from '../api/errors.mjs';
import { costMicroCu, integer } from '../ledger/arithmetic.mjs';
import { prepareContext } from './context.mjs';

const capabilities = ['text', 'code', 'tools', 'long_context', 'bangla', 'english'];
const modes = ['auto', 'manual', 'free-only', 'pinned'];
const rankFields = ['cost', 'quality', 'latency'];
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const classPattern = /^[a-z][a-z0-9_-]{0,39}$/;
const ratePattern = /^[0-9]{1,12}(\.[0-9]{1,6})?$/;
const fail = (code, message) => {
  throw new AppError(400, code, message);
};
const identifier = (value) => typeof value === 'string' && idPattern.test(value);
const modelClass = (value) =>
  typeof value === 'string' && classPattern.test(value) && value !== 'unknown';
const list = (value, allowed, maximum, nonempty = false) =>
  Array.isArray(value) &&
  (!nonempty || value.length > 0) &&
  value.length <= maximum &&
  new Set(value).size === value.length &&
  value.every((item) => allowed.includes(item));
const score = (value) => Number.isInteger(value) && value >= 0 && value <= 100;

function validatePolicy(policy) {
  if (
    !policy ||
    typeof policy !== 'object' ||
    Array.isArray(policy) ||
    !identifier(policy.id) ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 1 ||
    !modes.includes(policy.mode) ||
    !Array.isArray(policy.modelClasses) ||
    policy.modelClasses.length === 0 ||
    policy.modelClasses.length > 16 ||
    !policy.modelClasses.every(modelClass) ||
    !list(policy.requiredCapabilities, capabilities, capabilities.length) ||
    !list(policy.ranking, rankFields, rankFields.length, true) ||
    typeof policy.allowPaid !== 'boolean' ||
    !(
      policy.minQualityScore === undefined ||
      policy.minQualityScore === null ||
      score(policy.minQualityScore)
    ) ||
    (['manual', 'pinned'].includes(policy.mode) && !identifier(policy.modelId)) ||
    !policy.presets ||
    typeof policy.presets !== 'object' ||
    Array.isArray(policy.presets)
  )
    fail('INVALID_ROUTING_POLICY', 'Invalid trusted routing policy.');
  for (const name of ['general', 'coding', 'writing', 'research']) {
    const preset = policy.presets[name];
    if (
      !preset ||
      typeof preset !== 'object' ||
      Array.isArray(preset) ||
      !list(preset.requiredCapabilities, capabilities, capabilities.length) ||
      !(
        preset.modelClass === undefined ||
        (modelClass(preset.modelClass) && policy.modelClasses.includes(preset.modelClass))
      ) ||
      !(
        preset.ranking === undefined || list(preset.ranking, rankFields, rankFields.length, true)
      ) ||
      !(
        preset.minQualityScore === undefined ||
        preset.minQualityScore === null ||
        score(preset.minQualityScore)
      )
    )
      fail('INVALID_ROUTING_POLICY', 'Invalid trusted routing preset.');
  }
  for (const name of ['translation', 'summary']) {
    const preset = policy.presets[name];
    if (preset !== undefined) {
      if (
        !preset ||
        typeof preset !== 'object' ||
        Array.isArray(preset) ||
        !list(preset.requiredCapabilities, capabilities, capabilities.length) ||
        !(
          preset.modelClass === undefined ||
          (modelClass(preset.modelClass) && policy.modelClasses.includes(preset.modelClass))
        ) ||
        !(
          preset.ranking === undefined || list(preset.ranking, rankFields, rankFields.length, true)
        ) ||
        !(
          preset.minQualityScore === undefined ||
          preset.minQualityScore === null ||
          score(preset.minQualityScore)
        )
      )
        fail('INVALID_ROUTING_POLICY', 'Invalid trusted routing preset.');
    }
  }
}

export function resolveRoutingSelection(policy, overrides = {}) {
  validatePolicy(policy);
  if (
    !overrides ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides) ||
    Object.keys(overrides).some(
      (key) =>
        ![
          'mode',
          'modelId',
          'preset',
          'requiredCapabilities',
          'modelClass',
          'language',
          'sensitivity',
          'privateMode',
          'productivity',
        ].includes(key),
    ) ||
    !(overrides.mode === undefined || modes.includes(overrides.mode)) ||
    !(overrides.modelId === undefined || identifier(overrides.modelId)) ||
    !(
      overrides.preset === undefined ||
      ['general', 'coding', 'writing', 'research', 'translation', 'summary'].includes(
        overrides.preset,
      )
    ) ||
    !(overrides.language === undefined || ['en', 'bn'].includes(overrides.language)) ||
    !(
      overrides.modelClass === undefined ||
      (modelClass(overrides.modelClass) && policy.modelClasses.includes(overrides.modelClass))
    ) ||
    !(
      overrides.requiredCapabilities === undefined ||
      list(overrides.requiredCapabilities, capabilities, capabilities.length)
    ) ||
    !(
      overrides.productivity === undefined ||
      (typeof overrides.productivity === 'object' &&
        overrides.productivity !== null &&
        !Array.isArray(overrides.productivity))
    ) ||
    !(
      overrides.sensitivity === undefined || ['standard', 'private'].includes(overrides.sensitivity)
    ) ||
    !(overrides.privateMode === undefined || typeof overrides.privateMode === 'boolean')
  )
    fail('INVALID_ROUTING_SELECTION', 'Invalid request model or task selection.');
  if (
    policy.mode === 'pinned' &&
    ((overrides.modelId !== undefined && overrides.modelId !== policy.modelId) ||
      (overrides.mode !== undefined && overrides.mode !== 'pinned'))
  )
    fail('PINNED_MODEL_REQUIRED', 'This policy requires its pinned model.');
  const mode =
    policy.mode === 'pinned'
      ? 'pinned'
      : (overrides.mode ?? (overrides.modelId !== undefined ? 'manual' : policy.mode));
  const selectedModel = overrides.modelId ?? policy.modelId ?? null;
  if (['manual', 'pinned'].includes(mode) && !identifier(selectedModel))
    fail('INVALID_ROUTING_SELECTION', 'Explicit model selection requires a model.');
  const presetName = overrides.preset ?? 'general';
  const preset = policy.presets[presetName] ?? {
    requiredCapabilities: ['text'],
    ranking: ['quality', 'cost'],
  };
  const language = overrides.language ?? 'en';
  const requiredCapabilities = [
    ...new Set([
      ...policy.requiredCapabilities,
      ...preset.requiredCapabilities,
      ...(overrides.requiredCapabilities ?? []),
      language === 'bn' ? 'bangla' : 'english',
    ]),
  ];
  const minimums = [policy.minQualityScore, preset.minQualityScore].filter((value) => score(value));
  const isPrivate =
    overrides.sensitivity === 'private' ||
    overrides.privateMode === true ||
    policy.sensitivity === 'private' ||
    policy.privateMode === true;
  const sensitivity = isPrivate
    ? 'private'
    : (overrides.sensitivity ?? policy.sensitivity ?? 'standard');
  return {
    mode,
    modelId: ['manual', 'pinned'].includes(mode) ? selectedModel : null,
    preset: presetName,
    language,
    requiredCapabilities,
    modelClass: overrides.modelClass ?? preset.modelClass ?? null,
    modelClasses: [...policy.modelClasses],
    ranking: [...(preset.ranking ?? policy.ranking)],
    minQualityScore: minimums.length > 0 ? Math.max(...minimums) : null,
    allowPaid: policy.allowPaid,
    freeOnly: policy.mode === 'free-only' || mode === 'free-only',
    sensitivity,
    privateMode: isPrivate,
    productivity: overrides.productivity ?? null,
  };
}

function providerEligible(provider) {
  return (
    provider?.status === 'enabled' &&
    provider.adapterKind === 'synthetic_mock' &&
    provider.allowsMultiuser === true &&
    provider.ownerApproved === true &&
    provider.quotaConfirmed === true &&
    typeof provider.termsUrl === 'string' &&
    provider.termsUrl.startsWith('https://') &&
    typeof provider.termsReviewedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(provider.termsReviewedAt) &&
    ['synthetic_only', 'no_training', 'may_train'].includes(provider.dataPolicy) &&
    (provider.baseUrl === undefined || provider.baseUrl === null) &&
    (provider.secretRef === undefined || provider.secretRef === null)
  );
}
function quality(model, selection) {
  if (model.qualityKind !== 'synthetic_fixture') return null;
  const relevant = [];
  if (selection.requiredCapabilities.includes('code')) relevant.push(model.codingScore);
  if (selection.language === 'bn') relevant.push(model.banglaScore);
  // No English/general quality field exists in the registry. Do not invent one.
  return relevant.length > 0 && relevant.every(score) ? Math.min(...relevant) : null;
}
function compareUnknown(left, right, descending = false) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}

export function rankRoutingCandidates({
  providers,
  models,
  policy,
  selection: requestedSelection,
  messages,
  systemPrompt = '',
  maxOutputTokens,
  contextAction = 'refuse',
  warningRatio = 0.9,
  fundedBalanceMicroCu = '0',
  latencyByModel = {},
}) {
  validatePolicy(policy);
  if (
    !Array.isArray(providers) ||
    !Array.isArray(models) ||
    providers.some((provider) => !provider || !identifier(provider.id)) ||
    !requestedSelection ||
    !modes.includes(requestedSelection.mode) ||
    !list(requestedSelection.requiredCapabilities, capabilities, capabilities.length) ||
    !['en', 'bn'].includes(requestedSelection.language) ||
    !latencyByModel ||
    typeof latencyByModel !== 'object' ||
    Array.isArray(latencyByModel)
  )
    fail('INVALID_ROUTING_SELECTION', 'Invalid routing inputs.');
  // Reapply trusted policy constraints even when the caller constructs selection
  // directly: derived allowPaid, freeOnly, ranking and quality bars are not overrides.
  const selection = resolveRoutingSelection(policy, {
    mode: requestedSelection.mode,
    modelId: requestedSelection.modelId ?? undefined,
    preset: requestedSelection.preset,
    language: requestedSelection.language,
    requiredCapabilities: requestedSelection.requiredCapabilities,
    modelClass: requestedSelection.modelClass ?? undefined,
    sensitivity: requestedSelection.sensitivity ?? undefined,
    privateMode: requestedSelection.privateMode ?? undefined,
  });
  let balance;
  try {
    balance = integer(fundedBalanceMicroCu);
  } catch {
    fail('INVALID_ROUTING_SELECTION', 'Invalid funded accounting balance.');
  }
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const candidates = [];
  const rejected = [];
  function reject(model, reason) {
    rejected.push({ modelId: model?.id ?? null, reason });
  }
  for (const model of models) {
    const provider = providerMap.get(model?.providerId);
    let reason;
    if (!model || !identifier(model.id) || model.status !== 'enabled') reason = 'MODEL_DISABLED';
    else if (!providerEligible(provider)) reason = 'PROVIDER_INELIGIBLE';
    else if (['manual', 'pinned'].includes(selection.mode) && model.id !== selection.modelId)
      reason = 'MODEL_NOT_SELECTED';
    else if (
      !policy.modelClasses.includes(model.modelClass) ||
      (selection.modelClass !== null && model.modelClass !== selection.modelClass)
    )
      reason = 'MODEL_CLASS_UNAVAILABLE';
    else if (
      !list(model.capabilities, capabilities, capabilities.length, true) ||
      selection.requiredCapabilities.some((capability) => !model.capabilities.includes(capability))
    )
      reason = 'CAPABILITY_UNAVAILABLE';
    else if (
      model.ratesVerified !== true ||
      typeof model.cuInputRate !== 'string' ||
      !ratePattern.test(model.cuInputRate) ||
      typeof model.cuOutputRate !== 'string' ||
      !ratePattern.test(model.cuOutputRate) ||
      typeof model.freeFlag !== 'boolean'
    )
      reason = 'MODEL_RATES_UNKNOWN';
    else if (
      (selection.sensitivity === 'private' || selection.privateMode === true) &&
      provider?.dataPolicy === 'may_train'
    )
      reason = 'TRAINING_POLICY_FORBIDDEN';
    else if (
      !model.freeFlag &&
      (!policy.allowPaid || selection.freeOnly || policy.mode === 'free-only' || balance === 0n)
    )
      reason = 'PAID_ROUTE_FORBIDDEN';
    if (reason) {
      reject(model, reason);
      continue;
    }
    const context = prepareContext({
      messages,
      systemPrompt,
      model,
      maxOutputTokens,
      action: contextAction,
      warningRatio,
    });
    if (!context.ok) {
      reject(model, context.code);
      continue;
    }
    let cost;
    try {
      cost = costMicroCu({
        inputTokens: String(context.inputTokens),
        outputTokens: String(context.reservedOutputTokens),
        cuInputRate: model.cuInputRate,
        cuOutputRate: model.cuOutputRate,
      });
    } catch {
      reject(model, 'MODEL_RATES_UNKNOWN');
      continue;
    }
    if (cost > balance) {
      reject(model, 'INSUFFICIENT_FUNDS');
      continue;
    }
    const qualityScore = quality(model, selection);
    if (
      selection.minQualityScore !== null &&
      (qualityScore === null || qualityScore < selection.minQualityScore)
    ) {
      reject(model, 'QUALITY_UNVERIFIED');
      continue;
    }
    const observedLatency = latencyByModel[model.id];
    const latencyMs =
      typeof observedLatency === 'number' &&
      Number.isFinite(observedLatency) &&
      observedLatency >= 0
        ? observedLatency
        : null;
    candidates.push({
      model,
      provider,
      context,
      estimatedCostMicroCu: cost.toString(),
      qualityScore,
      latencyMs,
    });
  }
  candidates.sort((left, right) => {
    if (left.model.freeFlag !== right.model.freeFlag) return left.model.freeFlag ? -1 : 1;
    for (const field of selection.ranking) {
      let comparison;
      if (field === 'cost') {
        const a = BigInt(left.estimatedCostMicroCu);
        const b = BigInt(right.estimatedCostMicroCu);
        comparison = a < b ? -1 : a > b ? 1 : 0;
      } else if (field === 'quality') {
        comparison = compareUnknown(left.qualityScore, right.qualityScore, true);
      } else {
        comparison = compareUnknown(left.latencyMs, right.latencyMs);
      }
      if (comparison !== 0) return comparison;
    }
    return left.model.id < right.model.id ? -1 : left.model.id > right.model.id ? 1 : 0;
  });
  const trainingNoticeRequired = candidates.some(
    (c) => c.model.freeFlag && c.provider.dataPolicy === 'may_train',
  );
  return { candidates, rejected, trainingNoticeRequired };
}
