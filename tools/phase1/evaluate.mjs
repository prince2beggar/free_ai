import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createGroqEvaluation,
  scopeHash,
  validateEvaluationScope,
} from '../../packages/gateway/groq-evaluation.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const frozenSuiteHash = 'eb4aa10acda78daeb987906c324494f56b94295253e157929d3c03ef45cbe528';
export async function checkReadiness({
  scopePath = resolve(repo, '.phase1-integration/scope.json'),
  expectedHash,
} = {}) {
  const suiteRaw = await readFile(resolve(repo, 'tests/eval/suite.json'));
  if (createHash('sha256').update(suiteRaw).digest('hex') !== frozenSuiteHash)
    throw new Error('Frozen suite changed. Stop and review.');
  const suite = JSON.parse(suiteRaw.toString('utf8'));
  let scope;
  let scopeMissing = false;
  try {
    const raw = await readFile(scopePath);
    if (raw.byteLength > 16384) throw new Error('Scope file exceeds its bound.');
    scope = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Scope file could not be validated.');
    scopeMissing = true;
    scope = JSON.parse(
      await readFile(new URL('./test-scope.example.json', import.meta.url), 'utf8'),
    );
  }
  let reason = 'READY_FOR_EXPLICIT_EXECUTION';
  try {
    validateEvaluationScope(scope, {
      expectedHash,
      suiteHash: frozenSuiteHash,
      cases: suite.cases,
    });
  } catch (error) {
    reason = error.code ?? 'SCOPE_INCOMPLETE';
  }
  return {
    scope,
    suite,
    suiteRaw: suiteRaw.toString('utf8'),
    report: {
      status: scopeMissing ? 'NEEDS_ACCOUNT_AND_SCOPE' : reason,
      scopeSha256: scopeHash(scope),
      suiteSha256: frozenSuiteHash,
      modelCallsMade: 0,
      credentialsRead: false,
      hostDomain: 'OWNER_DEFERRED',
      missing: [
        ...(!scope.ownerApproved
          ? ['concrete owner-approved model/account/free-only/expiry scope']
          : []),
        ...(!scope.modelId ? ['exact model ID'] : []),
        ...(!scope.expiresAt ? ['Asia/Dhaka expiry with +06:00 offset'] : []),
        ...(!scope.tokenization?.verified
          ? ['exact-model rendered-prompt token-count evidence']
          : []),
        ...(!expectedHash ? ['reviewed scope SHA-256 supplied outside the scope file'] : []),
      ],
    },
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    let execute = false;
    let scopePath;
    let expectedHash;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--execute') execute = true;
      else if (args[i] === '--scope' && args[i + 1]) scopePath = resolve(args[++i]);
      else if (args[i] === '--scope-sha256' && args[i + 1]) expectedHash = args[++i];
      else throw new Error('Unsupported evaluator argument.');
    }
    const checked = await checkReadiness({ scopePath, expectedHash });
    if (!execute) console.log(JSON.stringify(checked.report, null, 2));
    else {
      if (checked.report.status !== 'READY_FOR_EXPLICIT_EXECUTION')
        throw new Error('Complete and verify the concrete scope before execution.');
      const { scope, suite } = checked;
      const root = resolve(repo, '.eval-local/groq');
      const directory = resolve(root, scope.scopeId);
      const local = relative(root, directory);
      if (!local || isAbsolute(local) || local.startsWith('..'))
        throw new Error('Invalid capture directory.');
      await mkdir(directory, { recursive: true });
      const evaluator = createGroqEvaluation({
        scope,
        expectedHash,
        suiteHash: frozenSuiteHash,
        suiteRaw: checked.suiteRaw,
        directory,
        transport: fetch,
        getSecret: (name) => process.env[name],
      });
      const results = [];
      const interval = Math.ceil(
        Math.max(
          60000 / scope.accountLimits.rpm,
          (60000 * (scope.caps.maxInputTokens + scope.caps.maxOutputTokens)) /
            scope.accountLimits.tpm,
        ),
      );
      for (const item of suite.cases.slice(0, scope.caps.maxCalls)) {
        if (results.length) {
          const nextAt = Date.now() + interval;
          while (Date.now() < nextAt) {
            if (Date.now() >= Date.parse(scope.expiresAt))
              throw new Error('Scope expired while waiting.');
            await delay(Math.min(1000, nextAt - Date.now()));
          }
        }
        const result = await evaluator.complete(item.id);
        results.push({
          caseId: result.caseId,
          providerId: result.providerId,
          modelId: result.modelId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          usageKind: result.usageKind,
          qualityAccepted: false,
          costBdt: null,
        });
        console.log(
          JSON.stringify({
            caseId: item.id,
            captured: true,
            calls: results.length,
            qualityAccepted: false,
          }),
        );
      }
      await writeFile(
        resolve(directory, 'summary.json'),
        JSON.stringify(
          {
            kind: 'REAL_CAPTURE_UNREVIEWED',
            scopeSha256: expectedHash,
            results,
            qualityAccepted: false,
            phase1Accepted: false,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        status: 'STOPPED',
        code: error.code ?? 'READINESS_REQUIRED',
        message: 'Review the readiness and local capture reports. No automatic retry or fallback.',
      }),
    );
    process.exitCode = 1;
  }
}
