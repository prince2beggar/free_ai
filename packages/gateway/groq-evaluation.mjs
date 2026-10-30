import { createHash } from 'node:crypto';
import { mkdir, readFile, open, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../api/errors.mjs';

// Official non-streaming API: https://console.groq.com/docs/api-reference (2026-10-13).
const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
const approvedSuiteHash = 'eb4aa10acda78daeb987906c324494f56b94295253e157929d3c03ef45cbe528';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const scopeHash = (scope) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(scope)))
    .digest('hex');
const positive = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n > 0 && n <= max;
const stop = (code) =>
  new AppError(503, code, 'Evaluation stopped. Review the local report before any further call.');

export function validateEvaluationScope(
  scope,
  { expectedHash, suiteHash, cases, now = Date.now() },
) {
  if (
    !Array.isArray(cases) ||
    cases.length < 1 ||
    cases.length > 45 ||
    cases.some(
      (item) =>
        !/^[A-Za-z0-9_-]{1,80}$/.test(item.id ?? '') ||
        typeof item.prompt !== 'string' ||
        item.prompt.length > 65536,
    )
  )
    throw stop('EVALUATOR_CONFIG_INVALID');
  if (
    !scope ||
    scope.version !== 1 ||
    scope.ownerApproved !== true ||
    scope.providerId !== 'groq' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(scope.scopeId ?? '') ||
    typeof scope.modelId !== 'string' ||
    !/^[a-zA-Z0-9_./-]{1,200}$/.test(scope.modelId) ||
    scope.environment !== 'local' ||
    !/^[A-Z][A-Z0-9_]{1,100}$/.test(scope.keyEnvName ?? '') ||
    !/^[a-f0-9]{64}$/.test(expectedHash ?? '') ||
    scopeHash(scope) !== expectedHash
  )
    throw stop('SCOPE_INCOMPLETE');
  if (
    typeof scope.expiresAt !== 'string' ||
    !/\+06:00$/.test(scope.expiresAt) ||
    !Number.isFinite(Date.parse(scope.expiresAt)) ||
    Date.parse(scope.expiresAt) <= now
  )
    throw stop('SCOPE_EXPIRED');
  const caps = scope.caps;
  if (
    !caps ||
    !positive(caps.maxCalls, 45) ||
    !positive(caps.maxInputTokens, 4000) ||
    !positive(caps.maxOutputTokens, 1024) ||
    caps.maxSpendBdt !== 0 ||
    caps.noRetries !== true ||
    caps.noFallbacks !== true
  )
    throw stop('SCOPE_CAPS_INVALID');
  const evidence = scope.evidence;
  if (
    !evidence ||
    evidence.eligibilityVerified !== true ||
    evidence.freeOnlyVerified !== true ||
    evidence.noOverageVerified !== true ||
    !/\S.{8,}/.test(evidence.freeOnlyDetails ?? '') ||
    !/^https:\/\/console\.groq\.com\/docs\/legal\//.test(evidence.termsUrl ?? '') ||
    !/^\d{4}-\d{2}-\d{2}$/.test(evidence.checkedDate ?? '') ||
    evidence.checkedDate > new Date(now + 6 * 3600000).toISOString().slice(0, 10)
  )
    throw stop('SCOPE_EVIDENCE_MISSING');
  const limits = scope.accountLimits;
  if (
    !limits ||
    !positive(limits.rpm) ||
    !positive(limits.tpm) ||
    !positive(limits.dailyRemaining) ||
    limits.dailyRemaining < caps.maxCalls ||
    limits.dedicatedTestAccount !== true
  )
    throw stop('ACCOUNT_LIMITS_MISSING');
  // These must be verified counts for this exact model and rendered chat template, not character estimates.
  const tokenization = scope.tokenization;
  if (
    !tokenization ||
    tokenization.suiteSha256 !== suiteHash ||
    tokenization.modelId !== scope.modelId ||
    tokenization.verified !== true ||
    typeof tokenization.evidence !== 'string' ||
    tokenization.evidence.trim().length < 10 ||
    !cases.every((item) => positive(tokenization.inputTokensByCase?.[item.id], caps.maxInputTokens))
  )
    throw stop('INPUT_TOKEN_EVIDENCE_MISSING');
  if (
    limits.tpm <
    Math.max(...cases.map((item) => tokenization.inputTokensByCase[item.id])) + caps.maxOutputTokens
  )
    throw stop('ACCOUNT_SINGLE_CALL_TOO_LARGE');
  return scope;
}

