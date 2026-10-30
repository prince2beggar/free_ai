import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AppError } from '../api/errors.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));
const fail = (code, message, status = 400) => {
  throw new AppError(status, code, message);
};
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const identifier = (value) => typeof value === 'string' && idPattern.test(value);
const reasons = [
  'CONFIGURATION_CHANGE',
  'ELIGIBILITY_UPDATE',
  'EMERGENCY_DISABLE',
  'ROLLBACK',
  'LOCAL_RESEARCH_SEED',
];
const providerFields = [
  'id',
  'name',
  'adapterKind',
  'baseUrl',
  'status',
  'termsUrl',
  'termsReviewedAt',
  'dataPolicy',
  'allowsMultiuser',
  'secretRef',
  'ownerApproved',
  'quotaConfirmed',
];
const modelFields = [
  'id',
  'providerId',
  'externalName',
  'displayName',
  'capabilities',
  'contextLimit',
  'contextVerified',
  'modelClass',
  'cuInputRate',
  'cuOutputRate',
  'ratesVerified',
  'agentReady',
  'banglaScore',
  'codingScore',
  'qualityKind',
  'freeFlag',
  'status',
];
function text(value, maximum) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function url(value) {
  if (value === null) return true;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      !parsed.search &&
      value.length <= 512
    );
  } catch {
    return false;
  }
}
function date(value) {
  if (value === null) return true;
  const parsed = new Date(value);
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value <= new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10)
  );
}
function shape(input, fields) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    fail('INVALID_REGISTRY_FIELDS', 'Unknown or invalid registry fields.');
}
function provider(input) {
  shape(input, providerFields);
  const record = {
    baseUrl: null,
    status: 'disabled',
    termsUrl: null,
    termsReviewedAt: null,
    dataPolicy: 'unknown',
    allowsMultiuser: false,
    secretRef: null,
    ownerApproved: false,
    quotaConfirmed: false,
    ...input,
  };
  if (
    !identifier(record.id) ||
    !text(record.name, 120) ||
    !['external', 'synthetic_mock'].includes(record.adapterKind) ||
    !['enabled', 'disabled'].includes(record.status) ||
    !url(record.baseUrl) ||
    !url(record.termsUrl) ||
    !date(record.termsReviewedAt) ||
    !['no_training', 'may_train', 'unknown', 'synthetic_only'].includes(record.dataPolicy) ||
    ['allowsMultiuser', 'ownerApproved', 'quotaConfirmed'].some(
      (key) => typeof record[key] !== 'boolean',
    ) ||
    !(
      record.secretRef === null ||
      (typeof record.secretRef === 'string' && /^env:[A-Z][A-Z0-9_]{1,100}$/.test(record.secretRef))
    )
  )
    fail(
      'INVALID_PROVIDER',
      'Provider fields are invalid; use only server-side secret references.',
    );
  if (
    record.adapterKind === 'synthetic_mock' &&
    (record.baseUrl !== null || record.secretRef !== null)
  )
    fail(
      'INVALID_SYNTHETIC_PROVIDER',
      'Synthetic providers cannot have endpoints or credential references.',
    );
  return record;
}
function model(input) {
  shape(input, modelFields);
  const record = {
    capabilities: [],
    contextLimit: null,
    contextVerified: false,
    modelClass: 'unknown',
    cuInputRate: null,
    cuOutputRate: null,
    ratesVerified: false,
    agentReady: false,
    banglaScore: null,
    codingScore: null,
    qualityKind: 'unknown',
    freeFlag: false,
    status: 'disabled',
    ...input,
  };
  const rate = (value) =>
    value === null || (typeof value === 'string' && /^[0-9]{1,12}(\.[0-9]{1,6})?$/.test(value));
  if (
    !identifier(record.id) ||
    !identifier(record.providerId) ||
    !text(record.externalName, 200) ||
    !text(record.displayName, 120) ||
    !Array.isArray(record.capabilities) ||
    record.capabilities.length > 6 ||
    new Set(record.capabilities).size !== record.capabilities.length ||
    record.capabilities.some(
      (capability) =>
        !['text', 'code', 'tools', 'long_context', 'bangla', 'english'].includes(capability),
    ) ||
    !(
      record.contextLimit === null ||
      (Number.isSafeInteger(record.contextLimit) &&
        record.contextLimit > 0 &&
        record.contextLimit <= 10000000)
    ) ||
    !/^[a-z][a-z0-9_-]{0,39}$/.test(record.modelClass) ||
    !rate(record.cuInputRate) ||
    !rate(record.cuOutputRate) ||
    ['contextVerified', 'ratesVerified', 'agentReady', 'freeFlag'].some(
      (key) => typeof record[key] !== 'boolean',
    ) ||
    ['banglaScore', 'codingScore'].some(
      (key) =>
        !(
          record[key] === null ||
          (Number.isInteger(record[key]) && record[key] >= 0 && record[key] <= 100)
        ),
    ) ||
    !['unknown', 'synthetic_fixture'].includes(record.qualityKind) ||
    !['enabled', 'disabled'].includes(record.status)
  )
    fail('INVALID_MODEL', 'Model metadata or exact decimal rate strings are invalid.');
  if (
    record.qualityKind === 'unknown' &&
    (record.agentReady || record.banglaScore !== null || record.codingScore !== null)
  )
    fail(
      'QUALITY_UNVERIFIED',
      'Real quality remains unknown; fixture scores must be explicitly synthetic.',
    );
  return record;
}
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
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
function publicOperation(operation) {
  shape(operation, ['expectedRevision', 'idempotencyKey', 'reasonCode']);
  return operation;
}
const priceFields = [
  'id',
  'provider_id',
  'model_id',
  'tier',
  'currency',
  'tokens_per_unit',
  'input_per_1m',
  'output_per_1m',
  'status',
  'checked_at',
  'source_ids',
  'billing_mode',
  'effective_from',
  'effective_until',
  'eligible_for_feasibility',
  'endpoint',
  'endpoint_status',
  'input_scope',
  'model_class',
  'model_class_status',
  'notes',
  'output_includes_thinking',
  'output_scope',
  'period_status_on_review',
  'neuron_meter',
];
function sourceScalar(value) {
  if (value === null || typeof value === 'boolean' || Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && text(value, 8000)) return value;
  if (Array.isArray(value) && value.length <= 32 && value.every((item) => text(item, 200)))
    return [...value];
  fail('REGISTRY_SOURCE_INVALID', 'Research source fields exceed allowed types or sizes.');
}
function sourceInputs(research, pricing) {
  if (
    !research ||
    !pricing ||
    !Array.isArray(research.providers) ||
    research.providers.length > 100 ||
    !Array.isArray(pricing.model_prices) ||
    pricing.model_prices.length > 1000 ||
    !date(research.reviewed_at) ||
    research.reviewed_at === null
  )
    fail(
      'REGISTRY_SOURCE_INVALID',
      'Research input arrays and review date are required and bounded.',
    );
  const providers = research.providers.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !identifier(item.research_id) ||
      !text(item.name, 120) ||
      !url(item.terms_url) ||
      typeof item.terms_url !== 'string' ||
      !text(item.source_data_policy, 100) ||
      !Array.isArray(item.open_question_ids) ||
      item.open_question_ids.length > 32 ||
      !item.open_question_ids.every((id) => text(id, 100))
    )
      fail('REGISTRY_SOURCE_INVALID', 'Provider research observations are invalid or oversized.');
    return {
      research_id: item.research_id,
      name: item.name,
      terms_url: item.terms_url,
      source_data_policy: item.source_data_policy,
      open_question_ids: [...item.open_question_ids],
    };
  });
  const rows = pricing.model_prices.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !identifier(item.provider_id) ||
      !(item.model_id === null || text(item.model_id, 200))
    )
      fail('REGISTRY_SOURCE_INVALID', 'Pricing observation identity is invalid or oversized.');
    return Object.fromEntries(
      priceFields
        .filter((key) => Object.hasOwn(item, key))
        .map((key) => {
          if (key !== 'neuron_meter' || item[key] === null) return [key, sourceScalar(item[key])];
          const meter = item[key];
          if (!meter || typeof meter !== 'object' || Array.isArray(meter))
            fail('REGISTRY_SOURCE_INVALID', 'Neuron observations must be a bounded source object.');
          const allowed = [
            'input_neurons_per_1m',
            'output_neurons_per_1m',
            'source_ids',
            'checked_at',
          ];
          return [
            key,
            Object.fromEntries(
              allowed
                .filter((name) => Object.hasOwn(meter, name))
                .map((name) => [name, sourceScalar(meter[name])]),
            ),
          ];
        }),
    );
  });
  return { providers, rows };
}

