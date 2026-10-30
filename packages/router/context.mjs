import { AppError } from '../api/errors.mjs';
import { estimateSyntheticTokens } from '../gateway/index.mjs';

const invalid = () => {
  throw new AppError(400, 'INVALID_CONTEXT', 'Invalid synthetic conversation context.');
};
function validateMessages(messages, systemPrompt) {
  if (
    typeof systemPrompt !== 'string' ||
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages[0]?.role !== 'user' ||
    messages.some(
      (message) =>
        !message ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string',
    )
  )
    invalid();
}

export function countSyntheticContextTokens({ messages, systemPrompt = '' }) {
  validateMessages(messages, systemPrompt);
  // Exact codepoint convention shared with the local synthetic Gateway. This is not
  // a real model tokenizer: no external adapter can use this as overflow evidence.
  const tokens = messages.reduce(
    (total, message) => total + estimateSyntheticTokens(message.content),
    estimateSyntheticTokens(systemPrompt),
  );
  if (!Number.isSafeInteger(tokens)) invalid();
  return tokens;
}

export function prepareContext({
  messages,
  systemPrompt = '',
  model,
  maxOutputTokens,
  action = 'refuse',
  warningRatio = 0.9,
}) {
  validateMessages(messages, systemPrompt);
  if (
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    !['refuse', 'trim', 'summarize'].includes(action) ||
    typeof warningRatio !== 'number' ||
    !Number.isFinite(warningRatio) ||
    warningRatio <= 0 ||
    warningRatio > 1
  )
    invalid();
  const original = messages.map(({ role, content }) => ({ role, content }));
  const inputTokens = countSyntheticContextTokens({ messages: original, systemPrompt });
  const totalTokens = inputTokens + maxOutputTokens;
  if (!Number.isSafeInteger(totalTokens)) invalid();
  const base = {
    ok: false,
    messages: original,
    inputTokens,
    reservedOutputTokens: maxOutputTokens,
    totalTokens,
    contextLimit: model?.contextLimit ?? null,
    removedMessages: 0,
    warnings: [],
    tokenCountKind: 'synthetic_codepoint',
    synthetic: true,
  };
  if (
    model?.modelClass !== 'synthetic' ||
    model?.contextVerified !== true ||
    !Number.isSafeInteger(model.contextLimit) ||
    model.contextLimit <= 0
  )
    return { ...base, code: 'CONTEXT_UNVERIFIED' };

  function bounded(retained, removedMessages) {
    const input = countSyntheticContextTokens({ messages: retained, systemPrompt });
    const total = input + maxOutputTokens;
    const warnings = removedMessages > 0 ? ['CONTEXT_TRIMMED'] : [];
    if (total >= model.contextLimit * warningRatio) warnings.push('CONTEXT_NEAR_LIMIT');
    return {
      ...base,
      ok: true,
      messages: retained,
      inputTokens: input,
      totalTokens: total,
      removedMessages,
      warnings,
    };
  }
  if (totalTokens <= model.contextLimit) return bounded(original, 0);
  if (action === 'refuse')
    return { ...base, code: 'CONTEXT_ACTION_REQUIRED', warnings: ['CONTEXT_LIMIT_EXCEEDED'] };
  // Summaries require separately approved quality/provenance. A local omission of
  // old turns is never presented as an AI-generated or meaning-preserving summary.
  if (action === 'summarize') return { ...base, code: 'SUMMARY_UNAVAILABLE' };

  const userTurns = original.flatMap((message, index) => (message.role === 'user' ? [index] : []));
  let removedMessages = 0;
  let retainedTokens = inputTokens;
  for (const nextUser of userTurns.slice(1)) {
    for (let index = removedMessages; index < nextUser; index++) {
      retainedTokens -= estimateSyntheticTokens(original[index].content);
    }
    removedMessages = nextUser;
    if (retainedTokens + maxOutputTokens <= model.contextLimit)
      return bounded(original.slice(removedMessages), removedMessages);
  }
  return {
    ...base,
    code: 'CONTEXT_CURRENT_TURN_TOO_LARGE',
    warnings: ['CONTEXT_LIMIT_EXCEEDED'],
  };
}
