import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../api/errors.mjs';
import { integer, costMicroCu } from './arithmetic.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));
const taskStates = ['ACTIVE', 'PAUSED', 'PLANNING', 'AWAITING_APPROVAL', 'REVIEW'];
const openStates = ['RESERVED', 'DISPATCHED', 'PENDING_RECONCILIATION'];
const columns = ['cost', 'input', 'output'];
// PGlite's default int8 parser produces JS numbers. Cast accounting fields in SQL
// before they cross that parser, preserving every digit without changing Phase 1.
const reservationFields =
  'id,user_id,entitlement_id,request_id,parent_id,kind,state,wait_deadline,bound_cost::text AS bound_cost,bound_input::text AS bound_input,bound_output::text AS bound_output,outstanding_cost::text AS outstanding_cost,outstanding_input::text AS outstanding_input,outstanding_output::text AS outstanding_output';
const fail = (code, message, status = 400) => {
  throw new AppError(status, code, message);
};
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value))
    fail('INVALID_LEDGER', 'Invalid accounting identifier.');
  return value;
}
function shape(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !allowed.includes(field))
  )
    fail('INVALID_LEDGER', 'Unknown field or invalid accounting payload.');
}
function amount(value, signed = false) {
  try {
    return integer(value, { signed });
  } catch {
    fail('INVALID_LEDGER', 'Expected a bounded canonical integer amount.');
  }
}
function dimensions(data, signed = false) {
  return {
    cost: amount(data.costMicroCu, signed),
    input: amount(data.inputTokens, signed),
    output: amount(data.outputTokens, signed),
  };
}
const zero = () => ({ cost: 0n, input: 0n, output: 0n });
const combine = (a, b, sign = 1n) =>
  Object.fromEntries(columns.map((name) => [name, amount(a[name] + sign * b[name], true)]));
const negative = (a) => Object.fromEntries(columns.map((name) => [name, -a[name]]));
const serialized = (a) => ({
  costMicroCu: a.cost.toString(),
  inputTokens: a.input.toString(),
  outputTokens: a.output.toString(),
});
const bounds = (r) => Object.fromEntries(columns.map((name) => [name, amount(r['bound_' + name])]));
const outstanding = (r) =>
  Object.fromEntries(columns.map((name) => [name, amount(r['outstanding_' + name])]));
const exceeds = (a, b) => columns.some((name) => a[name] > b[name]);
const canonical = (data) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(data)
        .sort()
        .map((name) => [name, typeof data[name] === 'bigint' ? data[name].toString() : data[name]]),
    ),
  );
