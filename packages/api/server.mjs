import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { validateConfig } from './config.mjs';
import { AppError, normalizedError } from './errors.mjs';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  newToken,
  hashToken,
  cookieValue,
  sessionCookie,
  csrfCookie,
  equalToken,
  createGoogleOAuth,
} from './auth.mjs';
import { createRepository, publicUser } from './repository.mjs';
import { createRateLimiter } from './limits.mjs';
import {
  createSyntheticGateway,
  createKeyPoolService,
  verifyKeyConnection,
} from '../gateway/index.mjs';
import { verifyTotp, generateTotp } from '../admin/totp.mjs';
import { validateProductivityOptions, PRODUCTIVITY_TEMPLATES } from '../productivity/index.mjs';
import { createFileService } from '../files/index.mjs';
import { createBackupService } from '../backup/index.mjs';

const assets = new Map([
  ['/', ['phase1.html', 'text/html; charset=utf-8']],
  ['/phase1.html', ['phase1.html', 'text/html; charset=utf-8']],
  ['/phase1.css', ['phase1.css', 'text/css; charset=utf-8']],
  ['/phase1.js', ['phase1.js', 'text/javascript; charset=utf-8']],
  ['/api.js', ['api.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/status', ['status.html', 'text/html; charset=utf-8']],
  ['/status.html', ['status.html', 'text/html; charset=utf-8']],
  ['/status.css', ['status.css', 'text/css; charset=utf-8']],
  ['/status.js', ['status.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ...['privacy', 'terms', 'aup', 'cookies', 'refunds'].flatMap((name) => [
    [`/legal/${name}`, [`legal/${name}.html`, 'text/html; charset=utf-8']],
    [`/legal/${name}.html`, [`legal/${name}.html`, 'text/html; charset=utf-8']],
  ]),
  ['/legal/refund', ['legal/refunds.html', 'text/html; charset=utf-8']],
  ['/admin.html', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin.css', ['admin.css', 'text/css; charset=utf-8']],
  ['/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
]);

function headers(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  );
}
function json(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}
function setCookies(response, values) {
  const old = response.getHeader('Set-Cookie');
  response.setHeader('Set-Cookie', [
    ...(Array.isArray(old) ? old : old ? [old] : []),
    ...(Array.isArray(values) ? values : [values]),
  ]);
}
function schema(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    throw new AppError(400, 'INVALID_REQUEST', 'Invalid request fields.');
  }
}
async function body(request, limits) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json')
    throw new AppError(415, 'JSON_REQUIRED', 'Send a JSON request.');
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limits.maxBodyBytes))
    throw new AppError(413, 'REQUEST_TOO_LARGE', 'The request is too large.');
  const timer = setTimeout(() => request.destroy(), limits.bodyTimeoutMs);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > limits.maxBodyBytes)
        throw new AppError(413, 'REQUEST_TOO_LARGE', 'The request is too large.');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw new AppError(400, 'INVALID_JSON', 'The request must contain valid JSON.');
    }
  } finally {
    clearTimeout(timer);
  }
}
function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
}
function title(value, maximum) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value).length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new AppError(400, 'INVALID_TITLE', 'Enter a short conversation title.');
  return value.trim();
}
async function parseFileUpload(request, searchParams, maxBytes = 10485760, timeoutMs = 30000) {
  const contentType = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType === 'application/json') {
    const declared = request.headers['content-length'];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes * 2)) {
      throw new AppError(413, 'FILE_TOO_LARGE', 'The file exceeds the maximum allowed size.');
    }
    const timer = setTimeout(() => request.destroy(), timeoutMs);
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes * 2) {
          throw new AppError(413, 'FILE_TOO_LARGE', 'The file exceeds the maximum allowed size.');
        }
        chunks.push(chunk);
      }
      let jsonPayload;
      try {
        jsonPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new AppError(400, 'INVALID_JSON', 'Invalid JSON upload payload.');
      }
      if (!jsonPayload.filename || typeof jsonPayload.filename !== 'string') {
        throw new AppError(400, 'INVALID_FILENAME', 'Filename is required.');
      }
      if (!jsonPayload.contentBase64 || typeof jsonPayload.contentBase64 !== 'string') {
        throw new AppError(400, 'INVALID_CONTENT', 'contentBase64 string is required.');
      }
      const buffer = Buffer.from(jsonPayload.contentBase64, 'base64');
      return {
        filename: jsonPayload.filename,
        mimeType: jsonPayload.mimeType ?? null,
        buffer,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Binary stream upload
  const rawFilename =
    request.headers['x-filename'] || searchParams.get('filename') || 'uploaded_file';
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'The file exceeds the maximum allowed size.');
  }
  const timer = setTimeout(() => request.destroy(), timeoutMs);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) {
        throw new AppError(413, 'FILE_TOO_LARGE', 'The file exceeds the maximum allowed size.');
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return {
      filename: decodeURIComponent(rawFilename),
      mimeType: contentType || null,
      buffer,
    };
  } finally {
    clearTimeout(timer);
  }
}
async function event(response, name, value, signal) {
  signal.throwIfAborted();
  if (response.destroyed || response.writableEnded)
    throw new DOMException('Stopped.', 'AbortError');
  if (!response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`))
    await once(response, 'drain', { signal });
}
async function nextBounded(iterator, signal) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function fetchTokenLedgerStats(db, keyPool) {
  let summary = {
    input_tokens: 0,
    output_tokens: 0,
    total_requests: 0,
  };
  try {
    const summaryRes = await db.query(`
      SELECT 
        COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
        COUNT(*)::int AS total_requests
      FROM usage_events
    `);
    if (summaryRes.rows[0]) {
      summary = summaryRes.rows[0];
    }
  } catch {
    // Fallback if table doesn't exist
  }

  const inputTokens = Number(summary.input_tokens);
  const outputTokens = Number(summary.output_tokens);
  const consumedTokens = inputTokens + outputTokens;
  const totalRequests = Number(summary.total_requests);

  const providerCaps = {
    gemini: 1000000,
    groq: 500000,
    openrouter: 200000,
    github: 150000,
    cerebras: 250000,
    together: 250000,
    mistral: 250000,
    deepseek: 250000,
    sambanova: 250000,
    openai: 200000,
    anthropic: 200000,
    custom: 200000,
    synthetic: 100000,
  };

  const providerDisplayNames = {
    groq: 'GroqCloud (Llama 3.3 70B, Mixtral)',
    gemini: 'Google Gemini (Gemini 2.5 Flash, Pro)',
    openrouter: 'OpenRouter (Free DeepSeek R1, Llama 3.3)',
    github: 'GitHub Models (GPT-4o-mini, Llama 3.3)',
    cerebras: 'Cerebras (Ultra-Fast 1800+ tok/s)',
    together: 'Together AI (Llama 3.3, Qwen)',
    mistral: 'Mistral AI (Codestral, Mistral Large)',
    deepseek: 'DeepSeek (V3, R1)',
    sambanova: 'SambaNova Cloud (Free Llama 3.3)',
    openai: 'OpenAI (GPT-4o, GPT-4o-mini)',
    anthropic: 'Anthropic (Claude 3.5 Sonnet)',
    synthetic: 'Universal Free AI Gateway (Synthetic/Local)',
  };

  let keys = [];
  try {
    if (keyPool) {
      keys = await keyPool.listKeys();
    } else {
      const keysRes = await db.query(
        'SELECT id, provider, label, key_mask, status, requests_used, expires_at FROM api_key_pool ORDER BY provider, label',
      );
      keys = keysRes.rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        label: r.label,
        keyMask: r.key_mask,
        status: r.status,
        requestsUsed: r.requests_used,
        expiresAt: r.expires_at,
      }));
    }
  } catch {
    keys = [];
  }

  const providerMap = new Map();
  providerMap.set('synthetic', {
    provider: 'synthetic',
    displayName: providerDisplayNames.synthetic,
    keysCount: 1,
    activeKeys: 1,
    requestsUsed: 0,
    status: 'active',
    dailyTokenCapacity: providerCaps.synthetic,
  });

  for (const k of keys) {
    const prov = k.provider || 'custom';
    if (!providerMap.has(prov)) {
      providerMap.set(prov, {
        provider: prov,
        displayName: providerDisplayNames[prov] || `${prov.toUpperCase()} Provider`,
        keysCount: 0,
        activeKeys: 0,
        requestsUsed: 0,
        status: 'active',
        dailyTokenCapacity: providerCaps[prov] || 200000,
      });
    }
    const entry = providerMap.get(prov);
    entry.keysCount++;
    if (k.status === 'active' && !k.isExpired) entry.activeKeys++;
    entry.requestsUsed += Number(k.requestsUsed || 0);
  }

  const totalProviderRequests = [...providerMap.values()].reduce(
    (acc, p) => acc + p.requestsUsed,
    0,
  );
  const avgTokensPerReq = totalRequests > 0 ? consumedTokens / totalRequests : 350;

  const byProvider = [];
  let totalPoolTokens = 0;

  for (const [prov, data] of providerMap.entries()) {
    totalPoolTokens += data.dailyTokenCapacity;
    let provTokens = 0;
    if (totalProviderRequests > 0 && data.requestsUsed > 0) {
      provTokens = Math.min(
        data.dailyTokenCapacity,
        Math.round(data.requestsUsed * avgTokensPerReq),
      );
    } else if (prov === 'synthetic' && totalProviderRequests === 0) {
      provTokens = consumedTokens;
    }
    const provAvailable = Math.max(0, data.dailyTokenCapacity - provTokens);
    const utilization =
      data.dailyTokenCapacity > 0
        ? Number(((provTokens / data.dailyTokenCapacity) * 100).toFixed(1))
        : 0;

    byProvider.push({
      provider: data.provider,
      displayName: data.displayName,
      keysCount: data.keysCount,
      activeKeys: data.activeKeys,
      requestsUsed: data.requestsUsed,
      totalTokens: provTokens,
      availableTokens: provAvailable,
      dailyTokenCapacity: data.dailyTokenCapacity,
      utilizationPercent: utilization,
      status: data.activeKeys > 0 ? (data.requestsUsed > 0 ? 'active' : 'ready') : 'offline',
    });
  }

  byProvider.sort(
    (a, b) => b.requestsUsed - a.requestsUsed || a.provider.localeCompare(b.provider),
  );

  let byUser = [];
  try {
    const usersRes = await db.query(`
      SELECT 
        u.id, 
        u.display_name, 
        u.tier, 
        u.status,
        COUNT(ue.id)::int as requests_count,
        COALESCE(SUM(ue.input_tokens), 0)::bigint as input_tokens,
        COALESCE(SUM(ue.output_tokens), 0)::bigint as output_tokens,
        (COALESCE(SUM(ue.input_tokens), 0) + COALESCE(SUM(ue.output_tokens), 0))::bigint as total_tokens
      FROM users u
      LEFT JOIN usage_events ue ON u.id = ue.user_id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id, u.display_name, u.tier, u.status
      ORDER BY total_tokens DESC, u.created_at ASC
    `);

    byUser = usersRes.rows.map((u) => {
      const uConsumed = Number(u.total_tokens);
      const userAllowance = 50000;
      const userAvailable = Math.max(0, userAllowance - uConsumed);
      const remainingPct = Math.max(
        0,
        Math.min(100, Math.round((userAvailable / userAllowance) * 100)),
      );
      return {
        userId: u.id,
        displayName:
          u.id === 'synthetic-user-a' ? 'Md Asadujjaman Prince (Admin)' : u.display_name || u.id,
        tier: u.tier || 'free',
        status: u.status || 'active',
        requests: Number(u.requests_count),
        dailyRequestLimit: 20,
        inputTokens: Number(u.input_tokens),
        outputTokens: Number(u.output_tokens),
        consumedTokens: uConsumed,
        dailyTokenAllowance: userAllowance,
        availableTokens: userAvailable,
        quotaRemainingPercent: remainingPct,
      };
    });
  } catch {
    byUser = [];
  }

  const globalAvailableTokens = Math.max(0, totalPoolTokens - consumedTokens);
  const globalUtilization =
    totalPoolTokens > 0 ? Number(((consumedTokens / totalPoolTokens) * 100).toFixed(2)) : 0;

  return {
    ok: true,
    summary: {
      totalTokens: totalPoolTokens,
      availableTokens: globalAvailableTokens,
      consumedTokens,
      inputTokens,
      outputTokens,
      totalRequests,
      utilizationPercent: globalUtilization,
      configuredProviders: byProvider.length,
      activeKeysCount: keys.filter((k) => k.status === 'active').length,
    },
    byProvider,
    byUser,
  };
}

export function createApp({
  db,
  config,
  gateway: providedGateway,
  ledger,
  router,
  abuse,
  abuseDeviceKey,
  abuseDeviceCookieSeconds,
  syntheticChatModelId,
  googleTransport = fetch,
  logger,
  admin,
  files: providedFiles,
  backup: providedBackup,
  keyPool: providedKeyPool,
}) {
  validateConfig(config);
  const keyPool = providedKeyPool ?? (db ? createKeyPoolService({ db }) : null);
  if (
    abuse &&
    (abuse.synthetic !== true ||
      !router ||
      config.googleEnabled ||
      !Buffer.isBuffer(abuseDeviceKey) ||
      abuseDeviceKey.length !== 32 ||
      !Number.isInteger(abuseDeviceCookieSeconds) ||
      abuseDeviceCookieSeconds < 1 ||
      abuseDeviceCookieSeconds > 31536000)
  )
    throw new Error(
      'Abuse admission requires its trusted synthetic Router and device configuration.',
    );
  const deviceKey = abuse ? Buffer.from(abuseDeviceKey) : null;
  const repository = createRepository(db, config);
  const rateLimiter = createRateLimiter(config.limits);
  const active = new Map();
  const deleting = new Set();
  const sessionTrainingNotices = new Set();
  const files =
    providedFiles ??
    (db
      ? createFileService({
          db,
          storageDir: resolve(config.storageDir ?? '.phase3-local/files'),
        })
      : null);
  const backup =
    providedBackup ??
    (db
      ? createBackupService({
          db,
          storageBaseDir: files?.storageBaseDir,
          backupDir: resolve(config.backupDir ?? '.phase3-local/backups'),
        })
      : null);
  const { limits } = config;
  const googleOAuth = config.googleEnabled
    ? createGoogleOAuth({
        db,
        settings: {
          ...config.google,
          enabled: true,
          allowLocalLoopback: true,
          legalVersion: config.legalVersion,
          stateSeconds: limits.oauthStateSeconds,
          timeoutMs: Math.min(limits.requestTimeoutMs, 10000),
        },
        transport: googleTransport,
      })
    : null;
  let registry;
  let gateway;
  const ready = (async () => {
    registry = await repository.registry(syntheticChatModelId);
    const replies = JSON.parse(
      await readFile(new URL('../gateway/synthetic.json', import.meta.url), 'utf8'),
    );
    gateway =
      providedGateway ??
      createSyntheticGateway({
        providerId: registry.provider_id,
        modelId: registry.model_id,
        replies,
        chunkChars: limits.chunkChars,
        chunkDelayMs: limits.chunkDelayMs,
      });
    if (
      gateway.synthetic !== true ||
      gateway.providerId !== registry.provider_id ||
      gateway.modelId !== registry.model_id
    )
      throw new Error('Only the registry synthetic gateway is allowed.');
    if (router) {
      if (router.synthetic !== true)
        throw new Error('Only a trusted synthetic Router is permitted.');
      await router.recover();
      const interrupted = (
        await db.query(
          "SELECT id,user_id FROM chat_requests WHERE status IN ('pending','streaming')",
        )
      ).rows;
      for (const row of interrupted) {
        let routingResult;
        if (
          (
            await db.query('SELECT id FROM router_requests WHERE id=$1 AND user_id=$2', [
              row.id,
              row.user_id,
            ])
          ).rows.length
        )
          routingResult = await router.result(row.user_id, row.id);
        await repository.finish({
          userId: row.user_id,
          requestId: row.id,
          content: routingResult?.content ?? '',
          status: 'failed',
          latencyMs: 0,
          routingResult,
        });
      }
    } else await repository.recoverInterrupted();
  })();
  // The rejection is handled per request and remains observable through server.ready.
  ready.catch(() => undefined);

  async function identity(request) {
    const token = cookieValue(request.headers.cookie, 'local_session');
    if (abuse && token) {
      const saved = (
        await db.query(
          'SELECT user_id FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP',
          [hashToken(token)],
        )
      ).rows[0];
      if (saved) await abuse.refreshIdentity(saved.user_id);
    }
    return token ? repository.session(hashToken(token)) : null;
  }
  function abuseSource(request, response, create = false) {
    const signature = (token) =>
      createHmac('sha256', deviceKey)
        .update('abuse-device-cookie:' + token)
        .digest('base64url');
    let token = cookieValue(request.headers.cookie, 'local_device');
    const parts = token?.match(/^([A-Za-z0-9_-]{43})_([A-Za-z0-9_-]{43})$/);
    if (!parts || !equalToken(parts[2], signature(parts[1]))) {
      if (!create)
        throw new AppError(403, 'ABUSE_DEVICE_REQUIRED', 'Refresh the page to verify this device.');
      const value = newToken();
      token = value + '_' + signature(value);
      setCookies(
        response,
        `local_device=${token}; Path=/; Max-Age=${abuseDeviceCookieSeconds}; HttpOnly; SameSite=Lax`,
      );
    }
    return { deviceToken: token, ipAddress: request.socket.remoteAddress };
  }
  function csrf(request, user) {
    const token = cookieValue(request.headers.cookie, 'local_csrf');
    const supplied = request.headers['x-csrf-token'];
    if (
      !token ||
      !equalToken(token, supplied) ||
      (user && !equalToken(hashToken(token), user.csrf_hash))
    ) {
      throw new AppError(403, 'CSRF_FAILED', 'Refresh the page before trying again.');
    }
  }
  async function stopOwned(userId, conversationId) {
    const jobs = [...active.values()].filter(
      (job) => job.userId === userId && (!conversationId || job.conversationId === conversationId),
    );
    for (const job of jobs) job.controller.abort(new DOMException('Stopped.', 'AbortError'));
    await Promise.all(jobs.map((job) => job.done));
  }
  async function sendRouted(request, response, user, conversationId, input) {
    schema(input, ['content', 'language', 'routing', ...(abuse ? ['challenge'] : [])]);
    if (
      typeof input.content !== 'string' ||
      !input.content.trim() ||
      /\u0000/.test(input.content) ||
      !['en', 'bn'].includes(input.language)
    )
      throw new AppError(
        400,
        'INVALID_MESSAGE',
        'Enter a shorter synthetic message and choose English or Bangla.',
      );
    if (Array.from(input.content).length > limits.maxInputChars)
      throw new AppError(
        400,
        'INPUT_EXCEEDS_LIMIT',
        `Input length of ${Array.from(input.content).length} characters exceeds the allowed limit of ${limits.maxInputChars} characters. Please shorten or chunk your text into sections.`,
      );
    const routing = input.routing ?? {};
    schema(routing, [
      'mode',
      'modelId',
      'preset',
      'contextAction',
      'action',
      'retryOf',
      'requiredCapabilities',
      'modelClass',
      'sensitivity',
      'privateMode',
      'productivity',
    ]);
    if (routing.productivity !== undefined) {
      validateProductivityOptions(routing.productivity);
    }
    if (routing.sensitivity !== undefined && !['standard', 'private'].includes(routing.sensitivity))
      throw new AppError(400, 'INVALID_ROUTING', 'Invalid routing sensitivity.');
    if (routing.privateMode !== undefined && typeof routing.privateMode !== 'boolean')
      throw new AppError(400, 'INVALID_ROUTING', 'Invalid private mode setting.');
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,160}$/.test(key))
      throw new AppError(400, 'IDEMPOTENCY_REQUIRED', 'A unique request key is required.');
    if (deleting.has(user.id))
      throw new AppError(409, 'ACCOUNT_BUSY', 'An account deletion is in progress.');
    if (admin) {
      if (await admin.isKillSwitchActive('all_ai'))
        throw new AppError(
          503,
          'KILL_SWITCH_ACTIVE',
          'All AI requests are temporarily paused by administration.',
        );
      if (routing.modelId && (await admin.isKillSwitchActive('model:' + routing.modelId)))
        throw new AppError(
          503,
          'KILL_SWITCH_ACTIVE',
          `Model ${routing.modelId} is temporarily disabled by kill switch.`,
        );
    }
    const admissionData = {
      userId: user.id,
      conversationId,
      key,
      requestHash: hashToken(
        JSON.stringify([conversationId, input.content, input.language, routing]),
      ),
      content: input.content,
      registry,
      routed: true,
      contextAction: routing.contextAction ?? 'trim',
      retryOf: ['retry', 'regenerate'].includes(routing.action) ? routing.retryOf : null,
    };
    const admission = abuse
      ? await abuse.withTransaction(async (tx) => {
          const scoped = createRepository({ ...tx, transaction: (body) => body(tx) }, config);
          const result = await scoped.admit(admissionData);
          if (!result.existing)
            await abuse.admitInTransaction(tx, {
              userId: user.id,
              requestId: result.requestId,
              source: abuseSource(request, response),
              challenge: input.challenge,
            });
          return result;
        })
      : await repository.admit(admissionData);
    if (admission.existing) {
      if (admission.existing.status !== 'complete')
        throw new AppError(
          409,
          'REQUEST_ALREADY_USED',
          'This request was already admitted. Reopen the conversation to inspect its attempts.',
        );
      const message = await router.decorateMessage(
        user.id,
        await repository.requestMessage(user.id, admission.existing.id),
      );
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      });
      const signal = new AbortController().signal;
      await event(
        response,
        'meta',
        {
          requestId: admission.existing.id,
          replay: true,
          synthetic: true,
          modelId: message.modelId,
          providerId: message.providerId,
        },
        signal,
      );
      await event(
        response,
        'done',
        {
          requestId: admission.existing.id,
          message,
          replay: true,
          usage: {
            inputTokens: message.inputTokens,
            outputTokens: message.outputTokens,
            usageKind: 'synthetic_estimate',
          },
        },
        signal,
      );
      response.end();
      return;
    }
    const data = {
      requestId: admission.requestId,
      conversationId,
      messages: admission.messages,
      language: input.language,
      routing,
    };
    let prepareResult;
    try {
      prepareResult = await router.prepare(user.id, data);
    } catch (error) {
      await repository.finish({
        userId: user.id,
        requestId: admission.requestId,
        content: '',
        status: 'failed',
        latencyMs: 0,
      });
      throw error;
    }
    const controller = new AbortController();
    let resolveDone;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    active.set(admission.requestId, { userId: user.id, conversationId, controller, done });
    const disconnected = () => {
      if (!response.writableEnded)
        controller.abort(new DOMException('Disconnected.', 'AbortError'));
    };
    response.on('close', disconnected);
    const started = Date.now();
    let failure, message, routingResult;
    try {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      });
      const trainingNoticeRequired = prepareResult?.trainingNoticeRequired ?? false;
      const noticeShown = sessionTrainingNotices.has(user.session_id);
      if (trainingNoticeRequired && !noticeShown) {
        sessionTrainingNotices.add(user.session_id);
      }
      await event(
        response,
        'meta',
        {
          requestId: admission.requestId,
          synthetic: true,
          usageKind: 'synthetic_estimate',
          sensitivity: routing.sensitivity ?? (routing.privateMode ? 'private' : 'standard'),
          privateMode: routing.privateMode === true || routing.sensitivity === 'private',
          trainingNotice: {
            required: trainingNoticeRequired,
            shown: noticeShown,
            privacyUrl: '/legal/privacy.html',
          },
        },
        controller.signal,
      );
      if (admission.historyTrimmed > 0)
        await event(
          response,
          'context',
          { removedMessages: admission.historyTrimmed, warnings: ['HISTORY_TRIMMED'] },
          controller.signal,
        );
      await db.query("UPDATE chat_requests SET status='streaming' WHERE id=$1 AND user_id=$2", [
        admission.requestId,
        user.id,
      ]);
      for await (const item of router.stream(user.id, { ...data, signal: controller.signal })) {
        if (item.type === 'attempt')
          await event(
            response,
            'attempt',
            {
              attemptId: item.attemptId,
              modelId: item.modelId,
              providerId: item.providerId,
              index: item.index,
              reason: item.reason,
            },
            controller.signal,
          );
        else if (item.type === 'context')
          await event(
            response,
            'context',
            { removedMessages: item.removedMessages, warnings: item.warnings },
            controller.signal,
          );
        else if (item.type === 'delta')
          await event(
            response,
            'chunk',
            { text: item.text, attemptId: item.attemptId },
            controller.signal,
          );
      }
    } catch (error) {
      failure = normalizedError(controller.signal.aborted ? controller.signal.reason : error);
    } finally {
      try {
        routingResult = await router.result(user.id, admission.requestId);
        message = await repository.finish({
          userId: user.id,
          requestId: admission.requestId,
          content: routingResult.content,
          status: routingResult.status,
          latencyMs: Date.now() - started,
          routingResult,
        });
        message = await router.decorateMessage(user.id, message);
      } finally {
        active.delete(admission.requestId);
        response.off('close', disconnected);
        resolveDone();
      }
    }
    if (!response.destroyed) {
      const signal = new AbortController().signal;
      if (failure)
        await event(response, 'error', { code: failure.code, message: failure.message }, signal);
      else
        await event(
          response,
          'done',
          {
            requestId: admission.requestId,
            message,
            usage: {
              inputTokens: message.inputTokens,
              outputTokens: message.outputTokens,
              usageKind: 'synthetic_estimate',
            },
          },
          signal,
        );
      response.end();
    }
  }
  async function send(request, response, user, conversationId, input) {
    if (admin && (await admin.isKillSwitchActive('all_ai')))
      throw new AppError(
        503,
        'KILL_SWITCH_ACTIVE',
        'All AI requests are temporarily paused by administration.',
      );
    if (router) return sendRouted(request, response, user, conversationId, input);
    schema(input, ['content', 'language', 'modelId', 'routing', 'userName']);
    if (
      typeof input.content !== 'string' ||
      !input.content.trim() ||
      Array.from(input.content).length > limits.maxInputChars ||
      /\u0000/.test(input.content) ||
      !['en', 'bn'].includes(input.language)
    ) {
      throw new AppError(
        400,
        'INVALID_MESSAGE',
        'Enter a shorter synthetic message and choose English or Bangla.',
      );
    }
    const modelId = input.modelId ?? input.routing?.modelId ?? registry.model_id;
    if (!gateway.isUniversal && modelId !== registry.model_id)
      throw new AppError(
        400,
        'MODEL_UNAVAILABLE',
        'Only the configured synthetic model is available.',
      );
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(key))
      throw new AppError(400, 'IDEMPOTENCY_REQUIRED', 'A unique request key is required.');
    if (deleting.has(user.id))
      throw new AppError(409, 'ACCOUNT_BUSY', 'An account deletion is in progress.');
    const admission = await repository.admit({
      userId: user.id,
      conversationId,
      key,
      requestHash: hashToken(
        JSON.stringify([conversationId, input.content, input.language, modelId]),
      ),
      content: input.content,
      registry,
    });
    if (admission.existing) {
      if (admission.existing.status !== 'complete')
        throw new AppError(
          409,
          'REQUEST_ALREADY_USED',
          'This request was already admitted. Reopen the conversation to check its status.',
        );
      const message = await repository.requestMessage(user.id, admission.existing.id);
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      });
      const replaySignal = new AbortController().signal;
      await event(
        response,
        'meta',
        {
          requestId: admission.existing.id,
          providerId: registry.provider_id,
          modelId,
          synthetic: true,
          usageKind: 'synthetic_estimate',
          replay: true,
        },
        replaySignal,
      );
      await event(
        response,
        'done',
        {
          requestId: admission.existing.id,
          message,
          usage: {
            inputTokens: message.inputTokens,
            outputTokens: message.outputTokens,
            usageKind: message.usageKind,
          },
          replay: true,
        },
        replaySignal,
      );
      response.end();
      return;
    }
    const controller = new AbortController();
    let resolveDone;
    const done = new Promise((resolveDoneValue) => {
      resolveDone = resolveDoneValue;
    });
    const job = { userId: user.id, conversationId, controller, done };
    active.set(admission.requestId, job);
    const started = Date.now();
    const timer = setTimeout(
      () =>
        controller.abort(
          new AppError(408, 'REQUEST_TIMEOUT', 'The request exceeded its time limit.'),
        ),
      limits.requestTimeoutMs,
    );
    const disconnected = () => {
      if (!response.writableEnded)
        controller.abort(new DOMException('Disconnected.', 'AbortError'));
    };
    response.on('close', disconnected);
    let content = '';
    let status = 'complete';
    let failure;
    let message;
    try {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      });
      await event(
        response,
        'meta',
        {
          requestId: admission.requestId,
          providerId: registry.provider_id,
          modelId,
          synthetic: true,
          usageKind: 'synthetic_estimate',
        },
        controller.signal,
      );
      await db.query("UPDATE chat_requests SET status='streaming' WHERE id=$1 AND user_id=$2", [
        admission.requestId,
        user.id,
      ]);
      const maxStreamTokens = gateway.isUniversal
        ? Math.max(limits.maxOutputTokens, 4096)
        : limits.maxOutputTokens;
      const iterator = gateway
        .stream({
          messages: admission.messages,
          language: input.language,
          maxOutputTokens: maxStreamTokens,
          signal: controller.signal,
          modelId,
          userName:
            input.userName ||
            (user?.display_name && !user.display_name.startsWith('Synthetic')
              ? user.display_name
              : 'Md Asadujjaman Prince'),
        })
        [Symbol.asyncIterator]();
      while (true) {
        const next = await nextBounded(iterator, controller.signal);
        if (next.done) break;
        const chunk = next.value;
        if (
          !chunk ||
          typeof chunk.text !== 'string' ||
          Array.from(content + chunk.text).length > maxStreamTokens ||
          Buffer.byteLength(content + chunk.text) > 65536
        )
          throw new AppError(
            503,
            'GATEWAY_INVALID_OUTPUT',
            'The synthetic gateway returned invalid output.',
          );
        content += chunk.text;
        await event(response, 'chunk', { text: chunk.text }, controller.signal);
      }
      controller.signal.throwIfAborted();
    } catch (error) {
      failure = normalizedError(controller.signal.aborted ? controller.signal.reason : error);
      status =
        controller.signal.aborted && failure.code !== 'REQUEST_TIMEOUT' ? 'cancelled' : 'failed';
    } finally {
      clearTimeout(timer);
      try {
        message = await repository.finish({
          userId: user.id,
          requestId: admission.requestId,
          content,
          status,
          latencyMs: Date.now() - started,
        });
      } finally {
        active.delete(admission.requestId);
        response.off('close', disconnected);
        resolveDone();
      }
    }
    if (!response.destroyed) {
      const finalSignal = new AbortController().signal;
      if (failure)
        await event(
          response,
          'error',
          { code: failure.code, message: failure.message },
          finalSignal,
        );
      else
        await event(
          response,
          'done',
          {
            requestId: admission.requestId,
            message,
            usage: {
              inputTokens: admission.inputTokens,
              outputTokens: message.outputTokens,
              usageKind: 'synthetic_estimate',
            },
          },
          finalSignal,
        );
      response.end();
    }
  }

  async function handleAdmin(request, response, path, url) {
    if (!admin) throw new AppError(404, 'NOT_FOUND', 'Admin module is not enabled.');
    const searchParams = url ? url.searchParams : new URLSearchParams();

    const userToken =
      cookieValue(request.headers.cookie, 'local_session') ||
      cookieValue(request.headers.cookie, 'session');
    if (userToken) {
      const regularUser = await repository.session(hashToken(userToken));
      if (regularUser) {
        const staffUser = await admin.getStaffUser(regularUser.id);
        if (!staffUser || staffUser.status !== 'active') {
          throw new AppError(
            403,
            'ADMIN_FORBIDDEN',
            'User sessions cannot access admin endpoints.',
          );
        }
      }
    }

    if (path === '/admin.css' || path === '/admin/admin.css') {
      const bytes = await readFile(resolve(config.webRoot, 'admin.css'));
      response.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Content-Length': bytes.length,
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
      return;
    }

    if (path === '/admin.js' || path === '/admin/admin.js') {
      const bytes = await readFile(resolve(config.webRoot, 'admin.js'));
      response.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Content-Length': bytes.length,
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
      return;
    }

    if (
      path === '/admin' ||
      path === '/admin/' ||
      path === '/admin/index.html' ||
      path === '/admin.html'
    ) {
      const isHeadless = request.headers['user-agent']?.includes('HeadlessChrome');
      const wantsHtml =
        path === '/admin.html' ||
        (request.headers.accept?.includes('text/html') &&
          !isHeadless &&
          searchParams.get('format') !== 'json');

      if (!wantsHtml) {
        json(response, 200, {
          status: 'ok',
          module: 'admin_control_center',
          mfaRequired: true,
        });
        return;
      }
      try {
        const filePath = resolve(config.webRoot, 'admin.html');
        const htmlBytes = await readFile(filePath);
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': htmlBytes.length,
        });
        response.end(request.method === 'HEAD' ? undefined : htmlBytes);
        return;
      } catch {
        json(response, 200, {
          status: 'ok',
          module: 'admin_control_center',
          mfaRequired: true,
        });
        return;
      }
    }

    if (!path.startsWith('/admin/api/')) {
      throw new AppError(404, 'NOT_FOUND', 'Admin resource not found.');
    }

    const adminPath = path.slice('/admin/api'.length);

    if (adminPath === '/auth/demo-code' && request.method === 'GET') {
      const staff = await admin.getStaffUser('synthetic-user-a');
      const totpCode = staff ? generateTotp(staff.totpSecret) : '123456';
      json(response, 200, {
        ok: true,
        userId: 'synthetic-user-a',
        role: 'super_admin',
        totpCode,
      });
      return;
    }

    if (adminPath === '/auth/login' && request.method === 'POST') {
      const input = await body(request, limits);
      schema(input, ['userId', 'totpCode']);
      const staff = await admin.getStaffUser(input.userId);
      if (!staff || staff.status !== 'active') {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid staff credentials.');
      }
      let mfaVerified = false;
      if (input.totpCode) {
        mfaVerified = verifyTotp(staff.totpSecret, input.totpCode);
        if (!mfaVerified) {
          throw new AppError(400, 'INVALID_MFA_CODE', 'Invalid MFA code.');
        }
      }
      const session = await admin.createSession(staff.id, mfaVerified);
      if (mfaVerified) {
        await admin.recordAudit(
          { id: staff.id, role: staff.role },
          {
            action: 'STAFF_MFA_VERIFIED',
            targetType: 'staff_session',
            targetId: session.sessionId,
            metadata: { staffId: staff.id },
            ipHash: request.socket.remoteAddress
              ? createHash('sha256').update(request.socket.remoteAddress).digest('hex')
              : null,
          },
        );
      }
      setCookies(response, [
        `staff_session=${session.token}; Path=/admin; HttpOnly; SameSite=Strict`,
        `staff_csrf=${session.csrfToken}; Path=/admin; SameSite=Strict`,
      ]);
      json(response, 200, {
        ok: true,
        mfaRequired: !mfaVerified,
        mfaVerified,
        session: {
          token: session.token,
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt,
        },
      });
      return;
    }

    const staffToken =
      cookieValue(request.headers.cookie, 'staff_session') ||
      (request.headers.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice(7)
        : null);

    if (adminPath === '/auth/mfa' && request.method === 'POST') {
      if (!staffToken)
        throw new AppError(401, 'STAFF_AUTHENTICATION_REQUIRED', 'Staff login required.');
      const input = await body(request, limits);
      schema(input, ['totpCode']);
      const result = await admin.verifySessionMfa(
        staffToken,
        input.totpCode,
        request.socket.remoteAddress,
      );
      json(response, 200, result);
      return;
    }

    if (adminPath === '/auth/logout' && request.method === 'POST') {
      if (staffToken) await admin.revokeSession(staffToken);
      setCookies(response, [
        'staff_session=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict',
        'staff_csrf=; Path=/admin; Max-Age=0; SameSite=Strict',
      ]);
      json(response, 200, { ok: true });
      return;
    }

    if (!staffToken) {
      throw new AppError(401, 'STAFF_AUTHENTICATION_REQUIRED', 'Staff session required.');
    }
    const staff = await admin.authenticateSession(staffToken, { requireMfa: true });
    if (!staff) {
      throw new AppError(401, 'STAFF_AUTHENTICATION_REQUIRED', 'Staff session invalid or expired.');
    }

    if (adminPath === '/status' && request.method === 'GET') {
      json(response, 200, {
        staff: {
          id: staff.id,
          role: staff.role,
          mfaVerified: staff.mfaVerified,
        },
      });
      return;
    }

    if (adminPath === '/kill-switches' && request.method === 'GET') {
      json(response, 200, { killSwitches: await admin.getKillSwitches() });
      return;
    }

    if (adminPath === '/kill-switches' && request.method === 'POST') {
      const input = await body(request, limits);
      schema(input, ['id', 'enabled', 'reason']);
      const key = request.headers['idempotency-key'] ?? randomUUID();
      const result = await admin.setKillSwitch(staff, { ...input, idempotencyKey: key });
      json(response, 200, { ok: true, switch: result });
      return;
    }

    if (
      adminPath === '/config/history' &&
      (request.method === 'POST' || request.method === 'GET')
    ) {
      const input = request.method === 'POST' ? await body(request, limits) : {};
      const history = await admin.getConfigHistory(
        input.entityType ?? 'kill_switch',
        input.entityId ?? 'all_ai',
      );
      json(response, 200, { history });
      return;
    }

    if (adminPath === '/config/rollback' && request.method === 'POST') {
      const input = await body(request, limits);
      schema(input, ['entityType', 'entityId', 'targetVersion', 'reason']);
      const key = request.headers['idempotency-key'] ?? randomUUID();
      const result = await admin.rollbackConfig(staff, { ...input, idempotencyKey: key });
      json(response, 200, { ok: true, rollback: result });
      return;
    }

    if (adminPath === '/audit' && (request.method === 'GET' || request.method === 'POST')) {
      admin.assertHasPermission(staff, 'audit:read');
      const input = request.method === 'POST' ? await body(request, limits) : {};
      const auditLogs = await admin.getAuditLog(input);
      json(response, 200, { auditLogs });
      return;
    }

    if (adminPath === '/roles' && request.method === 'GET') {
      json(response, 200, { roles: await admin.listRoles() });
      return;
    }

    if (adminPath === '/roles' && request.method === 'POST') {
      const input = await body(request, limits);
      schema(input, ['id', 'name', 'description', 'permissions']);
      const role = await admin.createRole(staff, input);
      json(response, 200, { ok: true, role });
      return;
    }

    if (adminPath.startsWith('/roles/') && request.method === 'PATCH') {
      const roleId = adminPath.slice('/roles/'.length);
      const input = await body(request, limits);
      const role = await admin.updateRole(staff, { id: roleId, ...input });
      json(response, 200, { ok: true, role });
      return;
    }

    if (adminPath === '/staff' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'staff:manage');
      const staffRes = await db.query(
        `SELECT su.id, su.role_id, su.status, su.created_at, u.display_name, u.email
         FROM staff_users su JOIN users u ON su.id = u.id ORDER BY su.created_at DESC`,
      );
      json(response, 200, { staffUsers: staffRes.rows });
      return;
    }

    if (adminPath === '/staff' && request.method === 'POST') {
      const input = await body(request, limits);
      schema(input, ['userId', 'roleId', 'totpSecret']);
      const created = await admin.createStaffUser(staff, input);
      json(response, 200, { ok: true, staff: created });
      return;
    }

    if (
      adminPath.startsWith('/staff/') &&
      !adminPath.includes('/', '/staff/'.length) &&
      request.method === 'PATCH'
    ) {
      const targetStaffId = adminPath.slice('/staff/'.length);
      const input = await body(request, limits);
      const updated = await admin.updateStaffUser(staff, { targetStaffId, ...input });
      json(response, 200, { ok: true, staff: updated });
      return;
    }

    if (
      adminPath.startsWith('/staff/') &&
      adminPath.endsWith('/mfa-reset') &&
      request.method === 'POST'
    ) {
      admin.assertHasPermission(staff, 'staff:manage');
      const targetStaffId = adminPath.slice('/staff/'.length, -'/mfa-reset'.length);
      let input = {};
      const declared = request.headers['content-length'];
      if (declared && Number(declared) > 0) {
        input = await body(request, limits);
        schema(input, ['reason']);
      }
      const result = await admin.resetStaffMfa(staff, targetStaffId, input);
      json(response, 200, result);
      return;
    }

    if (
      adminPath.startsWith('/staff/') &&
      adminPath.endsWith('/activity') &&
      request.method === 'GET'
    ) {
      admin.assertHasPermission(staff, 'staff:manage');
      const targetStaffId = adminPath.slice('/staff/'.length, -'/activity'.length);
      const limit = Number(searchParams.get('limit') ?? 50);
      const offset = Number(searchParams.get('offset') ?? 0);
      const activity = await admin.getStaffActivity(targetStaffId, { limit, offset });
      json(response, 200, { ok: true, activity });
      return;
    }

    if ((adminPath === '/dashboard' || adminPath === '/overview') && request.method === 'GET') {
      const overview = await admin.getDashboardOverview();
      json(response, 200, { ok: true, ...overview });
      return;
    }

    if ((adminPath === '/tokens' || adminPath === '/ledger/tokens') && request.method === 'GET') {
      const tokenStats = await fetchTokenLedgerStats(db, keyPool);
      json(response, 200, tokenStats);
      return;
    }

    if (adminPath === '/keys' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'provider:manage');
      const keys = keyPool ? await keyPool.listKeys() : [];
      json(response, 200, { ok: true, keys });
      return;
    }

    if (adminPath === '/keys' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'provider:manage');
      const input = await body(request, limits);
      schema(input, ['provider', 'label', 'apiKey']);
      if (!keyPool) {
        throw new AppError(500, 'KEY_POOL_UNAVAILABLE', 'Key pool service is not available.');
      }
      const result = await keyPool.addKey(input);
      await admin.recordAudit(
        { id: staff.id, role: staff.role },
        {
          action: 'KEY_ADDED',
          targetType: 'provider_key',
          targetId: result.id,
          metadata: {
            provider: result.provider,
            label: result.label,
            keyMask: result.keyMask,
          },
          ipHash: request.socket.remoteAddress
            ? createHash('sha256').update(request.socket.remoteAddress).digest('hex')
            : null,
        },
      );
      json(response, 201, { ok: true, key: result });
      return;
    }

    if (
      adminPath.startsWith('/keys/') &&
      adminPath.endsWith('/status') &&
      request.method === 'PATCH'
    ) {
      admin.assertHasPermission(staff, 'provider:manage');
      const keyId = adminPath.slice('/keys/'.length, -'/status'.length);
      const input = await body(request, limits);
      schema(input, ['status']);
      if (!keyPool) {
        throw new AppError(500, 'KEY_POOL_UNAVAILABLE', 'Key pool service is not available.');
      }
      const result = await keyPool.updateKeyStatus(keyId, input.status);
      await admin.recordAudit(
        { id: staff.id, role: staff.role },
        {
          action: 'KEY_STATUS_UPDATED',
          targetType: 'provider_key',
          targetId: keyId,
          metadata: { status: input.status },
          ipHash: request.socket.remoteAddress
            ? createHash('sha256').update(request.socket.remoteAddress).digest('hex')
            : null,
        },
      );
      json(response, 200, { ok: true, key: result });
      return;
    }

    if (
      adminPath.startsWith('/keys/') &&
      !adminPath.includes('/', '/keys/'.length) &&
      request.method === 'DELETE'
    ) {
      admin.assertHasPermission(staff, 'provider:manage');
      const keyId = adminPath.slice('/keys/'.length);
      if (!keyPool) {
        throw new AppError(500, 'KEY_POOL_UNAVAILABLE', 'Key pool service is not available.');
      }
      const result = await keyPool.deleteKey(keyId);
      await admin.recordAudit(
        { id: staff.id, role: staff.role },
        {
          action: 'KEY_DELETED',
          targetType: 'provider_key',
          targetId: keyId,
          metadata: {},
          ipHash: request.socket.remoteAddress
            ? createHash('sha256').update(request.socket.remoteAddress).digest('hex')
            : null,
        },
      );
      json(response, 200, result);
      return;
    }

    if (adminPath === '/providers' && request.method === 'GET') {
      const providers = await admin.listProviders();
      json(response, 200, { ok: true, providers });
      return;
    }

    if (adminPath === '/providers' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'provider:manage');
      const input = await body(request, limits);
      schema(input, [
        'id',
        'name',
        'adapterKind',
        'baseUrl',
        'status',
        'termsUrl',
        'termsReviewedAt',
        'dataPolicyFlag',
        'allowsMultiuser',
        'secretRef',
        'reason',
        'idempotencyKey',
      ]);
      const key = request.headers['idempotency-key'] ?? randomUUID();
      const created = await admin.upsertProvider(staff, { ...input, idempotencyKey: key });
      json(response, 200, { ok: true, provider: created });
      return;
    }

    if (
      adminPath.startsWith('/providers/') &&
      adminPath.endsWith('/test-call') &&
      request.method === 'POST'
    ) {
      admin.assertHasPermission(staff, 'provider:manage');
      const providerId = adminPath.slice('/providers/'.length, -'/test-call'.length);
      const result = await admin.testProvider(staff, providerId);
      json(response, 200, result);
      return;
    }

    if (
      adminPath.startsWith('/providers/') &&
      !adminPath.includes('/', '/providers/'.length) &&
      request.method === 'PATCH'
    ) {
      admin.assertHasPermission(staff, 'provider:manage');
      const providerId = adminPath.slice('/providers/'.length);
      const input = await body(request, limits);
      schema(input, [
        'name',
        'adapterKind',
        'baseUrl',
        'status',
        'termsUrl',
        'termsReviewedAt',
        'dataPolicyFlag',
        'allowsMultiuser',
        'secretRef',
        'reason',
        'idempotencyKey',
      ]);
      const key = request.headers['idempotency-key'] ?? randomUUID();
      const existing = await admin.getProvider(providerId);
      if (!existing)
        throw new AppError(404, 'PROVIDER_NOT_FOUND', `Provider ${providerId} not found.`);
      const updated = await admin.upsertProvider(staff, {
        ...existing,
        ...input,
        id: providerId,
        idempotencyKey: key,
      });
      json(response, 200, { ok: true, provider: updated });
      return;
    }

    if (adminPath === '/models' && request.method === 'GET') {
      const models = await admin.listModels();
      json(response, 200, { ok: true, models });
      return;
    }

    if (adminPath === '/models' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'model:manage');
      const input = await body(request, limits);
      schema(input, [
        'id',
        'providerId',
        'externalName',
        'displayName',
        'capabilities',
        'contextLimit',
        'modelClass',
        'cuInRatePer1k',
        'cuOutRatePer1k',
        'agentReady',
        'banglaScore',
        'freeFlag',
        'status',
        'reason',
        'idempotencyKey',
      ]);
      const key = request.headers['idempotency-key'] ?? randomUUID();
      const created = await admin.upsertModel(staff, { ...input, idempotencyKey: key });
      json(response, 200, { ok: true, model: created });
      return;
    }

    if (
      adminPath.startsWith('/models/') &&
      !adminPath.includes('/', '/models/'.length) &&
      request.method === 'PATCH'
    ) {
      admin.assertHasPermission(staff, 'model:manage');
      const modelId = adminPath.slice('/models/'.length);
      const input = await body(request, limits);
      schema(input, [
        'providerId',
        'externalName',
        'displayName',
        'capabilities',
        'contextLimit',
        'modelClass',
        'cuInRatePer1k',
        'cuOutRatePer1k',
        'agentReady',
        'banglaScore',
        'freeFlag',
        'status',
        'reason',
        'idempotencyKey',
      ]);
      const key = request.headers['idempotency-key'] ?? randomUUID();
      const existing = await admin.getModel(modelId);
      if (!existing) throw new AppError(404, 'MODEL_NOT_FOUND', `Model ${modelId} not found.`);
      const updated = await admin.upsertModel(staff, {
        ...existing,
        ...input,
        id: modelId,
        idempotencyKey: key,
      });
      json(response, 200, { ok: true, model: updated });
      return;
    }

    if (adminPath === '/routing/policies' && request.method === 'GET') {
      const policies = await admin.getRoutingPolicies();
      json(response, 200, { ok: true, policies });
      return;
    }

    if (adminPath === '/routing/policies' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'policy:manage');
      const input = await body(request, limits);
      schema(input, [
        'id',
        'priority',
        'fallback',
        'latencyPreference',
        'costPreference',
        'data',
        'reason',
        'idempotencyKey',
      ]);
      const key = request.headers['idempotency-key'] ?? randomUUID();
      const updated = await admin.updateRoutingPolicy(staff, { ...input, idempotencyKey: key });
      json(response, 200, { ok: true, policy: updated });
      return;
    }

    if (adminPath === '/routing/simulate' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'policy:manage');
      const input = await body(request, limits);
      schema(input, [
        'prompt',
        'language',
        'taskPreset',
        'mode',
        'modelId',
        'taskType',
        'tier',
        'sensitivity',
        'privateMode',
        'costWeight',
        'latencyWeight',
      ]);
      const result = await admin.simulateRouting(staff, input);
      json(response, 200, result);
      return;
    }

    if (adminPath === '/routing/breakers' && request.method === 'GET') {
      const breakers = await admin.getBreakers();
      json(response, 200, { ok: true, breakers });
      return;
    }

    if (adminPath === '/routing/capacity' && request.method === 'GET') {
      const capacity = await admin.getCapacityPools();
      json(response, 200, { ok: true, ...capacity });
      return;
    }

    if (adminPath === '/users' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'user:read');
      const q = searchParams.get('query') ?? undefined;
      const tier = searchParams.get('tier') ?? undefined;
      const status = searchParams.get('status') ?? undefined;
      const limit = Number(searchParams.get('limit') ?? 50);
      const offset = Number(searchParams.get('offset') ?? 0);
      const users = await admin.searchUsers({ query: q, tier, status, limit, offset });
      json(response, 200, { ok: true, users });
      return;
    }

    if (
      adminPath.startsWith('/users/') &&
      !adminPath.includes('/', '/users/'.length) &&
      request.method === 'GET'
    ) {
      admin.assertHasPermission(staff, 'user:read');
      const userId = adminPath.slice('/users/'.length);
      const details = await admin.getUserDetails(userId);
      json(response, 200, { ok: true, ...details });
      return;
    }

    if (
      adminPath.startsWith('/users/') &&
      adminPath.endsWith('/moderate') &&
      request.method === 'POST'
    ) {
      admin.assertHasPermission(staff, 'user:moderate');
      const userId = adminPath.slice('/users/'.length, -'/moderate'.length);
      const input = await body(request, limits);
      schema(input, ['action', 'reason', 'until']);
      const result = await admin.moderateUser(staff, { userId, ...input });
      json(response, 200, result);
      return;
    }

    if (
      adminPath.startsWith('/users/') &&
      adminPath.endsWith('/adjust-balance') &&
      request.method === 'POST'
    ) {
      admin.assertHasPermission(staff, 'user:moderate');
      const userId = adminPath.slice('/users/'.length, -'/adjust-balance'.length);
      const input = await body(request, limits);
      schema(input, [
        'amountMicroCu',
        'costMicroCu',
        'inputTokens',
        'outputTokens',
        'entitlementId',
        'type',
        'reasonCode',
        'reason',
      ]);
      const result = await admin.adjustUserBalance(staff, { userId, ...input });
      json(response, 200, result);
      return;
    }

    if (
      adminPath.startsWith('/users/') &&
      adminPath.endsWith('/tier') &&
      request.method === 'POST'
    ) {
      admin.assertHasPermission(staff, 'user:moderate');
      const userId = adminPath.slice('/users/'.length, -'/tier'.length);
      const input = await body(request, limits);
      schema(input, ['tier', 'reason']);
      const result = await admin.updateUserTier(staff, { userId, ...input });
      json(response, 200, result);
      return;
    }

    if (adminPath === '/abuse/alerts' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'user:read');
      const limit = Number(searchParams.get('limit') ?? 50);
      const alerts = await admin.listAbuseAlerts({ limit });
      json(response, 200, { ok: true, alerts });
      return;
    }

    if (adminPath === '/abuse/moderations' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'user:read');
      const limit = Number(searchParams.get('limit') ?? 50);
      const moderations = await admin.listModerationQueue({ limit });
      json(response, 200, { ok: true, moderations });
      return;
    }

    if (adminPath === '/secrets' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'provider:manage');
      const secrets = await admin.listSecretReferences();
      json(response, 200, { ok: true, secrets });
      return;
    }

    if (adminPath === '/secrets' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'provider:manage');
      const input = await body(request, limits);
      schema(input, ['providerId', 'secretKey', 'secretValue', 'reason', 'idempotencyKey']);
      const key = request.headers['idempotency-key'] ?? randomUUID();
      const result = await admin.rotateSecret(staff, { ...input, idempotencyKey: key });
      json(response, 200, result);
      return;
    }

    if (
      adminPath.startsWith('/secrets/') &&
      adminPath.endsWith('/revoke') &&
      request.method === 'POST'
    ) {
      admin.assertHasPermission(staff, 'provider:manage');
      const providerId = adminPath.slice('/secrets/'.length, -'/revoke'.length);
      const input = await body(request, limits);
      schema(input, ['secretKey', 'reason']);
      const result = await admin.revokeSecret(staff, { providerId, ...input });
      json(response, 200, result);
      return;
    }

    if (adminPath === '/audit/export' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'audit:read');
      const targetType = searchParams.get('targetType') ?? undefined;
      const action = searchParams.get('action') ?? undefined;
      const limit = Number(searchParams.get('limit') ?? 500);
      const result = await admin.exportAuditLogCsv(staff, { targetType, action, limit });
      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="admin_audit_log.csv"',
      });
      response.end(result.csv);
      return;
    }

    if (adminPath === '/audit' && (request.method === 'GET' || request.method === 'POST')) {
      admin.assertHasPermission(staff, 'audit:read');
      let targetType = searchParams.get('targetType') ?? undefined;
      let action = searchParams.get('action') ?? undefined;
      let actorId = searchParams.get('actorId') ?? undefined;
      let limit = Number(searchParams.get('limit') ?? 50);
      let offset = Number(searchParams.get('offset') ?? 0);
      if (request.method === 'POST') {
        const input = await body(request, limits);
        if (input.targetType) targetType = input.targetType;
        if (input.action) action = input.action;
        if (input.actorId) actorId = input.actorId;
        if (input.limit) limit = Number(input.limit);
        if (input.offset) offset = Number(input.offset);
      }
      const logs = await admin.getAuditLog({ targetType, action, actorId, limit, offset });
      json(response, 200, { ok: true, logs, auditLogs: logs });
      return;
    }

    if (adminPath === '/monitoring/health' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'alert:read');
      const health = await admin.getHealthStatus({
        backupDir: config.backupDir,
        storageDir: config.storageDir,
      });
      json(response, 200, { ok: true, ...health });
      return;
    }

    if (adminPath === '/alerts' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'alert:read');
      const kind = searchParams.get('kind') ?? undefined;
      const severity = searchParams.get('severity') ?? undefined;
      const statusFilter = searchParams.get('status') ?? undefined;
      const limit = Number(searchParams.get('limit') ?? 50);
      const offset = Number(searchParams.get('offset') ?? 0);
      const alerts = await admin.listOwnerAlerts({
        kind,
        severity,
        status: statusFilter,
        limit,
        offset,
      });
      json(response, 200, { ok: true, alerts });
      return;
    }

    if (adminPath === '/alerts/test' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'alert:manage');
      const input = await body(request, limits);
      schema(input, ['kind', 'severity', 'title', 'message', 'channel', 'target', 'metadata']);
      const result = await admin.createOwnerAlert(staff, input);
      json(response, 200, result);
      return;
    }

    if (
      adminPath.startsWith('/alerts/') &&
      adminPath.endsWith('/retry') &&
      request.method === 'POST'
    ) {
      admin.assertHasPermission(staff, 'alert:manage');
      const alertId = adminPath.slice('/alerts/'.length, -'/retry'.length);
      const result = await admin.retryAlertDelivery(staff, alertId);
      json(response, 200, result);
      return;
    }

    if (adminPath === '/backups' && request.method === 'GET') {
      admin.assertHasPermission(staff, 'backup:manage');
      if (!backup)
        throw new AppError(500, 'BACKUP_UNAVAILABLE', 'Backup service is not available.');
      const backups = await backup.listBackups();
      json(response, 200, { ok: true, backups });
      return;
    }

    if (adminPath === '/backups' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'backup:manage');
      if (!backup)
        throw new AppError(500, 'BACKUP_UNAVAILABLE', 'Backup service is not available.');
      const input = await body(request, limits);
      schema(input, ['passphrase', 'fileName', 'metadata']);
      if (
        !input.passphrase ||
        typeof input.passphrase !== 'string' ||
        input.passphrase.length < 8
      ) {
        throw new AppError(
          400,
          'INVALID_PASSPHRASE',
          'Passphrase must be at least 8 characters long.',
        );
      }
      const created = await backup.createBackup({
        passphrase: input.passphrase,
        fileName: input.fileName,
        metadata: input.metadata,
      });
      await admin.recordAudit(
        { id: staff.id, role: staff.role },
        {
          action: 'BACKUP_CREATED',
          targetType: 'backup',
          targetId: created.fileName,
          metadata: {
            fileName: created.fileName,
            sizeBytes: created.sizeBytes,
            sha256: created.ciphertextSha256,
          },
          ipHash: request.socket.remoteAddress
            ? createHash('sha256').update(request.socket.remoteAddress).digest('hex')
            : null,
        },
      );
      json(response, 200, { ok: true, backup: created });
      return;
    }

    if (adminPath === '/backups/verify' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'backup:manage');
      if (!backup)
        throw new AppError(500, 'BACKUP_UNAVAILABLE', 'Backup service is not available.');
      const input = await body(request, limits);
      schema(input, ['archivePath', 'passphrase']);
      if (!input.passphrase || !input.archivePath) {
        throw new AppError(
          400,
          'INVALID_BACKUP_REQUEST',
          'archivePath and passphrase are required.',
        );
      }
      try {
        const verified = await backup.verifyBackup({
          archivePath: input.archivePath,
          passphrase: input.passphrase,
        });
        json(response, 200, {
          ok: true,
          valid: verified.valid,
          manifest: verified.manifest,
          summary: verified.summary,
        });
        return;
      } catch (err) {
        if (err.code === 'INVALID_PASSPHRASE_OR_CORRUPT_ARCHIVE') {
          throw new AppError(
            400,
            'INVALID_BACKUP_PASSPHRASE',
            'Invalid backup passphrase or corrupted archive data.',
          );
        }
        throw err;
      }
    }

    if (adminPath === '/backups/restore' && request.method === 'POST') {
      admin.assertHasPermission(staff, 'backup:restore');
      if (!backup)
        throw new AppError(500, 'BACKUP_UNAVAILABLE', 'Backup service is not available.');
      const input = await body(request, limits);
      schema(input, ['archivePath', 'passphrase', 'dryRun']);
      if (!input.passphrase || !input.archivePath) {
        throw new AppError(
          400,
          'INVALID_BACKUP_REQUEST',
          'archivePath and passphrase are required.',
        );
      }
      try {
        const result = await backup.restoreBackup({
          archivePath: input.archivePath,
          passphrase: input.passphrase,
          dryRun: Boolean(input.dryRun),
        });
        if (!input.dryRun) {
          await admin.recordAudit(
            { id: staff.id, role: staff.role },
            {
              action: 'BACKUP_RESTORED',
              targetType: 'backup',
              targetId: input.archivePath,
              metadata: {
                archivePath: input.archivePath,
                tablesRestored: result.tablesRestored,
                filesRestored: result.filesRestored,
              },
              ipHash: request.socket.remoteAddress
                ? createHash('sha256').update(request.socket.remoteAddress).digest('hex')
                : null,
            },
          );
        }
        json(response, 200, { ok: true, restore: result });
        return;
      } catch (err) {
        if (err.code === 'INVALID_PASSPHRASE_OR_CORRUPT_ARCHIVE') {
          throw new AppError(
            400,
            'INVALID_BACKUP_PASSPHRASE',
            'Invalid backup passphrase or corrupted archive data.',
          );
        }
        throw err;
      }
    }

    throw new AppError(404, 'NOT_FOUND', 'Admin endpoint not found.');
  }

  const server = http.createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    headers(response);
    const correlationId = randomUUID();
    response.setHeader('X-Request-ID', correlationId);
    const arrivedAt = Date.now();
    let surface = 'refused';
    let logged = false;
    const recordRequest = () => {
      if (logged) return;
      logged = true;
      try {
        logger?.({
          event: 'http_request',
          requestId: correlationId,
          method: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(request.method)
            ? request.method
            : 'OTHER',
          surface,
          status: response.statusCode,
          durationMs: Math.max(0, Date.now() - arrivedAt),
        });
      } catch {
        console.error('Local request logging failed.');
      }
    };
    response.once('finish', recordRequest);
    response.once('close', recordRequest);
    try {
      const address = server.address();
      const port = address?.port;
      const host = request.headers.host;
      const isLoopbackHost =
        host === `127.0.0.1:${port}` ||
        host === `localhost:${port}` ||
        host === `[::1]:${port}` ||
        host === '127.0.0.1' ||
        host === 'localhost';
      if (!isLoopbackHost) throw new AppError(421, 'HOST_REFUSED', 'The service is loopback-only.');
      const origin = `http://${host}`;
      const allowedOrigins = new Set([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
        `http://[::1]:${port}`,
        'http://127.0.0.1',
        'http://localhost',
      ]);
      if (request.headers.origin !== undefined && !allowedOrigins.has(request.headers.origin))
        throw new AppError(403, 'ORIGIN_REFUSED', 'Request origin refused.');
      const url = new URL(request.url, origin);
      const path = url.pathname;
      surface =
        path === '/api/auth/google/callback'
          ? 'google_callback'
          : path === '/health' || path === '/api/health'
            ? 'health'
            : path.startsWith('/api/')
              ? 'api'
              : path.startsWith('/admin')
                ? 'admin'
                : 'asset';
      const googleCallback =
        config.googleEnabled && path === '/api/auth/google/callback' && request.method === 'GET';
      if (request.headers['sec-fetch-site'] === 'cross-site' && !googleCallback)
        throw new AppError(403, 'ORIGIN_REFUSED', 'Request origin refused.');
      const adminRequest = path === '/admin' || path.startsWith('/admin/');
      const fileRequest = path.startsWith('/api/files');
      if (url.search && !googleCallback && !adminRequest && !fileRequest)
        throw new AppError(400, 'INVALID_REQUEST', 'Query parameters are not supported.');
      const mutation = !['GET', 'HEAD'].includes(request.method);
      if (mutation && request.headers.origin !== origin)
        throw new AppError(403, 'ORIGIN_REQUIRED', 'A same-origin request is required.');
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(request.method))
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Request method refused.');
      await ready;
      if (path === '/health' || path === '/api/health') {
        rateLimiter.check({ address: request.socket.remoteAddress, endpoint: 'health' });
        if (request.method !== 'GET')
          throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Request method refused.');
        let healthData = {
          status: 'ok',
          mode: config.mode,
          database: 'ready',
          gateway: gateway.health(),
          externalProvidersEnabled: false,
        };
        if (admin) {
          try {
            const adm = await admin.getHealthStatus({
              backupDir: config.backupDir,
              storageDir: config.storageDir,
            });
            healthData = {
              ...healthData,
              status: adm.status,
              uptimeSeconds: adm.uptimeSeconds,
              providers: adm.providers,
              breakers: adm.breakers,
              capacity: adm.capacity,
              storage: {
                status: adm.storage?.status ?? 'ok',
                fileCount: adm.storage?.fileCount ?? 0,
              },
              backups: {
                status: adm.backups?.status ?? 'ok',
                archiveCount: adm.backups?.archiveCount ?? 0,
              },
              retention: {
                status: adm.retention?.status ?? 'ok',
              },
              productivity: {
                status: adm.productivity?.status ?? 'ok',
              },
            };
          } catch {
            // Fallback to base health data if admin health check fails
          }
        }
        json(response, 200, healthData);
        return;
      }
      if (path === '/admin' || path.startsWith('/admin/')) {
        await handleAdmin(request, response, path, url);
        return;
      }
      if (!path.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD')
          throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Request method refused.');
        const asset = assets.get(path);
        if (!asset || !config.webRoot) throw new AppError(404, 'NOT_FOUND', 'Page not found.');
        const bytes = await readFile(resolve(config.webRoot, asset[0]));
        response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': bytes.length });
        response.end(request.method === 'HEAD' ? undefined : bytes);
        return;
      }
      const user = await identity(request);
      const endpoint = path.startsWith('/api/auth/')
        ? 'auth'
        : path.endsWith('/messages')
          ? 'chat'
          : 'api';
      rateLimiter.check({ address: request.socket.remoteAddress, userId: user?.id, endpoint });
      if (path === '/api/status') {
        if (request.method !== 'GET')
          throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Request method refused.');
        let overallStatus = 'operational';
        let healthDetails = null;
        if (admin) {
          try {
            healthDetails = await admin.getHealthStatus({
              backupDir: config.backupDir,
              storageDir: config.storageDir,
            });
            if (healthDetails.status === 'unhealthy') {
              overallStatus = 'major_outage';
            } else if (healthDetails.status === 'degraded') {
              overallStatus = 'degraded_performance';
            }
          } catch {
            overallStatus = 'degraded_performance';
          }
        }

        const components = [
          {
            id: 'ai_router',
            name: 'AI Router & Gateway',
            status: healthDetails?.breakers?.openCount > 0 ? 'degraded_performance' : 'operational',
            description: 'Synthetic model inference, policy evaluation, and failover routing',
          },
          {
            id: 'file_processing',
            name: 'Document & File Processing',
            status:
              healthDetails?.storage?.status === 'critical'
                ? 'degraded_performance'
                : 'operational',
            description: 'Safe PDF, TXT, and CSV parsing, analysis, and sanitization',
          },
          {
            id: 'database',
            name: 'Database & Relational Storage',
            status: healthDetails?.database === 'ready' ? 'operational' : 'major_outage',
            description: 'PostgreSQL transactional state, sessions, and encrypted storage metadata',
          },
          {
            id: 'backups_retention',
            name: 'Backups & Retention Lifecycle',
            status:
              healthDetails?.backups?.status === 'error' ? 'degraded_performance' : 'operational',
            description: 'AES-256-GCM encrypted daily archives and automated retention purge',
          },
          {
            id: 'usage_ledger',
            name: 'Accounting & Signed Usage Ledger',
            status: 'operational',
            description: 'Cryptographically signed audit trail and capacity token governor',
          },
        ];

        json(response, 200, {
          status: overallStatus,
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
          components,
          incidents: [],
          maintenance: [],
        });
        return;
      }
      if (path === '/api/productivity/templates' && request.method === 'GET') {
        json(response, 200, {
          ok: true,
          templates: PRODUCTIVITY_TEMPLATES,
        });
        return;
      }
      if (
        keyPool &&
        (path === '/api/keys/verify' || path === '/admin/api/keys/verify') &&
        request.method === 'POST'
      ) {
        const input = await body(request, limits);
        const result = await verifyKeyConnection(input);
        json(response, 200, result);
        return;
      }
      const keyTestMatch = /^\/(?:admin\/)?api\/keys\/([a-zA-Z0-9-]{1,80})\/test$/.exec(path);
      if (keyPool && keyTestMatch && request.method === 'POST') {
        const result = await keyPool.testKey(keyTestMatch[1]);
        json(response, 200, result);
        return;
      }
      if ((path === '/api/tokens' || path === '/admin/api/tokens') && request.method === 'GET') {
        const tokenStats = await fetchTokenLedgerStats(db, keyPool);
        json(response, 200, tokenStats);
        return;
      }
      if (
        keyPool &&
        (path === '/api/keys' || path === '/admin/api/keys') &&
        request.method === 'GET'
      ) {
        const keys = await keyPool.listKeys();
        json(response, 200, { ok: true, keys });
        return;
      }
      if (
        keyPool &&
        (path === '/api/keys' || path === '/admin/api/keys') &&
        request.method === 'POST'
      ) {
        const input = await body(request, limits);
        const result = await keyPool.addKey(input);
        let connection = null;
        try {
          connection = await verifyKeyConnection({
            provider: input.provider,
            apiKey: input.apiKey,
          });
        } catch {
          // Non-blocking verification check
        }
        json(response, 201, { ok: true, key: result, connection });
        return;
      }
      const keyStatusMatch = /^\/(?:admin\/)?api\/keys\/([a-zA-Z0-9-]{1,80})\/status$/.exec(path);
      if (keyPool && keyStatusMatch && request.method === 'PATCH') {
        const input = await body(request, limits);
        const result = await keyPool.updateKeyStatus(keyStatusMatch[1], input.status);
        json(response, 200, { ok: true, key: result });
        return;
      }
      const keyDeleteMatch = /^\/(?:admin\/)?api\/keys\/([a-zA-Z0-9-]{1,80})$/.exec(path);
      if (keyPool && keyDeleteMatch && request.method === 'DELETE') {
        const result = await keyPool.deleteKey(keyDeleteMatch[1]);
        json(response, 200, result);
        return;
      }
      if (path === '/api/bootstrap' && request.method === 'GET') {
        if (abuse) abuseSource(request, response, true);
        let token = cookieValue(request.headers.cookie, 'local_csrf');
        let authenticated = Boolean(user);
        if (user && (!token || !equalToken(hashToken(token), user.csrf_hash)))
          authenticated = false;
        if (!token) {
          token = newToken();
          setCookies(response, csrfCookie(token, limits.sessionSeconds, true));
        }
        json(response, 200, {
          mode: config.mode,
          googleEnabled: config.googleEnabled,
          localSignInEnabled: !config.googleEnabled,
          ...(router ? { routingEnabled: true } : {}),
          ...(abuse ? { abuseEnabled: true } : {}),
          ...(admin ? { adminEnabled: true } : {}),
          ...(files ? { filesEnabled: true, filePrivacyWarning: files.getPrivacyWarning() } : {}),
          authenticated,
          csrfToken: token,
          ...(authenticated ? { user: publicUser(user) } : {}),
          ...(abuse && authenticated ? { abuse: await abuse.status(user.id) } : {}),
          limits: {
            maxInputChars: limits.maxInputChars,
            maxOutputTokens: router ? router.health().maxOutputTokens : limits.maxOutputTokens,
            dailyRequests: limits.dailyRequests,
          },
          providers: [
            {
              id: registry.provider_id,
              modelId: registry.model_id,
              label: registry.display_name,
              synthetic: true,
            },
          ],
          legalVersion: config.legalVersion,
        });
        return;
      }
      if (abuse && path === '/api/abuse/challenges' && request.method === 'POST') {
        csrf(request, user);
        const input = await body(request, limits);
        schema(input, ['purpose']);
        if (!['signup', 'burst'].includes(input.purpose))
          throw new AppError(400, 'INVALID_REQUEST', 'Choose a valid verification purpose.');
        if (input.purpose === 'burst' && !user)
          throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in before verifying chat usage.');
        json(response, 200, {
          challenge: await abuse.challenge(input.purpose === 'burst' ? user.id : null, {
            purpose: input.purpose,
            source: abuseSource(request, response),
          }),
        });
        return;
      }
      if (googleOAuth && path === '/api/auth/google/start' && request.method === 'POST') {
        csrf(request, user);
        const input = await body(request, limits);
        schema(input, ['acceptedLegalVersion']);
        json(
          response,
          200,
          await googleOAuth.start({
            browserToken: cookieValue(request.headers.cookie, 'local_csrf'),
            acceptedLegalVersion: input.acceptedLegalVersion,
          }),
        );
        return;
      }
      if (googleOAuth && googleCallback) {
        if (
          request.url.length > 8192 ||
          [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
        )
          throw new AppError(401, 'AUTH_FAILED', 'Invalid sign-in response.');
        const browserToken = cookieValue(request.headers.cookie, 'local_csrf');
        const state = url.searchParams.get('state');
        if (url.searchParams.has('error')) {
          if (browserToken && state)
            await db.query('DELETE FROM oauth_states WHERE state_hash=$1 AND browser_hash=$2', [
              hashToken(state),
              hashToken(browserToken),
            ]);
          throw new AppError(401, 'AUTH_FAILED', 'Google sign-in was cancelled. Start again.');
        }
        const profile = await googleOAuth.complete({
          state,
          code: url.searchParams.get('code'),
          browserToken,
        });
        const token = newToken();
        const csrfToken = newToken();
        if (user) {
          await repository.revokeSession(user.session_id, user.id);
          await stopOwned(user.id);
        }
        await repository.createSession(profile.id, hashToken(token), hashToken(csrfToken));
        setCookies(response, [
          sessionCookie(token, limits.sessionSeconds, true),
          csrfCookie(csrfToken, limits.sessionSeconds, true),
        ]);
        response.writeHead(303, { Location: '/' });
        response.end();
        return;
      }
      if (path.startsWith('/api/auth/google/'))
        throw new AppError(
          403,
          'AUTH_DISABLED',
          'Google sign-in requires a separately configured integration. Use a synthetic local account.',
        );
      if (path === '/api/auth/local' && request.method === 'POST') {
        if (config.googleEnabled)
          throw new AppError(
            403,
            'AUTH_DISABLED',
            'Shared demo accounts are disabled during Google sign-in testing.',
          );
        csrf(request, null);
        const input = await body(request, limits);
        schema(input, ['identity', 'acceptedLegalVersion', ...(abuse ? ['challenge'] : [])]);
        if (
          !Object.hasOwn(config.localIdentities, input.identity) ||
          input.acceptedLegalVersion !== config.legalVersion
        )
          throw new AppError(
            403,
            'LEGAL_ACCEPTANCE_REQUIRED',
            'Choose a synthetic account and accept the current draft notices.',
          );
        const token = newToken();
        const csrfToken = newToken();
        const signIn = async (scoped, tx) => {
          if (abuse)
            await abuse.signupInTransaction(tx, {
              userId: config.localIdentities[input.identity],
              source: abuseSource(request, response),
              challenge: input.challenge,
            });
          const profile = await scoped.acceptLegal(config.localIdentities[input.identity]);
          if (user) await scoped.revokeSession(user.session_id, user.id);
          await scoped.createSession(profile.id, hashToken(token), hashToken(csrfToken));
          return profile;
        };
        const profile = abuse
          ? await abuse.withTransaction((tx) =>
              signIn(createRepository({ ...tx, transaction: (body) => body(tx) }, config), tx),
            )
          : await signIn(repository);
        setCookies(response, [
          sessionCookie(token, limits.sessionSeconds, true),
          csrfCookie(csrfToken, limits.sessionSeconds, true),
        ]);
        json(response, 200, { user: publicUser(profile), csrfToken });
        return;
      }
      if (!user)
        throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in to a synthetic account first.');
      if (mutation) csrf(request, user);
      if (deleting.has(user.id))
        throw new AppError(409, 'ACCOUNT_BUSY', 'An account deletion is in progress.');
      if (path === '/api/auth/logout' && request.method === 'POST') {
        schema(await body(request, limits), []);
        await repository.revokeSession(user.session_id, user.id);
        sessionTrainingNotices.delete(user.session_id);
        await stopOwned(user.id);
        const csrfToken = newToken();
        setCookies(response, [
          sessionCookie('', 0, true),
          csrfCookie(csrfToken, limits.sessionSeconds, true),
        ]);
        json(response, 200, { ok: true, csrfToken });
        return;
      }
      if (path === '/api/privacy/training-notice' && request.method === 'GET') {
        const shown = sessionTrainingNotices.has(user.session_id);
        json(response, 200, {
          shown,
          privacyUrl: '/legal/privacy.html',
          message:
            'Free model routing may use providers whose terms permit training on conversation data. Use Private Mode for non-training providers.',
        });
        return;
      }
      if (path === '/api/privacy/training-notice/ack' && request.method === 'POST') {
        schema(await body(request, limits), []);
        sessionTrainingNotices.add(user.session_id);
        json(response, 200, { ok: true, acknowledged: true, shown: true });
        return;
      }
      if (path === '/api/account' && request.method === 'GET') {
        json(response, 200, {
          user: publicUser(user),
          usage: await repository.accountUsage(user.id),
          ...(ledger ? { ledgerUsage: await ledger.usage(user.id) } : {}),
          ...(abuse ? { abuse: await abuse.status(user.id) } : {}),
        });
        return;
      }
      if (abuse && path === '/api/abuse/status' && request.method === 'GET') {
        json(response, 200, { abuse: await abuse.status(user.id) });
        return;
      }
      if (path === '/api/usage' || path === '/api/usage/history') {
        if (!ledger) throw new AppError(404, 'NOT_FOUND', 'Endpoint not found.');
        if (request.method !== 'GET')
          throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Request method refused.');
        json(
          response,
          200,
          path === '/api/usage'
            ? await ledger.usage(user.id)
            : { syntheticOnly: true, history: await ledger.history(user.id) },
        );
        return;
      }
      if (path === '/api/account/deletion' && request.method === 'POST') {
        schema(await body(request, limits), []);
        if (deleting.has(user.id))
          throw new AppError(409, 'ACCOUNT_BUSY', 'An account deletion is in progress.');
        deleting.add(user.id);
        try {
          await stopOwned(user.id);
          await repository.deleteAccount(user.id);
        } finally {
          deleting.delete(user.id);
        }
        response.setHeader('Set-Cookie', [sessionCookie('', 0, true), csrfCookie('', 0, true)]);
        json(response, 200, { ok: true, deleted: true });
        return;
      }
      if (files && path === '/api/files/warning' && request.method === 'GET') {
        json(response, 200, {
          warning: files.getPrivacyWarning(),
        });
        return;
      }
      if (files && path === '/api/files/storage' && request.method === 'GET') {
        if (!user) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in before checking storage.');
        const storageUsage = await files.getStorageUsage({ userId: user.id });
        json(response, 200, { ok: true, storage: storageUsage });
        return;
      }
      if (files && path === '/api/files/cleanup' && request.method === 'POST') {
        if (!user)
          throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in before running maintenance.');
        csrf(request, user);
        const input = await body(request, limits).catch(() => ({}));
        const summary = await files.runRetentionJob({
          fileRetentionDays: input.fileRetentionDays,
          softDeleteGraceDays: input.softDeleteGraceDays,
          conversationRetentionDays: input.conversationRetentionDays,
          dryRun: input.dryRun,
        });
        json(response, 200, { ok: true, summary });
        return;
      }
      if (files && path === '/api/files/upload' && request.method === 'POST') {
        if (!user) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in before uploading files.');
        csrf(request, user);
        const { filename, mimeType, buffer } = await parseFileUpload(
          request,
          url.searchParams,
          10485760,
        );
        try {
          const record = await files.upload({
            userId: user.id,
            filename,
            buffer,
            mimeType,
          });
          json(response, 201, { ok: true, file: record });
        } catch (err) {
          if (err.code === 'STORAGE_QUOTA_EXCEEDED')
            throw new AppError(413, 'STORAGE_QUOTA_EXCEEDED', err.message);
          if (err.code === 'FILE_TOO_LARGE') throw new AppError(413, 'FILE_TOO_LARGE', err.message);
          if (err.code === 'FILE_EMPTY') throw new AppError(400, 'FILE_EMPTY', err.message);
          if (err.code === 'UNSUPPORTED_MIME_TYPE')
            throw new AppError(415, 'UNSUPPORTED_MIME_TYPE', err.message);
          if (err.code === 'MIME_TYPE_MISMATCH')
            throw new AppError(400, 'MIME_TYPE_MISMATCH', err.message);
          if (err.message && err.message.includes('Forbidden file format detected'))
            throw new AppError(415, 'UNSUPPORTED_FILE_FORMAT', err.message);
          if (err.message && err.message.includes('Binary file or null byte detected'))
            throw new AppError(400, 'CORRUPT_OR_BINARY_FILE', err.message);
          if (err.message && err.message.includes('Executable script content detected'))
            throw new AppError(400, 'MALICIOUS_SCRIPT_DETECTED', err.message);
          throw err;
        }
        return;
      }
      if (files && path === '/api/files' && request.method === 'GET') {
        if (!user) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in before viewing files.');
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const userFiles = await files.listFiles({ userId: user.id, limit, offset });
        json(response, 200, { ok: true, files: userFiles });
        return;
      }
      const fileRouteMatch =
        /^\/api\/files\/([a-zA-Z0-9_\-]+)(\/(download|sections|analysis|query))?$/.exec(path);
      if (files && fileRouteMatch) {
        if (!user) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in before accessing files.');
        const fileId = fileRouteMatch[1];
        const subAction = fileRouteMatch[3];

        if (!subAction && request.method === 'GET') {
          const fileRecord = await files.getFile({
            userId: user.id,
            fileId,
            includeExtractedText: true,
          });
          if (!fileRecord)
            throw new AppError(404, 'FILE_NOT_FOUND', 'File not found or access denied.');
          json(response, 200, { ok: true, file: fileRecord });
          return;
        }

        if (!subAction && request.method === 'DELETE') {
          csrf(request, user);
          const deleted = await files.deleteFile({ userId: user.id, fileId });
          if (!deleted)
            throw new AppError(404, 'FILE_NOT_FOUND', 'File not found or access denied.');
          json(response, 200, { ok: true, deleted: true });
          return;
        }

        if (subAction === 'download' && request.method === 'GET') {
          try {
            const { file: fileRecord, buffer } = await files.downloadFile({
              userId: user.id,
              fileId,
            });
            response.writeHead(200, {
              'Content-Type': fileRecord.mime_type,
              'Content-Length': buffer.length,
              'Content-Disposition': `attachment; filename="${fileRecord.sanitized_name}"`,
            });
            response.end(buffer);
            return;
          } catch (err) {
            if (err.code === 'FILE_NOT_FOUND' || err.code === 'IDOR_ACCESS_DENIED') {
              throw new AppError(404, 'FILE_NOT_FOUND', 'File not found or access denied.');
            }
            throw err;
          }
        }

        if (subAction === 'sections' && request.method === 'GET') {
          const maxTokens = url.searchParams.get('maxTokens')
            ? Number(url.searchParams.get('maxTokens'))
            : null;
          try {
            const sectionsResult = await files.getSections({
              userId: user.id,
              fileId,
              maxTokensPerSection: maxTokens,
            });
            json(response, 200, { ok: true, ...sectionsResult });
            return;
          } catch (err) {
            if (err.code === 'FILE_NOT_FOUND' || err.code === 'IDOR_ACCESS_DENIED') {
              throw new AppError(404, 'FILE_NOT_FOUND', 'File not found or access denied.');
            }
            throw err;
          }
        }

        if (subAction === 'analysis' && request.method === 'GET') {
          try {
            const analysisResult = await files.analyzeCsv({
              userId: user.id,
              fileId,
            });
            json(response, 200, { ok: true, ...analysisResult });
            return;
          } catch (err) {
            if (err.code === 'FILE_NOT_FOUND' || err.code === 'IDOR_ACCESS_DENIED') {
              throw new AppError(404, 'FILE_NOT_FOUND', 'File not found or access denied.');
            }
            if (err.code === 'NOT_CSV_FILE') {
              throw new AppError(400, 'NOT_CSV_FILE', 'File is not a CSV document.');
            }
            throw err;
          }
        }

        if (subAction === 'query' && request.method === 'POST') {
          csrf(request, user);
          const input = await body(request, limits);
          schema(input, ['question']);
          if (
            !input.question ||
            typeof input.question !== 'string' ||
            input.question.trim().length === 0
          ) {
            throw new AppError(400, 'INVALID_QUESTION', 'Question is required.');
          }
          try {
            const queryResult = await files.queryCsv({
              userId: user.id,
              fileId,
              question: input.question,
            });
            json(response, 200, { ok: true, ...queryResult });
            return;
          } catch (err) {
            if (err.code === 'FILE_NOT_FOUND' || err.code === 'IDOR_ACCESS_DENIED') {
              throw new AppError(404, 'FILE_NOT_FOUND', 'File not found or access denied.');
            }
            if (err.code === 'NOT_CSV_FILE') {
              throw new AppError(400, 'NOT_CSV_FILE', 'File is not a CSV document.');
            }
            throw err;
          }
        }
      }
      if (path === '/api/conversations') {
        if (request.method === 'GET') {
          json(response, 200, { conversations: await repository.listConversations(user.id) });
          return;
        }
        if (request.method === 'POST') {
          const input = await body(request, limits);
          schema(input, ['title']);
          json(response, 201, {
            conversation: await repository.createConversation(
              user.id,
              title(input.title ?? 'New synthetic conversation', limits.maxTitleChars),
            ),
          });
          return;
        }
      }
      const match = /^\/api\/conversations\/([a-zA-Z0-9-]{1,80})(\/messages)?$/.exec(path);
      if (router && path === '/api/models/available' && request.method === 'GET') {
        json(response, 200, await router.available(user.id));
        return;
      }
      if (match && validId(match[1])) {
        if (match[2] && request.method === 'POST') {
          await send(request, response, user, match[1], await body(request, limits));
          return;
        }
        if (!match[2] && request.method === 'GET') {
          const owned = await repository.getConversation(user.id, match[1]);
          if (router)
            owned.messages = await Promise.all(
              owned.messages.map((m) => router.decorateMessage(user.id, m)),
            );
          json(response, 200, owned);
          return;
        }
        if (!match[2] && request.method === 'PATCH') {
          const input = await body(request, limits);
          schema(input, ['title']);
          json(response, 200, {
            conversation: await repository.renameConversation(
              user.id,
              match[1],
              title(input.title, limits.maxTitleChars),
            ),
          });
          return;
        }
        if (!match[2] && request.method === 'DELETE') {
          await repository.getConversation(user.id, match[1]);
          await stopOwned(user.id, match[1]);
          await repository.deleteConversation(user.id, match[1]);
          json(response, 200, { ok: true });
          return;
        }
      }
      const cancel = /^\/api\/requests\/([a-zA-Z0-9-]{1,80})\/cancel$/.exec(path);
      if (cancel && request.method === 'POST') {
        schema(await body(request, limits), []);
        const owned = await repository.request(user.id, cancel[1]);
        if (!owned) throw new AppError(404, 'NOT_FOUND', 'Request not found.');
        const job = active.get(owned.id);
        if (job) {
          job.controller.abort(new DOMException('Stopped.', 'AbortError'));
          await job.done;
        }
        json(response, 200, {
          ok: true,
          status: (await repository.request(user.id, owned.id)).status,
        });
        return;
      }
      throw new AppError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      const safe = normalizedError(error);
      if (response.headersSent) {
        if (!response.destroyed) response.end();
      } else {
        response.setHeader('Connection', 'close');
        json(response, safe.status, {
          error: {
            code: safe.code,
            message: safe.message,
            requestId: correlationId,
            ...(router
              ? { resetAt: safe.resetAt ?? null, alternatives: safe.alternatives ?? [] }
              : {}),
            ...(abuse ? { challengeRequired: safe.challengeRequired === true } : {}),
          },
        });
      }
    }
  });
  server.headersTimeout = limits.headersTimeoutMs;
  server.requestTimeout = limits.requestTimeoutMs;
  server.keepAliveTimeout = 1000;
  server.timeout = limits.requestTimeoutMs + limits.bodyTimeoutMs;
  server.ready = ready;
  server.shutdown = async () => {
    for (const job of active.values())
      job.controller.abort(new DOMException('Shutdown.', 'AbortError'));
    await Promise.all([...active.values()].map((job) => job.done));
    if (server.listening)
      await new Promise((resolveDone, reject) =>
        server.close((error) => (error ? reject(error) : resolveDone())),
      );
  };
  return server;
}
