-- Synthetic Governor state is separate from immutable financial accounting.
CREATE TABLE capacity_storage_guard (
  id INTEGER PRIMARY KEY CHECK(id=1), last_time TIMESTAMPTZ
);
INSERT INTO capacity_storage_guard(id) VALUES(1);
CREATE TABLE capacity_pools (
  id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,80}$'),
  provider_id TEXT NOT NULL REFERENCES providers(id),
  scope TEXT NOT NULL CHECK(scope IN ('provider','account','model')),
  account_ref TEXT NOT NULL CHECK(account_ref ~ '^[A-Za-z0-9_-]{1,80}$'),
  scope_ref TEXT NOT NULL CHECK(scope_ref ~ '^[A-Za-z0-9_-]{1,80}$'),
  definition JSONB NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=16384),
  status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','disabled')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  synthetic_only BOOLEAN NOT NULL DEFAULT TRUE CHECK(synthetic_only),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(provider_id,scope,account_ref,scope_ref),
  CHECK(scope<>'provider' OR (account_ref='provider' AND scope_ref='all')),
  CHECK(scope='model' OR scope_ref='all')
);
CREATE TABLE capacity_limits (
  id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,80}$'),
  pool_id TEXT NOT NULL REFERENCES capacity_pools(id),
  metric TEXT NOT NULL CHECK(metric IN ('requests','tokens','input_tokens','output_tokens')),
  limit_amount BIGINT NOT NULL CHECK(limit_amount>=0),
  safety_factor TEXT NOT NULL CHECK(length(safety_factor) BETWEEN 1 AND 64),
  safe_amount BIGINT NOT NULL CHECK(safe_amount BETWEEN 0 AND limit_amount),
  window_ms INTEGER NOT NULL CHECK(window_ms BETWEEN 1000 AND 86400000),
  anchor_at TIMESTAMPTZ NOT NULL,
  UNIQUE(pool_id,metric,window_ms,anchor_at)
);
CREATE TABLE capacity_routes (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  model_id TEXT NOT NULL,
  account_ref TEXT NOT NULL CHECK(account_ref ~ '^[A-Za-z0-9_-]{1,80}$'),
  provider_limits TEXT NOT NULL CHECK(provider_limits IN ('known','not_applicable')),
  account_limits TEXT NOT NULL CHECK(account_limits IN ('known','not_applicable')),
  model_limits TEXT NOT NULL CHECK(model_limits IN ('known','not_applicable')),
  quota_confirmed BOOLEAN NOT NULL CHECK(quota_confirmed),
  synthetic_only BOOLEAN NOT NULL DEFAULT TRUE CHECK(synthetic_only),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(model_id,account_ref),
  FOREIGN KEY(model_id,provider_id) REFERENCES models(id,provider_id)
);
CREATE TABLE capacity_counters (
  id TEXT PRIMARY KEY,
  limit_id TEXT NOT NULL REFERENCES capacity_limits(id),
  starts_at TIMESTAMPTZ NOT NULL,
  resets_at TIMESTAMPTZ NOT NULL CHECK(resets_at>starts_at),
  safe_amount BIGINT NOT NULL CHECK(safe_amount>=0),
  used_amount BIGINT NOT NULL DEFAULT 0 CHECK(used_amount>=0),
  reserved_amount BIGINT NOT NULL DEFAULT 0 CHECK(reserved_amount>=0),
  UNIQUE(limit_id,starts_at),
  CHECK(used_amount::numeric+reserved_amount::numeric<=safe_amount::numeric)
);
CREATE TABLE capacity_reservations (
  id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,160}$'),
  user_id TEXT NOT NULL REFERENCES users(id),
  route_id TEXT NOT NULL REFERENCES capacity_routes(id),
  request_id TEXT NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_-]{1,160}$'),
  state TEXT NOT NULL CHECK(state IN ('RESERVED','DISPATCHED','PENDING_RECONCILIATION','RELEASED','SETTLED','ESTIMATED','CORRECTED')),
  bound_input BIGINT NOT NULL CHECK(bound_input>=0),
  bound_output BIGINT NOT NULL CHECK(bound_output>=0),
  actual_input BIGINT CHECK(actual_input BETWEEN 0 AND bound_input),
  actual_output BIGINT CHECK(actual_output BETWEEN 0 AND bound_output),
  expires_at TIMESTAMPTZ NOT NULL,
  dispatched_at TIMESTAMPTZ,
  reconciliation_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id,request_id)
);
CREATE TABLE capacity_allocations (
  reservation_id TEXT NOT NULL REFERENCES capacity_reservations(id),
  counter_id TEXT NOT NULL REFERENCES capacity_counters(id),
  metric TEXT NOT NULL CHECK(metric IN ('requests','tokens','input_tokens','output_tokens')),
  bound_amount BIGINT NOT NULL CHECK(bound_amount>=0),
  used_amount BIGINT NOT NULL DEFAULT 0 CHECK(used_amount BETWEEN 0 AND bound_amount),
  reserved_amount BIGINT NOT NULL CHECK(reserved_amount BETWEEN 0 AND bound_amount),
  PRIMARY KEY(reservation_id,counter_id),
  CHECK(used_amount::numeric+reserved_amount::numeric<=bound_amount::numeric)
);
CREATE TABLE capacity_operations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 40),
  idempotency_key TEXT NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{8,160}$'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  result JSONB NOT NULL CHECK(octet_length(result::text)<=8192),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(actor_id,idempotency_key)
);
CREATE TABLE capacity_events (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL,
  reservation_id TEXT REFERENCES capacity_reservations(id),
  kind TEXT NOT NULL CHECK(kind IN ('POOL_CREATE','POOL_STATUS','ROUTE_CREATE','RESERVE','DISPATCH','CANCEL','SETTLE','DEADLINE_ESTIMATE','LATE_CORRECTION','PRE_DISPATCH_TIMEOUT','FAIR_SHARE_JOB')),
  metadata JSONB NOT NULL CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=2048),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(operation_id)
);
CREATE UNIQUE INDEX capacity_one_estimate ON capacity_events(reservation_id) WHERE kind='DEADLINE_ESTIMATE';
CREATE UNIQUE INDEX capacity_one_correction ON capacity_events(reservation_id) WHERE kind='LATE_CORRECTION';
CREATE TABLE capacity_job_runs (
  id TEXT PRIMARY KEY,
  pool_remaining_tokens BIGINT NOT NULL CHECK(pool_remaining_tokens>=0),
  expected_active_users BIGINT NOT NULL CHECK(expected_active_users>=0),
  created_at TIMESTAMPTZ NOT NULL,
  synthetic_only BOOLEAN NOT NULL DEFAULT TRUE CHECK(synthetic_only)
);
CREATE TABLE capacity_fair_share (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES capacity_job_runs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  daily_tokens BIGINT NOT NULL CHECK(daily_tokens>=0),
  trust_token_cap BIGINT NOT NULL CHECK(trust_token_cap>=0),
  trust_level INTEGER NOT NULL CHECK(trust_level BETWEEN 0 AND 10),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(generation_id,user_id)
);
CREATE INDEX capacity_fair_share_owner ON capacity_fair_share(user_id,created_at,id);

