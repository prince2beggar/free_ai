import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AppError } from '../api/errors.mjs';
import { integer } from '../ledger/arithmetic.mjs';
import {
  safeLimit,
  fairShareTokens,
  requestTokenCapacity,
  aggregateDailyTokens,
} from './arithmetic.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));
const metrics = ['requests', 'tokens', 'input_tokens', 'output_tokens'];
const scopes = ['provider', 'account', 'model'];
const fail = (code, message, status = 409) => {
  throw new AppError(status, code, message);
};
const iso = (time) => new Date(time).toISOString();
const hash = (value) => createHash('sha256').update(value).digest('hex');
function shape(data, fields) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).some((k) => !fields.includes(k))
  )
    fail('INVALID_CAPACITY', 'Unknown field or invalid capacity payload.', 400);
}
function id(value, length = 160) {
  if (typeof value !== 'string' || !new RegExp('^[A-Za-z0-9_-]{1,' + length + '}$').test(value))
    fail('INVALID_CAPACITY', 'Invalid capacity identifier.', 400);
  return value;
}
function date(value) {
  if (
    typeof value !== 'string' ||
    value.length > 30 ||
    !Number.isFinite(Date.parse(value)) ||
    iso(Date.parse(value)) !== value
  )
    fail('INVALID_CAPACITY', 'Expected a canonical UTC capacity date.', 400);
  return Date.parse(value);
}
function canonical(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function windowAt(limit, time) {
  const anchor = new Date(limit.anchor_at).getTime();
  const start = anchor + Math.floor((time - anchor) / limit.window_ms) * limit.window_ms;
  return { start, reset: start + limit.window_ms };
}
const amounts = (input, output) => ({
  requests: 1n,
  tokens: integer(input + output),
  input_tokens: input,
  output_tokens: output,
});
const reservationFields =
  '*,bound_input::text AS bound_input,bound_output::text AS bound_output,actual_input::text AS actual_input,actual_output::text AS actual_output';
const publicReservation = (r) => ({
  id: r.id,
  requestId: r.request_id,
  state: r.state,
  inputTokens: r.bound_input,
  outputTokens: r.bound_output,
  expiresAt: iso(new Date(r.expires_at).getTime()),
  syntheticOnly: true,
});

/** Local synthetic quota admission. Dispatch is a durable marker, never a provider call. */
export function createGovernor(db, options = {}) {
  shape(options, [...Object.keys(defaults), 'clock']);
  const config = structuredClone({ ...defaults, ...options, clock: undefined });
  if (
    config.localOnly !== true ||
    JSON.stringify(config.staffRoles) !== JSON.stringify(defaults.staffRoles)
  )
    fail('INVALID_CAPACITY_CONFIG', 'Governor requires local-only staff permissions.', 400);
  for (const field of Object.keys(defaults).filter((k) => k.startsWith('max'))) {
    if (!Number.isInteger(config[field]) || config[field] < 1 || config[field] > 100000)
      fail('INVALID_CAPACITY_CONFIG', 'Invalid bounded capacity storage configuration.', 400);
  }
  for (const field of ['reservationTtlMs', 'reconciliationMs']) {
    if (!Number.isInteger(config[field]) || config[field] < 1 || config[field] > 86400000)
      fail('INVALID_CAPACITY_CONFIG', 'Invalid capacity deadline configuration.', 400);
  }
  safeLimit('1', config.safetyFactor);
  integer(config.expectedActiveUsers);
  shape(
    config.trustTokenCaps,
    Array.from({ length: 11 }, (_, i) => String(i)),
  );
  for (let i = 0; i <= 10; i++) integer(config.trustTokenCaps[i]);
  const clock = options.clock ?? Date.now;
  if (typeof clock !== 'function')
    fail('INVALID_CAPACITY_CONFIG', 'Invalid trusted capacity clock.', 400);
  const now = () => {
    const time = clock();
    if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime()))
      fail('INVALID_CAPACITY_CONFIG', 'Invalid capacity time.', 400);
    return time;
  };
  async function actor(tx, actorId, staff = false) {
    id(actorId);
    const r = (
      await tx.query(
        "SELECT id,role,trust_level,tier FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL AND identity_provider='synthetic'",
        [actorId],
      )
    ).rows[0];
    if (!r || (staff && !config.staffRoles.includes(r.role)))
      fail(
        'CAPACITY_FORBIDDEN',
        'Active synthetic identity and trusted staff permission are required.',
        403,
      );
    return r;
  }
  async function eligible(tx, modelId = null, providerId = null) {
    let model;
    if (modelId) {
      const base = (
        await tx.query('SELECT provider_id,status FROM models WHERE id=$1 FOR SHARE', [modelId])
      ).rows[0];
      model = (
        await tx.query(
          "SELECT data FROM registry_metadata WHERE area='model' AND target_id=$1 FOR SHARE",
          [modelId],
        )
      ).rows[0]?.data;
      if (
        !base ||
        !model ||
        base.status !== 'enabled' ||
        model.status !== 'enabled' ||
        model.modelClass !== 'synthetic' ||
        !model.contextVerified ||
        !Number.isInteger(model.contextLimit) ||
        model.contextLimit < 1 ||
        !model.capabilities?.length ||
        !model.ratesVerified ||
        model.cuInputRate === null ||
        model.cuOutputRate === null ||
        model.qualityKind !== 'synthetic_fixture'
      )
        fail('CAPACITY_UNAVAILABLE', 'Synthetic model eligibility is unavailable.');
      providerId = base.provider_id;
      if (model.providerId !== providerId)
        fail('CAPACITY_UNAVAILABLE', 'Model provider evidence disagrees.');
    }
    const base = (
      await tx.query('SELECT status,adapter_kind FROM providers WHERE id=$1 FOR SHARE', [
        providerId,
      ])
    ).rows[0];
    const provider = (
      await tx.query(
        "SELECT data FROM registry_metadata WHERE area='provider' AND target_id=$1 FOR SHARE",
        [providerId],
      )
    ).rows[0]?.data;
    if (
      !base ||
      !provider ||
      base.status !== 'enabled' ||
      base.adapter_kind !== 'synthetic_mock' ||
      provider.status !== 'enabled' ||
      provider.adapterKind !== 'synthetic_mock' ||
      provider.baseUrl !== null ||
      provider.secretRef !== null ||
      !['synthetic_only', 'no_training', 'may_train'].includes(provider.dataPolicy) ||
      !provider.allowsMultiuser ||
      !provider.ownerApproved ||
      !provider.quotaConfirmed ||
      !provider.termsUrl ||
      !provider.termsReviewedAt
    )
      fail('CAPACITY_UNAVAILABLE', 'Synthetic provider eligibility is unavailable.');
    return { providerId, model };
  }
  async function route(tx, modelId, accountRef) {
    const r = (
      await tx.query('SELECT * FROM capacity_routes WHERE model_id=$1 AND account_ref=$2', [
        modelId,
        accountRef,
      ])
    ).rows[0];
    if (!r) fail('CAPACITY_UNKNOWN', 'Unknown capacity route or account.');
    await eligible(tx, r.model_id);
    const pools = (
      await tx.query(
        "SELECT * FROM capacity_pools WHERE provider_id=$1 AND (scope='provider' OR (account_ref=$2 AND (scope='account' OR scope_ref=$3))) ORDER BY id",
        [r.provider_id, r.account_ref, r.model_id],
      )
    ).rows;
    for (const scope of scopes) {
      const found = pools.filter((p) => p.scope === scope);
      if (
        (r[scope + '_limits'] === 'known' && found.length !== 1) ||
        (r[scope + '_limits'] === 'not_applicable' && found.length !== 0)
      )
        fail('CAPACITY_UNKNOWN', 'Unknown or conflicting capacity scope evidence.');
    }
    if (pools.length === 0 || pools.some((p) => p.status !== 'enabled'))
      fail('CAPACITY_UNAVAILABLE', 'Capacity pool disabled or unavailable.');
    const limits = (
      await tx.query(
        'SELECT l.*,l.safe_amount::text AS safe_amount,l.limit_amount::text AS limit_amount,p.scope,p.definition FROM capacity_limits l JOIN capacity_pools p ON p.id=l.pool_id WHERE l.pool_id=ANY($1::text[]) ORDER BY l.id',
        [pools.map((p) => p.id)],
      )
    ).rows;
    if (!limits.length) fail('CAPACITY_UNKNOWN', 'Unknown capacity limits.');
    return { ...r, pools, limits };
  }
  async function readReservation(tx, reservationId, owner = null) {
    id(reservationId);
    const r = (
      await tx.query(
        'SELECT ' + reservationFields + ' FROM capacity_reservations WHERE id=$1 FOR UPDATE',
        [reservationId],
      )
    ).rows[0];
    if (!r || (owner && r.user_id !== owner))
      fail('CAPACITY_NOT_FOUND', 'Capacity reservation not found.', 404);
    return r;
  }
  async function storage(tx) {
    const tables = {
      capacity_pools: 'maxPools',
      capacity_routes: 'maxRoutes',
      capacity_counters: 'maxCounters',
      capacity_reservations: 'maxReservations',
      capacity_allocations: 'maxAllocations',
      capacity_operations: 'maxOperations',
      capacity_events: 'maxEvents',
      capacity_fair_share: 'maxFairShareRows',
      capacity_job_runs: 'maxOperations',
    };
    const future = (
      await tx.query(
        "SELECT COALESCE(sum(CASE state WHEN 'RESERVED' THEN 4 WHEN 'DISPATCHED' THEN 3 WHEN 'PENDING_RECONCILIATION' THEN 2 WHEN 'ESTIMATED' THEN 1 ELSE 0 END),0)::int AS n FROM capacity_reservations",
      )
    ).rows[0].n;
    for (const [table, field] of Object.entries(tables)) {
      const count = (await tx.query('SELECT count(*)::int AS n FROM ' + table)).rows[0].n;
      const closure = ['capacity_operations', 'capacity_events'].includes(table) ? future : 0;
      if (count + closure > config[field])
        fail('CAPACITY_STORAGE_FULL', 'Bounded capacity storage cannot admit this operation.');
    }
  }
  async function event(ctx, kind, reservationId = null, metadata = {}) {
    await ctx.tx.query(
      'INSERT INTO capacity_events(id,operation_id,actor_id,actor_role,reservation_id,kind,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
      [
        randomUUID(),
        ctx.operationId,
        ctx.actor.id,
        ctx.actor.role,
        reservationId,
        kind,
        JSON.stringify(metadata),
        iso(ctx.time),
      ],
    );
  }
  async function operation(actorId, action, data, staff, body, maintenance = false) {
    id(data.idempotencyKey);
    if (data.idempotencyKey.length < 8)
      fail('INVALID_CAPACITY', 'Idempotency key is too short.', 400);
    const raw = JSON.stringify(canonical(data));
    if (Buffer.byteLength(raw) > 16384)
      fail('INVALID_CAPACITY', 'Capacity payload exceeds its size bound.', 400);
    const digest = hash(action + ':' + raw);
    return db.transaction(async (tx) => {
      const guard = (
        await tx.query('SELECT last_time FROM capacity_storage_guard WHERE id=1 FOR UPDATE')
      ).rows[0];
      const identity = await actor(tx, actorId, staff);
      const old = (
        await tx.query(
          'SELECT action,request_hash,result FROM capacity_operations WHERE actor_id=$1 AND idempotency_key=$2',
          [actorId, data.idempotencyKey],
        )
      ).rows[0];
      if (old) {
        if (old.action !== action || old.request_hash !== digest)
          fail('IDEMPOTENCY_CONFLICT', 'Idempotency key identifies a different capacity payload.');
        return maintenance ? { ...old.result, replayed: true } : old.result;
      }
      const time = now();
      if (guard.last_time && time < new Date(guard.last_time).getTime())
        fail('CAPACITY_CLOCK', 'Capacity clock moved backwards.');
      const ctx = { tx, actor: identity, time, operationId: randomUUID() };
      const result = await body(ctx);
      await tx.query(
        'INSERT INTO capacity_operations(id,actor_id,actor_role,action,idempotency_key,request_hash,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
        [
          ctx.operationId,
          actorId,
          identity.role,
          action,
          data.idempotencyKey,
          digest,
          JSON.stringify(result),
          iso(time),
        ],
      );
      await storage(tx);
      const end = now();
      if (end < time)
        fail('CAPACITY_CLOCK', 'Capacity clock moved backwards during the operation.');
      await tx.query('UPDATE capacity_storage_guard SET last_time=$1 WHERE id=1', [iso(end)]);
      // Capture dispatch evidence before an outer coordinator performs more writes.
      const dispatch = ctx.dispatch ? structuredClone(ctx.dispatch) : null;
      const checkCompletion = () => {
        const finalTime = now();
        if (finalTime < end)
          fail('CAPACITY_CLOCK', 'Capacity clock moved backwards at completion.');
        if (
          dispatch &&
          (finalTime >= dispatch.expiresAt ||
            dispatch.limits.some((l) => windowAt(l, finalTime).start !== windowAt(l, time).start))
        )
          fail(
            'CAPACITY_EXPIRED',
            'Capacity time or reset window changed before dispatch completion.',
          );
      };
      checkCompletion();
      // An optional joint-transaction hook repeats the guard after all outer writes.
      if (dispatch && typeof tx.onBeforeCommit === 'function') tx.onBeforeCommit(checkCompletion);
      return maintenance ? { ...result, replayed: false } : result;
    });
  }
  async function counter(tx, limit, time, create = false) {
    const w = windowAt(limit, time);
    const counterId = hash(limit.id + ':' + iso(w.start));
    if (create)
      await tx.query(
        'INSERT INTO capacity_counters(id,limit_id,starts_at,resets_at,safe_amount) VALUES($1,$2,$3,$4,$5) ON CONFLICT(limit_id,starts_at) DO NOTHING',
        [counterId, limit.id, iso(w.start), iso(w.reset), limit.safe_amount],
      );
    const r = (
      await tx.query(
        'SELECT id,used_amount::text AS used,reserved_amount::text AS reserved,safe_amount::text AS safe FROM capacity_counters WHERE limit_id=$1 AND starts_at=$2',
        [limit.id, iso(w.start)],
      )
    ).rows[0];
    return { id: counterId, used: '0', reserved: '0', safe: limit.safe_amount, ...r, ...w };
  }
  async function hold(ctx, reservationId, limits, bounds) {
    for (const limit of limits) {
      const c = await counter(ctx.tx, limit, ctx.time, true);
      const bound = bounds[limit.metric];
      if (integer(c.safe) - integer(c.used) - integer(c.reserved) < bound)
        fail('CAPACITY_EXHAUSTED', 'Available capacity is exhausted.');
      await ctx.tx.query(
        'UPDATE capacity_counters SET reserved_amount=reserved_amount+$2 WHERE id=$1',
        [c.id, bound.toString()],
      );
      await ctx.tx.query(
        'INSERT INTO capacity_allocations(reservation_id,counter_id,metric,bound_amount,reserved_amount) VALUES($1,$2,$3,$4,$4) ON CONFLICT(reservation_id,counter_id) DO UPDATE SET bound_amount=$4,reserved_amount=$4',
        [reservationId, c.id, limit.metric, bound.toString()],
      );
    }
  }
  async function allocations(tx, reservationId) {
    return (
      await tx.query(
        'SELECT counter_id,metric,bound_amount::text AS bound,used_amount::text AS used,reserved_amount::text AS reserved FROM capacity_allocations WHERE reservation_id=$1 ORDER BY counter_id',
        [reservationId],
      )
    ).rows;
  }
  async function updateAllocation(tx, reservationId, a, used, reserved) {
    await tx.query(
      'UPDATE capacity_counters SET used_amount=used_amount+$2,reserved_amount=reserved_amount+$3 WHERE id=$1',
      [
        a.counter_id,
        (used - integer(a.used)).toString(),
        (reserved - integer(a.reserved)).toString(),
      ],
    );
    await tx.query(
      'UPDATE capacity_allocations SET used_amount=$3,reserved_amount=$4 WHERE reservation_id=$1 AND counter_id=$2',
      [reservationId, a.counter_id, used.toString(), reserved.toString()],
    );
  }
  async function release(ctx, r) {
    for (const a of await allocations(ctx.tx, r.id))
      await updateAllocation(ctx.tx, r.id, a, integer(a.used), 0n);
    await ctx.tx.query("UPDATE capacity_reservations SET state='RELEASED' WHERE id=$1", [r.id]);
    return { ...publicReservation(r), state: 'RELEASED' };
  }
  async function finish(ctx, r, input, output, estimated = false) {
    if (
      !['DISPATCHED', 'PENDING_RECONCILIATION', 'ESTIMATED'].includes(r.state) ||
      (estimated && r.state === 'ESTIMATED')
    )
      fail('CAPACITY_RESOLVED', 'Capacity reservation is already resolved or cannot be settled.');
    if (input > integer(r.bound_input) || output > integer(r.bound_output))
      fail('INVALID_CAPACITY', 'Actual tokens exceed the reserved bound.', 400);
    const actual = amounts(input, output);
    for (const a of await allocations(ctx.tx, r.id)) {
      // Rebinding leaves zeroed old-window evidence; only dispatched allocations have usage or holds.
      if (integer(a.used) === 0n && integer(a.reserved) === 0n) continue;
      await updateAllocation(ctx.tx, r.id, a, actual[a.metric], 0n);
    }
    const state = estimated ? 'ESTIMATED' : r.state === 'ESTIMATED' ? 'CORRECTED' : 'SETTLED';
    await ctx.tx.query(
      'UPDATE capacity_reservations SET state=$2,actual_input=$3,actual_output=$4 WHERE id=$1',
      [r.id, state, input.toString(), output.toString()],
    );
    await event(
      ctx,
      estimated ? 'DEADLINE_ESTIMATE' : state === 'CORRECTED' ? 'LATE_CORRECTION' : 'SETTLE',
      r.id,
      { inputTokens: input.toString(), outputTokens: output.toString() },
    );
    return { ...publicReservation(r), state };
  }
  async function dailyPool(tx, pool, limits, time) {
    const values = {};
    for (const limit of limits.filter((l) => l.pool_id === pool.id && l.window_ms === 86400000)) {
      const c = await counter(tx, limit, time);
      const remaining = integer(c.safe) - integer(c.used) - integer(c.reserved);
      values[limit.metric] =
        values[limit.metric] === undefined || remaining < values[limit.metric]
          ? remaining
          : values[limit.metric];
    }
    const budgets = [];
    if (values.tokens !== undefined) budgets.push(values.tokens);
    if (values.requests !== undefined) {
      if (!pool.definition.tokensPerRequest)
        fail(
          'CAPACITY_UNKNOWN',
          'Request-only daily capacity needs a conservative tokens per request conversion.',
        );
      budgets.push(
        requestTokenCapacity({
          remainingRequests: values.requests,
          tokensPerRequest: pool.definition.tokensPerRequest,
        }),
      );
    }
    if (values.input_tokens !== undefined && values.output_tokens !== undefined)
      budgets.push(integer(values.input_tokens + values.output_tokens));
    return budgets.length ? budgets.reduce((a, b) => (a < b ? a : b)) : null;
  }
  return {
    createPool: async (actorId, data) => {
      shape(data, [
        'id',
        'providerId',
        'scope',
        'accountRef',
        'modelId',
        'tokensPerRequest',
        'limits',
        'idempotencyKey',
      ]);
      id(data.id, 80);
      id(data.providerId, 80);
      if (!scopes.includes(data.scope)) fail('INVALID_CAPACITY', 'Invalid capacity scope.', 400);
      const accountRef = data.scope === 'provider' ? 'provider' : id(data.accountRef, 80);
      const scopeRef = data.scope === 'model' ? id(data.modelId, 80) : 'all';
      if (
        (data.scope === 'provider' && data.accountRef !== undefined) ||
        (data.scope !== 'model' && data.modelId !== undefined)
      )
        fail('INVALID_CAPACITY', 'Capacity scope fields disagree.', 400);
      const conversion =
        data.tokensPerRequest === undefined ? null : integer(data.tokensPerRequest).toString();
      if (conversion === '0') fail('INVALID_CAPACITY', 'Tokens per request must be positive.', 400);
      if (
        !Array.isArray(data.limits) ||
        !data.limits.length ||
        data.limits.length > config.maxLimitsPerPool
      )
        fail('INVALID_CAPACITY', 'Expected bounded capacity limits.', 400);
      const limits = data.limits.map((l) => {
        shape(l, ['id', 'metric', 'limit', 'windowMs', 'anchorAt', 'safetyFactor']);
        id(l.id, 80);
        date(l.anchorAt);
        if (
          !metrics.includes(l.metric) ||
          !Number.isInteger(l.windowMs) ||
          l.windowMs < 1000 ||
          l.windowMs > 86400000
        )
          fail('INVALID_CAPACITY', 'Invalid capacity metric or window.', 400);
        const safetyFactor = l.safetyFactor ?? config.safetyFactor;
        return {
          ...l,
          limit: integer(l.limit).toString(),
          safetyFactor,
          safe: safeLimit(l.limit, safetyFactor).toString(),
        };
      });
      const normalized = { ...data, tokensPerRequest: conversion, limits };
      return operation(actorId, 'POOL_CREATE', normalized, true, async (ctx) => {
        const evidence = await eligible(
          ctx.tx,
          data.scope === 'model' ? data.modelId : null,
          data.providerId,
        );
        if (evidence.providerId !== data.providerId)
          fail('INVALID_CAPACITY', 'Pool model belongs to another provider.', 400);
        await ctx.tx.query(
          'INSERT INTO capacity_pools(id,provider_id,scope,account_ref,scope_ref,definition,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',
          [
            data.id,
            data.providerId,
            data.scope,
            accountRef,
            scopeRef,
            JSON.stringify({ tokensPerRequest: conversion, limits }),
            iso(ctx.time),
          ],
        );
        for (const l of limits)
          await ctx.tx.query(
            'INSERT INTO capacity_limits(id,pool_id,metric,limit_amount,safety_factor,safe_amount,window_ms,anchor_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [l.id, data.id, l.metric, l.limit, l.safetyFactor, l.safe, l.windowMs, l.anchorAt],
          );
        await event(ctx, 'POOL_CREATE', null, { poolId: data.id, scope: data.scope });
        return { id: data.id, revision: 1, status: 'enabled', syntheticOnly: true };
      });
    },
    setPoolStatus: async (actorId, data) => {
      shape(data, ['poolId', 'status', 'expectedRevision', 'idempotencyKey']);
      id(data.poolId, 80);
      if (
        !['enabled', 'disabled'].includes(data.status) ||
        !Number.isInteger(data.expectedRevision) ||
        data.expectedRevision < 1
      )
        fail('INVALID_CAPACITY', 'Invalid pool status or revision.', 400);
      return operation(actorId, 'POOL_STATUS', data, true, async (ctx) => {
        const pool = (
          await ctx.tx.query('SELECT * FROM capacity_pools WHERE id=$1 FOR UPDATE', [data.poolId])
        ).rows[0];
        if (!pool) fail('CAPACITY_NOT_FOUND', 'Capacity pool not found.', 404);
        if (pool.revision !== data.expectedRevision)
          fail('CAPACITY_REVISION', 'Capacity pool revision changed.');
        const revision = pool.revision + 1;
        await ctx.tx.query('UPDATE capacity_pools SET status=$2,revision=$3 WHERE id=$1', [
          pool.id,
          data.status,
          revision,
        ]);
        await event(ctx, 'POOL_STATUS', null, { poolId: pool.id, status: data.status, revision });
        return { id: pool.id, status: data.status, revision, syntheticOnly: true };
      });
    },
    createRoute: async (actorId, data) => {
      shape(data, [
        'modelId',
        'accountRef',
        'providerLimits',
        'accountLimits',
        'modelLimits',
        'quotaConfirmed',
        'idempotencyKey',
      ]);
      id(data.modelId, 80);
      id(data.accountRef, 80);
      if (
        data.quotaConfirmed !== true ||
        scopes.some((s) => !['known', 'not_applicable'].includes(data[s + 'Limits']))
      )
        fail('CAPACITY_UNKNOWN', 'Every capacity scope needs explicit quota evidence.');
      return operation(actorId, 'ROUTE_CREATE', data, true, async (ctx) => {
        const { providerId } = await eligible(ctx.tx, data.modelId);
        const routeId = hash(data.modelId + ':' + data.accountRef);
        await ctx.tx.query(
          'INSERT INTO capacity_routes(id,provider_id,model_id,account_ref,provider_limits,account_limits,model_limits,quota_confirmed,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,$8)',
          [
            routeId,
            providerId,
            data.modelId,
            data.accountRef,
            data.providerLimits,
            data.accountLimits,
            data.modelLimits,
            iso(ctx.time),
          ],
        );
        await route(ctx.tx, data.modelId, data.accountRef);
        await event(ctx, 'ROUTE_CREATE', null, { routeId });
        return {
          id: routeId,
          modelId: data.modelId,
          accountRef: data.accountRef,
          syntheticOnly: true,
        };
      });
    },
    reserve: async (actorId, data) => {
      shape(data, [
        'reservationId',
        'requestId',
        'modelId',
        'accountRef',
        'inputTokens',
        'outputTokens',
        'idempotencyKey',
      ]);
      id(data.reservationId);
      id(data.requestId);
      id(data.modelId, 80);
      id(data.accountRef, 80);
      const input = integer(data.inputTokens),
        output = integer(data.outputTokens),
        bounds = amounts(input, output);
      return operation(actorId, 'RESERVE', data, false, async (ctx) => {
        const r = await route(ctx.tx, data.modelId, data.accountRef);
        await ctx.tx.query(
          "INSERT INTO capacity_reservations(id,user_id,route_id,request_id,state,bound_input,bound_output,expires_at,created_at) VALUES($1,$2,$3,$4,'RESERVED',$5,$6,$7,$8)",
          [
            data.reservationId,
            ctx.actor.id,
            r.id,
            data.requestId,
            input.toString(),
            output.toString(),
            iso(ctx.time + config.reservationTtlMs),
            iso(ctx.time),
          ],
        );
        await hold(ctx, data.reservationId, r.limits, bounds);
        await event(ctx, 'RESERVE', data.reservationId, { routeId: r.id });
        return publicReservation(await readReservation(ctx.tx, data.reservationId));
      });
    },
    dispatch: async (actorId, data) => {
      shape(data, ['reservationId', 'idempotencyKey']);
      id(data.reservationId);
      return operation(actorId, 'DISPATCH', data, true, async (ctx) => {
        const r = await readReservation(ctx.tx, data.reservationId);
        if (r.state !== 'RESERVED')
          fail('CAPACITY_RESOLVED', 'Capacity dispatch state is already resolved.');
        if (ctx.time >= new Date(r.expires_at).getTime())
          fail('CAPACITY_EXPIRED', 'Capacity reservation expired.');
        await actor(ctx.tx, r.user_id);
        const original = (
          await ctx.tx.query('SELECT model_id,account_ref FROM capacity_routes WHERE id=$1', [
            r.route_id,
          ])
        ).rows[0];
        const current = await route(ctx.tx, original.model_id, original.account_ref);
        ctx.dispatch = { limits: current.limits, expiresAt: new Date(r.expires_at).getTime() };
        for (const a of await allocations(ctx.tx, r.id))
          await updateAllocation(ctx.tx, r.id, a, 0n, 0n);
        await hold(
          ctx,
          r.id,
          current.limits,
          amounts(integer(r.bound_input), integer(r.bound_output)),
        );
        const time = now();
        if (
          time < ctx.time ||
          time >= new Date(r.expires_at).getTime() ||
          current.limits.some((l) => windowAt(l, time).start !== windowAt(l, ctx.time).start)
        )
          fail('CAPACITY_EXPIRED', 'Capacity time or reset window changed before dispatch.');
        for (const a of await allocations(ctx.tx, r.id))
          if (a.metric === 'requests' && integer(a.reserved) > 0n)
            await updateAllocation(ctx.tx, r.id, a, 1n, 0n);
        await ctx.tx.query(
          "UPDATE capacity_reservations SET state='DISPATCHED',dispatched_at=$2,reconciliation_deadline=$3 WHERE id=$1",
          [r.id, iso(time), iso(time + config.reconciliationMs)],
        );
        await event(ctx, 'DISPATCH', r.id);
        return { ...publicReservation(r), state: 'DISPATCHED' };
      });
    },
    cancel: async (actorId, data) => {
      shape(data, ['reservationId', 'idempotencyKey']);
      id(data.reservationId);
      return operation(actorId, 'CANCEL', data, false, async (ctx) => {
        const r = await readReservation(ctx.tx, data.reservationId, actorId);
        let result;
        if (r.state === 'RESERVED') result = await release(ctx, r);
        else if (r.state === 'DISPATCHED') {
          await ctx.tx.query(
            "UPDATE capacity_reservations SET state='PENDING_RECONCILIATION' WHERE id=$1",
            [r.id],
          );
          result = { ...publicReservation(r), state: 'PENDING_RECONCILIATION' };
        } else fail('CAPACITY_RESOLVED', 'Capacity reservation is already resolved or pending.');
        await event(ctx, 'CANCEL', r.id);
        return result;
      });
    },
    cancelDispatched: async (actorId, data) => {
      shape(data, ['reservationId', 'idempotencyKey']);
      id(data.reservationId);
      return operation(actorId, 'CANCEL_DISPATCHED', data, true, async (ctx) => {
        const r = await readReservation(ctx.tx, data.reservationId);
        if (r.state !== 'DISPATCHED')
          fail('CAPACITY_RESOLVED', 'Only dispatched capacity may enter reconciliation.');
        // Retain all used requests and token holds when the customer loses access.
        await ctx.tx.query(
          "UPDATE capacity_reservations SET state='PENDING_RECONCILIATION' WHERE id=$1",
          [r.id],
        );
        await event(ctx, 'CANCEL', r.id, { dispatchedOnly: true });
        return { ...publicReservation(r), state: 'PENDING_RECONCILIATION' };
      });
    },
    settle: async (actorId, data) => {
      shape(data, ['reservationId', 'inputTokens', 'outputTokens', 'idempotencyKey']);
      id(data.reservationId);
      const input = integer(data.inputTokens),
        output = integer(data.outputTokens);
      return operation(actorId, 'SETTLE', data, true, async (ctx) =>
        finish(ctx, await readReservation(ctx.tx, data.reservationId), input, output),
      );
    },
    sweep: async (actorId) => {
      await actor(db, actorId, true);
      const rows = (
        await db.query(
          "SELECT id,state FROM capacity_reservations WHERE (state='RESERVED' AND expires_at<=$1) OR (state IN ('DISPATCHED','PENDING_RECONCILIATION') AND reconciliation_deadline<=$1) ORDER BY created_at,id LIMIT 100",
          [iso(now())],
        )
      ).rows;
      let released = 0,
        estimated = 0;
      for (const row of rows) {
        const kind = row.state === 'RESERVED' ? 'PRE_DISPATCH_TIMEOUT' : 'DEADLINE_ESTIMATE';
        try {
          const result = await operation(
            actorId,
            kind,
            { reservationId: row.id, idempotencyKey: 'sweep-' + hash(kind + ':' + row.id) },
            true,
            async (ctx) => {
              const r = await readReservation(ctx.tx, row.id);
              if (kind === 'PRE_DISPATCH_TIMEOUT') {
                if (r.state !== 'RESERVED' || ctx.time < new Date(r.expires_at).getTime())
                  fail('CAPACITY_RESOLVED', 'Capacity reservation is already resolved.');
                const value = await release(ctx, r);
                await event(ctx, kind, r.id);
                return value;
              }
              if (
                !['DISPATCHED', 'PENDING_RECONCILIATION'].includes(r.state) ||
                ctx.time < new Date(r.reconciliation_deadline).getTime()
              )
                fail('CAPACITY_RESOLVED', 'Capacity reservation is already resolved.');
              return finish(ctx, r, integer(r.bound_input), integer(r.bound_output), true);
            },
            true,
          );
          if (!result.replayed) {
            if (result.state === 'RELEASED') released++;
            else estimated++;
          }
        } catch (error) {
          if (error.code !== 'CAPACITY_RESOLVED') throw error;
        }
      }
      return { released, estimated, syntheticOnly: true };
    },
    snapshot: async (actorId, data) => {
      shape(data, ['modelId', 'accountRef']);
      id(data.modelId, 80);
      id(data.accountRef, 80);
      return db.transaction(async (tx) => {
        await tx.query('SELECT id FROM capacity_storage_guard WHERE id=1 FOR SHARE');
        await actor(tx, actorId, true);
        const r = await route(tx, data.modelId, data.accountRef),
          time = now(),
          limits = [];
        for (const l of r.limits) {
          const c = await counter(tx, l, time);
          limits.push({
            poolId: l.pool_id,
            scope: l.scope,
            metric: l.metric,
            windowMs: l.window_ms,
            limit: l.limit_amount,
            safetyFactor: l.safety_factor,
            safeLimit: c.safe,
            used: c.used,
            reserved: c.reserved,
            remaining: (integer(c.safe) - integer(c.used) - integer(c.reserved)).toString(),
            startsAt: iso(c.start),
            resetsAt: iso(c.reset),
          });
        }
        return { modelId: r.model_id, accountRef: r.account_ref, limits, syntheticOnly: true };
      });
    },
    reservation: async (actorId, reservationId) =>
      db.transaction(async (tx) => {
        await actor(tx, actorId);
        return publicReservation(await readReservation(tx, reservationId, actorId));
      }),
    runFairShare: async (actorId, data) => {
      shape(data, ['idempotencyKey']);
      return operation(actorId, 'FAIR_SHARE_JOB', data, true, async (ctx) => {
        const candidates = (
          await ctx.tx.query(
            "SELECT r.model_id,r.account_ref FROM capacity_routes r JOIN models m ON m.id=r.model_id JOIN providers p ON p.id=r.provider_id JOIN registry_metadata mm ON mm.area='model' AND mm.target_id=m.id WHERE m.status='enabled' AND p.status='enabled' AND m.free_flag=TRUE AND mm.data->>'freeFlag'='true' ORDER BY r.id LIMIT $1",
            [config.maxRoutes + 1],
          )
        ).rows;
        if (candidates.length > config.maxRoutes)
          fail('CAPACITY_STORAGE_FULL', 'Bounded route storage exceeded.');
        const routes = [];
        for (const candidate of candidates) {
          const r = await route(ctx.tx, candidate.model_id, candidate.account_ref),
            budgets = {};
          for (const pool of r.pools)
            budgets[pool.scope] = await dailyPool(ctx.tx, pool, r.limits, ctx.time);
          routes.push({
            providerId: r.provider_id,
            accountRef: r.account_ref,
            modelId: r.model_id,
            providerRemainingTokens: budgets.provider ?? null,
            accountRemainingTokens: budgets.account ?? null,
            modelRemainingTokens: budgets.model ?? null,
          });
        }
        if (
          !routes.length ||
          routes.some((r) =>
            [r.providerRemainingTokens, r.accountRemainingTokens, r.modelRemainingTokens].every(
              (v) => v === null,
            ),
          )
        )
          fail(
            'CAPACITY_UNKNOWN',
            'Unknown daily token capacity; minute limits cannot imply daily quota.',
          );
        const remaining = aggregateDailyTokens(routes);
        const users = (
          await ctx.tx.query(
            "SELECT id,trust_level FROM users WHERE role='user' AND tier='free' AND identity_provider='synthetic' AND status='active' AND deleted_at IS NULL ORDER BY id LIMIT $1 FOR SHARE",
            [config.maxJobUsers + 1],
          )
        ).rows;
        if (users.length > config.maxJobUsers)
          fail('CAPACITY_STORAGE_FULL', 'Fair-share user storage bound exceeded.');
        const generationId = ctx.operationId;
        await ctx.tx.query(
          'INSERT INTO capacity_job_runs(id,pool_remaining_tokens,expected_active_users,created_at) VALUES($1,$2,$3,$4)',
          [generationId, remaining.toString(), config.expectedActiveUsers, iso(ctx.time)],
        );
        for (const user of users) {
          const cap = config.trustTokenCaps[user.trust_level];
          const tokens = fairShareTokens({
            userTokenCap: cap,
            remainingTokens: remaining,
            expectedActiveUsers: config.expectedActiveUsers,
          });
          await ctx.tx.query(
            'INSERT INTO capacity_fair_share(generation_id,user_id,daily_tokens,trust_token_cap,trust_level,created_at) VALUES($1,$2,$3,$4,$5,$6)',
            [generationId, user.id, tokens.toString(), cap, user.trust_level, iso(ctx.time)],
          );
        }
        await event(ctx, 'FAIR_SHARE_JOB', null, { generationId, users: users.length });
        return {
          generationId,
          poolRemainingTokens: remaining.toString(),
          expectedActiveUsers: config.expectedActiveUsers,
          users: users.length,
          unit: 'tokens',
          syntheticOnly: true,
        };
      });
    },
    allowance: async (actorId) => {
      await actor(db, actorId);
      const r = (
        await db.query(
          'SELECT f.daily_tokens::text AS tokens,f.trust_token_cap::text AS cap,f.trust_level,f.created_at,j.pool_remaining_tokens::text AS remaining,j.expected_active_users::text AS expected FROM capacity_fair_share f JOIN capacity_job_runs j ON j.id=f.generation_id WHERE f.user_id=$1 ORDER BY f.created_at DESC,f.id DESC LIMIT 1',
          [actorId],
        )
      ).rows[0];
      return r
        ? {
            tokens: r.tokens,
            unit: 'tokens',
            trustTokenCap: r.cap,
            trustLevel: r.trust_level,
            poolRemainingTokens: r.remaining,
            expectedActiveUsers: r.expected,
            createdAt: iso(new Date(r.created_at).getTime()),
            syntheticOnly: true,
          }
        : null;
    },
  };
}
