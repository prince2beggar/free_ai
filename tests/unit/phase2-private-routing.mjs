import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createAdminServer, DEFAULT_ADMIN_TOTP_SECRET } from '../../tools/phase2/admin.mjs';
import { generateTotp } from '../../packages/admin/totp.mjs';
import { SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { routerFixture } from '../../tools/phase2/router-fixture.mjs';
import { AppError } from '../../packages/api/errors.mjs';
import { rankRoutingCandidates, resolveRoutingSelection } from '../../packages/router/policy.mjs';

async function fixture(t, options = {}) {
  let virtualTime = Date.parse('2026-10-13T00:00:00.000Z');
  const clock = () => virtualTime;
  const app = await createAdminServer({
    fixtureOptions: {
      clock,
      abuseOptions: { challengeDifficulty: 4 },
      ...options,
    },
  });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;

  function client() {
    const cookies = new Map();
    let csrf = '';
    return {
      cookies,
      async call(path, method = 'GET', value, extra = {}) {
        const response = await fetch(base + path, {
          method,
          headers: {
            Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
            ...(method === 'GET'
              ? {}
              : { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
            ...extra,
          },
          ...(value === undefined ? {} : { body: JSON.stringify(value) }),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const [k, v] = cookie.split(';')[0].split('=');
          if (v) cookies.set(k, v);
          else cookies.delete(k);
        }
        const text = await response.text();
        const json = text.startsWith('{') ? JSON.parse(text) : null;
        if (json?.csrfToken) csrf = json.csrfToken;
        return { response, text, json };
      },
      async proof(purpose = 'signup') {
        const r = await this.call('/api/abuse/challenges', 'POST', { purpose });
        assert.equal(r.response.status, 200, r.text);
        const c = r.json.challenge;
        for (let n = 0; n < 1048576; n++) {
          const digest = createHash('sha256')
            .update(c.nonce + ':' + n)
            .digest();
          let valid = true;
          for (let bit = 0; bit < c.difficulty; bit++)
            if ((digest[Math.floor(bit / 8)] >> (7 - (bit % 8))) & 1) {
              valid = false;
              break;
            }
          if (valid) return { id: c.id, solution: String(n) };
        }
        throw new Error('Bounded proof search exhausted.');
      },
      async loginStaff(userId = SYNTHETIC_SEED.userA, totpCode) {
        return this.call('/admin/api/auth/login', 'POST', { userId, totpCode });
      },
      async loginUser(identity = 'alpha') {
        const b = await this.call('/api/bootstrap');
        const challenge = await this.proof();
        return this.call('/api/auth/local', 'POST', {
          identity,
          acceptedLegalVersion: b.json.legalVersion,
          challenge,
        });
      },
    };
  }

  return {
    ...app,
    client,
    get time() {
      return virtualTime;
    },
    advanceTime(ms) {
      virtualTime += ms;
    },
  };
}

async function prepareChat(
  f,
  {
    userId = SYNTHETIC_SEED.userA,
    conversationId = randomUUID(),
    requestId = randomUUID(),
    content = 'Synthetic prompt for private routing test',
    language = 'en',
    routing = {},
  } = {},
) {
  const nowIso = new Date().toISOString();
  await f.db.query(
    'INSERT INTO conversations(id, user_id, title, created_at) VALUES($1, $2, $3, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING',
    [conversationId, userId, 'Private Routing Test Conversation'],
  );
  await f.db.query(
    'INSERT INTO chat_requests(id, user_id, conversation_id, idempotency_key, request_hash, input_tokens, status, created_at) VALUES($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)',
    [
      requestId,
      userId,
      conversationId,
      `chat-idemp-${requestId}`,
      `hash-${requestId}`,
      10,
      'pending',
    ],
  );
  await f.db.query(
    'INSERT INTO abuse_admissions(request_id, user_id, source_key, trust_level, day_at, created_at) VALUES($1, $2, $3, $4, $5, $6)',
    [requestId, userId, 'a'.repeat(64), 3, nowIso, nowIso],
  );
  const data = {
    requestId,
    conversationId,
    messages: [{ role: 'user', content }],
    language,
    routing,
  };
  const prepareResult = await f.router.prepare(userId, data);
  return { data, prepareResult };
}

test('Step 2.9 ROUTE-05 & PRIV-03: Core candidate filtering rejects may_train providers in private mode', async () => {
  const policy = {
    id: 'test-policy',
    version: 1,
    mode: 'auto',
    modelClasses: ['synthetic'],
    requiredCapabilities: ['text'],
    allowPaid: true,
    ranking: ['quality', 'cost'],
    presets: {
      general: { requiredCapabilities: ['text'], ranking: ['quality', 'cost'] },
      coding: { requiredCapabilities: ['text', 'code'], ranking: ['quality', 'cost'] },
      writing: { requiredCapabilities: ['text'], ranking: ['quality', 'cost'] },
      research: { requiredCapabilities: ['text'], ranking: ['quality', 'cost'] },
    },
  };

  const providerNoTrain = {
    id: 'provider-no-train',
    name: 'Provider Non-Training',
    status: 'enabled',
    adapterKind: 'synthetic_mock',
    allowsMultiuser: true,
    ownerApproved: true,
    quotaConfirmed: true,
    termsUrl: 'https://example.invalid/terms',
    termsReviewedAt: '2026-01-01',
    dataPolicy: 'no_training',
  };

  const providerMayTrain = {
    id: 'provider-may-train',
    name: 'Provider Training Allowed',
    status: 'enabled',
    adapterKind: 'synthetic_mock',
    allowsMultiuser: true,
    ownerApproved: true,
    quotaConfirmed: true,
    termsUrl: 'https://example.invalid/terms',
    termsReviewedAt: '2026-01-01',
    dataPolicy: 'may_train',
  };

  const modelA = {
    id: 'model-a-private',
    providerId: providerNoTrain.id,
    status: 'enabled',
    modelClass: 'synthetic',
    capabilities: ['text', 'code', 'english'],
    ratesVerified: true,
    cuInputRate: '0',
    cuOutputRate: '0',
    freeFlag: true,
    qualityKind: 'synthetic_fixture',
    codingScore: 80,
    banglaScore: 80,
    contextLimit: 4096,
    contextVerified: true,
  };

  const modelB = {
    id: 'model-b-train',
    providerId: providerMayTrain.id,
    status: 'enabled',
    modelClass: 'synthetic',
    capabilities: ['text', 'code', 'english'],
    ratesVerified: true,
    cuInputRate: '0',
    cuOutputRate: '0',
    freeFlag: true,
    qualityKind: 'synthetic_fixture',
    codingScore: 95,
    banglaScore: 95,
    contextLimit: 4096,
    contextVerified: true,
  };

  // 1. Standard mode: Both providers eligible, modelB wins on higher quality score (95 vs 80)
  const standardSelection = resolveRoutingSelection(policy, {
    mode: 'auto',
    preset: 'coding',
    language: 'en',
    sensitivity: 'standard',
  });
  assert.equal(standardSelection.sensitivity, 'standard');
  assert.equal(standardSelection.privateMode, false);

  const standardRanked = rankRoutingCandidates({
    providers: [providerNoTrain, providerMayTrain],
    models: [modelA, modelB],
    policy,
    selection: standardSelection,
    messages: [{ role: 'user', content: 'Standard request' }],
    maxOutputTokens: 96,
  });

  assert.equal(standardRanked.candidates.length, 2);
  assert.equal(standardRanked.candidates[0].model.id, modelB.id); // Higher quality chosen
  assert.equal(standardRanked.candidates[1].model.id, modelA.id);
  assert.equal(standardRanked.rejected.length, 0);
  assert.equal(standardRanked.trainingNoticeRequired, true); // may_train free route requires notice

  // 2. Private mode: modelB is strictly rejected with TRAINING_POLICY_FORBIDDEN!
  const privateSelection = resolveRoutingSelection(policy, {
    mode: 'auto',
    preset: 'coding',
    language: 'en',
    sensitivity: 'private',
  });
  assert.equal(privateSelection.sensitivity, 'private');
  assert.equal(privateSelection.privateMode, true);

  const privateRanked = rankRoutingCandidates({
    providers: [providerNoTrain, providerMayTrain],
    models: [modelA, modelB],
    policy,
    selection: privateSelection,
    messages: [{ role: 'user', content: 'Private request' }],
    maxOutputTokens: 96,
  });

  assert.equal(privateRanked.candidates.length, 1);
  assert.equal(privateRanked.candidates[0].model.id, modelA.id); // Only modelA on no_training provider
  assert.equal(privateRanked.rejected.length, 1);
  assert.equal(privateRanked.rejected[0].modelId, modelB.id);
  assert.equal(privateRanked.rejected[0].reason, 'TRAINING_POLICY_FORBIDDEN');
  assert.equal(privateRanked.trainingNoticeRequired, false); // No may_train candidate -> no notice needed

  // 3. privateMode: true boolean flag behaves identically to sensitivity: 'private'
  const boolPrivateSelection = resolveRoutingSelection(policy, {
    mode: 'auto',
    preset: 'general',
    language: 'en',
    privateMode: true,
  });
  assert.equal(boolPrivateSelection.sensitivity, 'private');
  assert.equal(boolPrivateSelection.privateMode, true);
});

test('Step 2.9 ROUTE-05: Manual and pinned mode cannot override private mode', async () => {
  const policy = {
    id: 'test-policy',
    version: 1,
    mode: 'auto',
    modelClasses: ['synthetic'],
    requiredCapabilities: ['text'],
    allowPaid: true,
    ranking: ['quality', 'cost'],
    presets: {
      general: { requiredCapabilities: ['text'], ranking: ['quality', 'cost'] },
      coding: { requiredCapabilities: ['text', 'code'] },
      writing: { requiredCapabilities: ['text'] },
      research: { requiredCapabilities: ['text'] },
    },
  };

  const providerMayTrain = {
    id: 'provider-may-train',
    name: 'Provider Training Allowed',
    status: 'enabled',
    adapterKind: 'synthetic_mock',
    allowsMultiuser: true,
    ownerApproved: true,
    quotaConfirmed: true,
    termsUrl: 'https://example.invalid/terms',
    termsReviewedAt: '2026-01-01',
    dataPolicy: 'may_train',
  };

  const modelB = {
    id: 'model-b-train',
    providerId: providerMayTrain.id,
    status: 'enabled',
    modelClass: 'synthetic',
    capabilities: ['text', 'english'],
    ratesVerified: true,
    cuInputRate: '0',
    cuOutputRate: '0',
    freeFlag: true,
    qualityKind: 'synthetic_fixture',
  };

  // User explicitly selects modelB in private mode
  const manualPrivateSelection = resolveRoutingSelection(policy, {
    mode: 'manual',
    modelId: modelB.id,
    sensitivity: 'private',
  });

  const ranked = rankRoutingCandidates({
    providers: [providerMayTrain],
    models: [modelB],
    policy,
    selection: manualPrivateSelection,
    messages: [{ role: 'user', content: 'Attempting to force train model in private mode' }],
    maxOutputTokens: 96,
  });

  assert.equal(ranked.candidates.length, 0);
  assert.equal(ranked.rejected.length, 1);
  assert.equal(ranked.rejected[0].modelId, modelB.id);
  assert.equal(ranked.rejected[0].reason, 'TRAINING_POLICY_FORBIDDEN');
});

test('Step 2.9 ROUTE-05 & PRIV-03: Privacy invariance during transport failure and fallback', async (t) => {
  const modelA = routerFixture.models[0]; // will be on provider-no-train
  const modelB = routerFixture.models[1]; // will be on provider-may-train

  let failModelA = true;
  let modelBCalled = false;

  const overrides = {
    [modelA.id]: {
      synthetic: true,
      providerId: routerFixture.provider.id,
      modelId: modelA.id,
      health: () => ({ synthetic: true, available: true }),
      async *stream() {
        if (failModelA) {
          throw new AppError(503, 'SIMULATED_FAILURE', 'Model A primary route failed');
        }
        yield { text: 'Model A response' };
      },
    },
    [modelB.id]: {
      synthetic: true,
      providerId: routerFixture.provider.id,
      modelId: modelB.id,
      health: () => ({ synthetic: true, available: true }),
      async *stream() {
        modelBCalled = true;
        yield { text: 'Model B training provider response' };
      },
    },
  };

  const f = await fixture(t, {
    gatewayOverrides: overrides,
    routerOptions: {
      maxRetries: 0,
      maxFallbacks: 1,
      allowManualFallback: true,
    },
  });

  // 1. By default, routerFixture.provider has dataPolicy: 'synthetic_only' (non-training).
  // Update provider in DB to 'may_train' to simulate a training-enabled provider!
  await f.db.query("UPDATE providers SET data_policy_flag = 'may_train' WHERE id = $1", [
    routerFixture.provider.id,
  ]);
  await f.db.query(
    "UPDATE registry_metadata SET data = jsonb_set(data, '{dataPolicy}', '\"may_train\"') WHERE area = 'provider' AND target_id = $1",
    [routerFixture.provider.id],
  );

  // In standard mode, request to model A fails and falls back to model B on may_train provider
  failModelA = true;
  modelBCalled = false;
  const standardChat = await prepareChat(f, {
    content: 'Standard request expecting fallback',
    routing: { mode: 'manual', modelId: modelA.id, sensitivity: 'standard' },
  });
  assert.equal(standardChat.prepareResult.trainingNoticeRequired, true);

  const streamStandard = f.router.stream(SYNTHETIC_SEED.userA, standardChat.data);
  const chunks = [];
  for await (const chunk of streamStandard) {
    if (chunk.type === 'delta') chunks.push(chunk.text);
  }
  assert.equal(chunks.join(''), 'Model B training provider response');
  assert.equal(modelBCalled, true);

  // 2. In private mode, because provider is 'may_train', both model A and model B are FORBIDDEN!
  // Neither can be admitted or used as a fallback!
  await assert.rejects(
    prepareChat(f, {
      content: 'Private request on training provider',
      routing: { mode: 'auto', sensitivity: 'private' },
    }),
    (err) => err.code === 'NO_ELIGIBLE_MODELS',
  );

  // 3. Restore provider to 'no_training'
  await f.db.query("UPDATE providers SET data_policy_flag = 'no_training' WHERE id = $1", [
    routerFixture.provider.id,
  ]);
  await f.db.query(
    "UPDATE registry_metadata SET data = jsonb_set(data, '{dataPolicy}', '\"no_training\"') WHERE area = 'provider' AND target_id = $1",
    [routerFixture.provider.id],
  );

  // Now in private mode, request succeeds because provider is no_training!
  failModelA = false;
  const privateChat = await prepareChat(f, {
    content: 'Private request on no_training provider',
    routing: { mode: 'manual', modelId: modelA.id, sensitivity: 'private' },
  });
  assert.equal(privateChat.prepareResult.sensitivity, 'private');
  assert.equal(privateChat.prepareResult.privateMode, true);
  assert.equal(privateChat.prepareResult.trainingNoticeRequired, false);

  const streamPrivate = f.router.stream(SYNTHETIC_SEED.userA, privateChat.data);
  const privateChunks = [];
  for await (const chunk of streamPrivate) {
    if (chunk.type === 'delta') privateChunks.push(chunk.text);
  }
  assert.equal(privateChunks.join(''), 'Model A response');
});

test('Step 2.9 ROUTE-07: Training data notice detection and once-per-session tracking', async (t) => {
  const f = await fixture(t);
  const client = f.client();

  // Log in as test user
  const loginRes = await client.loginUser('demo-beta');
  assert.equal(loginRes.response.status, 200);

  // Set provider to may_train
  await f.db.query("UPDATE providers SET data_policy_flag = 'may_train' WHERE id = $1", [
    routerFixture.provider.id,
  ]);
  await f.db.query(
    "UPDATE registry_metadata SET data = jsonb_set(data, '{dataPolicy}', '\"may_train\"') WHERE area = 'provider' AND target_id = $1",
    [routerFixture.provider.id],
  );

  // 1. Check training notice endpoint for new session: shown is false
  const noticeRes1 = await client.call('/api/privacy/training-notice');
  assert.equal(noticeRes1.response.status, 200);
  assert.equal(noticeRes1.json.shown, false);
  assert.equal(noticeRes1.json.privacyUrl, '/legal/privacy.html');
  assert.ok(noticeRes1.json.message.includes('training on conversation data'));

  // 2. Acknowledge notice via POST
  const ackRes = await client.call('/api/privacy/training-notice/ack', 'POST', {});
  assert.equal(ackRes.response.status, 200);
  assert.equal(ackRes.json.acknowledged, true);
  assert.equal(ackRes.json.shown, true);

  // 3. Subsequent check in the same session shows true
  const noticeRes2 = await client.call('/api/privacy/training-notice');
  assert.equal(noticeRes2.response.status, 200);
  assert.equal(noticeRes2.json.shown, true);

  // 4. Logout revokes session and clears notice state for that session
  await client.call('/api/auth/logout', 'POST', {});

  // 5. Log in again (new session): notice resets to shown: false
  await client.loginUser('demo-beta');
  const noticeRes3 = await client.call('/api/privacy/training-notice');
  assert.equal(noticeRes3.response.status, 200);
  assert.equal(noticeRes3.json.shown, false);
});

test('Step 2.9 AP-06: Routing simulator evaluates sensitivity and private mode', async (t) => {
  const f = await fixture(t);
  const staff = f.client();
  const validCode = generateTotp(DEFAULT_ADMIN_TOTP_SECRET);
  await staff.loginStaff(SYNTHETIC_SEED.userA, validCode);

  // Configure all providers as may_train
  await f.db.query("UPDATE providers SET data_policy_flag = 'may_train'");

  // 1. Standard mode simulation: may_train models are eligible candidates
  const stdSim = await staff.call('/admin/api/routing/simulate', 'POST', {
    prompt: 'Evaluate prompt in standard mode',
    language: 'en',
    sensitivity: 'standard',
  });
  assert.equal(stdSim.response.status, 200);
  assert.equal(stdSim.json.ok, true);
  assert.equal(stdSim.json.trainingNoticeRequired, true);
  assert.ok(stdSim.json.candidates.length >= 2);
  assert.ok(stdSim.json.selection.modelId);

  // 2. Private mode simulation: all may_train models rejected with TRAINING_POLICY_FORBIDDEN!
  const privSim = await staff.call('/admin/api/routing/simulate', 'POST', {
    prompt: 'Evaluate prompt in private mode',
    language: 'en',
    sensitivity: 'private',
  });
  assert.equal(privSim.response.status, 200);
  assert.equal(privSim.json.ok, true);
  assert.equal(privSim.json.trainingNoticeRequired, false);
  assert.equal(privSim.json.selection, null);
  assert.equal(privSim.json.candidates.length, 0);
  assert.ok(privSim.json.rejected.length >= 2);
  assert.ok(privSim.json.rejected.every((r) => r.reason === 'TRAINING_POLICY_FORBIDDEN'));

  // 3. Re-enable no_training on all providers: private simulation now succeeds!
  await f.db.query("UPDATE providers SET data_policy_flag = 'no_training'");

  const restoredSim = await staff.call('/admin/api/routing/simulate', 'POST', {
    prompt: 'Evaluate prompt in restored private mode',
    language: 'en',
    sensitivity: 'private',
  });
  assert.equal(restoredSim.response.status, 200);
  assert.equal(restoredSim.json.ok, true);
  assert.equal(restoredSim.json.trainingNoticeRequired, false);
  assert.ok(restoredSim.json.candidates.length >= 2);
  assert.ok(restoredSim.json.selection.modelId);
});