async function abortable(promise, signal) {
  signal.throwIfAborted();
  let handler;
  const cancelled = new Promise((_resolve, reject) => {
    handler = () => reject(signal.reason);
    signal.addEventListener('abort', handler, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener('abort', handler);
  }
}
async function responseJson(response, signal) {
  if (!response.body) throw stop('PROVIDER_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) throw stop('PROVIDER_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
function costSignal(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => /cost|price|billing|charge/i.test(key) || costSignal(child),
  );
}

/** Fixed synthetic suite only. No default transport/secret reader; CLI supplies them after explicit scope validation. */
export function createGroqEvaluation({
  scope,
  expectedHash,
  suiteHash,
  suiteRaw,
  directory,
  transport,
  getSecret,
  now = Date.now,
  timeoutMs = 10000,
}) {
  if (
    typeof suiteRaw !== 'string' ||
    suiteHash !== approvedSuiteHash ||
    createHash('sha256').update(suiteRaw).digest('hex') !== suiteHash
  )
    throw stop('FROZEN_SUITE_MISMATCH');
  const suite = JSON.parse(suiteRaw);
  const cases = suite.cases;
  const systemMessage = suite.system_message;
  validateEvaluationScope(scope, { expectedHash, suiteHash, cases, now: now() });
  if (
    typeof transport !== 'function' ||
    typeof getSecret !== 'function' ||
    typeof directory !== 'string' ||
    !positive(timeoutMs, 30000) ||
    !Array.isArray(cases) ||
    typeof systemMessage !== 'string'
  )
    throw stop('EVALUATOR_CONFIG_INVALID');
  const frozenCases = structuredClone(cases);
  const selectedCases = new Map(frozenCases.map((item) => [item.id, item]));
  const digest = scopeHash(scope);
  return {
    async complete(caseId) {
      const item = selectedCases.get(caseId);
      if (!item) throw stop('CASE_NOT_APPROVED');
      await mkdir(directory, { recursive: true });
      const lockPath = join(directory, 'run.lock');
      let lock;
      try {
        lock = await open(lockPath, 'wx');
      } catch {
        throw stop('EVALUATION_LOCKED');
      }
      let reserved = false;
      try {
        validateEvaluationScope(scope, { expectedHash, suiteHash, cases: frozenCases, now: now() });
        try {
          await readFile(join(directory, 'stop.json'));
          throw stop('EVALUATION_ALREADY_STOPPED');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        let history = [];
        try {
          const raw = await readFile(join(directory, 'calls.jsonl'), 'utf8');
          if (Buffer.byteLength(raw) > 32768) throw stop('BUDGET_JOURNAL_INVALID');
          history = raw.trim().split('\n').filter(Boolean).map(JSON.parse);
        } catch (error) {
          if (error.code !== 'ENOENT') throw stop('BUDGET_JOURNAL_INVALID');
        }
        if (history.some((record) => record.scopeSha256 !== digest))
          throw stop('SCOPE_JOURNAL_MISMATCH');
        if (
          history.length > 45 ||
          new Set(history.map((record) => record.caseId)).size !== history.length ||
          history.some(
            (record, index) =>
              !selectedCases.has(record.caseId) ||
              !Number.isSafeInteger(record.reservedAt) ||
              record.reservedAt < 0 ||
              record.sequence !== index + 1,
          )
        )
          throw stop('BUDGET_JOURNAL_INVALID');
        for (const record of history) {
          try {
            const captured = JSON.parse(
              await readFile(join(directory, `${record.caseId}.json`), 'utf8'),
            );
            if (
              captured.scopeSha256 !== digest ||
              captured.caseId !== record.caseId ||
              captured.kind !== 'REAL_CAPTURE_UNREVIEWED'
            )
              throw stop('EVALUATION_UNCERTAIN');
          } catch {
            throw stop('EVALUATION_UNCERTAIN');
          }
        }
        if (
          history.length >= scope.caps.maxCalls ||
          history.some((record) => record.caseId === caseId)
        )
          throw stop('CALL_BUDGET_EXHAUSTED');
        const minimumGap = Math.ceil(
          Math.max(
            60000 / scope.accountLimits.rpm,
            (60000 * (scope.caps.maxInputTokens + scope.caps.maxOutputTokens)) /
              scope.accountLimits.tpm,
          ),
        );
        if (history.length && now() < history.at(-1).reservedAt + minimumGap)
          throw stop('CALL_PACING_REQUIRED');
        validateEvaluationScope(scope, { expectedHash, suiteHash, cases: frozenCases, now: now() });
        const secret = getSecret(scope.keyEnvName);
        if (typeof secret !== 'string' || !secret || secret.length > 4096 || /[\r\n]/.test(secret))
          throw stop('TEST_KEY_MISSING');
        const record = {
          caseId,
          scopeSha256: digest,
          reservedAt: now(),
          sequence: history.length + 1,
          status: 'RESERVED_NOT_PROOF_OF_SUCCESS',
        };
        const journal = await open(join(directory, 'calls.jsonl'), 'a');
        try {
          await journal.writeFile(JSON.stringify(record) + '\n');
          await journal.sync();
        } finally {
          await journal.close();
        }
        reserved = true;
        validateEvaluationScope(scope, { expectedHash, suiteHash, cases: frozenCases, now: now() });
        const remainingMs = Date.parse(scope.expiresAt) - now();
        if (remainingMs < 1000) throw stop('SCOPE_EXPIRED');
        const signal = AbortSignal.timeout(Math.min(timeoutMs, remainingMs));
        const started = now();
        const response = await abortable(
          transport(endpoint, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: scope.modelId,
              messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: item.prompt },
              ],
              stream: false,
              n: 1,
              max_completion_tokens: scope.caps.maxOutputTokens,
            }),
          }),
          signal,
        );
        if (!response.ok) throw stop('PROVIDER_HTTP_ERROR');
        if (
          response.headers.has('retry-after') ||
          ['x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens'].some(
            (name) => response.headers.has(name) && Number(response.headers.get(name)) <= 0,
          )
        )
          throw stop('PROVIDER_QUOTA_WARNING');
        if ([...response.headers.keys()].some((key) => /cost|billing|charge/i.test(key)))
          throw stop('PROVIDER_COST_SIGNAL');
        const body = await responseJson(response, signal);
        if (costSignal(body)) throw stop('PROVIDER_COST_SIGNAL');
        const usage = body.usage;
        const choice = body.choices?.[0];
        if (
          body.model !== scope.modelId ||
          !Array.isArray(body.choices) ||
          body.choices.length !== 1 ||
          choice.message?.role !== 'assistant' ||
          typeof choice.message?.content !== 'string' ||
          !['stop', 'length'].includes(choice.finish_reason) ||
          choice.message.tool_calls
        )
          throw stop('PROVIDER_RESPONSE_INVALID');
        if (
          !usage ||
          !Number.isSafeInteger(usage.prompt_tokens) ||
          usage.prompt_tokens < 0 ||
          !Number.isSafeInteger(usage.completion_tokens) ||
          usage.completion_tokens < 0
        )
          throw stop('PROVIDER_USAGE_UNKNOWN');
        if (
          usage.prompt_tokens > scope.caps.maxInputTokens ||
          usage.completion_tokens > scope.caps.maxOutputTokens
        )
          throw stop('PROVIDER_TOKEN_BOUND_EXCEEDED');
        const result = {
          kind: 'REAL_CAPTURE_UNREVIEWED',
          caseId,
          providerId: scope.providerId,
          modelId: body.model,
          scopeSha256: digest,
          requestId: typeof body.id === 'string' ? body.id.slice(0, 200) : null,
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          usageKind: 'provider_reported',
          latencyMs: Math.max(0, now() - started),
          finishReason: choice.finish_reason,
          text: choice.message.content,
          observedProviderCostBdt: null,
          qualityAccepted: false,
        };
        const captured = await open(join(directory, `${caseId}.json`), 'wx');
        try {
          await captured.writeFile(JSON.stringify(result, null, 2) + '\n');
          await captured.sync();
        } finally {
          await captured.close();
        }
        return result;
      } catch (error) {
        if (reserved) {
          const code = error instanceof AppError ? error.code : 'PROVIDER_TRANSPORT_FAILURE';
          await writeFile(
            join(directory, 'stop.json'),
            JSON.stringify({
              reason: code,
              at: now(),
              scopeSha256: digest,
              usage: 'UNKNOWN_UNLESS_CAPTURED',
              automaticRetryAllowed: false,
            }) + '\n',
            { flag: 'wx' },
          ).catch(() => undefined);
          throw stop(code);
        }
        throw error;
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    },
  };
}
