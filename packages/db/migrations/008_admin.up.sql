-- Migration 008: Step 2.6 Control Center Foundation
-- Separate admin app/API scope, RBAC roles, MFA, append-only audit, config versioning & rollback, kill switches

CREATE TABLE staff_roles (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{2,40}$'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  description TEXT,
  permissions JSONB NOT NULL CHECK (jsonb_typeof(permissions) = 'array'),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE staff_users (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES staff_roles(id),
  totp_secret TEXT NOT NULL CHECK (length(totp_secret) BETWEEN 16 AND 128),
  totp_enrolled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE staff_sessions (
  id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  csrf_hash TEXT NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX staff_sessions_staff_idx ON staff_sessions(staff_id);

CREATE TABLE kill_switches (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9_:-]{2,80}$'),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  updated_by TEXT NOT NULL REFERENCES staff_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('kill_switch', 'routing_policy', 'registry_provider', 'registry_model', 'role')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 120),
  version INTEGER NOT NULL CHECK (version > 0),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'rollback')),
  actor_id TEXT NOT NULL REFERENCES staff_users(id),
  before_data JSONB,
  after_data JSONB NOT NULL CHECK (jsonb_typeof(after_data) = 'object'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 2 AND 256),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, version),
  UNIQUE(actor_id, idempotency_key)
);
CREATE INDEX config_revisions_entity_idx ON config_revisions(entity_type, entity_id, version);

CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  actor_id TEXT NOT NULL REFERENCES staff_users(id),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target_type TEXT NOT NULL CHECK (length(target_type) BETWEEN 1 AND 80),
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192),
  ip_hash TEXT CHECK (ip_hash IS NULL OR ip_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX admin_audit_actor_idx ON admin_audit_log(actor_id, created_at);

CREATE TRIGGER config_revisions_no_change BEFORE UPDATE OR DELETE ON config_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER config_revisions_no_truncate BEFORE TRUNCATE ON config_revisions FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER admin_audit_log_no_change BEFORE UPDATE OR DELETE ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER admin_audit_log_no_truncate BEFORE TRUNCATE ON admin_audit_log FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();

ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_check;
ALTER TABLE providers ADD CONSTRAINT providers_check CHECK (adapter_kind <> 'synthetic_mock' OR base_url IS NULL);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tier_check;
ALTER TABLE users ADD CONSTRAINT users_tier_check CHECK (tier IN ('free', 'funded', 'premium'));
