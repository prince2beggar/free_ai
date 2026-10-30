import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { AppError } from '../api/errors.mjs';

const defaults = JSON.parse(
  (await readFile(new URL('./defaults.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''),
);
const dayMs = 86400000;
const reasons = [
  'ACCOUNT_ABUSE',
  'CLUSTER_RISK',
  'AUTOMATION_RISK',
  'REVIEW_COMPLETE',
  'VERIFIED_LOCAL_EVIDENCE',
];
const staffRoles = ['owner', 'super_admin', 'admin', 'support'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const iso = (time) => new Date(time).toISOString();
function fail(code, message, status = 409, fields = {}) {
  const error = new AppError(status, code, message);
  Object.assign(error, fields);
  throw error;
}
function shape(input, fields) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !fields.includes(k))
  )
    fail('INVALID_ABUSE', 'Unknown or invalid abuse fields.', 400);
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value))
    fail('INVALID_ABUSE', 'Invalid abuse identifier.', 400);
  return value;
}
function integer(value, min = 1, max = 1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail('INVALID_ABUSE', 'Invalid bounded abuse amount.', 400);
  return value;
}
function tokenAmount(value = 0) {
  if (typeof value === 'bigint' && value >= 0n && value <= 1000000n) return value;
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,6})$/.test(value) && BigInt(value) <= 1000000n)
    return BigInt(value);
  if (Number.isSafeInteger(value) && value >= 0 && value <= 1000000) return BigInt(value);
  fail('INVALID_ABUSE', 'Invalid token bound.', 400);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function ipv4(value, bits) {
  const octets = value.split('.').map(Number);
  const n = octets.reduce((a, b) => (a << 8n) | BigInt(b), 0n);
  return 'v4:' + (n >> BigInt(32 - bits)).toString(16) + '/' + bits;
}
function ipRange(address, v4Bits, v6Bits) {
  if (typeof address !== 'string' || address.length > 45 || address.includes('%') || !isIP(address))
    fail('INVALID_ABUSE', 'Expected a valid server-observed IP address.', 400);
  if (isIP(address) === 4) return ipv4(address, v4Bits);
  let text = address.toLowerCase();
  if (text.includes('.')) {
    const p = text.lastIndexOf(':'),
      octets = text
        .slice(p + 1)
        .split('.')
        .map(Number);
    text =
      text.slice(0, p + 1) +
      ((octets[0] << 8) | octets[1]).toString(16) +
      ':' +
      ((octets[2] << 8) | octets[3]).toString(16);
  }
  const parts = text.split('::');
  const left = parts[0] ? parts[0].split(':') : [],
    right = parts[1] ? parts[1].split(':') : [];
  const words =
    parts.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  const n = words.reduce((a, b) => (a << 16n) | BigInt('0x' + b), 0n);
  if (n >> 32n === 65535n) {
    const tail = n & 0xffffffffn;
    const mapped = [24n, 16n, 8n, 0n].map((s) => Number((tail >> s) & 255n)).join('.');
    return ipv4(mapped, v4Bits);
  }
  return 'v6:' + (n >> BigInt(128 - v6Bits)).toString(16) + '/' + v6Bits;
}

