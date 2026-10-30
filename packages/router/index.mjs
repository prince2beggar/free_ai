import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, normalizedError } from '../api/errors.mjs';
import { createLedger } from '../ledger/index.mjs';
import { createGovernor } from '../governor/index.mjs';
import { integer } from '../ledger/arithmetic.mjs';
import { usageDayStart } from '../api/repository.mjs';
import { resolveRoutingSelection, rankRoutingCandidates } from './policy.mjs';
import { buildProductivityPrompt } from '../productivity/index.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));
const fail = (code, message, status = 409) => {
  throw new AppError(status, code, message);
};
const hash = (s) => createHash('sha256').update(s).digest('hex');
const iso = (n) => new Date(n).toISOString();
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
function shape(v, fields) {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !fields.includes(k))
  )
    fail('INVALID_ROUTER', 'Unknown field or invalid routing payload.', 400);
}
function identifier(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(v))
    fail('INVALID_ROUTER', 'Invalid routing identifier.', 400);
  return v;
}
function validateInput(data) {
  shape(data, ['requestId', 'conversationId', 'messages', 'language', 'routing']);
  identifier(data.requestId);
  identifier(data.conversationId);
  if (
    !['en', 'bn'].includes(data.language) ||
    !Array.isArray(data.messages) ||
    !data.messages.length ||
    data.messages.length > 200 ||
    Buffer.byteLength(JSON.stringify(data.messages)) > 65536
  )
    fail('INVALID_ROUTER', 'Invalid bounded synthetic context.', 400);
  shape(data.routing ?? {}, [
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
  if (
    data.routing?.sensitivity !== undefined &&
    !['standard', 'private'].includes(data.routing.sensitivity)
  )
    fail('INVALID_ROUTER', 'Invalid sensitivity setting.', 400);
  if (data.routing?.privateMode !== undefined && typeof data.routing.privateMode !== 'boolean')
    fail('INVALID_ROUTER', 'Invalid private mode flag.', 400);
  if (
    data.routing?.contextAction !== undefined &&
    !['trim', 'refuse'].includes(data.routing.contextAction)
  )
    fail('INVALID_ROUTER', 'Invalid context action.', 400);
  if (
    data.routing?.action !== undefined &&
    !['send', 'retry', 'regenerate'].includes(data.routing.action)
  )
    fail('INVALID_ROUTER', 'Invalid request action.', 400);
}
const inputHash = (data) =>
  hash(
    JSON.stringify(
      canonical({ messages: data.messages, language: data.language, routing: data.routing ?? {} }),
    ),
  );
const txAdapter = (tx) => ({ ...tx, transaction: async (fn) => fn(tx) });
const attemptFields =
  '*,input_bound::text AS input_bound,output_bound::text AS output_bound,actual_input::text AS actual_input,actual_output::text AS actual_output';

/** Trusted synthetic routing. All provider-like transports must be explicitly synthetic. */
export function createRouter(db, options = {}) {
  shape(options, [...Object.keys(defaults), 'staffActorId', 'gateways', 'clock', 'admissionGuard']);
  const config = structuredClone(
    Object.fromEntries(
      Object.entries({ ...defaults, ...options }).filter(
        ([k]) => !['clock', 'gateways', 'admissionGuard'].includes(k),
      ),
    ),
  );
  identifier(config.staffActorId);
  if (config.localOnly !== true)
    fail('INVALID_ROUTER_CONFIG', 'Router must remain local and synthetic.', 400);
  if (typeof config.allowManualFallback !== 'boolean')
    fail('INVALID_ROUTER_CONFIG', 'Invalid manual fallback policy.', 400);
  for (const k of ['maxRetries', 'maxFallbacks'])
    if (!Number.isInteger(config[k]) || config[k] < 0 || config[k] > 5)
      fail('INVALID_ROUTER_CONFIG', 'Invalid bounded retry budget.', 400);
  for (const k of [
    'breakerFailures',
    'breakerWindowMs',
    'coolOffMs',
    'requestTimeoutMs',
    'reconciliationMs',
    'reservationTtlMs',
    'maxOutputTokens',
    'maxRequests',
    'maxAttempts',
    'maxEvents',
    'maxPolicyVersions',
    'maxCandidates',
  ])
    if (!Number.isInteger(config[k]) || config[k] < 1 || config[k] > 86400000)
      fail('INVALID_ROUTER_CONFIG', 'Invalid bounded routing configuration.', 400);
  if (
    config.maxCandidates > 100 ||
    config.maxRequests > 100000 ||
    config.maxAttempts > 100000 ||
    config.maxEvents > 100000 ||
    config.maxPolicyVersions > 10000 ||
    config.maxOutputTokens > 16384 ||
    !Number.isInteger(config.dayOffsetMinutes) ||
    Math.abs(config.dayOffsetMinutes) > 840
  )
    fail('INVALID_ROUTER_CONFIG', 'Routing bounds exceed the local envelope.', 400);
  shape(config.systemPrompts, [
    'general',
    'coding',
    'writing',
    'research',
    'translation',
    'summary',
  ]);
  for (const preset of Object.keys(config.systemPrompts))
    if (
      typeof config.systemPrompts[preset] !== 'string' ||
      Buffer.byteLength(config.systemPrompts[preset]) > 4096
    )
      fail('INVALID_ROUTER_CONFIG', 'Invalid trusted system prompt.', 400);
  const gateways = { ...options.gateways };
  if (
    !options.gateways ||
    typeof options.gateways !== 'object' ||
    Array.isArray(options.gateways) ||
    Object.keys(gateways).length > config.maxCandidates
  )
    fail('INVALID_ROUTER_CONFIG', 'Expected bounded synthetic gateways.', 400);
  for (const [modelId, g] of Object.entries(gateways)) {
    identifier(modelId);
    if (
      g?.synthetic !== true ||
      g.modelId !== modelId ||
      typeof g.stream !== 'function' ||
      typeof g.health !== 'function'
    )
      fail('INVALID_ROUTER_CONFIG', 'Only explicit synthetic gateways are permitted.', 400);
    identifier(g.providerId);
  }
  const clock = options.clock ?? Date.now;
  const admissionGuard = options.admissionGuard;
  if (admissionGuard !== undefined && typeof admissionGuard !== 'function')
    fail('INVALID_ROUTER_CONFIG', 'Invalid trusted admission guard.', 400);
  if (typeof clock !== 'function')
    fail('INVALID_ROUTER_CONFIG', 'Invalid trusted routing clock.', 400);
  const now = () => {
    const n = clock();
    if (!Number.isSafeInteger(n) || !Number.isFinite(new Date(n).getTime()))
      fail('INVALID_ROUTER_CONFIG', 'Invalid routing time.', 400);
    return n;
  };
  const ledger = (client) =>
    createLedger(client, { clock, reconciliationMs: config.reconciliationMs });
  const governor = (client) =>
    createGovernor(client, {
      clock,
      reconciliationMs: config.reconciliationMs,
      reservationTtlMs: config.reservationTtlMs,
    });
  async function actor(tx, userId, staff = false, allowSuspended = false) {
    identifier(userId);
    const r = (
      await tx.query(
        "SELECT id,role FROM users WHERE id=$1 AND identity_provider='synthetic' AND (status='active' OR ($2 AND status='suspended')) AND deleted_at IS NULL",
        [userId, allowSuspended],
      )
    ).rows[0];
    if (!r || (staff && !['owner', 'super_admin', 'admin'].includes(r.role)))
      fail(
        'ROUTER_FORBIDDEN',
        'Active synthetic identity and trusted staff permission required.',
        403,
      );
    return r;
  }
  async function guard(tx) {
    const row = (await tx.query('SELECT last_time FROM router_storage_guard WHERE id=1 FOR UPDATE'))
      .rows[0];
    const time = now();
    if (row.last_time && time < new Date(row.last_time).getTime())
      fail('ROUTER_CLOCK', 'Routing clock moved backwards.');
    await tx.query('UPDATE router_storage_guard SET last_time=$1 WHERE id=1', [iso(time)]);
    return time;
  }
  async function event(tx, userId, kind, requestId = null, attemptId = null, metadata = {}) {
    const a = await actor(tx, userId);
    await tx.query(
      'INSERT INTO router_events(id,actor_id,actor_role,request_id,attempt_id,kind,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
      [
        randomUUID(),
        a.id,
        a.role,
        requestId,
        attemptId,
        kind,
        JSON.stringify(metadata),
        iso(now()),
      ],
    );
  }
  async function storage(tx) {
    const future = (
      await tx.query(
        "SELECT (SELECT COALESCE(sum((1+max_retries+max_fallbacks)*2+2),0) FROM router_requests WHERE state='RUNNING')+(SELECT COALESCE(sum(CASE state WHEN 'DISPATCHED' THEN 2 WHEN 'PENDING_RECONCILIATION' THEN 2 WHEN 'ESTIMATED' THEN 1 ELSE 0 END),0) FROM router_accounting_holds)::int AS n",
      )
    ).rows[0].n;
    for (const [table, max] of [
      ['router_requests', config.maxRequests],
      ['router_attempts', config.maxAttempts],
      ['router_accounting_holds', config.maxAttempts],
      ['router_policy_versions', config.maxPolicyVersions],
      ['router_events', config.maxEvents],
    ]) {
      const n = (await tx.query('SELECT count(*)::int AS n FROM ' + table)).rows[0].n;
      if (n + (table === 'router_events' ? future : 0) > max)
        fail('ROUTER_STORAGE_FULL', 'Bounded routing storage cannot admit more work.', 503);
    }
  }
  async function request(tx, userId, requestId, lock = true) {
    identifier(requestId);
    const r = (
      await tx.query(
        'SELECT * FROM router_requests WHERE id=$1 AND user_id=$2' + (lock ? ' FOR UPDATE' : ''),
        [requestId, userId],
      )
    ).rows[0];
    if (!r) fail('ROUTER_NOT_FOUND', 'Routing request not found.', 404);
    return r;
  }
  async function policy(tx) {
    const p = (
      await tx.query('SELECT data FROM routing_policies WHERE id=$1 FOR SHARE', [config.policy.id])
    ).rows[0]?.data;
    if (!p) fail('ROUTING_POLICY_UNKNOWN', 'No active routing policy is configured.', 503);
    return p;
  }
  async function plan(tx, userId, data, preparedPolicy = null) {
    await actor(tx, userId);
    await actor(tx, config.staffActorId, true);
    const p = preparedPolicy ?? (await policy(tx)),
      r = data.routing ?? {};
    const selection = resolveRoutingSelection(p, {
      ...Object.fromEntries(
        [
          'mode',
          'modelId',
          'preset',
          'requiredCapabilities',
          'modelClass',
          'sensitivity',
          'privateMode',
          'productivity',
        ]
          .filter((k) => r[k] !== undefined && r[k] !== null)
          .map((k) => [k, r[k]]),
      ),
      language: data.language,
    });
    const owned = await ledger(txAdapter(tx)).usage(userId);
    const active = owned.entitlements.filter(
      (e) =>
        e.status === 'active' &&
        new Date(e.startsAt).getTime() <= now() &&
        new Date(e.endsAt).getTime() > now(),
    );
    const funded = active
      .filter((e) => e.kind === 'pack')
      .reduce((a, e) => a + integer(e.remaining.costMicroCu), 0n);
    const rows = (
      await tx.query(
        "SELECT area,data FROM registry_metadata WHERE area IN ('provider','model') ORDER BY target_id LIMIT $1",
        [config.maxCandidates * 2 + 1],
      )
    ).rows;
    if (rows.length > config.maxCandidates * 2)
      fail('ROUTER_STORAGE_FULL', 'Registry exceeds bounded routing candidate storage.', 503);
    const observed = (
      await tx.query(
        "SELECT model_id,avg(latency_ms)::float AS latency FROM router_attempts WHERE state='COMPLETE' AND latency_ms IS NOT NULL GROUP BY model_id",
      )
    ).rows;
    const ranked = rankRoutingCandidates({
      providers: rows.filter((r) => r.area === 'provider').map((r) => r.data),
      models: rows.filter((r) => r.area === 'model').map((r) => r.data),
      policy: p,
      selection,
      messages: data.messages,
      systemPrompt: selection.productivity
        ? buildProductivityPrompt(
            selection.productivity,
            config.systemPrompts[selection.preset] ?? config.systemPrompts.general ?? '',
            data.language,
          )
        : (config.systemPrompts[selection.preset] ?? config.systemPrompts.general ?? ''),
      maxOutputTokens: config.maxOutputTokens,
      contextAction: r.contextAction ?? 'trim',
      fundedBalanceMicroCu: integer(funded).toString(),
      latencyByModel: Object.fromEntries(observed.map((r) => [r.model_id, r.latency])),
    });
    const candidates = [],
      rejected = [...ranked.rejected];
    let resetAt = null;
    for (const c of ranked.candidates) {
      const g = gateways[c.model.id];
      if (!g || g.providerId !== c.provider.id) {
        rejected.push({ modelId: c.model.id, reason: 'SYNTHETIC_GATEWAY_UNAVAILABLE' });
        continue;
      }
      const breakers = (
        await tx.query('SELECT opened_until FROM router_breakers WHERE id=ANY($1::text[])', [
          ['provider-' + c.provider.id, 'model-' + c.model.id],
        ])
      ).rows;
      if (breakers.some((b) => b.opened_until && new Date(b.opened_until).getTime() > now())) {
        rejected.push({ modelId: c.model.id, reason: 'CIRCUIT_OPEN' });
        for (const b of breakers)
          if (b.opened_until && (!resetAt || new Date(b.opened_until) < new Date(resetAt)))
            resetAt = iso(new Date(b.opened_until).getTime());
        continue;
      }
      const entitlement = active.find(
        (e) =>
          (c.model.freeFlag || e.kind === 'pack') &&
          (c.model.freeFlag || integer(e.remaining.costMicroCu) > 0n) &&
          integer(e.remaining.costMicroCu) >= integer(c.estimatedCostMicroCu) &&
          integer(e.remaining.inputTokens) >= BigInt(c.context.inputTokens) &&
          integer(e.remaining.outputTokens) >= BigInt(config.maxOutputTokens),
      );
      if (!entitlement) {
        rejected.push({ modelId: c.model.id, reason: 'INSUFFICIENT_BALANCE' });
        continue;
      }
      const routes = (
        await tx.query(
          'SELECT account_ref FROM capacity_routes WHERE model_id=$1 ORDER BY account_ref',
          [c.model.id],
        )
      ).rows;
      // Never rotate accounts to evade a shared account cap.
      if (routes.length !== 1) {
        rejected.push({ modelId: c.model.id, reason: 'CAPACITY_SCOPE_UNKNOWN' });
        continue;
      }
      try {
        const s = await governor(txAdapter(tx)).snapshot(config.staffActorId, {
          modelId: c.model.id,
          accountRef: routes[0].account_ref,
        });
        const bounds = {
          requests: 1n,
          tokens: BigInt(c.context.inputTokens + config.maxOutputTokens),
          input_tokens: BigInt(c.context.inputTokens),
          output_tokens: BigInt(config.maxOutputTokens),
        };
        if (s.limits.some((l) => integer(l.remaining) < bounds[l.metric])) {
          rejected.push({ modelId: c.model.id, reason: 'CAPACITY_EXHAUSTED' });
          for (const l of s.limits)
            if (
              integer(l.remaining) < bounds[l.metric] &&
              (!resetAt || new Date(l.resetsAt) < new Date(resetAt))
            )
              resetAt = l.resetsAt;
          continue;
        }
        c.accountRef = routes[0].account_ref;
        c.entitlement = entitlement;
        candidates.push(c);
      } catch (error) {
        if (!['CAPACITY_UNKNOWN', 'CAPACITY_UNAVAILABLE'].includes(error.code)) throw error;
        rejected.push({ modelId: c.model.id, reason: error.code });
      }
    }
    return {
      policy: p,
      selection,
      candidates,
      rejected,
      resetAt,
      trainingNoticeRequired: ranked.trainingNoticeRequired ?? false,
    };
  }
  async function breaker(tx, c, failed) {
    for (const id of ['provider-' + c.provider_id, 'model-' + c.model_id]) {
      const old = (await tx.query('SELECT * FROM router_breakers WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      const fresh =
        !old ||
        now() - new Date(old.window_at).getTime() >= config.breakerWindowMs ||
        (old.opened_until && now() >= new Date(old.opened_until).getTime());
      if (!old && !failed) continue;
      const failures = (fresh ? 0 : old.failures) + (failed ? 1 : 0);
      await tx.query(
        'INSERT INTO router_breakers(id,failures,window_at,opened_until) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET failures=$2,window_at=$3,opened_until=$4',
        [
          id,
          failures,
          iso(fresh ? now() : new Date(old.window_at).getTime()),
          failed && failures >= config.breakerFailures
            ? iso(now() + config.coolOffMs)
            : fresh
              ? null
              : old.opened_until,
        ],
      );
    }
  }
  async function daily(tx, a, actual, correction = false) {
    const bound = integer(a.input_bound) + integer(a.output_bound);
    const old =
      integer(a.actual_input ?? a.input_bound) + integer(a.actual_output ?? a.output_bound);
    const amounts = [
      a.user_id,
      a.day_at,
      (correction ? actual - old : actual).toString(),
      correction ? '0' : bound.toString(),
    ];
    if (admissionGuard)
      await tx.query(
        'UPDATE abuse_daily_token_counters SET used_tokens=used_tokens+$3,reserved_tokens=reserved_tokens-$4 WHERE user_id=$1 AND day_at=$2',
        amounts,
      );
    if (a.kind === 'free')
      await tx.query(
        'UPDATE router_daily_counters SET used_tokens=used_tokens+$3,reserved_tokens=reserved_tokens-$4 WHERE user_id=$1 AND day_at=$2',
        amounts,
      );
  }
  async function finishAttempt(userId, attemptId, content, failed, providerFailure = failed) {
    return db.transaction(async (tx) => {
      await guard(tx);
      const a = (
        await tx.query(
          'SELECT a.*,a.input_bound::text AS input_bound,a.output_bound::text AS output_bound,a.actual_input::text AS actual_input,a.actual_output::text AS actual_output,r.user_id FROM router_attempts a JOIN router_requests r ON r.id=a.request_id WHERE a.id=$1 AND r.user_id=$2 FOR UPDATE OF a',
          [attemptId, userId],
        )
      ).rows[0];
      if (!a || a.state !== 'DISPATCHED')
        fail('ROUTER_RESOLVED', 'Routing attempt already resolved.');
      const client = txAdapter(tx);
      if (failed) {
        await ledger(client)[admissionGuard ? 'cancelDispatched' : 'cancel'](
          admissionGuard ? config.staffActorId : userId,
          {
            reservationId: a.id,
            idempotencyKey: 'router-pending-ledger-' + a.id,
          },
        );
        await governor(client)[admissionGuard ? 'cancelDispatched' : 'cancel'](
          admissionGuard ? config.staffActorId : userId,
          {
            reservationId: a.id,
            idempotencyKey: 'router-pending-capacity-' + a.id,
          },
        );
        await tx.query(
          "UPDATE router_attempts SET state='PENDING_RECONCILIATION',content=$2,latency_ms=$3 WHERE id=$1",
          [a.id, content, Math.max(0, now() - new Date(a.dispatched_at).getTime())],
        );
      } else {
        const usage = {
          reservationId: a.id,
          inputTokens: a.input_bound,
          outputTokens: String(Array.from(content).length),
        };
        await ledger(client).settle(config.staffActorId, {
          ...usage,
          idempotencyKey: 'router-settle-ledger-' + a.id,
        });
        await governor(client).settle(config.staffActorId, {
          ...usage,
          idempotencyKey: 'router-settle-capacity-' + a.id,
        });
        await daily(tx, a, integer(usage.inputTokens) + integer(usage.outputTokens));
        await tx.query(
          "UPDATE router_attempts SET state='COMPLETE',content=$2,actual_input=$3,actual_output=$4,latency_ms=$5 WHERE id=$1",
          [
            a.id,
            content,
            usage.inputTokens,
            usage.outputTokens,
            Math.max(0, now() - new Date(a.dispatched_at).getTime()),
          ],
        );
      }
      await tx.query(
        'UPDATE router_accounting_holds SET state=$2,actual_input=$3,actual_output=$4 WHERE attempt_id=$1',
        [
          a.id,
          failed ? 'PENDING_RECONCILIATION' : 'COMPLETE',
          failed ? null : a.input_bound,
          failed ? null : String(Array.from(content).length),
        ],
      );
      if (!failed || providerFailure) await breaker(tx, a, failed);
      await event(
        tx,
        config.staffActorId,
        failed ? 'ATTEMPT_PENDING' : 'ATTEMPT_COMPLETE',
        a.request_id,
        a.id,
        { modelId: a.model_id },
      );
      await storage(tx);
      return a;
    });
  }
  async function releaseKnownUnstarted(userId, attemptId) {
    await db.transaction(async (tx) => {
      await guard(tx);
      await actor(tx, config.staffActorId, true);
      const a = (
        await tx.query(
          'SELECT h.*,h.attempt_id AS id,h.input_bound::text AS input_bound,h.output_bound::text AS output_bound,h.actual_input::text AS actual_input,h.actual_output::text AS actual_output FROM router_accounting_holds h WHERE h.attempt_id=$1 AND h.user_id=$2 FOR UPDATE',
          [attemptId, userId],
        )
      ).rows[0];
      if (!a || a.state !== 'DISPATCHED')
        fail('ROUTER_RESOLVED', 'The unstarted attempt is already resolved.');
      const client = txAdapter(tx),
        usage = { reservationId: attemptId, inputTokens: '0', outputTokens: '0' };
      // This private path is called only before the gateway function is entered.
      // Zero usage is proven locally; it must not become a deadline estimate.
      await ledger(client).settle(config.staffActorId, {
        ...usage,
        idempotencyKey: 'router-not-called-ledger-' + attemptId,
      });
      await governor(client).settle(config.staffActorId, {
        ...usage,
        idempotencyKey: 'router-not-called-capacity-' + attemptId,
      });
      const requests = (
        await tx.query(
          "SELECT counter_id,used_amount::text AS used FROM capacity_allocations WHERE reservation_id=$1 AND metric='requests' AND used_amount>0 FOR UPDATE",
          [attemptId],
        )
      ).rows;
      for (const allocation of requests) {
        await tx.query('UPDATE capacity_counters SET used_amount=used_amount-$2 WHERE id=$1', [
          allocation.counter_id,
          allocation.used,
        ]);
        await tx.query(
          'UPDATE capacity_allocations SET used_amount=0 WHERE reservation_id=$1 AND counter_id=$2',
          [attemptId, allocation.counter_id],
        );
      }
      await daily(tx, a, 0n);
      await tx.query(
        "UPDATE router_attempts SET state='CORRECTED',actual_input=0,actual_output=0,reason='CANCELLED_BEFORE_TRANSPORT' WHERE id=$1",
        [attemptId],
      );
      await tx.query(
        "UPDATE router_accounting_holds SET state='CORRECTED',actual_input=0,actual_output=0 WHERE attempt_id=$1",
        [attemptId],
      );
      await event(tx, config.staffActorId, 'ATTEMPT_NOT_STARTED', a.request_id, attemptId, {
        knownNoCall: true,
        requestCountersReleased: requests.length,
      });
      await storage(tx);
    });
  }
  async function admitAttempt(userId, data, kind, previousModel = null, signal = null) {
    return db.transaction(async (tx) => {
      await guard(tx);
      const r = await request(tx, userId, data.requestId);
      if (r.state !== 'RUNNING') fail('ROUTER_RESOLVED', 'Routing request already resolved.');
      const family = await request(tx, userId, r.family_id);
      if (kind === 'retry') {
        if (family.retries_used >= family.max_retries)
          fail('RETRY_BUDGET', 'Retry budget exhausted.');
        await tx.query('UPDATE router_requests SET retries_used=retries_used+1 WHERE id=$1', [
          family.id,
        ]);
      }
      if (kind === 'fallback') {
        if (family.fallbacks_used >= family.max_fallbacks)
          fail('RETRY_BUDGET', 'Fallback budget exhausted.');
        await tx.query('UPDATE router_requests SET fallbacks_used=fallbacks_used+1 WHERE id=$1', [
          family.id,
        ]);
      }
      const prepared = (
        await tx.query(
          'SELECT data FROM router_policy_versions WHERE policy_id=$1 AND version=$2',
          [r.policy_id, r.policy_version],
        )
      ).rows[0]?.data;
      if (!prepared)
        fail('ROUTING_POLICY_UNKNOWN', 'Prepared routing policy snapshot is unavailable.', 503);
      const fallbackData =
        kind === 'fallback' &&
        config.allowManualFallback &&
        data.routing?.mode === 'manual' &&
        prepared.mode !== 'pinned'
          ? { ...data, routing: { ...data.routing, mode: 'auto', modelId: null } }
          : data;
      const p = await plan(tx, userId, fallbackData, prepared);
      const c =
        kind === 'retry'
          ? p.candidates.find((c) => c.model.id === previousModel)
          : kind === 'fallback'
            ? p.candidates.find((c) => c.model.id !== previousModel)
            : p.candidates[0];
      if (!c) {
        fail(
          'NO_ELIGIBLE_MODELS',
          'No eligible route is available. Wait for reset or use a simpler task.',
          503,
        );
      }
      const ordinal = (
        await tx.query('SELECT count(*)::int+1 AS n FROM router_attempts WHERE request_id=$1', [
          r.id,
        ])
      ).rows[0].n;
      const attemptId = randomUUID();
      const time = now(),
        day = usageDayStart(time, config.dayOffsetMinutes),
        bound = BigInt(c.context.inputTokens + config.maxOutputTokens);
      const client = txAdapter(tx);
      const abuseAdmission = admissionGuard
        ? await admissionGuard(tx, {
            userId,
            requestId: r.id,
            inputTokens: String(c.context.inputTokens),
            outputTokens: String(config.maxOutputTokens),
          })
        : null;
      if (abuseAdmission) {
        await tx.query(
          'INSERT INTO abuse_daily_token_counters(user_id,day_at) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [userId, day],
        );
        const total = (
          await tx.query(
            'SELECT used_tokens::text AS used,reserved_tokens::text AS reserved FROM abuse_daily_token_counters WHERE user_id=$1 AND day_at=$2 FOR UPDATE',
            [userId, day],
          )
        ).rows[0];
        if (
          integer(total.used) + integer(total.reserved) + bound >
          integer(String(abuseAdmission.limits.dailyTokens))
        )
          fail(
            'ABUSE_TOKEN_LIMIT',
            'Your current daily token limit is insufficient. Wait for reset.',
            429,
          );
        await tx.query(
          'UPDATE abuse_daily_token_counters SET reserved_tokens=reserved_tokens+$3 WHERE user_id=$1 AND day_at=$2',
          [userId, day, bound.toString()],
        );
      }
      if (c.entitlement.kind === 'free') {
        const allowance = await governor(client).allowance(userId);
        if (
          !allowance ||
          usageDayStart(Date.parse(allowance.createdAt), config.dayOffsetMinutes) !== day
        )
          fail(
            'DAILY_POLICY_UNAVAILABLE',
            'The daily token policy must be refreshed before sending.',
            503,
          );
        await tx.query(
          'INSERT INTO router_daily_counters(user_id,day_at) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [userId, day],
        );
        const total = (
          await tx.query(
            'SELECT used_tokens::text AS used,reserved_tokens::text AS reserved FROM router_daily_counters WHERE user_id=$1 AND day_at=$2 FOR UPDATE',
            [userId, day],
          )
        ).rows[0];
        const currentLimit = abuseAdmission?.limits?.dailyTokens;
        const tokenLimit =
          currentLimit === undefined
            ? integer(allowance.tokens)
            : integer(String(currentLimit)) < integer(allowance.tokens)
              ? integer(String(currentLimit))
              : integer(allowance.tokens);
        if (integer(total.used) + integer(total.reserved) + bound > tokenLimit)
          fail(
            'DAILY_TOKEN_LIMIT',
            'Your daily free token allowance is insufficient. Try a shorter task or wait for reset.',
            429,
          );
        await tx.query(
          'UPDATE router_daily_counters SET reserved_tokens=reserved_tokens+$3 WHERE user_id=$1 AND day_at=$2',
          [userId, day, bound.toString()],
        );
      }
      await ledger(client).reserve(userId, {
        entitlementId: c.entitlement.id,
        reservationId: attemptId,
        requestId: attemptId,
        kind: 'request',
        costMicroCu: c.estimatedCostMicroCu,
        inputTokens: String(c.context.inputTokens),
        outputTokens: String(config.maxOutputTokens),
        idempotencyKey: 'router-reserve-ledger-' + attemptId,
      });
      await governor(client).reserve(userId, {
        reservationId: attemptId,
        requestId: attemptId,
        modelId: c.model.id,
        accountRef: c.accountRef,
        inputTokens: String(c.context.inputTokens),
        outputTokens: String(config.maxOutputTokens),
        idempotencyKey: 'router-reserve-capacity-' + attemptId,
      });
      await ledger(client).dispatch(config.staffActorId, {
        reservationId: attemptId,
        modelId: c.model.id,
        idempotencyKey: 'router-dispatch-ledger-' + attemptId,
      });
      await tx.query(
        "INSERT INTO router_attempts(id,request_id,ordinal,provider_id,model_id,external_name,entitlement_id,kind,day_at,input_bound,output_bound,state,reason,dispatched_at,reconciliation_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DISPATCHED',$12,$13,$14)",
        [
          attemptId,
          r.id,
          ordinal,
          c.provider.id,
          c.model.id,
          c.model.externalName,
          c.entitlement.id,
          c.entitlement.kind,
          day,
          String(c.context.inputTokens),
          String(config.maxOutputTokens),
          kind,
          iso(time),
          iso(time + config.reconciliationMs),
        ],
      );
      await tx.query(
        'UPDATE router_requests SET context_trimmed=context_trimmed OR $2 WHERE id=$1',
        [r.id, c.context.removedMessages > 0],
      );
      await event(tx, config.staffActorId, 'ATTEMPT_DISPATCH', r.id, attemptId, {
        modelId: c.model.id,
        kind,
        policyVersion: p.policy.version,
        candidates: [
          ...p.candidates.map((c) => ({ modelId: c.model.id, reason: 'ELIGIBLE' })),
          ...p.rejected,
        ],
      });
      await storage(tx);
      await tx.query(
        "INSERT INTO router_accounting_holds(attempt_id,request_id,user_id,kind,day_at,input_bound,output_bound,state,reconciliation_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,'DISPATCHED',$8)",
        [
          attemptId,
          r.id,
          userId,
          c.entitlement.kind,
          day,
          String(c.context.inputTokens),
          String(config.maxOutputTokens),
          iso(time + config.reconciliationMs),
        ],
      );
      await storage(tx);
      // Governor is last: its final window/TTL guard covers every preceding joint write.
      await governor(client).dispatch(config.staffActorId, {
        reservationId: attemptId,
        idempotencyKey: 'router-dispatch-capacity-' + attemptId,
      });
      signal?.throwIfAborted();
      if (
        now() >= Date.parse(c.entitlement.endsAt) ||
        usageDayStart(now(), config.dayOffsetMinutes) !== day
      )
        fail('ENTITLEMENT_EXPIRED', 'The funded allowance expired before dispatch.');
      tx.onBeforeCommit?.(() => {
        if (
          now() >= Date.parse(c.entitlement.endsAt) ||
          usageDayStart(now(), config.dayOffsetMinutes) !== day
        )
          fail(
            'ENTITLEMENT_EXPIRED',
            'The funded allowance expired before transaction completion.',
          );
      });
      return {
        attemptId,
        index: ordinal,
        modelId: c.model.id,
        providerId: c.provider.id,
        reason: kind,
        context: c.context,
        systemPrompt: p.selection.productivity
          ? buildProductivityPrompt(
              p.selection.productivity,
              config.systemPrompts[p.selection.preset] ?? config.systemPrompts.general ?? '',
              data.language,
            )
          : (config.systemPrompts[p.selection.preset] ?? config.systemPrompts.general ?? ''),
      };
    });
  }
  async function closeRequest(userId, requestId, state) {
    await db.transaction(async (tx) => {
      await guard(tx);
      await request(tx, userId, requestId);
      await tx.query(
        'UPDATE router_requests SET state=$3,finished_at=$4 WHERE id=$1 AND user_id=$2',
        [requestId, userId, state, iso(now())],
      );
      await event(tx, config.staffActorId, 'REQUEST_' + state, requestId);
      await storage(tx);
    });
  }
  const service = {
    synthetic: true,
    health: () => ({
      status: 'ok',
      mode: 'synthetic_router',
      externalCallsEnabled: false,
      maxOutputTokens: config.maxOutputTokens,
    }),
    configurePolicy: async (userId, data) => {
      shape(data, ['policy', 'expectedVersion', 'idempotencyKey']);
      identifier(data.idempotencyKey);
      if (
        data.idempotencyKey.length < 8 ||
        !Number.isInteger(data.expectedVersion) ||
        data.expectedVersion < 0
      )
        fail('INVALID_ROUTER', 'Invalid policy revision/key.', 400);
      shape(data.policy, [
        'id',
        'version',
        'mode',
        'modelId',
        'modelClasses',
        'requiredCapabilities',
        'allowPaid',
        'ranking',
        'presets',
        'minQualityScore',
      ]);
      shape(data.policy.presets, [
        'general',
        'coding',
        'writing',
        'research',
        'translation',
        'summary',
      ]);
      for (const value of Object.values(data.policy.presets))
        shape(value, ['requiredCapabilities', 'ranking', 'modelClass', 'minQualityScore']);
      resolveRoutingSelection(data.policy);
      const digest = hash(JSON.stringify(canonical(data)));
      return db.transaction(async (tx) => {
        await guard(tx);
        const a = await actor(tx, userId, true);
        const prior = (
          await tx.query(
            'SELECT request_hash,data FROM router_policy_versions WHERE actor_id=$1 AND idempotency_key=$2',
            [userId, data.idempotencyKey],
          )
        ).rows[0];
        if (prior) {
          if (prior.request_hash !== digest)
            fail('IDEMPOTENCY_CONFLICT', 'Policy key identifies another payload.');
          return prior.data;
        }
        const old = (
          await tx.query('SELECT version FROM routing_policies WHERE id=$1 FOR UPDATE', [
            data.policy.id,
          ])
        ).rows[0];
        if (
          (old?.version ?? 0) !== data.expectedVersion ||
          data.policy.version !== data.expectedVersion + 1 ||
          data.policy.id !== config.policy.id
        )
          fail('POLICY_REVISION', 'Routing policy revision changed.');
        await tx.query(
          'INSERT INTO routing_policies(id,version,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET version=$2,data=$3::jsonb',
          [data.policy.id, data.policy.version, JSON.stringify(data.policy)],
        );
        await tx.query(
          'INSERT INTO router_policy_versions(id,policy_id,version,actor_id,actor_role,idempotency_key,request_hash,data,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
          [
            randomUUID(),
            data.policy.id,
            data.policy.version,
            a.id,
            a.role,
            data.idempotencyKey,
            digest,
            JSON.stringify(data.policy),
            iso(now()),
          ],
        );
        await event(tx, userId, 'POLICY_CONFIGURE', null, null, {
          policyId: data.policy.id,
          version: data.policy.version,
        });
        await storage(tx);
        return data.policy;
      });
    },
    available: async (userId) =>
      db.transaction(async (tx) => {
        await actor(tx, userId);
        const p = await policy(tx);
        const rows = (
          await tx.query(
            "SELECT mm.data,pm.data AS provider FROM registry_metadata mm JOIN registry_metadata pm ON pm.area='provider' AND pm.target_id=mm.data->>'providerId' WHERE mm.area='model' ORDER BY mm.target_id LIMIT $1",
            [config.maxCandidates + 1],
          )
        ).rows;
        const usage = await ledger(txAdapter(tx)).usage(userId);
        const funded = usage.entitlements.some(
          (e) =>
            e.kind === 'pack' && e.status === 'active' && integer(e.remaining.costMicroCu) > 0n,
        );
        return {
          models: rows
            .filter(
              (r) =>
                r.data.status === 'enabled' &&
                r.provider.status === 'enabled' &&
                r.provider.adapterKind === 'synthetic_mock' &&
                gateways[r.data.id] &&
                (r.data.freeFlag || (p.allowPaid && funded)),
            )
            .map((r) => ({
              id: r.data.id,
              displayName: r.data.displayName,
              providerId: r.data.providerId,
              capabilities: r.data.capabilities,
              freeFlag: r.data.freeFlag,
            })),
          presets: Object.keys(p.presets),
        };
      }),
    prepare: async (userId, raw) => {
      validateInput(raw);
      const data = structuredClone(raw);
      const result = await db.transaction(async (tx) => {
        await guard(tx);
        await actor(tx, userId);
        const chat = (
          await tx.query(
            'SELECT id FROM chat_requests WHERE id=$1 AND user_id=$2 AND conversation_id=$3',
            [data.requestId, userId, data.conversationId],
          )
        ).rows[0];
        if (!chat) fail('ROUTER_NOT_FOUND', 'Owned chat request not found.', 404);
        const old = (
          await tx.query(
            'SELECT request_hash,state FROM router_requests WHERE id=$1 AND user_id=$2',
            [data.requestId, userId],
          )
        ).rows[0];
        if (old) {
          if (old.request_hash !== inputHash(data))
            fail('IDEMPOTENCY_CONFLICT', 'Routing payload changed.');
          return { state: old.state, replay: true };
        }
        const action = data.routing?.action ?? 'send';
        let familyId = data.requestId,
          retryOf = null;
        if (action !== 'send') {
          retryOf = identifier(data.routing?.retryOf);
          const previous = await request(tx, userId, retryOf);
          if (previous.conversation_id !== data.conversationId || previous.state === 'RUNNING')
            fail('ROUTER_NOT_FOUND', 'Original request is unavailable for retry.');
          const original = (
            await tx.query(
              "SELECT content FROM messages WHERE request_id=$1 AND user_id=$2 AND role='user'",
              [previous.id, userId],
            )
          ).rows[0];
          if (!original || original.content !== data.messages.at(-1)?.content)
            fail('RETRY_PROMPT_CHANGED', 'Retry must use the original user prompt.', 400);
          const family = await request(tx, userId, previous.family_id);
          if (family.retries_used >= family.max_retries)
            fail('RETRY_BUDGET', 'The original request retry budget is exhausted.');
          familyId = family.id;
          await tx.query('UPDATE router_requests SET retries_used=retries_used+1 WHERE id=$1', [
            family.id,
          ]);
        } else if (data.routing?.retryOf !== undefined && data.routing.retryOf !== null)
          fail('INVALID_ROUTER', 'Original request requires retry/regenerate action.', 400);
        const p = await plan(tx, userId, data),
          empty = p.candidates.length === 0;
        await tx.query(
          'INSERT INTO router_requests(id,user_id,conversation_id,request_hash,language,policy_id,policy_version,selection,family_id,retry_of,max_retries,max_fallbacks,state,candidates,reason,reset_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)',
          [
            data.requestId,
            userId,
            data.conversationId,
            inputHash(data),
            data.language,
            p.policy.id,
            p.policy.version,
            JSON.stringify(data.routing ?? {}),
            familyId,
            retryOf,
            config.maxRetries,
            config.maxFallbacks,
            empty ? 'FAILED' : 'RUNNING',
            JSON.stringify([
              ...p.candidates.map((c) => ({ modelId: c.model.id, reason: 'ELIGIBLE' })),
              ...p.rejected,
            ]),
            empty ? 'NO_ELIGIBLE_MODELS' : 'ELIGIBLE',
            p.resetAt,
            iso(now()),
          ],
        );
        await event(
          tx,
          userId,
          empty ? 'REQUEST_REFUSED' : 'REQUEST_PREPARE',
          data.requestId,
          null,
          { policyVersion: p.policy.version },
        );
        await storage(tx);
        return {
          state: empty ? 'FAILED' : 'RUNNING',
          resetAt: p.resetAt,
          trainingNoticeRequired: p.trainingNoticeRequired ?? false,
          privacyNoticeUrl: '/legal/privacy.html',
          sensitivity: p.selection?.sensitivity ?? 'standard',
          privateMode: p.selection?.privateMode ?? false,
        };
      });
      if (result.state === 'FAILED') {
        const e = new AppError(
          503,
          'NO_ELIGIBLE_MODELS',
          'No eligible route is available. Wait for reset or choose a simpler task.',
        );
        e.resetAt = result.resetAt ?? null;
        e.alternatives = ['Wait for quota reset.', 'Choose a shorter or simpler task.'];
        throw e;
      }
      return result;
    },
    async *stream(userId, raw) {
      shape(raw, ['requestId', 'conversationId', 'messages', 'language', 'routing', 'signal']);
      const data = structuredClone(
        Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'signal')),
      );
      validateInput(data);
      await db.transaction(async (tx) => {
        await guard(tx);
        await actor(tx, userId);
        const r = await request(tx, userId, data.requestId);
        if (r.request_hash !== inputHash(data))
          fail('IDEMPOTENCY_CONFLICT', 'Routing input changed before stream.');
        if (r.state !== 'RUNNING' || r.started_at)
          fail('REQUEST_ALREADY_USED', 'Routing request has already started.');
        await tx.query('UPDATE router_requests SET started_at=$2 WHERE id=$1', [r.id, iso(now())]);
      });
      const controller = new AbortController();
      const abort = () => controller.abort(raw.signal.reason);
      raw.signal?.addEventListener('abort', abort, { once: true });
      if (raw.signal?.aborted) abort();
      const timer = setTimeout(
        () =>
          controller.abort(
            new AppError(408, 'REQUEST_TIMEOUT', 'The request exceeded its time limit.'),
          ),
        config.requestTimeoutMs,
      );
      let kind = 'initial',
        previousModel = null,
        failure,
        lastAttempt = null,
        output = '';
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const a = await admitAttempt(userId, data, kind, previousModel, controller.signal);
          lastAttempt = a;
          previousModel = a.modelId;
          output = '';
          if (controller.signal.aborted) {
            await releaseKnownUnstarted(userId, a.attemptId);
            lastAttempt = null;
            throw controller.signal.reason;
          }
          let iterator;
          try {
            iterator = gateways[a.modelId]
              .stream({
                messages: a.context.messages,
                systemPrompt: a.systemPrompt,
                language: data.language,
                maxOutputTokens: config.maxOutputTokens,
                modelId: a.modelId,
                signal: controller.signal,
              })
              [Symbol.asyncIterator]();
            // Enter transport before yielding any event. A consumer cannot abandon
            // a chargeable marker while a known unstarted transport waits on SSE.
            let pending = iterator.next();
            pending.catch(() => undefined); // observed below after yielding metadata
            yield {
              type: 'attempt',
              attemptId: a.attemptId,
              index: a.index,
              modelId: a.modelId,
              providerId: a.providerId,
              reason: a.reason,
            };
            if (a.context.removedMessages > 0)
              yield {
                type: 'context',
                removedMessages: a.context.removedMessages,
                warnings: a.context.warnings,
              };
            while (true) {
              const next = await boundedNext(iterator, controller.signal, pending);
              pending = null;
              if (next.done) break;
              const chunk = next.value;
              if (
                !chunk ||
                typeof chunk.text !== 'string' ||
                Array.from(output + chunk.text).length > config.maxOutputTokens ||
                Buffer.byteLength(output + chunk.text) > 65536
              )
                fail('GATEWAY_INVALID_OUTPUT', 'Synthetic output exceeded its bound.', 503);
              output += chunk.text;
              await db.query('UPDATE router_attempts SET content=$2 WHERE id=$1', [
                a.attemptId,
                output,
              ]);
              yield { type: 'delta', text: chunk.text, attemptId: a.attemptId };
            }
            controller.signal.throwIfAborted();
            await finishAttempt(userId, a.attemptId, output, false);
            lastAttempt = null;
            await closeRequest(userId, data.requestId, 'COMPLETE');
            return;
          } catch (error) {
            failure = normalizedError(controller.signal.aborted ? controller.signal.reason : error);
            await finishAttempt(
              userId,
              a.attemptId,
              output,
              true,
              !controller.signal.aborted || failure.code === 'REQUEST_TIMEOUT',
            );
            lastAttempt = null;
            if (output || controller.signal.aborted) break;
            const r = await request(db, userId, data.requestId, false),
              family = await request(db, userId, r.family_id, false);
            if (family.retries_used < family.max_retries) {
              kind = 'retry';
              continue;
            }
            if (family.fallbacks_used < family.max_fallbacks) {
              kind = 'fallback';
              continue;
            }
            break;
          } finally {
            if (iterator?.return) Promise.resolve(iterator.return()).catch(() => undefined);
          }
        }
        await closeRequest(
          userId,
          data.requestId,
          controller.signal.aborted ? 'CANCELLED' : 'FAILED',
        );
        throw failure ?? new AppError(503, 'NO_ELIGIBLE_MODELS', 'No eligible route remains.');
      } catch (error) {
        if (lastAttempt) {
          await finishAttempt(
            userId,
            lastAttempt.attemptId,
            output,
            true,
            !controller.signal.aborted || controller.signal.reason?.code === 'REQUEST_TIMEOUT',
          );
          lastAttempt = null;
        }
        const r = await request(db, userId, data.requestId, false);
        if (r.state === 'RUNNING')
          await closeRequest(
            userId,
            data.requestId,
            controller.signal.aborted ? 'CANCELLED' : 'FAILED',
          );
        throw error;
      } finally {
        try {
          if (lastAttempt) {
            await finishAttempt(userId, lastAttempt.attemptId, output, true, false);
            lastAttempt = null;
          }
          const current = await request(db, userId, data.requestId, false);
          if (current.state === 'RUNNING') await closeRequest(userId, data.requestId, 'CANCELLED');
        } finally {
          clearTimeout(timer);
          raw.signal?.removeEventListener('abort', abort);
        }
      }
    },
    result: async (userId, requestId) => {
      // Paused accounts still own their reply and existing reconciliation evidence.
      await actor(db, userId, false, true);
      const r = await request(db, userId, requestId, false),
        family = await request(db, userId, r.family_id, false);
      const rows = (
        await db.query(
          'SELECT ' + attemptFields + ' FROM router_attempts WHERE request_id=$1 ORDER BY ordinal',
          [r.id],
        )
      ).rows;
      const last = rows.at(-1);
      const cost = (
        await db.query(
          "SELECT (-COALESCE(sum(l.amount_micro_cu),0))::text AS cost FROM usage_ledger l JOIN router_attempts a ON a.id=l.reservation_id WHERE a.request_id=$1 AND (l.type='commit' OR (l.type='adjust' AND l.reconciles_entry_id IS NOT NULL))",
          [r.id],
        )
      ).rows[0].cost;
      return {
        requestId: r.id,
        state: r.state,
        status:
          r.state === 'COMPLETE' ? 'complete' : r.state === 'CANCELLED' ? 'cancelled' : 'failed',
        content: last?.content ?? '',
        providerId: last?.provider_id ?? null,
        modelId: last?.model_id ?? null,
        externalName: last?.external_name ?? null,
        inputTokens: rows.reduce((s, a) => s + Number(a.actual_input ?? a.input_bound), 0),
        outputTokens: last ? Array.from(last.content).length : 0,
        costMicroCu: cost,
        attempts: rows.map((a) => ({
          attemptId: a.id,
          modelId: a.model_id,
          providerId: a.provider_id,
          index: a.ordinal,
          reason: a.reason,
          state: a.state,
          status: a.state === 'COMPLETE' ? 'complete' : 'failed',
          content: a.content,
        })),
        contextTrimmed: r.context_trimmed,
        requestedModelId: r.selection.modelId ?? null,
        retryBudgetRemaining: Math.max(0, family.max_retries - family.retries_used),
        retryAllowed: r.state !== 'RUNNING' && family.retries_used < family.max_retries,
        regenerateAllowed: r.state !== 'RUNNING' && family.retries_used < family.max_retries,
      };
    },
    decorateMessage: async (userId, message) => {
      const raw = (
        await db.query(
          "SELECT request_id FROM messages WHERE id=$1 AND user_id=$2 AND role='assistant'",
          [message.id, userId],
        )
      ).rows[0];
      if (
        !raw?.request_id ||
        (
          await db.query('SELECT id FROM router_requests WHERE id=$1 AND user_id=$2', [
            raw.request_id,
            userId,
          ])
        ).rows.length === 0
      )
        return message;
      const result = await service.result(userId, raw.request_id);
      const source = (
        await db.query(
          "SELECT id FROM messages WHERE request_id=$1 AND user_id=$2 AND role='user'",
          [raw.request_id, userId],
        )
      ).rows[0];
      return {
        ...message,
        requestId: raw.request_id,
        sourceMessageId: source?.id,
        ...Object.fromEntries(
          [
            'attempts',
            'contextTrimmed',
            'requestedModelId',
            'retryBudgetRemaining',
            'retryAllowed',
            'regenerateAllowed',
          ].map((k) => [k, result[k]]),
        ),
      };
    },
    simulate: async (userId, data) => {
      shape(data, ['messages', 'language', 'routing', 'targetUserId']);
      return db.transaction(async (tx) => {
        await actor(tx, userId, true);
        const target = data.targetUserId ?? userId;
        await actor(tx, target);
        const p = await plan(tx, target, data);
        return {
          policyId: p.policy.id,
          policyVersion: p.policy.version,
          candidates: p.candidates.map((c) => ({
            modelId: c.model.id,
            providerId: c.provider.id,
            inputTokens: c.context.inputTokens,
            contextTrimmed: c.context.removedMessages > 0,
          })),
          rejected: p.rejected,
          resetAt: p.resetAt,
          callsMade: 0,
          syntheticOnly: true,
        };
      });
    },
    inspect: async (userId, requestId) => {
      await actor(db, userId, true);
      return (
        (
          await db.query(
            'SELECT id,state,candidates,reason,policy_id,policy_version,reset_at FROM router_requests WHERE id=$1',
            [identifier(requestId)],
          )
        ).rows[0] ?? null
      );
    },
    recover: async () => {
      await actor(db, config.staffActorId, true);
      const rows = (
        await db.query(
          "SELECT id,user_id FROM router_requests WHERE state='RUNNING' ORDER BY created_at LIMIT 100",
        )
      ).rows;
      for (const r of rows) {
        const attempts = (
          await db.query(
            "SELECT id,content FROM router_attempts WHERE request_id=$1 AND state='DISPATCHED'",
            [r.id],
          )
        ).rows;
        for (const a of attempts) await finishAttempt(r.user_id, a.id, a.content, true);
        await closeRequest(r.user_id, r.id, 'FAILED');
      }
      return { recovered: rows.length };
    },
    sweep: async () =>
      db.transaction(async (tx) => {
        await guard(tx);
        await actor(tx, config.staffActorId, true);
        const client = txAdapter(tx);
        const ledgerResult = await ledger(client).sweep(config.staffActorId);
        const capacityResult = await governor(client).sweep(config.staffActorId);
        const rows = (
          await tx.query(
            "SELECT a.*,a.attempt_id AS id,a.input_bound::text AS input_bound,a.output_bound::text AS output_bound,a.actual_input::text AS actual_input,a.actual_output::text AS actual_output FROM router_accounting_holds a JOIN ledger_reservations l ON l.id=a.attempt_id JOIN capacity_reservations c ON c.id=a.attempt_id WHERE a.state='PENDING_RECONCILIATION' AND a.reconciliation_deadline<=$1 AND l.state='ESTIMATED' AND c.state='ESTIMATED' ORDER BY a.attempt_id LIMIT 100",
            [iso(now())],
          )
        ).rows;
        for (const a of rows) {
          await daily(tx, a, integer(a.input_bound) + integer(a.output_bound));
          await tx.query(
            "UPDATE router_attempts SET state='ESTIMATED',actual_input=input_bound,actual_output=output_bound WHERE id=$1",
            [a.id],
          );
          await tx.query(
            "UPDATE router_accounting_holds SET state='ESTIMATED',actual_input=input_bound,actual_output=output_bound WHERE attempt_id=$1",
            [a.id],
          );
          await event(tx, config.staffActorId, 'ATTEMPT_ESTIMATE', a.request_id, a.id);
        }
        await storage(tx);
        return { ledger: ledgerResult, capacity: capacityResult, estimated: rows.length };
      }),
    reconcile: async (userId, data) => {
      shape(data, ['attemptId', 'inputTokens', 'outputTokens', 'idempotencyKey']);
      identifier(data.attemptId);
      identifier(data.idempotencyKey);
      const input = integer(data.inputTokens),
        output = integer(data.outputTokens);
      return db.transaction(async (tx) => {
        await guard(tx);
        await actor(tx, userId, true);
        if (data.idempotencyKey.length < 8)
          fail('INVALID_ROUTER', 'Reconciliation key is too short.', 400);
        const keyHash = hash(data.idempotencyKey),
          payloadHash = hash(JSON.stringify([data.attemptId, input.toString(), output.toString()]));
        const replay = (
          await tx.query(
            "SELECT metadata FROM router_events WHERE actor_id=$1 AND kind='ATTEMPT_CORRECTION' AND metadata->>'keyHash'=$2",
            [userId, keyHash],
          )
        ).rows[0];
        if (replay) {
          if (replay.metadata.payloadHash !== payloadHash)
            fail('IDEMPOTENCY_CONFLICT', 'Reconciliation key identifies another payload.');
          return { attemptId: data.attemptId, state: 'CORRECTED' };
        }
        const a = (
          await tx.query(
            'SELECT a.*,a.attempt_id AS id,a.input_bound::text AS input_bound,a.output_bound::text AS output_bound,a.actual_input::text AS actual_input,a.actual_output::text AS actual_output FROM router_accounting_holds a WHERE a.attempt_id=$1 FOR UPDATE',
            [data.attemptId],
          )
        ).rows[0];
        if (!a || !['PENDING_RECONCILIATION', 'ESTIMATED'].includes(a.state))
          fail('ROUTER_RESOLVED', 'Routing attempt is already resolved.');
        const client = txAdapter(tx),
          usage = {
            reservationId: a.id,
            inputTokens: input.toString(),
            outputTokens: output.toString(),
          };
        await ledger(client).settle(userId, {
          ...usage,
          idempotencyKey: 'router-correction-ledger-' + keyHash,
        });
        await governor(client).settle(userId, {
          ...usage,
          idempotencyKey: 'router-correction-capacity-' + keyHash,
        });
        await daily(tx, a, input + output, a.state === 'ESTIMATED');
        await tx.query(
          "UPDATE router_attempts SET state='CORRECTED',actual_input=$2,actual_output=$3 WHERE id=$1",
          [a.id, input.toString(), output.toString()],
        );
        await tx.query(
          "UPDATE router_accounting_holds SET state='CORRECTED',actual_input=$2,actual_output=$3 WHERE attempt_id=$1",
          [a.id, input.toString(), output.toString()],
        );
        await event(tx, userId, 'ATTEMPT_CORRECTION', a.request_id, a.id, { keyHash, payloadHash });
        await storage(tx);
        return { attemptId: a.id, state: 'CORRECTED' };
      });
    },
  };
  return service;
}
async function boundedNext(iterator, signal, pending = null) {
  signal.throwIfAborted();
  let aborted;
  const cancellation = new Promise((_, reject) => {
    aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
  });
  try {
    return await Promise.race([pending ?? iterator.next(), cancellation]);
  } finally {
    signal.removeEventListener('abort', aborted);
  }
}