/** Trusted service boundary; no staff web mutation surface exists until separate MFA auth is implemented. */
export function createRegistry(db, options = {}) {
  const config = { ...defaults, ...options };
  if (
    options.staffRoles &&
    JSON.stringify(options.staffRoles) !== JSON.stringify(defaults.staffRoles)
  )
    fail(
      'REGISTRY_CONFIG_INVALID',
      'Staff permissions cannot be reassigned through registry configuration.',
    );
  config.staffRoles = Object.freeze([...defaults.staffRoles]);
  if (
    config.localOnly !== true ||
    !Number.isInteger(config.maxRecordBytes) ||
    config.maxRecordBytes < 1024 ||
    config.maxRecordBytes > 32768 ||
    ['maxProviders', 'maxModels', 'maxVersions', 'maxAuditEvents'].some(
      (key) => !Number.isInteger(config[key]) || config[key] < 1 || config[key] > 100000,
    )
  )
    fail(
      'REGISTRY_CONFIG_INVALID',
      'Registry must remain in its bounded local-only configuration.',
    );
  async function staff(tx, actorId) {
    const actor = (
      await tx.query("SELECT id,role FROM users WHERE id=$1 AND status='active'", [actorId])
    ).rows[0];
    if (!actor || !config.staffRoles.includes(actor.role))
      fail('REGISTRY_FORBIDDEN', 'A trusted staff identity is required.', 403);
  }
  async function audit(tx, actorId, action, area, targetId, revision = null) {
    const actor = (await tx.query('SELECT role FROM users WHERE id=$1', [actorId])).rows[0];
    const count = (
      await tx.query(`SELECT (SELECT count(*) FROM audit_events) AS audit,
      (SELECT count(*) FROM users WHERE status='active') +
      (SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP) +
      (SELECT count(*) FROM chat_requests WHERE status IN ('pending','streaming')) AS reserved`)
    ).rows[0];
    if (Number(count.audit) + Number(count.reserved) + 1 > config.maxAuditEvents)
      fail(
        'LOCAL_STORAGE_FULL',
        'Registry evidence storage is full; stop and review local data.',
        503,
      );
    await tx.query(
      'INSERT INTO audit_events(id,actor_id,actor_role,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [
        randomUUID(),
        actorId,
        actor.role,
        action,
        area,
        targetId,
        JSON.stringify({ area, revision }),
      ],
    );
  }
  async function read(tx, area, targetId, lock = false) {
    const table = area === 'provider' ? 'providers' : 'models';
    const base = (
      await tx.query(`SELECT * FROM ${table} WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [targetId])
    ).rows[0];
    if (!base) return null;
    const meta = (
      await tx.query('SELECT revision,data FROM registry_metadata WHERE area=$1 AND target_id=$2', [
        area,
        targetId,
      ])
    ).rows[0];
    if (meta) return { ...meta.data, revision: meta.revision };
    if (area === 'provider')
      return {
        id: base.id,
        name: base.name,
        adapterKind: base.adapter_kind,
        baseUrl: base.base_url,
        status: base.status,
        termsUrl: base.terms_url,
        termsReviewedAt: base.terms_reviewed_at?.toISOString?.().slice(0, 10) ?? null,
        dataPolicy: base.data_policy_flag,
        allowsMultiuser: base.allows_multiuser,
        secretRef: base.secret_ref,
        ownerApproved: false,
        quotaConfirmed: false,
        revision: 0,
      };
    return {
      id: base.id,
      providerId: base.provider_id,
      externalName: base.external_name,
      displayName: base.display_name,
      capabilities: base.capabilities,
      contextLimit: base.context_limit,
      contextVerified: base.model_class === 'synthetic',
      modelClass: base.model_class,
      cuInputRate: null,
      cuOutputRate: null,
      ratesVerified: false,
      agentReady: false,
      banglaScore: null,
      codingScore: null,
      qualityKind: 'unknown',
      freeFlag: base.free_flag,
      status: base.status,
      revision: 0,
    };
  }
  async function gate(tx, area, record) {
    if (record.status !== 'enabled') return;
    const source = area === 'provider' ? record : await read(tx, 'provider', record.providerId);
    if (
      !source ||
      !source.allowsMultiuser ||
      !source.termsUrl ||
      !source.termsReviewedAt ||
      !source.ownerApproved ||
      !source.quotaConfirmed ||
      source.dataPolicy === 'unknown'
    )
      fail(
        'PROVIDER_ELIGIBILITY_REQUIRED',
        'Multi-user, terms, owner, quota and privacy evidence are required.',
        403,
      );
    if (source.adapterKind === 'external')
      fail(
        'LIVE_PROVIDER_DEFERRED',
        'Real provider activation remains deferred in local Phase 2.',
        403,
      );
    if (
      area === 'model' &&
      (source.status !== 'enabled' ||
        !record.contextVerified ||
        record.contextLimit === null ||
        record.capabilities.length === 0 ||
        !record.ratesVerified ||
        record.cuInputRate === null ||
        record.cuOutputRate === null)
    )
      fail(
        'MODEL_EVIDENCE_REQUIRED',
        'Enabled models need an eligible provider, capabilities, context and exact verified rate metadata.',
        403,
      );
    if (
      area === 'model' &&
      record.agentReady &&
      (record.qualityKind !== 'synthetic_fixture' || record.codingScore === null)
    )
      fail(
        'QUALITY_UNVERIFIED',
        'Agent-ready fixtures require explicitly labeled coding diagnostics.',
        403,
      );
  }
  async function persist(tx, area, record, isNew) {
    if (area === 'provider') {
      const values = [
        record.id,
        record.name,
        record.adapterKind,
        record.baseUrl,
        record.status,
        record.termsUrl,
        record.termsReviewedAt,
        record.dataPolicy,
        record.allowsMultiuser,
        record.secretRef,
      ];
      if (isNew)
        await tx.query(
          'INSERT INTO providers(id,name,adapter_kind,base_url,status,terms_url,terms_reviewed_at,data_policy_flag,allows_multiuser,secret_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          values,
        );
      else
        await tx.query(
          'UPDATE providers SET name=$2,adapter_kind=$3,base_url=$4,status=$5,terms_url=$6,terms_reviewed_at=$7,data_policy_flag=$8,allows_multiuser=$9,secret_ref=$10 WHERE id=$1',
          values,
        );
    } else {
      // Exact decimal CU rates live in versioned metadata; legacy integer columns are not silently rounded.
      const values = [
        record.id,
        record.providerId,
        record.externalName,
        record.displayName,
        record.capabilities,
        record.contextLimit ?? 1,
        record.modelClass,
        record.agentReady,
        record.banglaScore,
        record.freeFlag,
        record.status,
      ];
      if (isNew)
        await tx.query(
          'INSERT INTO models(id,provider_id,external_name,display_name,capabilities,context_limit,model_class,agent_ready,bangla_score,free_flag,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          values,
        );
      else
        await tx.query(
          'UPDATE models SET provider_id=$2,external_name=$3,display_name=$4,capabilities=$5,context_limit=$6,model_class=$7,agent_ready=$8,bangla_score=$9,free_flag=$10,status=$11 WHERE id=$1',
          values,
        );
    }
  }
  async function write(
    area,
    actorId,
    targetId,
    input,
    {
      expectedRevision,
      idempotencyKey,
      reasonCode = 'CONFIGURATION_CHANGE',
      action = 'update',
      observations,
    } = {},
  ) {
    if (Object.hasOwn(input ?? {}, 'id') && input.id !== targetId)
      fail('REGISTRY_IDENTITY_IMMUTABLE', 'Registry identifiers cannot be reassigned.');
    if (
      !identifier(targetId) ||
      typeof idempotencyKey !== 'string' ||
      !/^[A-Za-z0-9_-]{8,160}$/.test(idempotencyKey) ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      !reasons.includes(reasonCode) ||
      !['create', 'update', 'rollback', 'seed'].includes(action)
    )
      fail(
        'REGISTRY_OPERATION_INVALID',
        'Provide expected revision, unique operation key and allowed reason code.',
      );
    const requestHash = digest([area, targetId, input, expectedRevision, reasonCode, action]);
    return db.transaction(async (tx) => {
      await staff(tx, actorId);
      const replay = (
        await tx.query(
          'SELECT request_hash,after_data FROM registry_versions WHERE actor_id=$1 AND idempotency_key=$2',
          [actorId, idempotencyKey],
        )
      ).rows[0];
      if (replay) {
        if (replay.request_hash !== requestHash)
          fail('IDEMPOTENCY_CONFLICT', 'Operation key was already used for different data.', 409);
        return replay.after_data;
      }
      const before = await read(tx, area, targetId, true);
      if ((action === 'create' || action === 'seed') && before)
        fail('REGISTRY_EXISTS', 'Registry object already exists.', 409);
      if (action === 'update' && !before)
        fail('REGISTRY_NOT_FOUND', 'Registry object not found.', 404);
      if ((before?.revision ?? 0) !== expectedRevision)
        fail('REGISTRY_REVISION_CONFLICT', 'Registry changed; refresh before editing.', 409);
      const cleanBefore = before
        ? Object.fromEntries(
            Object.entries(before).filter(([key]) => !['revision', 'observations'].includes(key)),
          )
        : {};
      const merged = { ...cleanBefore, ...input, id: targetId };
      if (
        before &&
        (merged.adapterKind !== before.adapterKind || merged.providerId !== before.providerId)
      )
        fail(
          'REGISTRY_IDENTITY_IMMUTABLE',
          'Provider kind and model ownership cannot be reassigned.',
        );
      const record = area === 'provider' ? provider(merged) : model(merged);
      if (area === 'model') {
        const parent = await read(tx, 'provider', record.providerId);
        if (!parent) fail('REGISTRY_NOT_FOUND', 'Parent provider not found.', 404);
        if (
          parent.adapterKind === 'external' &&
          (record.agentReady ||
            record.banglaScore !== null ||
            record.codingScore !== null ||
            record.qualityKind !== 'unknown')
        )
          fail(
            'QUALITY_UNVERIFIED',
            'No real quality evidence has been approved for these research models.',
          );
      }
      await gate(tx, area, record);
      const counts = (
        await tx.query(
          `SELECT (SELECT count(*) FROM registry_versions) AS versions,(SELECT count(*) FROM ${area === 'provider' ? 'providers' : 'models'}) AS objects`,
        )
      ).rows[0];
      if (
        Number(counts.versions) >= config.maxVersions ||
        (!before &&
          Number(counts.objects) >= (area === 'provider' ? config.maxProviders : config.maxModels))
      )
        fail('LOCAL_STORAGE_FULL', 'Registry object/history limit reached.', 503);
      const after = {
        ...record,
        revision: expectedRevision + 1,
        ...((observations ?? before?.observations)
          ? { observations: observations ?? before.observations }
          : {}),
      };
      if (Buffer.byteLength(JSON.stringify(after), 'utf8') > config.maxRecordBytes)
        fail(
          'REGISTRY_RECORD_TOO_LARGE',
          'Registry record and observations exceed the configured byte limit.',
        );
      await persist(tx, area, record, !before);
      await tx.query(
        'INSERT INTO registry_metadata(area,target_id,revision,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(area,target_id) DO UPDATE SET revision=$3,data=$4::jsonb',
        [area, targetId, after.revision, JSON.stringify(after)],
      );
      await tx.query(
        'INSERT INTO registry_versions(area,target_id,revision,actor_id,action,reason_code,before_data,after_data,request_hash,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)',
        [
          area,
          targetId,
          after.revision,
          actorId,
          action,
          reasonCode,
          before ? JSON.stringify(before) : null,
          JSON.stringify(after),
          requestHash,
          idempotencyKey,
        ],
      );
      await audit(tx, actorId, 'registry_changed', area, targetId, after.revision);
      return after;
    });
  }
  return Object.freeze({
    createProvider: async (actorId, input, operation) => {
      shape(input, providerFields);
      return write('provider', actorId, input.id, input, {
        ...publicOperation(operation),
        expectedRevision: 0,
        action: 'create',
      });
    },
    updateProvider: async (actorId, targetId, patch, operation) => {
      shape(patch, providerFields);
      return write('provider', actorId, targetId, patch, publicOperation(operation));
    },
    createModel: async (actorId, input, operation) => {
      shape(input, modelFields);
      return write('model', actorId, input.id, input, {
        ...publicOperation(operation),
        expectedRevision: 0,
        action: 'create',
      });
    },
    updateModel: async (actorId, targetId, patch, operation) => {
      shape(patch, modelFields);
      return write('model', actorId, targetId, patch, publicOperation(operation));
    },
    async list(actorId, area) {
      if (!['provider', 'model'].includes(area))
        fail('REGISTRY_OPERATION_INVALID', 'Unknown registry area.');
      return db.transaction(async (tx) => {
        await staff(tx, actorId);
        const ids = (
          await tx.query(
            `SELECT id FROM ${area === 'provider' ? 'providers' : 'models'} ORDER BY id LIMIT $1`,
            [area === 'provider' ? config.maxProviders : config.maxModels],
          )
        ).rows;
        const objects = [];
        for (const item of ids) objects.push(await read(tx, area, item.id));
        await audit(tx, actorId, 'registry_viewed', area, 'registry');
        return objects;
      });
    },
    async history(actorId, area, targetId) {
      if (!['provider', 'model'].includes(area) || !identifier(targetId))
        fail('REGISTRY_OPERATION_INVALID', 'Invalid registry history target.');
      return db.transaction(async (tx) => {
        await staff(tx, actorId);
        await audit(tx, actorId, 'registry_history_viewed', area, targetId);
        return (
          await tx.query(
            'SELECT id,revision,actor_id,action,reason_code,created_at,before_data,after_data FROM registry_versions WHERE area=$1 AND target_id=$2 ORDER BY revision LIMIT 100',
            [area, targetId],
          )
        ).rows;
      });
    },
    async rollback(actorId, area, targetId, revision, operation) {
      publicOperation(operation);
      if (
        !['provider', 'model'].includes(area) ||
        !identifier(targetId) ||
        !Number.isInteger(revision) ||
        revision < 1
      )
        fail('REGISTRY_OPERATION_INVALID', 'Invalid rollback target.');
      const target = await db.transaction(async (tx) => {
        await staff(tx, actorId);
        return (
          await tx.query(
            'SELECT after_data FROM registry_versions WHERE area=$1 AND target_id=$2 AND revision=$3',
            [area, targetId, revision],
          )
        ).rows[0];
      });
      if (!target) fail('REGISTRY_NOT_FOUND', 'Historical revision not found.', 404);
      const restored = Object.fromEntries(
        Object.entries(target.after_data).filter(
          ([key]) => !['revision', 'observations'].includes(key),
        ),
      );
      return write(area, actorId, targetId, restored, {
        ...operation,
        action: 'rollback',
        reasonCode: 'ROLLBACK',
      });
    },
    async seed(actorId, research, pricing) {
      const source = sourceInputs(research, pricing);
      const existing = new Set((await this.list(actorId, 'provider')).map((item) => item.id));
      for (const candidate of source.providers) {
        if (existing.has(candidate.research_id)) continue;
        await write(
          'provider',
          actorId,
          candidate.research_id,
          {
            id: candidate.research_id,
            name: candidate.name,
            adapterKind: 'external',
            termsUrl: candidate.terms_url,
            termsReviewedAt: research.reviewed_at,
            dataPolicy: candidate.source_data_policy === 'may_train' ? 'may_train' : 'unknown',
            status: 'disabled',
            allowsMultiuser: false,
            ownerApproved: false,
            quotaConfirmed: false,
          },
          {
            expectedRevision: 0,
            idempotencyKey: 'seed-provider-' + digest(candidate.research_id),
            reasonCode: 'LOCAL_RESEARCH_SEED',
            action: 'seed',
            observations: {
              researchId: candidate.research_id,
              sourceDataPolicy: candidate.source_data_policy,
              openQuestionIds: candidate.open_question_ids,
            },
          },
        );
      }
      const grouped = new Map();
      for (const row of source.rows) {
        if (typeof row.model_id !== 'string') continue;
        const key = row.provider_id + '|' + row.model_id;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
      }
      const models = new Set((await this.list(actorId, 'model')).map((item) => item.id));
      for (const [key, rows] of grouped) {
        const targetId = 'research-' + digest(key).slice(0, 24);
        if (models.has(targetId)) continue;
        await write(
          'model',
          actorId,
          targetId,
          {
            id: targetId,
            providerId: rows[0].provider_id,
            externalName: rows[0].model_id,
            displayName: rows[0].model_id,
            status: 'disabled',
          },
          {
            expectedRevision: 0,
            idempotencyKey: 'seed-model-' + digest(key),
            reasonCode: 'LOCAL_RESEARCH_SEED',
            action: 'seed',
            observations: { priceRows: rows, researchOnly: true, actualModelQuota: null },
          },
        );
      }
    },
  });
}

export async function seedRegistryReviewActor(db) {
  const actor = defaults.reviewActor;
  await db.query(
    "INSERT INTO users(id,identity_provider,provider_subject,display_name,role) VALUES($1,'synthetic',$2,$3,'owner') ON CONFLICT(id) DO NOTHING",
    [actor.id, actor.subject, actor.displayName],
  );
  return actor.id;
}