function date(value) {
  if (
    typeof value !== 'string' ||
    value.length > 30 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail('INVALID_LEDGER', 'Expected a canonical UTC accounting date.');
  return Date.parse(value);
}
function toolExceeds(actual, cap) {
  // Validate using the same exact parser, then compare unrounded decimal quantities.
  costMicroCu({
    inputTokens: '0',
    outputTokens: '0',
    cuInputRate: '0',
    cuOutputRate: '0',
    toolSurchargeCu: actual,
  });
  const [aw, af = ''] = actual.split('.');
  const [cw, cf = ''] = cap.split('.');
  const length = Math.max(af.length, cf.length);
  return BigInt(aw + af.padEnd(length, '0')) > BigInt(cw + cf.padEnd(length, '0'));
}
function publicReservation(r) {
  return {
    id: r.id,
    entitlementId: r.entitlement_id,
    requestId: r.request_id,
    parentId: r.parent_id,
    kind: r.kind,
    state: r.state,
    bound: serialized(bounds(r)),
    outstanding: serialized(outstanding(r)),
    syntheticOnly: true,
  };
}
function publicEntry(r) {
  return {
    id: r.id,
    entitlementId: r.entitlement_id,
    type: r.type,
    amountMicroCu: String(r.amount_micro_cu),
    tokensIn: String(r.tokens_in),
    tokensOut: String(r.tokens_out),
    reservationId: r.reservation_id,
    estimateFlag: r.estimate_flag,
    reconcilesEntryId: r.reconciles_entry_id,
    reasonCode: r.reason_code,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Trusted local synthetic accounting. Dispatch records evidence only; it never calls a provider. */
export function createLedger(db, options = {}) {
  shape(options, [...Object.keys(defaults), 'clock']);
  const config = { ...defaults, ...options };
  if (
    config.localOnly !== true ||
    JSON.stringify(config.staffRoles) !== JSON.stringify(defaults.staffRoles)
  )
    fail('INVALID_LEDGER_CONFIG', 'Ledger must retain local-only staff permissions.');
  for (const name of [
    'maxLedgerRows',
    'maxOperations',
    'maxEntitlements',
    'maxReservations',
    'maxAlerts',
    'historyLimit',
  ]) {
    if (!Number.isInteger(config[name]) || config[name] < 1 || config[name] > 100000)
      fail('INVALID_LEDGER_CONFIG', 'Invalid bounded ledger storage configuration.');
  }
  for (const name of ['reconciliationMs', 'taskWaitTimeoutMs']) {
    if (!Number.isInteger(config[name]) || config[name] < 1 || config[name] > 86400000)
      fail('INVALID_LEDGER_CONFIG', 'Invalid ledger reconciliation deadline.');
  }
  const clock = options.clock ?? Date.now;
  if (typeof clock !== 'function')
    fail('INVALID_LEDGER_CONFIG', 'Invalid trusted accounting clock.');
  const now = () => {
    const value = clock();
    if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime()))
      fail('INVALID_LEDGER_CONFIG', 'Invalid accounting time.');
    return value;
  };
  async function actor(tx, actorId, requireStaff = false) {
    identifier(actorId);
    const found = (
      await tx.query(
        "SELECT id,role,identity_provider FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL",
        [actorId],
      )
    ).rows[0];
    if (
      !found ||
      found.identity_provider !== 'synthetic' ||
      (requireStaff && !defaults.staffRoles.includes(found.role))
    )
      fail(
        'LEDGER_FORBIDDEN',
        'An active synthetic identity and trusted staff permission are required.',
        403,
      );
    return found;
  }
  async function entitlement(tx, id, owner = null) {
    identifier(id);
    const r = (await tx.query('SELECT * FROM ledger_entitlements WHERE id=$1 FOR UPDATE', [id]))
      .rows[0];
    if (!r || (owner && r.user_id !== owner))
      fail('LEDGER_NOT_FOUND', 'Accounting resource not found.', 404);
    return r;
  }
  async function reservation(tx, id, owner = null) {
    identifier(id);
    const r = (
      await tx.query(
        `SELECT ${reservationFields} FROM ledger_reservations WHERE id=$1 FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (!r || (owner && r.user_id !== owner))
      fail('LEDGER_NOT_FOUND', 'Accounting resource not found.', 404);
    return r;
  }
  async function valid(tx, e) {
    const user = (
      await tx.query(
        "SELECT id FROM users WHERE id=$1 AND status='active' AND identity_provider='synthetic' AND deleted_at IS NULL",
        [e.user_id],
      )
    ).rows[0];
    if (!user) fail('LEDGER_FORBIDDEN', 'The synthetic account is not active.', 403);
    const time = now();
    if (e.status !== 'active' || time >= new Date(e.ends_at).getTime())
      fail('ENTITLEMENT_EXPIRED', 'The token allowance has expired.', 409);
    if (time < new Date(e.starts_at).getTime())
      fail('ENTITLEMENT_NOT_STARTED', 'The token allowance has not started.', 409);
  }
  async function balance(tx, id) {
    const r = (
      await tx.query(
        'SELECT COALESCE(sum(amount_micro_cu),0)::text AS cost, COALESCE(sum(tokens_in),0)::text AS input, COALESCE(sum(tokens_out),0)::text AS output FROM usage_ledger WHERE entitlement_id=$1',
        [id],
      )
    ).rows[0];
    const values = Object.fromEntries(columns.map((name) => [name, amount(r[name], true)]));
    if (columns.some((name) => values[name] < 0n))
      fail('INSUFFICIENT_BALANCE', 'The funded balance or token allowance is insufficient.', 402);
    return values;
  }
  async function capacity(tx) {
    const counts = (
      await tx.query(`SELECT
      (SELECT count(*) FROM usage_ledger)::int AS rows,
      (SELECT count(*) FROM ledger_operations)::int AS operations,
      (SELECT count(*) FROM ledger_entitlements)::int AS entitlements,
      (SELECT count(*) FROM ledger_reservations)::int AS reservations,
      (SELECT count(*) FROM ledger_alerts)::int AS alerts`)
    ).rows[0];
    const holds = (await tx.query('SELECT kind,state FROM ledger_reservations')).rows;
    let rows = 0;
    let operations = 0;
    let alerts = 0;
    for (const r of holds) {
      if (r.kind === 'task') {
        if (taskStates.includes(r.state)) {
          rows += 1;
          operations += 1;
        }
      } else if (openStates.includes(r.state)) {
        rows += r.kind === 'call' ? 4 : 3;
        operations += r.state === 'RESERVED' ? 4 : r.state === 'DISPATCHED' ? 3 : 2;
        alerts += 1;
      } else if (r.state === 'ESTIMATED') {
        rows += r.kind === 'call' ? 2 : 1;
        operations += 1;
      }
    }
    if (
      counts.rows + rows > config.maxLedgerRows ||
      counts.operations + operations > config.maxOperations ||
      counts.entitlements > config.maxEntitlements ||
      counts.reservations > config.maxReservations ||
      counts.alerts + alerts > config.maxAlerts
    )
      fail(
        'LOCAL_STORAGE_FULL',
        'Ledger storage is full; outstanding holds retain settlement capacity.',
        503,
      );
  }
  async function entry(
    ctx,
    e,
    type,
    values,
    { reservationId = null, refId = e.id, estimated = false, reconciles = null, reason } = {},
  ) {
    const id = randomUUID();
    await ctx.tx.query(
      'INSERT INTO usage_ledger(id,user_id,entitlement_id,actor_id,actor_role,type,amount_micro_cu,tokens_in,tokens_out,reservation_id,ref_id,idempotency_key,estimate_flag,reconciles_entry_id,reason_code,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        id,
        e.user_id,
        e.id,
        ctx.actor.id,
        ctx.actor.role,
        type,
        values.cost.toString(),
        values.input.toString(),
        values.output.toString(),
        reservationId,
        refId,
        ctx.operationId + '-' + ctx.rowIndex++,
        estimated,
        reconciles,
        reason,
        new Date(now()).toISOString(),
      ],
    );
    return id;
  }
  async function setOutstanding(tx, r, value, state = r.state) {
    await tx.query(
      'UPDATE ledger_reservations SET outstanding_cost=$2,outstanding_input=$3,outstanding_output=$4,state=$5 WHERE id=$1',
      [r.id, value.cost.toString(), value.input.toString(), value.output.toString(), state],
    );
    return {
      ...r,
      outstanding_cost: value.cost.toString(),
      outstanding_input: value.input.toString(),
      outstanding_output: value.output.toString(),
      state,
    };
  }
  async function operation(action, actorId, data, fields, requireStaff, body) {
    shape(data, [...fields, 'idempotencyKey']);
    if (
      typeof data.idempotencyKey !== 'string' ||
      !/^[A-Za-z0-9_-]{8,160}$/.test(data.idempotencyKey)
    )
      fail('INVALID_LEDGER', 'Invalid operation idempotency key.');
    const raw = canonical(data);
    if (raw.length > 8192) fail('INVALID_LEDGER', 'Accounting payload exceeds its size bound.');
    const hash = createHash('sha256')
      .update(action + ':' + raw)
      .digest('hex');
    return db.transaction(async (tx) => {
      await tx.query('SELECT id FROM ledger_storage_guard WHERE id=1 FOR UPDATE');
      const identity = await actor(tx, actorId, requireStaff);
      const previous = (
        await tx.query(
          'SELECT action,request_hash,result FROM ledger_operations WHERE actor_id=$1 AND idempotency_key=$2',
          [actorId, data.idempotencyKey],
        )
      ).rows[0];
      if (previous) {
        if (previous.action !== action || previous.request_hash !== hash)
          fail(
            'IDEMPOTENCY_CONFLICT',
            'The idempotency key already identifies a different accounting operation.',
            409,
          );
        return previous.result;
      }
      const ctx = { tx, actor: identity, operationId: randomUUID(), rowIndex: 0 };
      const result = await body(ctx);
      await tx.query(
        'INSERT INTO ledger_operations(id,actor_id,actor_role,action,idempotency_key,request_hash,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
        [
          ctx.operationId,
          actorId,
          identity.role,
          action,
          data.idempotencyKey,
          hash,
          JSON.stringify(result),
          new Date(now()).toISOString(),
        ],
      );
      await capacity(tx);
      return result;
    });
  }
  const fields = [
    'entitlementId',
    'reservationId',
    'requestId',
    'kind',
    'costMicroCu',
    'inputTokens',
    'outputTokens',
  ];
  async function newReservation(ctx, data, e, parent = null) {
    identifier(data.reservationId);
    identifier(data.requestId);
    const requested = dimensions(data);
    const state = data.kind === 'task' ? 'ACTIVE' : 'RESERVED';
    const r = (
      await ctx.tx.query(
        `INSERT INTO ledger_reservations(id,user_id,entitlement_id,request_id,parent_id,kind,state,bound_cost,bound_input,bound_output,outstanding_cost,outstanding_input,outstanding_output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$8,$9,$10) RETURNING ${reservationFields}`,
        [
          data.reservationId,
          e.user_id,
          e.id,
          data.requestId,
          parent?.id ?? null,
          parent ? 'call' : data.kind,
          state,
          requested.cost.toString(),
          requested.input.toString(),
          requested.output.toString(),
        ],
      )
    ).rows[0];
    if (!parent)
      await entry(ctx, e, 'reserve', negative(requested), {
        reservationId: r.id,
        refId: r.request_id,
        reason: 'RESERVATION',
      });
    return publicReservation(r);
  }
  async function allocations(tx, parentId) {
    const r = (
      await tx.query(
        'SELECT COALESCE(sum(outstanding_cost),0)::text AS cost,COALESCE(sum(outstanding_input),0)::text AS input,COALESCE(sum(outstanding_output),0)::text AS output FROM ledger_reservations WHERE parent_id=$1',
        [parentId],
      )
    ).rows[0];
    return Object.fromEntries(columns.map((name) => [name, amount(r[name])]));
  }
  async function settleAttempt(ctx, r, actual, estimated) {
    const e = await entitlement(ctx.tx, r.entitlement_id);
    const attempt = (
      await ctx.tx.query(
        'SELECT status,commit_entry_id,actual_micro_cu::text AS actual_micro_cu,actual_input::text AS actual_input,actual_output::text AS actual_output FROM provider_attempts WHERE reservation_id=$1 FOR UPDATE',
        [r.id],
      )
    ).rows[0];
    if (!attempt || !['DISPATCHED', 'PENDING_RECONCILIATION', 'ESTIMATED'].includes(r.state))
      fail(
        'LEDGER_RESOLVED',
        'The dispatched attempt is already resolved or cannot be settled.',
        409,
      );
    const parent = r.parent_id ? await reservation(ctx.tx, r.parent_id) : null;
    let commitId = attempt.commit_entry_id;
    if (r.state === 'ESTIMATED') {
      if (estimated)
        fail('LEDGER_RESOLVED', 'The attempt is already resolved by an estimate.', 409);
      const old = {
        cost: amount(attempt.actual_micro_cu),
        input: amount(attempt.actual_input),
        output: amount(attempt.actual_output),
      };
      const correction = combine(old, actual, -1n);
      await entry(ctx, e, 'adjust', correction, {
        reservationId: r.id,
        refId: r.request_id,
        reconciles: commitId,
        reason: 'LATE_CORRECTION',
      });
      if (parent && taskStates.includes(parent.state)) {
        await entry(ctx, e, 'reserve', negative(correction), {
          reservationId: r.id,
          refId: r.request_id,
          reason: 'RESERVATION',
        });
        await setOutstanding(ctx.tx, parent, combine(outstanding(parent), correction));
      }
    } else {
      const released = parent && taskStates.includes(parent.state) ? actual : outstanding(r);
      await entry(ctx, e, 'release', released, {
        reservationId: r.id,
        refId: r.request_id,
        reason: estimated ? 'DEADLINE_ESTIMATE' : 'SETTLEMENT',
      });
      commitId = await entry(ctx, e, 'commit', negative(actual), {
        reservationId: r.id,
        refId: r.request_id,
        estimated,
        reason: estimated ? 'DEADLINE_ESTIMATE' : 'SETTLEMENT',
      });
      if (parent) await setOutstanding(ctx.tx, parent, combine(outstanding(parent), released, -1n));
    }
    const state = estimated ? 'ESTIMATED' : r.state === 'ESTIMATED' ? 'CORRECTED' : 'SETTLED';
    const changed = await setOutstanding(ctx.tx, r, zero(), state);
    await ctx.tx.query(
      'UPDATE provider_attempts SET status=$2,usage_status=$3,actual_micro_cu=$4,actual_input=$5,actual_output=$6,reconciled_at=$7,commit_entry_id=$8 WHERE reservation_id=$1',
      [
        r.id,
        state,
        estimated ? 'estimated' : 'synthetic_reported',
        actual.cost.toString(),
        actual.input.toString(),
        actual.output.toString(),
        new Date(now()).toISOString(),
        commitId,
      ],
    );
    await balance(ctx.tx, e.id);
    return publicReservation(changed);
  }
  async function terminate(ctx, r, outcome) {
    if (r.kind !== 'task' || !taskStates.includes(r.state))
      fail('LEDGER_RESOLVED', 'The task is already resolved.', 409);
    const e = await entitlement(ctx.tx, r.entitlement_id);
    const children = (
      await ctx.tx.query(
        `SELECT ${reservationFields} FROM ledger_reservations WHERE parent_id=$1 FOR UPDATE`,
        [r.id],
      )
    ).rows;
    for (const child of children) {
      if (child.state === 'RESERVED') await setOutstanding(ctx.tx, child, zero(), 'RELEASED');
      if (child.state === 'DISPATCHED') {
        await ctx.tx.query(
          "UPDATE ledger_reservations SET state='PENDING_RECONCILIATION' WHERE id=$1",
          [child.id],
        );
        await ctx.tx.query(
          "UPDATE provider_attempts SET status='PENDING_RECONCILIATION' WHERE reservation_id=$1",
          [child.id],
        );
      }
    }
    const allocated = await allocations(ctx.tx, r.id);
    const released = combine(outstanding(r), allocated, -1n);
    await entry(ctx, e, 'release', released, {
      reservationId: r.id,
      refId: r.request_id,
      reason: 'TASK_TERMINATION',
    });
    const changed = await setOutstanding(ctx.tx, r, allocated, outcome);
    await ctx.tx.query('UPDATE ledger_reservations SET wait_deadline=NULL WHERE id=$1', [r.id]);
    return publicReservation(changed);
  }
  const service = {
    async grant(actorId, data) {
      return operation(
        'grant',
        actorId,
        data,
        [
          'userId',
          'entitlementId',
          'kind',
          'costMicroCu',
          'inputTokens',
          'outputTokens',
          'startsAt',
          'endsAt',
        ],
        true,
        async (ctx) => {
          identifier(data.userId);
          identifier(data.entitlementId);
          if (!['free', 'pack'].includes(data.kind))
            fail('INVALID_LEDGER', 'Invalid token allowance kind.');
          const amounts = dimensions(data);
          const starts = date(data.startsAt);
          const ends = date(data.endsAt);
          if (ends <= starts)
            fail('INVALID_LEDGER', 'The token allowance must have a positive duration.');
          await actor(ctx.tx, data.userId);
          const e = (
            await ctx.tx.query(
              'INSERT INTO ledger_entitlements(id,user_id,kind,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) RETURNING *',
              [data.entitlementId, data.userId, data.kind, data.startsAt, data.endsAt],
            )
          ).rows[0];
          await entry(ctx, e, 'grant', amounts, { reason: 'LOCAL_GRANT' });
          await balance(ctx.tx, e.id);
          return { id: e.id, syntheticOnly: true };
        },
      );
    },
    async reserve(actorId, data) {
      return operation('reserve', actorId, data, fields, false, async (ctx) => {
        const e = await entitlement(ctx.tx, data.entitlementId, actorId);
        await valid(ctx.tx, e);
        if (!['request', 'task'].includes(data.kind))
          fail('INVALID_LEDGER', 'Invalid reservation kind.');
        if (exceeds(dimensions(data), await balance(ctx.tx, e.id)))
          fail(
            'INSUFFICIENT_BALANCE',
            'The funded balance or token allowance is insufficient.',
            402,
          );
        return newReservation(ctx, data, e);
      });
    },
    async allocate(actorId, data) {
      return operation(
        'allocate',
        actorId,
        data,
        ['parentId', 'reservationId', 'requestId', 'costMicroCu', 'inputTokens', 'outputTokens'],
        false,
        async (ctx) => {
          const parent = await reservation(ctx.tx, data.parentId, actorId);
          if (parent.kind !== 'task' || parent.state !== 'ACTIVE')
            fail('TASK_NOT_ACTIVE', 'Only an active task may allocate calls.', 409);
          const e = await entitlement(ctx.tx, parent.entitlement_id, actorId);
          await valid(ctx.tx, e);
          const unallocated = combine(
            outstanding(parent),
            await allocations(ctx.tx, parent.id),
            -1n,
          );
          if (exceeds(dimensions(data), unallocated))
            fail(
              'INSUFFICIENT_BALANCE',
              'The task allocation exceeds its remaining funded bound.',
              402,
            );
          return newReservation(ctx, data, e, parent);
        },
      );
    },
    async dispatch(actorId, data) {
      return operation(
        'dispatch',
        actorId,
        data,
        ['reservationId', 'modelId', 'toolSurchargeCu'],
        true,
        async (ctx) => {
          const r = await reservation(ctx.tx, data.reservationId);
          if (r.kind === 'task' || r.state !== 'RESERVED')
            fail(
              'INVALID_DISPATCH_STATE',
              'An attempt may dispatch only once from its reserved state.',
              409,
            );
          const e = await entitlement(ctx.tx, r.entitlement_id);
          await valid(ctx.tx, e);
          if (r.parent_id && (await reservation(ctx.tx, r.parent_id)).state !== 'ACTIVE')
            fail('TASK_NOT_ACTIVE', 'Only an active task may dispatch a call.', 409);
          identifier(data.modelId);
          const m = (
            await ctx.tx.query(
              `SELECT m.id,m.provider_id,p.adapter_kind,m.status AS model_status,p.status AS provider_status,mm.data,mm.revision,pm.revision AS provider_revision
          FROM models m JOIN providers p ON p.id=m.provider_id
          JOIN registry_metadata mm ON mm.area='model' AND mm.target_id=m.id
          JOIN registry_metadata pm ON pm.area='provider' AND pm.target_id=p.id
          WHERE m.id=$1 FOR UPDATE OF m,p,mm,pm`,
              [data.modelId],
            )
          ).rows[0];
          if (
            !m ||
            m.adapter_kind !== 'synthetic_mock' ||
            m.model_status !== 'enabled' ||
            m.provider_status !== 'enabled' ||
            m.data.ratesVerified !== true ||
            m.data.cuInputRate === null ||
            m.data.cuOutputRate === null
          )
            fail(
              'MODEL_RATES_UNKNOWN',
              'An enabled synthetic model with verified exact registry rates is required.',
              409,
            );
          const snapshot = {
            cuInputRate: m.data.cuInputRate,
            cuOutputRate: m.data.cuOutputRate,
            toolSurchargeCu: Object.hasOwn(data, 'toolSurchargeCu') ? data.toolSurchargeCu : '0',
            modelRevision: m.revision,
            providerRevision: m.provider_revision,
            fxVersion: 'synthetic-no-fx',
            source: 'synthetic_registry_cu',
          };
          let upper;
          try {
            upper = costMicroCu({
              inputTokens: r.bound_input,
              outputTokens: r.bound_output,
              ...snapshot,
            });
          } catch {
            fail(
              'MODEL_RATES_UNKNOWN',
              'The model rates or tool surcharge are unknown or invalid.',
              409,
            );
          }
          if (upper > amount(r.bound_cost))
            fail(
              'RESERVATION_BOUND',
              'The funded reservation cannot cover the full dispatch cost bound.',
              402,
            );
          const time = now();
          await ctx.tx.query(
            "INSERT INTO provider_attempts(id,reservation_id,user_id,entitlement_id,request_id,provider_id,model_id,price_version,price_snapshot,status,usage_status,reserved_micro_cu,dispatched_at,reconciliation_deadline) VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8::jsonb,'DISPATCHED','unknown',$9,$10,$11)",
            [
              r.id,
              r.user_id,
              r.entitlement_id,
              r.request_id,
              m.provider_id,
              m.id,
              m.revision,
              JSON.stringify(snapshot),
              r.bound_cost,
              new Date(time).toISOString(),
              new Date(time + config.reconciliationMs).toISOString(),
            ],
          );
          await ctx.tx.query("UPDATE ledger_reservations SET state='DISPATCHED' WHERE id=$1", [
            r.id,
          ]);
          return publicReservation({ ...r, state: 'DISPATCHED' });
        },
      );
    },
    async cancel(actorId, data) {
      return operation('cancel', actorId, data, ['reservationId'], false, async (ctx) => {
        const r = await reservation(ctx.tx, data.reservationId, actorId);
        if (r.kind === 'task' || !openStates.includes(r.state))
          fail(
            'LEDGER_RESOLVED',
            'The request is already resolved; use task termination for task holds.',
            409,
          );
        if (r.state === 'RESERVED') {
          const e = await entitlement(ctx.tx, r.entitlement_id);
          if (!r.parent_id)
            await entry(ctx, e, 'release', outstanding(r), {
              reservationId: r.id,
              refId: r.request_id,
              reason: 'PRE_DISPATCH_CANCEL',
            });
          return publicReservation(await setOutstanding(ctx.tx, r, zero(), 'RELEASED'));
        }
        await ctx.tx.query(
          "UPDATE ledger_reservations SET state='PENDING_RECONCILIATION' WHERE id=$1",
          [r.id],
        );
        await ctx.tx.query(
          "UPDATE provider_attempts SET status='PENDING_RECONCILIATION' WHERE reservation_id=$1",
          [r.id],
        );
        return publicReservation({ ...r, state: 'PENDING_RECONCILIATION' });
      });
    },
    async cancelDispatched(actorId, data) {
      return operation('cancelDispatched', actorId, data, ['reservationId'], true, async (ctx) => {
        const r = await reservation(ctx.tx, data.reservationId);
        if (r.kind === 'task' || r.state !== 'DISPATCHED')
          fail('LEDGER_RESOLVED', 'Only a dispatched request may enter reconciliation.', 409);
        const attempt = (
          await ctx.tx.query('SELECT status FROM provider_attempts WHERE reservation_id=$1', [r.id])
        ).rows[0];
        if (attempt?.status !== 'DISPATCHED')
          fail('LEDGER_RESOLVED', 'Dispatched attempt evidence is required.', 409);
        // Staff may close uncertainty after the customer loses access; keep the full hold.
        await ctx.tx.query(
          "UPDATE ledger_reservations SET state='PENDING_RECONCILIATION' WHERE id=$1",
          [r.id],
        );
        await ctx.tx.query(
          "UPDATE provider_attempts SET status='PENDING_RECONCILIATION' WHERE reservation_id=$1",
          [r.id],
        );
        return publicReservation({ ...r, state: 'PENDING_RECONCILIATION' });
      });
    },
    async settle(actorId, data) {
      return operation(
        'settle',
        actorId,
        data,
        ['reservationId', 'inputTokens', 'outputTokens', 'toolSurchargeCu'],
        true,
        async (ctx) => {
          const r = await reservation(ctx.tx, data.reservationId);
          const a = (
            await ctx.tx.query(
              'SELECT price_snapshot FROM provider_attempts WHERE reservation_id=$1',
              [r.id],
            )
          ).rows[0];
          if (!a) fail('INVALID_DISPATCH_STATE', 'The request has not dispatched.', 409);
          const actual = {
            input: amount(data.inputTokens),
            output: amount(data.outputTokens),
            cost: 0n,
          };
          const surcharge = Object.hasOwn(data, 'toolSurchargeCu') ? data.toolSurchargeCu : '0';
          try {
            if (toolExceeds(surcharge, a.price_snapshot.toolSurchargeCu))
              fail('RESERVATION_BOUND', 'Actual tool use exceeds its dispatch bound.', 409);
            actual.cost = costMicroCu({
              inputTokens: actual.input,
              outputTokens: actual.output,
              ...a.price_snapshot,
              toolSurchargeCu: surcharge,
            });
          } catch (error) {
            if (error instanceof AppError) throw error;
            fail('INVALID_LEDGER', 'Invalid exact usage or tool surcharge.');
          }
          if (exceeds(actual, bounds(r)))
            fail('RESERVATION_BOUND', 'Reported usage exceeds the reserved accounting bound.', 409);
          return settleAttempt(ctx, r, actual, false);
        },
      );
    },
    async taskState(actorId, data) {
      return operation(
        'taskState',
        actorId,
        data,
        ['reservationId', 'state'],
        false,
        async (ctx) => {
          const r = await reservation(ctx.tx, data.reservationId, actorId);
          if (
            r.kind !== 'task' ||
            !taskStates.includes(r.state) ||
            !taskStates.includes(data.state)
          )
            fail('TASK_NOT_ACTIVE', 'The task is not active or the waiting state is invalid.', 409);
          const e = await entitlement(ctx.tx, r.entitlement_id);
          await valid(ctx.tx, e);
          await ctx.tx.query(
            'UPDATE ledger_reservations SET state=$2,wait_deadline=$3 WHERE id=$1',
            [
              r.id,
              data.state,
              data.state === 'ACTIVE'
                ? null
                : new Date(now() + config.taskWaitTimeoutMs).toISOString(),
            ],
          );
          return publicReservation({ ...r, state: data.state });
        },
      );
    },
    async finishTask(actorId, data) {
      return operation(
        'finishTask',
        actorId,
        data,
        ['reservationId', 'outcome'],
        false,
        async (ctx) => {
          const r = await reservation(ctx.tx, data.reservationId, actorId);
          if (!['COMPLETE', 'CANCELLED'].includes(data.outcome))
            fail('INVALID_LEDGER', 'Invalid task termination outcome.');
          return terminate(ctx, r, data.outcome);
        },
      );
    },
    async adjust(actorId, data) {
      return operation(
        'adjust',
        actorId,
        data,
        ['entitlementId', 'costMicroCu', 'inputTokens', 'outputTokens', 'type', 'reasonCode'],
        true,
        async (ctx) => {
          const e = await entitlement(ctx.tx, data.entitlementId);
          if (!(
            (data.type === 'adjust' && data.reasonCode === 'LOCAL_CORRECTION') ||
            (data.type === 'refund' && data.reasonCode === 'LOCAL_REFUND')
          ))
            fail('INVALID_LEDGER', 'A trusted adjustment requires a matching fixed reason code.');
          await entry(ctx, e, data.type, dimensions(data, data.type === 'adjust'), {
            reason: data.reasonCode,
          });
          return {
            id: e.id,
            remaining: serialized(await balance(ctx.tx, e.id)),
            syntheticOnly: true,
          };
        },
      );
    },
    async expire(actorId, data) {
      return operation('expire', actorId, data, ['entitlementId'], true, async (ctx) => {
        const e = await entitlement(ctx.tx, data.entitlementId);
        if (now() < new Date(e.ends_at).getTime())
          fail('INVALID_LEDGER', 'The token allowance is not yet expired.', 409);
        await entry(ctx, e, 'expire', negative(await balance(ctx.tx, e.id)), {
          reason: 'ENTITLEMENT_EXPIRED',
        });
        await ctx.tx.query("UPDATE ledger_entitlements SET status='expired' WHERE id=$1", [e.id]);
        return {
          id: e.id,
          remaining: serialized(await balance(ctx.tx, e.id)),
          syntheticOnly: true,
        };
      });
    },
    async sweep(actorId) {
      await db.transaction((tx) => actor(tx, actorId, true));
      const due = (
        await db.query(
          "SELECT reservation_id FROM provider_attempts WHERE status IN ('DISPATCHED','PENDING_RECONCILIATION') AND reconciliation_deadline<=$1 ORDER BY reconciliation_deadline,reservation_id LIMIT 100",
          [new Date(now()).toISOString()],
        )
      ).rows;
      let estimated = 0;
      let timedOut = 0;
      for (const dueAttempt of due) {
        try {
          await operation(
            'deadline',
            actorId,
            {
              reservationId: dueAttempt.reservation_id,
              idempotencyKey:
                'deadline-' + createHash('sha256').update(dueAttempt.reservation_id).digest('hex'),
            },
            ['reservationId'],
            true,
            async (ctx) => {
              const r = await reservation(ctx.tx, dueAttempt.reservation_id);
              const a = (
                await ctx.tx.query(
                  'SELECT reconciliation_deadline FROM provider_attempts WHERE reservation_id=$1',
                  [r.id],
                )
              ).rows[0];
              if (
                !openStates.includes(r.state) ||
                now() < new Date(a.reconciliation_deadline).getTime()
              )
                fail('LEDGER_RESOLVED', 'The attempt is already resolved or not due.', 409);
              const result = await settleAttempt(ctx, r, bounds(r), true);
              await ctx.tx.query(
                "INSERT INTO ledger_alerts(id,reservation_id,kind,created_at) VALUES($1,$2,'UNKNOWN_USAGE_DEADLINE',$3)",
                [randomUUID(), r.id, new Date(now()).toISOString()],
              );
              return result;
            },
          );
          estimated++;
        } catch (error) {
          if (error.code !== 'LEDGER_RESOLVED') throw error;
        }
      }
      const waiting = (
        await db.query(
          "SELECT id FROM ledger_reservations WHERE kind='task' AND state IN ('PAUSED','PLANNING','AWAITING_APPROVAL','REVIEW') AND wait_deadline<=$1 ORDER BY wait_deadline,id LIMIT 100",
          [new Date(now()).toISOString()],
        )
      ).rows;
      for (const task of waiting) {
        try {
          await operation(
            'taskTimeout',
            actorId,
            {
              reservationId: task.id,
              idempotencyKey: 'task-timeout-' + createHash('sha256').update(task.id).digest('hex'),
            },
            ['reservationId'],
            true,
            async (ctx) => {
              const r = await reservation(ctx.tx, task.id);
              if (
                !taskStates.includes(r.state) ||
                !r.wait_deadline ||
                now() < new Date(r.wait_deadline).getTime()
              )
                fail('LEDGER_RESOLVED', 'The task is already resolved or not due.', 409);
              return terminate(ctx, r, 'TIMED_OUT');
            },
          );
          timedOut++;
        } catch (error) {
          if (error.code !== 'LEDGER_RESOLVED') throw error;
        }
      }
      return { estimated, timedOut, syntheticOnly: true };
    },
    async reservation(actorId, id) {
      return db.transaction(async (tx) => {
        await actor(tx, actorId);
        return publicReservation(await reservation(tx, id, actorId));
      });
    },
    async usage(actorId) {
      return db.transaction(async (tx) => {
        await tx.query('SELECT id FROM ledger_storage_guard WHERE id=1 FOR SHARE');
        await actor(tx, actorId);
        const entitlements = [];
        const owned = (
          await tx.query('SELECT * FROM ledger_entitlements WHERE user_id=$1 ORDER BY kind,id', [
            actorId,
          ])
        ).rows;
        for (const e of owned) {
          const remaining = await balance(tx, e.id);
          const spent = (
            await tx.query(
              "SELECT (-COALESCE(sum(amount_micro_cu),0))::text AS cost,(-COALESCE(sum(tokens_in),0))::text AS input,(-COALESCE(sum(tokens_out),0))::text AS output FROM usage_ledger WHERE entitlement_id=$1 AND (type='commit' OR (type='adjust' AND reconciles_entry_id IS NOT NULL))",
              [e.id],
            )
          ).rows[0];
          const unresolved = (
            await tx.query(
              "SELECT count(*) FILTER(WHERE usage_status='estimated')::int AS estimates,count(*) FILTER(WHERE usage_status='unknown')::int AS pending FROM provider_attempts WHERE entitlement_id=$1",
              [e.id],
            )
          ).rows[0];
          const time = now();
          const expired = e.status === 'expired' || time >= new Date(e.ends_at).getTime();
          const refusalReason = expired
            ? 'ENTITLEMENT_EXPIRED'
            : time < new Date(e.starts_at).getTime()
              ? 'ENTITLEMENT_NOT_STARTED'
              : remaining.input === 0n && remaining.output === 0n
                ? 'TOKENS_EXHAUSTED'
                : null;
          entitlements.push({
            id: e.id,
            kind: e.kind,
            status: expired ? 'expired' : e.status,
            startsAt: new Date(e.starts_at).toISOString(),
            endsAt: new Date(e.ends_at).toISOString(),
            timeLeftSeconds: Math.max(0, Math.floor((new Date(e.ends_at).getTime() - time) / 1000)),
            remaining: serialized(remaining),
            spent: serialized(
              Object.fromEntries(columns.map((name) => [name, amount(spent[name])])),
            ),
            estimated: unresolved.estimates > 0,
            pendingReconciliation: unresolved.pending > 0,
            refusalReason,
          });
        }
        return { syntheticOnly: true, unit: 'tokens', entitlements };
      });
    },
    async history(actorId) {
      return db.transaction(async (tx) => {
        await actor(tx, actorId);
        const records = (
          await tx.query(
            'SELECT id,entitlement_id,type,amount_micro_cu::text AS amount_micro_cu,tokens_in::text AS tokens_in,tokens_out::text AS tokens_out,reservation_id,estimate_flag,reconciles_entry_id,reason_code,created_at FROM (SELECT * FROM usage_ledger WHERE user_id=$1 ORDER BY sequence_no DESC LIMIT $2) recent ORDER BY sequence_no',
            [actorId, config.historyLimit],
          )
        ).rows;
        return records.map(publicEntry);
      });
    },
  };
  return Object.freeze(service);
}
