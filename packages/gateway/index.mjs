import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../api/errors.mjs';

export function estimateSyntheticTokens(text) {
  // A conservative character count for diagnostics, never provider-reported token usage.
  return Array.from(text).length;
}

export function createSyntheticGateway({ providerId, modelId, replies, chunkChars, chunkDelayMs }) {
  if (
    typeof providerId !== 'string' ||
    typeof modelId !== 'string' ||
    typeof replies?.en !== 'string' ||
    typeof replies?.bn !== 'string' ||
    !Number.isInteger(chunkChars) ||
    chunkChars < 1 ||
    !Number.isInteger(chunkDelayMs) ||
    chunkDelayMs < 0
  ) {
    throw new Error('Invalid synthetic gateway configuration.');
  }
  return {
    providerId,
    modelId,
    synthetic: true,
    health() {
      return { status: 'ok', mode: 'synthetic_mock', externalCallsEnabled: false, retries: 0 };
    },
    async *stream({ messages, language, maxOutputTokens, signal, modelId: requestedModel }) {
      if (requestedModel !== modelId)
        throw new AppError(
          400,
          'MODEL_UNAVAILABLE',
          'Only the configured synthetic model is available.',
        );
      if (
        !['en', 'bn'].includes(language) ||
        !Array.isArray(messages) ||
        messages.some(
          (message) =>
            !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string',
        )
      ) {
        throw new AppError(400, 'INVALID_REQUEST', 'Invalid synthetic gateway input.');
      }
      const characters = Array.from(replies[language]).slice(0, maxOutputTokens);
      for (let index = 0; index < characters.length; index += chunkChars) {
        signal?.throwIfAborted();
        if (chunkDelayMs > 0) await delay(chunkDelayMs, undefined, { signal });
        yield { text: characters.slice(index, index + chunkChars).join('') };
      }
    },
  };
}

export function createRealGateway() {
  throw new AppError(
    503,
    'PROVIDER_DISABLED',
    'Real providers require a separately completed authorization scope.',
  );
}

export { createUniversalFreeGateway } from './free_providers.mjs';
export {
  createKeyPoolService,
  maskApiKey,
  detectProviderFromKey,
  verifyKeyConnection,
} from './key_pool.mjs';
