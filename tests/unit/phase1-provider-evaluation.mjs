import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createGroqEvaluation,
  scopeHash,
  validateEvaluationScope,
} from '../../packages/gateway/groq-evaluation.mjs';

const suiteRaw = await readFile(new URL('../eval/suite.json', import.meta.url), 'utf8');
const cases = JSON.parse(suiteRaw).cases;
const suiteHash = createHash('sha256').update(suiteRaw).digest('hex');
function scopeAt(now = Date.now()) {
  return {
    version: 1,
    scopeId: 'synthetic-provider-test',
    ownerApproved: true,
    providerId: 'groq',
    modelId: 'synthetic-exact-model',
    environment: 'local',
    keyEnvName: 'SYNTHETIC_TEST_KEY',
    expiresAt: new Date(now + 3600000 + 6 * 3600000).toISOString().replace('Z', '+06:00'),
    caps: {
      maxCalls: 2,
      maxInputTokens: 100,
      maxOutputTokens: 32,
      maxSpendBdt: 0,
      noRetries: true,
      noFallbacks: true,
    },
    evidence: {
      termsUrl: 'https://console.groq.com/docs/legal/services-agreement',
      checkedDate: new Date(now + 6 * 3600000).toISOString().slice(0, 10),
      eligibilityVerified: true,
      freeOnlyVerified: true,
      noOverageVerified: true,
      freeOnlyDetails: 'Synthetic account evidence for contract tests only',
    },
    accountLimits: { rpm: 60000, tpm: 1000000000, dailyRemaining: 2, dedicatedTestAccount: true },
    tokenization: {
      verified: true,
      modelId: 'synthetic-exact-model',
      suiteSha256: suiteHash,
      evidence: 'Synthetic token-count fixture, not real tokenizer evidence',
      inputTokensByCase: Object.fromEntries(cases.map((item) => [item.id, 40])),
    },
  };
}
function response(changes = {}, headers = {}) {
  return Response.json(
    {
      model: 'synthetic-exact-model',
      id: 'synthetic-request',
      choices: [
        {
          message: { role: 'assistant', content: 'Injected synthetic result' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 12 },
      ...changes,
    },
    { headers },
  );
}
async function fixture(transport = async () => response(), changes = {}) {
  await mkdir('.phase1-test', { recursive: true });
  const directory = await mkdtemp(join(resolve('.phase1-test'), 'provider-'));
  let clock = Date.now();
  const scope = scopeAt(clock);
  const config = {
    scope,
    expectedHash: scopeHash(scope),
    suiteHash,
    suiteRaw,
    directory,
    transport,
    getSecret: () => 'synthetic-unit-test-key',
    now: () => clock,
    ...changes,
  };
  return {
    directory,
    scope,
    config,
    evaluator: createGroqEvaluation(config),
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('provider scope rejects incomplete/hash/expiry/spend/input-token evidence before any secret or transport access', () => {
  for (const change of [
    { ownerApproved: false },
    { modelId: null },
    { expiresAt: '2000-01-01T00:00:00+06:00' },
    { caps: { ...scopeAt().caps, maxSpendBdt: 1 } },
    { tokenization: { ...scopeAt().tokenization, verified: false } },
    { evidence: { ...scopeAt().evidence, noOverageVerified: false } },
    { accountLimits: { ...scopeAt().accountLimits, tpm: 1 } },
  ]) {
    const scope = { ...scopeAt(), ...change };
    assert.throws(() =>
      validateEvaluationScope(scope, { expectedHash: scopeHash(scope), suiteHash, cases }),
    );
  }
  assert.throws(() =>
    validateEvaluationScope(scopeAt(), { expectedHash: 'f'.repeat(64), suiteHash, cases }),
  );
});

test('fixed synthetic case transport captures exact provider/model usage without quality/cost claims; duplicate budget persists across restart', async () => {
  let calls = 0;
  let payload;
  const f = await fixture(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    payload = JSON.parse(options.body);
    return response();
  });
  const altered = JSON.parse(suiteRaw);
  altered.system_message = 'Unapproved system prompt';
  assert.throws(() => createGroqEvaluation({ ...f.config, suiteRaw: JSON.stringify(altered) }), {
    code: 'FROZEN_SUITE_MISMATCH',
  });
  const captured = await f.evaluator.complete('EN01');
  assert.equal(payload.messages[1].content, cases.find((item) => item.id === 'EN01').prompt);
  assert.equal(payload.max_completion_tokens, 32);
  assert.equal(payload.stream, false);
  assert.equal(captured.inputTokens, 40);
  assert.equal(captured.outputTokens, 12);
  assert.equal(captured.qualityAccepted, false);
  assert.equal(captured.observedProviderCostBdt, null);
  assert.ok(
    !(await readFile(join(f.directory, 'calls.jsonl'), 'utf8')).includes('synthetic-unit-test-key'),
  );
  await assert.rejects(createGroqEvaluation(f.config).complete('EN01'), {
    code: 'CALL_BUDGET_EXHAUSTED',
  });
  f.advance(10000);
  await f.evaluator.complete('BN01');
  assert.equal(calls, 2);
  await assert.rejects(f.evaluator.complete('unknown'), { code: 'CASE_NOT_APPROVED' });
});

test('HTTP errors, quota/cost signals, wrong route, unknown usage and excess tokens permanently stop without retries', async () => {
  const responses = [
    () => new Response('Do not expose provider error or secret', { status: 429 }),
    () => response({}, { 'x-ratelimit-remaining-tokens': '0' }),
    () => response({ cost: 0 }),
    () => response({ model: 'other-model' }),
    () => response({ usage: null }),
    () => response({ usage: { prompt_tokens: 101, completion_tokens: 12 } }),
  ];
  for (const makeResponse of responses) {
    let calls = 0;
    const f = await fixture(async () => {
      calls++;
      return makeResponse();
    });
    await assert.rejects(f.evaluator.complete('EN01'));
    f.advance(10000);
    await assert.rejects(createGroqEvaluation(f.config).complete('BN01'), {
      code: 'EVALUATION_ALREADY_STOPPED',
    });
    assert.equal(calls, 1);
    assert.equal(
      (await readFile(join(f.directory, 'calls.jsonl'), 'utf8')).trim().split('\n').length,
      1,
    );
    assert.ok(
      !JSON.stringify(JSON.parse(await readFile(join(f.directory, 'stop.json'), 'utf8'))).includes(
        'Do not expose',
      ),
    );
  }
});

test('exclusive durable evaluator lock prevents simultaneous dispatch and account pacing cannot be bypassed', async () => {
  let release;
  const held = new Promise((resolveHeld) => {
    release = resolveHeld;
  });
  let markStarted;
  const started = new Promise((resolveStarted) => {
    markStarted = resolveStarted;
  });
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    markStarted();
    await held;
    return response();
  });
  const first = f.evaluator.complete('EN01');
  await started;
  try {
    await assert.rejects(createGroqEvaluation(f.config).complete('BN01'), {
      code: 'EVALUATION_LOCKED',
    });
  } finally {
    release();
  }
  await first;
  await assert.rejects(f.evaluator.complete('BN01'), { code: 'CALL_PACING_REQUIRED' });
  assert.equal(calls, 1);
});

test('missing capture after an uncertain attempt and malformed budget journal fail closed after restart', async () => {
  const f = await fixture();
  await f.evaluator.complete('EN01');
  f.advance(10000);
  await unlink(join(f.directory, 'EN01.json'));
  await assert.rejects(createGroqEvaluation(f.config).complete('BN01'), {
    code: 'EVALUATION_UNCERTAIN',
  });
  await writeFile(join(f.directory, 'calls.jsonl'), '{invalid json\n');
  await assert.rejects(createGroqEvaluation(f.config).complete('BN01'), {
    code: 'BUDGET_JOURNAL_INVALID',
  });
});

test('timeout stops even an uncooperative transport and burns its one reserved attempt', async () => {
  const f = await fixture(() => new Promise(() => undefined), { timeoutMs: 20 });
  const keepAlive = setTimeout(() => undefined, 1000);
  try {
    await assert.rejects(f.evaluator.complete('EN01'), { code: 'PROVIDER_TRANSPORT_FAILURE' });
  } finally {
    clearTimeout(keepAlive);
  }
  await assert.rejects(f.evaluator.complete('BN01'), { code: 'EVALUATION_ALREADY_STOPPED' });
});

test('scope expiry crossed during reservation never dispatches and preserves the spent attempt', async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return response();
  });
  const evaluator = createGroqEvaluation({
    ...f.config,
    getSecret: () => {
      f.advance(2 * 3600000);
      return 'synthetic-test-key';
    },
  });
  await assert.rejects(evaluator.complete('EN01'), { code: 'SCOPE_EXPIRED' });
  assert.equal(calls, 0);
  assert.equal(
    (await readFile(join(f.directory, 'calls.jsonl'), 'utf8')).trim().split('\n').length,
    1,
  );
  assert.equal(
    JSON.parse(await readFile(join(f.directory, 'stop.json'), 'utf8')).reason,
    'SCOPE_EXPIRED',
  );
});