CREATE TRIGGER capacity_limits_no_change BEFORE UPDATE OR DELETE ON capacity_limits FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_limits_no_truncate BEFORE TRUNCATE ON capacity_limits FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_routes_no_change BEFORE UPDATE OR DELETE ON capacity_routes FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_routes_no_truncate BEFORE TRUNCATE ON capacity_routes FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_operations_no_change BEFORE UPDATE OR DELETE ON capacity_operations FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_operations_no_truncate BEFORE TRUNCATE ON capacity_operations FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_events_no_change BEFORE UPDATE OR DELETE ON capacity_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_events_no_truncate BEFORE TRUNCATE ON capacity_events FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_job_runs_no_change BEFORE UPDATE OR DELETE ON capacity_job_runs FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_job_runs_no_truncate BEFORE TRUNCATE ON capacity_job_runs FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_fair_share_no_change BEFORE UPDATE OR DELETE ON capacity_fair_share FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER capacity_fair_share_no_truncate BEFORE TRUNCATE ON capacity_fair_share FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE FUNCTION capacity_pool_definition_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id,OLD.provider_id,OLD.scope,OLD.account_ref,OLD.scope_ref,OLD.definition,OLD.synthetic_only)
    IS DISTINCT FROM ROW(NEW.id,NEW.provider_id,NEW.scope,NEW.account_ref,NEW.scope_ref,NEW.definition,NEW.synthetic_only) THEN
    RAISE EXCEPTION 'Capacity pool definition is append-only' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER capacity_pool_definition BEFORE UPDATE ON capacity_pools FOR EACH ROW EXECUTE FUNCTION capacity_pool_definition_immutable();