/** Trusted, bounded, local synthetic anti-automation. This is not production human verification. */
export function createAbuse(db, options = {}) {
  shape(options, [...Object.keys(defaults), 'key', 'clock']);
  const key =
    Buffer.isBuffer(options.key) || options.key instanceof Uint8Array
      ? Buffer.from(options.key)
      : null;
  if (!key || key.length < 32 || key.length > 64)
    fail('INVALID_ABUSE_CONFIG', 'A server-owned pseudonym key is required.', 400);
  const config = structuredClone(
    Object.fromEntries(
      Object.entries({ ...defaults, ...options }).filter(([k]) => !['key', 'clock'].includes(k)),
    ),
  );
  if (
    config.localOnly !== true ||
    !Array.isArray(config.trustLevels) ||
    config.trustLevels.length !== 4
  )
    fail('INVALID_ABUSE_CONFIG', 'Exactly four local synthetic trust levels are required.', 400);
  for (const [i, level] of config.trustLevels.entries()) {
    shape(level, [
      'minAgeMs',
      'verifiedContact',
      'minGoodBehavior',
      'dailyRequests',
      'dailyTokens',
      'burstRequests',
      'concurrency',
    ]);
    integer(level.minAgeMs, 0, 31536000000);
    integer(level.minGoodBehavior, 0);
    for (const k of ['dailyRequests', 'dailyTokens', 'burstRequests', 'concurrency'])
      integer(level[k]);
    if (
      typeof level.verifiedContact !== 'boolean' ||
      (i === 0 && (level.minAgeMs !== 0 || level.minGoodBehavior !== 0 || level.verifiedContact))
    )
      fail('INVALID_ABUSE_CONFIG', 'Invalid new-account trust criteria.', 400);
    if (i > 0) {
      const prior = config.trustLevels[i - 1];
      if (
        level.minAgeMs < prior.minAgeMs ||
        level.minGoodBehavior < prior.minGoodBehavior ||
        (level.minAgeMs === 0 && level.minGoodBehavior === 0 && !level.verifiedContact) ||
        (prior.verifiedContact && !level.verifiedContact) ||
        level.dailyRequests <= prior.dailyRequests ||
        level.dailyTokens <= prior.dailyTokens ||
        level.burstRequests < prior.burstRequests ||
        level.concurrency < prior.concurrency
      )
        fail('INVALID_ABUSE_CONFIG', 'Trust criteria and limits must increase with level.', 400);
    }
  }
  for (const k of Object.keys(config).filter((k) => k.startsWith('max') && k !== 'maxModerationMs'))
    integer(config[k], 1, 100000);
  for (const k of [
    'newAccountDeviceRequests',
    'newAccountIpRequests',
    'clusterAccounts',
    'burstChallengeAfter',
    'throttleDailyRequests',
    'throttleDailyTokens',
    'throttleBurstRequests',
    'moderationEventReserve',
  ])
    integer(config[k]);
  integer(config.clusterAccounts, 2);
  integer(config.burstWindowMs, 1, dayMs);
  integer(config.challengeTtlMs, 1, 600000);
  integer(config.challengeDifficulty, 1, 20);
  integer(config.newAccountMs, 1, 31536000000);
  integer(config.maxModerationMs, 1, 31536000000);
  integer(config.ipv4PrefixBits, 8, 32);
  integer(config.ipv6PrefixBits, 16, 128);
  integer(config.dayOffsetMinutes, -840, 840);
  if (config.moderationEventReserve >= config.maxEvents)
    fail('INVALID_ABUSE_CONFIG', 'Moderation reserve must fit bounded audit storage.', 400);
  const clock = options.clock ?? Date.now;
  if (typeof clock !== 'function') fail('INVALID_ABUSE_CONFIG', 'Expected a trusted clock.', 400);
  const now = () => {
    const time = clock();
    if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime()))
      fail('ABUSE_CLOCK', 'Invalid abuse clock.');
    return time;
  };
  const hmac = (domain, value) =>
    createHmac('sha256', key)
      .update(domain + ':' + value)
      .digest('hex');
  const userKey = (userId) => hmac('actor', userId);
  const challengeUserKey = (userId) => hmac('challenge-actor', userId ?? 'anonymous');
  const dayAt = (time) =>
    Math.floor((time + config.dayOffsetMinutes * 60000) / dayMs) * dayMs -
    config.dayOffsetMinutes * 60000;
  const burstAt = (time) => Math.floor(time / config.burstWindowMs) * config.burstWindowMs;
  const contexts = new WeakMap();
  function sourceKeys(source) {
    shape(source, ['deviceToken', 'ipAddress']);
    if (
      typeof source.deviceToken !== 'string' ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(source.deviceToken)
    )
      fail('INVALID_ABUSE', 'Expected an opaque server-owned device token.', 400);
    const device = hmac('device', source.deviceToken),
      ip = hmac(
        'ip-range',
        ipRange(source.ipAddress, config.ipv4PrefixBits, config.ipv6PrefixBits),
      );
    return { device, ip, combined: hmac('source', device + ':' + ip) };
  }
  function context(tx) {
    const c = contexts.get(tx);
    if (!c) fail('ABUSE_TRANSACTION_REQUIRED', 'Abuse guard must own the outer transaction.');
    return c;
  }
  async function size(tx, table) {
    const allowed = [
      'abuse_profiles',
      'abuse_sources',
      'abuse_counters',
      'abuse_admissions',
      'abuse_challenges',
      'abuse_alerts',
      'abuse_events',
    ];
    if (!allowed.includes(table)) fail('INVALID_ABUSE', 'Invalid bounded storage scope.', 400);
    if (table === 'abuse_counters')
      return Number(
        (
          await tx.query(
            'SELECT ((SELECT count(*) FROM abuse_counters)+(SELECT count(*) FROM abuse_daily_token_counters))::integer AS n',
          )
        ).rows[0].n,
      );
    return Number((await tx.query('SELECT count(*)::integer AS n FROM ' + table)).rows[0].n);
  }
  async function capacity(tx, table, maximum, additional = 1) {
    if ((await size(tx, table)) + additional > maximum)
      fail('ABUSE_STORAGE_LIMIT', 'Local abuse storage is full.', 503);
  }
  async function eventCapacity(tx, additional, privileged = false, closing = false) {
    const open = Number(
      (await tx.query("SELECT count(*)::integer AS n FROM abuse_moderation WHERE action<>'none'"))
        .rows[0].n,
    );
    if (
      (await size(tx, 'abuse_events')) +
        additional +
        open -
        (closing ? 1 : 0) +
        (privileged ? 0 : config.moderationEventReserve) >
      config.maxEvents
    )
      fail('ABUSE_STORAGE_LIMIT', 'Local abuse audit storage is full.', 503);
  }
  async function event(
    tx,
    identity,
    targetId,
    kind,
    metadata = {},
    operationKey = null,
    requestHash = null,
  ) {
    const json = JSON.stringify(metadata);
    if (Buffer.byteLength(json) > 2048)
      fail('INVALID_ABUSE', 'Abuse event metadata is too large.', 400);
    await tx.query(
      'INSERT INTO abuse_events(id,actor_key,actor_role,target_key,kind,operation_key,request_hash,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
      [
        randomUUID(),
        userKey(identity.id),
        identity.role,
        userKey(targetId),
        kind,
        operationKey,
        requestHash,
        json,
        iso(context(tx).time),
      ],
    );
  }
  async function expire(tx, userId) {
    const c = context(tx),
      m = (await tx.query('SELECT * FROM abuse_moderation WHERE user_id=$1', [userId])).rows[0];
    if (
      m &&
      ['suspend', 'throttle'].includes(m.action) &&
      new Date(m.until_at).getTime() <= c.time
    ) {
      await eventCapacity(tx, 1, true, true);
      await tx.query(
        "UPDATE abuse_moderation SET action='none',until_at=NULL,reason='REVIEW_COMPLETE',updated_at=$1 WHERE user_id=$2",
        [iso(c.time), userId],
      );
      if (m.action === 'suspend')
        await tx.query(
          "UPDATE users SET status='active' WHERE id=$1 AND status='suspended' AND deleted_at IS NULL",
          [userId],
        );
      await event(tx, { id: 'abuse-system', role: 'system' }, userId, 'MODERATION_EXPIRED', {
        previousAction: m.action,
      });
      return { action: 'none', until_at: null };
    }
    return m ?? { action: 'none', until_at: null };
  }
  async function actor(tx, userId, permission = 'user', allowBlocked = false) {
    identifier(userId);
    const moderation = await expire(tx, userId);
    const row = (
      await tx.query(
        "SELECT id,role,status,trust_level,created_at FROM users WHERE id=$1 AND identity_provider='synthetic' AND deleted_at IS NULL",
        [userId],
      )
    ).rows[0];
    if (!row || row.status === 'deleted')
      fail('ABUSE_FORBIDDEN', 'Active synthetic identity required.', 403);
    if (
      !allowBlocked &&
      (['suspend', 'ban'].includes(moderation.action) || row.status !== 'active')
    )
      fail('ABUSE_MODERATED', 'This account is restricted.', 403);
    if (
      (permission === 'staff' && !staffRoles.includes(row.role)) ||
      (permission === 'trust' && !['owner', 'super_admin', 'admin'].includes(row.role))
    )
      fail('ABUSE_FORBIDDEN', 'Trusted moderator permission required.', 403);
    return { ...row, moderation };
  }
  async function ownedRequest(tx, userId, requestId) {
    const row = (await tx.query('SELECT user_id FROM chat_requests WHERE id=$1', [requestId]))
      .rows[0];
    if (!row) fail('ABUSE_ADMISSION_REQUIRED', 'An owned chat request is required.', 403);
    if (row.user_id !== userId) fail('ABUSE_FORBIDDEN', 'Owned chat request required.', 403);
  }
  async function profile(tx, userId) {
    let p = (await tx.query('SELECT * FROM abuse_profiles WHERE user_id=$1', [userId])).rows[0];
    if (!p) {
      await capacity(tx, 'abuse_profiles', config.maxProfiles);
      await tx.query('INSERT INTO abuse_profiles(user_id) VALUES($1)', [userId]);
      p = { verified_contact: false, good_behavior: 0, signup_verified: false };
    }
    return p;
  }
  function trust(identity, p, time) {
    const age = Math.max(0, time - new Date(identity.created_at).getTime());
    let level = 0;
    for (let i = 1; i < 4; i++) {
      const rule = config.trustLevels[i];
      if (
        age >= rule.minAgeMs &&
        p.good_behavior >= rule.minGoodBehavior &&
        (!rule.verifiedContact || p.verified_contact)
      )
        level = i;
    }
    return level;
  }
  function limits(level, moderation) {
    const rule = config.trustLevels[level],
      throttled = moderation.action === 'throttle';
    return {
      dailyRequests: throttled
        ? Math.min(rule.dailyRequests, config.throttleDailyRequests)
        : rule.dailyRequests,
      dailyTokens: throttled
        ? Math.min(rule.dailyTokens, config.throttleDailyTokens)
        : rule.dailyTokens,
      concurrency: rule.concurrency,
      burstRequests: throttled
        ? Math.min(rule.burstRequests, config.throttleBurstRequests)
        : rule.burstRequests,
      burstWindowMs: config.burstWindowMs,
      newAccountDeviceRequests: config.newAccountDeviceRequests,
      newAccountIpRequests: config.newAccountIpRequests,
    };
  }
  async function syncTrust(tx, identity, p) {
    const level = trust(identity, p, context(tx).time);
    if (level !== identity.trust_level) {
      await eventCapacity(tx, 1);
      await tx.query('UPDATE users SET trust_level=$1 WHERE id=$2', [level, identity.id]);
      await event(tx, identity, identity.id, 'TRUST_CHANGED', {
        previous: identity.trust_level,
        current: level,
      });
    }
    return level;
  }
  async function counter(tx, scope, owner, window) {
    return (
      (
        await tx.query(
          'SELECT used FROM abuse_counters WHERE scope=$1 AND owner_key=$2 AND window_at=$3',
          [scope, owner, iso(window)],
        )
      ).rows[0]?.used ?? 0
    );
  }
  async function debit(tx, scope, owner, window, bound, reset) {
    const used = await counter(tx, scope, owner, window);
    if (used >= bound)
      fail(
        scope === 'user_day' || scope === 'user_burst' ? 'ABUSE_USER_LIMIT' : 'ABUSE_SOURCE_LIMIT',
        'Configured abuse usage cap reached.',
        429,
        { resetAt: iso(reset) },
      );
    if (used === 0) await capacity(tx, 'abuse_counters', config.maxCounters);
    await tx.query(
      'INSERT INTO abuse_counters(scope,owner_key,window_at,used) VALUES($1,$2,$3,1) ON CONFLICT(scope,owner_key,window_at) DO UPDATE SET used=abuse_counters.used+1',
      [scope, owner, iso(window)],
    );
  }
  async function registerSources(tx, userId, sources) {
    const c = context(tx);
    for (const [kind, sourceHash] of [
      ['device', sources.device],
      ['ip_range', sources.ip],
    ]) {
      const existing = (
        await tx.query(
          'SELECT 1 FROM abuse_sources WHERE user_key=$1 AND source_kind=$2 AND source_hash=$3',
          [userKey(userId), kind, sourceHash],
        )
      ).rows.length;
      if (!existing) await capacity(tx, 'abuse_sources', config.maxSources);
      await tx.query(
        'INSERT INTO abuse_sources(user_key,source_kind,source_hash,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT(user_key,source_kind,source_hash) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at',
        [userKey(userId), kind, sourceHash, iso(c.time)],
      );
      const count = Number(
        (
          await tx.query(
            'SELECT count(*)::integer AS n FROM abuse_sources WHERE source_kind=$1 AND source_hash=$2 AND last_seen_at>=$3',
            [kind, sourceHash, iso(dayAt(c.time))],
          )
        ).rows[0].n,
      );
      if (count >= config.clusterAccounts) {
        const present = (
          await tx.query(
            'SELECT 1 FROM abuse_alerts WHERE source_kind=$1 AND source_hash=$2 AND window_at=$3',
            [kind, sourceHash, iso(dayAt(c.time))],
          )
        ).rows.length;
        if (!present) {
          await capacity(tx, 'abuse_alerts', config.maxAlerts);
          await tx.query(
            "INSERT INTO abuse_alerts(id,source_kind,source_hash,window_at,account_count,rule,created_at) VALUES($1,$2,$3,$4,$5,'ACCOUNT_CLUSTER',$6)",
            [randomUUID(), kind, sourceHash, iso(dayAt(c.time)), count, iso(c.time)],
          );
        }
      }
    }
  }
  async function consumeChallenge(tx, userId, sources, purpose, proof) {
    if (!proof)
      fail('ABUSE_CHALLENGE_REQUIRED', 'A local anti-automation challenge is required.', 429, {
        challengeRequired: true,
        resetAt: iso(burstAt(context(tx).time) + config.burstWindowMs),
      });
    shape(proof, ['id', 'solution']);
    identifier(proof.id);
    if (typeof proof.solution !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(proof.solution))
      fail('INVALID_ABUSE', 'Invalid challenge solution.', 400);
    const c = context(tx),
      record = (await tx.query('SELECT * FROM abuse_challenges WHERE id=$1', [proof.id])).rows[0];
    const nonce = hmac('challenge-nonce', proof.id);
    if (
      !record ||
      record.purpose !== purpose ||
      record.source_key !== sources.combined ||
      (record.user_key !== challengeUserKey(userId) &&
        !(purpose === 'signup' && record.user_key === challengeUserKey(null))) ||
      record.nonce_hash !== hash(nonce) ||
      record.consumed_at ||
      new Date(record.expires_at).getTime() <= c.time
    )
      fail('ABUSE_CHALLENGE', 'Challenge could not be verified.', 403);
    const digest = createHash('sha256')
      .update(nonce + ':' + proof.solution)
      .digest();
    for (let bit = 0; bit < record.difficulty; bit++)
      if (digest[Math.floor(bit / 8)] & (128 >> (bit % 8)))
        fail('ABUSE_CHALLENGE', 'Challenge could not be verified.', 403);
    await tx.query(
      'UPDATE abuse_challenges SET consumed_at=$1 WHERE id=$2 AND consumed_at IS NULL',
      [iso(c.time), proof.id],
    );
    c.checks.push((time) => {
      if (time >= new Date(record.expires_at).getTime())
        fail('ABUSE_CHALLENGE', 'Challenge expired before admission.', 403);
    });
    return proof.id;
  }
  async function finalActor(tx, userId, permission = 'user') {
    context(tx).actors.set(userId, permission);
  }
  async function withTransaction(callback) {
    if (typeof callback !== 'function')
      fail('INVALID_ABUSE', 'Expected a transaction operation.', 400);
    return db.transaction(async (tx) => {
      const stored = (
        await tx.query(
          'SELECT last_time,key_fingerprint FROM abuse_storage_guard WHERE id=1 FOR UPDATE',
        )
      ).rows[0];
      if (!stored) fail('ABUSE_SCHEMA_REQUIRED', 'Abuse migration is required.', 503);
      const fingerprint = hmac('key-binding', 'abuse-v1');
      if (stored.key_fingerprint && stored.key_fingerprint !== fingerprint)
        fail('ABUSE_KEY_MISMATCH', 'The server identity key does not match this database.', 503);
      const time = now();
      if (stored.last_time && time < new Date(stored.last_time).getTime())
        fail('ABUSE_CLOCK', 'Abuse clock moved backwards.');
      const c = { time, checks: [], actors: new Map() };
      const guardedTx = Object.freeze({
        ...tx,
        onBeforeCommit(check) {
          if (typeof check !== 'function' || check.constructor.name === 'AsyncFunction')
            fail('INVALID_ABUSE', 'Commit checks must be synchronous functions.', 400);
          c.checks.push(check);
        },
      });
      contexts.set(guardedTx, c);
      try {
        const result = await callback(guardedTx);
        for (const [userId, permission] of c.actors) await actor(guardedTx, userId, permission);
        const finalTime = now();
        if (finalTime < time) fail('ABUSE_CLOCK', 'Abuse clock moved backwards.');
        await tx.query(
          'UPDATE abuse_storage_guard SET last_time=$1,key_fingerprint=$2 WHERE id=1',
          [iso(finalTime), fingerprint],
        );
        const after = now();
        if (after < finalTime) fail('ABUSE_CLOCK', 'Abuse clock moved backwards.');
        for (const check of c.checks) {
          const result = check(after);
          if (result && typeof result.then === 'function')
            fail('INVALID_ABUSE', 'Commit checks must finish synchronously.', 400);
        }
        return result;
      } finally {
        contexts.delete(guardedTx);
      }
    });
  }
  const service = {
    synthetic: true,
    withTransaction,
    async challenge(userId, input) {
      shape(input, ['purpose', 'source']);
      if (userId !== null) identifier(userId);
      if (
        !['signup', 'burst'].includes(input.purpose) ||
        (userId === null && input.purpose !== 'signup')
      )
        fail('INVALID_ABUSE', 'Invalid challenge purpose.', 400);
      const sources = sourceKeys(input.source);
      return withTransaction(async (tx) => {
        if (userId !== null) {
          await actor(tx, userId);
          await finalActor(tx, userId);
        }
        await capacity(tx, 'abuse_challenges', config.maxChallenges);
        const c = context(tx),
          id = randomUUID(),
          nonce = hmac('challenge-nonce', id),
          expiresAt = iso(c.time + config.challengeTtlMs);
        await tx.query(
          'INSERT INTO abuse_challenges(id,user_key,source_key,purpose,nonce_hash,difficulty,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            challengeUserKey(userId),
            sources.combined,
            input.purpose,
            hash(nonce),
            config.challengeDifficulty,
            iso(c.time),
            expiresAt,
          ],
        );
        return {
          id,
          nonce,
          purpose: input.purpose,
          difficulty: config.challengeDifficulty,
          expiresAt,
          algorithm: 'sha256-leading-zero-bits-v1',
          syntheticOnly: true,
          humanVerification: false,
        };
      });
    },
    async signupInTransaction(tx, input) {
      shape(input, ['userId', 'source', 'challenge']);
      context(tx);
      const identity = await actor(tx, input.userId),
        sources = sourceKeys(input.source);
      const challengeId = await consumeChallenge(
        tx,
        input.userId,
        sources,
        'signup',
        input.challenge,
      );
      const p = await profile(tx, identity.id);
      const level = await syncTrust(tx, identity, p);
      await eventCapacity(tx, 1);
      await tx.query('UPDATE abuse_profiles SET signup_verified=TRUE WHERE user_id=$1', [
        identity.id,
      ]);
      await registerSources(tx, identity.id, sources);
      await event(tx, identity, identity.id, 'SIGNUP_CHALLENGE', { challengeId });
      await finalActor(tx, identity.id);
      return {
        userId: identity.id,
        trustLevel: level,
        syntheticOnly: true,
      };
    },
    async admitInTransaction(tx, input) {
      shape(input, ['userId', 'requestId', 'source', 'challenge']);
      identifier(input.requestId);
      context(tx);
      await ownedRequest(tx, input.userId, input.requestId);
      const c = context(tx),
        identity = await actor(tx, input.userId),
        sources = sourceKeys(input.source),
        p = await profile(tx, identity.id),
        level = await syncTrust(tx, identity, p),
        currentLimits = limits(level, identity.moderation);
      const saved = (
        await tx.query('SELECT * FROM abuse_admissions WHERE request_id=$1', [input.requestId])
      ).rows[0];
      if (saved) {
        if (saved.user_id !== identity.id)
          fail('ABUSE_FORBIDDEN', 'Owned admission required.', 403);
        if (saved.source_key !== sources.combined)
          fail('ABUSE_IDEMPOTENCY_CONFLICT', 'Admission source differs from the saved request.');
        await finalActor(tx, identity.id);
        return {
          requestId: input.requestId,
          trustLevel: level,
          charged: false,
          resetAt: iso(dayAt(c.time) + dayMs),
          syntheticOnly: true,
        };
      }
      if (!p.signup_verified)
        fail('ABUSE_CHALLENGE_REQUIRED', 'Signup challenge is required before usage.', 429, {
          challengeRequired: true,
          resetAt: iso(burstAt(c.time) + config.burstWindowMs),
        });
      const day = dayAt(c.time),
        burst = burstAt(c.time),
        used = await counter(tx, 'user_burst', userKey(identity.id), burst);
      if (used >= config.burstChallengeAfter)
        await consumeChallenge(tx, identity.id, sources, 'burst', input.challenge);
      else if (input.challenge)
        await consumeChallenge(tx, identity.id, sources, 'burst', input.challenge);
      await capacity(tx, 'abuse_admissions', config.maxAdmissions);
      await eventCapacity(tx, 1);
      await debit(
        tx,
        'user_day',
        userKey(identity.id),
        day,
        currentLimits.dailyRequests,
        day + dayMs,
      );
      await debit(
        tx,
        'user_burst',
        userKey(identity.id),
        burst,
        currentLimits.burstRequests,
        burst + config.burstWindowMs,
      );
      if (c.time - new Date(identity.created_at).getTime() < config.newAccountMs) {
        await debit(
          tx,
          'device_day',
          sources.device,
          day,
          config.newAccountDeviceRequests,
          day + dayMs,
        );
        await debit(tx, 'ip_day', sources.ip, day, config.newAccountIpRequests, day + dayMs);
      }
      await registerSources(tx, identity.id, sources);
      await tx.query(
        'INSERT INTO abuse_admissions(request_id,user_id,source_key,trust_level,day_at,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [input.requestId, identity.id, sources.combined, level, iso(day), iso(c.time)],
      );
      await event(tx, identity, identity.id, 'ADMISSION', {
        requestId: input.requestId,
        trustLevel: level,
      });
      c.checks.push((time) => {
        if (dayAt(time) !== day || burstAt(time) !== burst)
          fail('ABUSE_WINDOW', 'Usage window changed before admission.');
      });
      await finalActor(tx, identity.id);
      return {
        requestId: input.requestId,
        trustLevel: level,
        charged: true,
        resetAt: iso(day + dayMs),
        syntheticOnly: true,
      };
    },
    async assertAttemptInTransaction(tx, input) {
      shape(input, ['userId', 'requestId', 'inputTokens', 'outputTokens']);
      identifier(input.requestId);
      context(tx);
      await ownedRequest(tx, input.userId, input.requestId);
      const c = context(tx),
        identity = await actor(tx, input.userId),
        p = await profile(tx, identity.id),
        level = await syncTrust(tx, identity, p),
        currentLimits = limits(level, identity.moderation);
      const saved = (
        await tx.query('SELECT * FROM abuse_admissions WHERE request_id=$1', [input.requestId])
      ).rows[0];
      if (!saved) fail('ABUSE_ADMISSION_REQUIRED', 'A saved abuse admission is required.', 403);
      if (saved.user_id !== identity.id) fail('ABUSE_FORBIDDEN', 'Owned admission required.', 403);
      if (input.inputTokens !== undefined || input.outputTokens !== undefined) {
        const bound = tokenAmount(input.inputTokens) + tokenAmount(input.outputTokens),
          day = dayAt(c.time);
        const r = (
          await tx.query(
            'SELECT used_tokens::text AS used,reserved_tokens::text AS reserved FROM abuse_daily_token_counters WHERE user_id=$1 AND day_at=$2',
            [identity.id, iso(day)],
          )
        ).rows[0];
        await capacity(tx, 'abuse_counters', config.maxCounters, r ? 0 : 1);
        if (
          BigInt(r?.used ?? '0') + BigInt(r?.reserved ?? '0') + bound >
          BigInt(currentLimits.dailyTokens)
        )
          fail('ABUSE_TOKEN_LIMIT', 'Current trust token cap reached.', 429, {
            resetAt: iso(day + dayMs),
          });
        const running = Number(
          (
            await tx.query(
              "SELECT count(*)::integer AS n FROM router_requests WHERE user_id=$1 AND state='RUNNING' AND id<>$2",
              [identity.id, input.requestId],
            )
          ).rows[0].n,
        );
        if (running >= currentLimits.concurrency)
          fail('ABUSE_CONCURRENCY_LIMIT', 'Current trust concurrency cap reached.', 429);
        c.checks.push((time) => {
          if (dayAt(time) !== day) fail('ABUSE_WINDOW', 'Usage window changed before attempt.');
        });
      }
      await finalActor(tx, identity.id);
      return {
        requestId: input.requestId,
        trustLevel: level,
        limits: currentLimits,
        syntheticOnly: true,
      };
    },
    // Server callers supply only an identity obtained from a valid owned session or local sign-in.
    // Timed restrictions expire here before the repository performs its active-identity check.
    async refreshIdentity(userId) {
      return withTransaction(async (tx) => {
        const identity = await actor(tx, userId, 'user', true);
        return {
          userId: identity.id,
          status: identity.status,
          moderationAction: identity.moderation.action,
          syntheticOnly: true,
        };
      });
    },
    async status(userId) {
      return withTransaction(async (tx) => {
        const c = context(tx),
          identity = await actor(tx, userId, 'user', true),
          p = await profile(tx, userId),
          level = trust(identity, p, c.time);
        const daily = await counter(tx, 'user_day', userKey(userId), dayAt(c.time)),
          burst = await counter(tx, 'user_burst', userKey(userId), burstAt(c.time));
        return {
          trustLevel: level,
          verifiedContact: p.verified_contact,
          goodBehavior: p.good_behavior,
          moderation: {
            action: identity.moderation.action,
            until: identity.moderation.until_at
              ? iso(new Date(identity.moderation.until_at).getTime())
              : null,
          },
          limits: limits(level, identity.moderation),
          usage: { dailyRequests: daily, burstRequests: burst },
          challenge: {
            signupRequired: !p.signup_verified,
            burstRequired: burst >= config.burstChallengeAfter,
            equivalent: 'local-proof-of-work',
            humanVerification: false,
          },
          resetAt: iso(dayAt(c.time) + dayMs),
          localOnly: true,
          syntheticOnly: true,
        };
      });
    },
    async setTrustEvidence(actorId, input) {
      shape(input, ['targetId', 'verifiedContact', 'goodBehavior', 'reason', 'idempotencyKey']);
      identifier(input.targetId);
      identifier(input.idempotencyKey);
      integer(input.goodBehavior, 0);
      if (typeof input.verifiedContact !== 'boolean' || !reasons.includes(input.reason))
        fail('INVALID_ABUSE', 'Trusted trust evidence is invalid.', 400);
      return withTransaction(async (tx) => {
        const staff = await actor(tx, actorId, 'trust'),
          target = await actor(tx, input.targetId, 'user', true),
          requestHash = hash(JSON.stringify(canonical({ operation: 'trust', ...input })));
        const replay = (
          await tx.query(
            'SELECT request_hash,metadata FROM abuse_events WHERE actor_key=$1 AND operation_key=$2',
            [userKey(actorId), input.idempotencyKey],
          )
        ).rows[0];
        if (replay) {
          if (replay.request_hash !== requestHash)
            fail('ABUSE_IDEMPOTENCY_CONFLICT', 'Trusted operation key conflicts.');
          await finalActor(tx, actorId, 'trust');
          return { ...replay.metadata, targetId: target.id };
        }
        await profile(tx, target.id);
        await eventCapacity(tx, 1, true);
        await tx.query(
          'UPDATE abuse_profiles SET verified_contact=$1,good_behavior=$2 WHERE user_id=$3',
          [input.verifiedContact, input.goodBehavior, target.id],
        );
        const level = trust(
          target,
          { verified_contact: input.verifiedContact, good_behavior: input.goodBehavior },
          context(tx).time,
        );
        await tx.query('UPDATE users SET trust_level=$1 WHERE id=$2', [level, target.id]);
        const result = {
          targetId: target.id,
          trustLevel: level,
          reason: input.reason,
          verifiedContact: input.verifiedContact,
          goodBehavior: input.goodBehavior,
          syntheticOnly: true,
        };
        await event(
          tx,
          staff,
          target.id,
          'TRUST_EVIDENCE',
          { ...result, targetId: undefined },
          input.idempotencyKey,
          requestHash,
        );
        await finalActor(tx, actorId, 'trust');
        return result;
      });
    },
    async moderate(actorId, input) {
      shape(input, ['targetId', 'action', 'until', 'reason', 'idempotencyKey']);
      identifier(input.targetId);
      identifier(input.idempotencyKey);
      if (
        !['none', 'suspend', 'throttle', 'ban'].includes(input.action) ||
        !reasons.includes(input.reason)
      )
        fail('INVALID_ABUSE', 'Invalid moderation action or reason.', 400);
      if (
        ['suspend', 'throttle'].includes(input.action)
          ? typeof input.until !== 'string' ||
            !Number.isFinite(Date.parse(input.until)) ||
            iso(Date.parse(input.until)) !== input.until
          : input.until !== null
      )
        fail('INVALID_ABUSE', 'Invalid moderation expiry.', 400);
      return withTransaction(async (tx) => {
        const c = context(tx),
          staff = await actor(tx, actorId, 'staff'),
          target = await actor(tx, input.targetId, 'user', true);
        if (
          target.id === staff.id ||
          (target.role !== 'user' && !['owner', 'super_admin'].includes(staff.role))
        )
          fail('ABUSE_FORBIDDEN', 'Moderator cannot restrict this target.', 403);
        const requestHash = hash(JSON.stringify(canonical({ operation: 'moderation', ...input })));
        const replay = (
          await tx.query(
            'SELECT request_hash,metadata FROM abuse_events WHERE actor_key=$1 AND operation_key=$2',
            [userKey(actorId), input.idempotencyKey],
          )
        ).rows[0];
        if (replay) {
          if (replay.request_hash !== requestHash)
            fail('ABUSE_IDEMPOTENCY_CONFLICT', 'Trusted operation key conflicts.');
          await finalActor(tx, actorId, 'staff');
          return replay.metadata;
        }
        if (
          ['suspend', 'throttle'].includes(input.action) &&
          (Date.parse(input.until) <= c.time ||
            Date.parse(input.until) > c.time + config.maxModerationMs)
        )
          fail('INVALID_ABUSE', 'Moderation expiry is outside the bounded interval.', 400);
        const priorOpen = target.moderation.action !== 'none',
          nextOpen = input.action !== 'none';
        await eventCapacity(tx, 1 + (!priorOpen && nextOpen ? 1 : 0), true, priorOpen && !nextOpen);
        await tx.query(
          'INSERT INTO abuse_moderation(user_id,action,until_at,reason,actor_key,actor_role,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET action=EXCLUDED.action,until_at=EXCLUDED.until_at,reason=EXCLUDED.reason,actor_key=EXCLUDED.actor_key,actor_role=EXCLUDED.actor_role,updated_at=EXCLUDED.updated_at',
          [
            target.id,
            input.action,
            input.until,
            input.reason,
            userKey(staff.id),
            staff.role,
            iso(c.time),
          ],
        );
        await tx.query('UPDATE users SET status=$1 WHERE id=$2', [
          ['suspend', 'ban'].includes(input.action) ? 'suspended' : 'active',
          target.id,
        ]);
        const result = {
          action: input.action,
          until: input.until,
          reason: input.reason,
          syntheticOnly: true,
        };
        await event(tx, staff, target.id, 'MODERATION', result, input.idempotencyKey, requestHash);
        await finalActor(tx, actorId, 'staff');
        if (input.until)
          c.checks.push((time) => {
            if (time >= Date.parse(input.until))
              fail('ABUSE_WINDOW', 'Moderation expired before commit.');
          });
        return result;
      });
    },
    async listAlerts(actorId) {
      return withTransaction(async (tx) => {
        await actor(tx, actorId, 'staff');
        await finalActor(tx, actorId, 'staff');
        return (
          await tx.query(
            'SELECT id,source_kind,source_hash,account_count,rule,created_at FROM abuse_alerts ORDER BY created_at DESC,id DESC LIMIT 100',
          )
        ).rows.map((r) => ({
          id: r.id,
          sourceKind: r.source_kind,
          sourceHash: r.source_hash,
          accountCount: r.account_count,
          rule: r.rule,
          createdAt: iso(new Date(r.created_at).getTime()),
          syntheticOnly: true,
        }));
      });
    },
  };
  return Object.freeze(service);
}
