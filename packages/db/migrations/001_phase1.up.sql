CREATE TABLE users (
  id TEXT PRIMARY KEY,
  identity_provider TEXT NOT NULL CHECK (identity_provider IN ('synthetic', 'google')),
  provider_subject TEXT NOT NULL,
  google_sub TEXT UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'bn')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'owner', 'super_admin', 'admin', 'support', 'finance', 'reviewer')),
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
  trust_level INTEGER NOT NULL DEFAULT 0 CHECK (trust_level BETWEEN 0 AND 10),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  legal_version TEXT,
  legal_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (identity_provider, provider_subject),
  CHECK ((legal_version IS NULL) = (legal_accepted_at IS NULL))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  device_hash TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter_kind TEXT NOT NULL CHECK (adapter_kind IN ('synthetic_mock', 'external')),
  base_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  terms_url TEXT,
  terms_reviewed_at TIMESTAMPTZ,
  data_policy_flag TEXT NOT NULL DEFAULT 'unknown' CHECK (data_policy_flag IN ('no_training', 'may_train', 'unknown', 'synthetic_only')),
  allows_multiuser BOOLEAN NOT NULL DEFAULT FALSE,
  secret_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (adapter_kind <> 'synthetic_mock' OR (base_url IS NULL AND secret_ref IS NULL)),
  CHECK (adapter_kind <> 'external' OR status = 'disabled')
);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  external_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT ARRAY['text']::TEXT[],
  context_limit INTEGER NOT NULL CHECK (context_limit > 0),
  model_class TEXT NOT NULL DEFAULT 'synthetic',
  cu_in_rate_per_1k BIGINT NOT NULL DEFAULT 0 CHECK (cu_in_rate_per_1k BETWEEN 0 AND 9007199254740991),
  cu_out_rate_per_1k BIGINT NOT NULL DEFAULT 0 CHECK (cu_out_rate_per_1k BETWEEN 0 AND 9007199254740991),
  agent_ready BOOLEAN NOT NULL DEFAULT FALSE,
  bangla_score INTEGER CHECK (bangla_score BETWEEN 0 AND 100),
  free_flag BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, provider_id),
  UNIQUE (provider_id, external_name)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation' CHECK (length(title) BETWEEN 1 AND 120),
  mode TEXT NOT NULL DEFAULT 'chat' CHECK (mode IN ('chat', 'agent')),
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (id, user_id)
);
CREATE INDEX conversations_user_idx ON conversations(user_id, updated_at DESC);

CREATE TABLE chat_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  conversation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'streaming', 'complete', 'cancelled', 'failed')),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key),
  UNIQUE (id, user_id),
  FOREIGN KEY (conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE CASCADE
);
CREATE INDEX chat_requests_daily_idx ON chat_requests(user_id, created_at);

CREATE TABLE routing_records (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  model_id TEXT NOT NULL,
  external_model TEXT NOT NULL,
  run_kind TEXT NOT NULL CHECK (run_kind = 'synthetic_mock'),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count = 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, user_id),
  UNIQUE (id, request_id, user_id, provider_id, model_id),
  FOREIGN KEY (request_id, user_id) REFERENCES chat_requests(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (model_id, provider_id) REFERENCES models(id, provider_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  sequence_no BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL CHECK (octet_length(content) <= 65536),
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending', 'streaming', 'complete', 'cancelled', 'failed')),
  provider_id TEXT REFERENCES providers(id),
  model_id TEXT REFERENCES models(id),
  routing_record_id TEXT,
  request_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  usage_kind TEXT NOT NULL DEFAULT 'synthetic_estimate' CHECK (usage_kind IN ('synthetic_estimate', 'unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, user_id) REFERENCES chat_requests(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (routing_record_id, request_id, user_id, provider_id, model_id) REFERENCES routing_records(id, request_id, user_id, provider_id, model_id),
  FOREIGN KEY (model_id, provider_id) REFERENCES models(id, provider_id),
  CHECK (role <> 'assistant' OR (provider_id IS NOT NULL AND model_id IS NOT NULL AND routing_record_id IS NOT NULL AND request_id IS NOT NULL))
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, sequence_no);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  model_id TEXT NOT NULL REFERENCES models(id),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  estimated BOOLEAN NOT NULL DEFAULT TRUE,
  usage_kind TEXT NOT NULL DEFAULT 'synthetic_estimate' CHECK (usage_kind = 'synthetic_estimate'),
  cost_micro_cu BIGINT NOT NULL DEFAULT 0 CHECK (cost_micro_cu = 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('complete', 'cancelled', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id),
  CHECK (estimated = TRUE)
);
CREATE INDEX usage_events_user_idx ON usage_events(user_id, created_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target_type TEXT NOT NULL DEFAULT 'resource',
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (octet_length(metadata::TEXT) <= 2048)
);
CREATE INDEX audit_events_actor_idx ON audit_events(actor_id, created_at);

CREATE TABLE deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL DEFAULT 'account' CHECK (scope IN ('account', 'conversation')),
  conversation_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deadline_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CHECK ((scope = 'conversation') = (conversation_id IS NOT NULL)),
  CHECK (deadline_at >= requested_at)
);

CREATE FUNCTION reject_append_only_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table cannot be modified' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER usage_events_append_only BEFORE UPDATE OR DELETE ON usage_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER usage_events_no_truncate BEFORE TRUNCATE ON usage_events FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER routing_records_no_update BEFORE UPDATE ON routing_records FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
