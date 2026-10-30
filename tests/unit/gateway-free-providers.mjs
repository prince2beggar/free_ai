import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUniversalFreeGateway } from '../../packages/gateway/free_providers.mjs';

test('Universal Free Gateway: Initialization and health reporting with zero keys', async () => {
  const gateway = createUniversalFreeGateway({
    githubToken: null,
    groqApiKey: null,
    geminiApiKey: null,
    replies: {
      en: 'Synthetic test fallback response.',
      bn: 'সিন্থেটিক টেস্ট উত্তর।',
    },
    chunkChars: 10,
    chunkDelayMs: 0,
  });

  assert.equal(gateway.synthetic, true);
  assert.equal(gateway.isUniversal, true);

  const health = gateway.health();
  assert.equal(health.status, 'ok');
  assert.equal(health.mode, 'universal_free_pool');
  assert.equal(health.configuredProviders.github, false);
  assert.equal(health.configuredProviders.groq, false);
  assert.equal(health.configuredProviders.gemini, false);
});

test('Universal Free Gateway: Graceful streaming fallback when no external keys set', async () => {
  const gateway = createUniversalFreeGateway({
    githubToken: null,
    groqApiKey: null,
    geminiApiKey: null,
    replies: {
      en: 'Sample response text for testing.',
      bn: 'নমুনা উত্তর।',
    },
    chunkChars: 8,
    chunkDelayMs: 0,
  });

  let fullText = '';
  for await (const chunk of gateway.stream({
    messages: [{ role: 'user', content: 'Hello AI' }],
    language: 'en',
    maxOutputTokens: 100,
  })) {
    fullText += chunk.text;
  }

  assert.equal(fullText, 'Sample response text for testing.');
});

test('Universal Free Gateway: Health reporting when keys are configured', async () => {
  const gateway = createUniversalFreeGateway({
    githubToken: 'ghp_synthetic_test_token',
    groqApiKey: 'gsk_synthetic_test_key',
    geminiApiKey: 'AIza_synthetic_test_key',
  });

  const health = gateway.health();
  assert.equal(health.status, 'ok');
  assert.equal(health.configuredProviders.github, true);
  assert.equal(health.configuredProviders.groq, true);
  assert.equal(health.configuredProviders.gemini, true);
});
