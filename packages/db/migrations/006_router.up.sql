-- Explicit local synthetic Router composition; original Phase1 schema stays opt-in.
ALTER TABLE usage_events DROP CONSTRAINT usage_events_cost_micro_cu_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_router_cost CHECK(cost_micro_cu>=0);
ALTER TABLE routing_records DROP CONSTRAINT routing_records_attempt_count_check;
ALTER TABLE routing_records ADD CONSTRAINT routing_records_router_attempts CHECK(attempt_count BETWEEN 1 AND 11);
ALTER TABLE messages DROP CONSTRAINT messages_check;
ALTER TABLE messages ADD CONSTRAINT messages_router_provenance CHECK (
 role<>'assistant' OR (request_id IS NOT NULL AND (
  (provider_id IS NOT NULL AND model_id IS NOT NULL AND routing_record_id IS NOT NULL)
  OR (status IN ('pending','failed','cancelled') AND content='' AND provider_id IS NULL AND model_id IS NULL AND routing_record_id IS NULL)
 ))
);
CREATE TABLE router_storage_guard(id INTEGER PRIMARY KEY CHECK(id=1),last_time TIMESTAMPTZ);
INSERT INTO router_storage_guard(id) VALUES(1);
CREATE TABLE routing_policies(id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version>0),data JSONB NOT NULL CHECK(octet_length(data::text)<=8192));
CREATE TABLE router_policy_versions(id TEXT PRIMARY KEY,policy_id TEXT NOT NULL,version INTEGER NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_role TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,data JSONB NOT NULL CHECK(octet_length(data::text)<=8192),created_at TIMESTAMPTZ NOT NULL,UNIQUE(policy_id,version),UNIQUE(actor_id,idempotency_key));
CREATE TABLE router_requests(
 id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,160}$'),user_id TEXT NOT NULL REFERENCES users(id),conversation_id TEXT NOT NULL,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),language TEXT NOT NULL CHECK(language IN ('en','bn')),
 policy_id TEXT NOT NULL,policy_version INTEGER NOT NULL,selection JSONB NOT NULL CHECK(octet_length(selection::text)<=4096),
 family_id TEXT NOT NULL REFERENCES router_requests(id),retry_of TEXT REFERENCES router_requests(id),
 max_retries INTEGER NOT NULL CHECK(max_retries BETWEEN 0 AND 5),max_fallbacks INTEGER NOT NULL CHECK(max_fallbacks BETWEEN 0 AND 5),
 retries_used INTEGER NOT NULL DEFAULT 0 CHECK(retries_used>=0 AND retries_used<=max_retries),fallbacks_used INTEGER NOT NULL DEFAULT 0 CHECK(fallbacks_used>=0 AND fallbacks_used<=max_fallbacks),
 state TEXT NOT NULL CHECK(state IN ('RUNNING','COMPLETE','FAILED','CANCELLED')),
 candidates JSONB NOT NULL CHECK(octet_length(candidates::text)<=8192),reason TEXT NOT NULL,reset_at TIMESTAMPTZ,context_trimmed BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL,started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,
 FOREIGN KEY(id,user_id) REFERENCES chat_requests(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(conversation_id,user_id) REFERENCES conversations(id,user_id) ON DELETE CASCADE
);
CREATE TABLE router_daily_counters(user_id TEXT NOT NULL REFERENCES users(id),day_at TIMESTAMPTZ NOT NULL,used_tokens BIGINT NOT NULL DEFAULT 0 CHECK(used_tokens>=0),reserved_tokens BIGINT NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),PRIMARY KEY(user_id,day_at));
CREATE TABLE router_attempts(
 id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES router_requests(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 11),provider_id TEXT NOT NULL REFERENCES providers(id),model_id TEXT NOT NULL REFERENCES models(id),
 external_name TEXT NOT NULL,entitlement_id TEXT NOT NULL REFERENCES ledger_entitlements(id),
 kind TEXT NOT NULL CHECK(kind IN ('free','pack')),day_at TIMESTAMPTZ NOT NULL,
 input_bound BIGINT NOT NULL CHECK(input_bound>=0),output_bound BIGINT NOT NULL CHECK(output_bound>=0),
 actual_input BIGINT CHECK(actual_input BETWEEN 0 AND input_bound),actual_output BIGINT CHECK(actual_output BETWEEN 0 AND output_bound),
 state TEXT NOT NULL CHECK(state IN ('DISPATCHED','COMPLETE','PENDING_RECONCILIATION','ESTIMATED','CORRECTED')),
 content TEXT NOT NULL DEFAULT '' CHECK(octet_length(content)<=65536),reason TEXT NOT NULL,
 dispatched_at TIMESTAMPTZ NOT NULL,reconciliation_deadline TIMESTAMPTZ NOT NULL,latency_ms INTEGER CHECK(latency_ms>=0),UNIQUE(request_id,ordinal)
);
CREATE TABLE router_breakers(id TEXT PRIMARY KEY,failures INTEGER NOT NULL DEFAULT 0 CHECK(failures>=0),window_at TIMESTAMPTZ NOT NULL,opened_until TIMESTAMPTZ);
-- Minimal accounting survives owned chat deletion; private attempts still cascade.
CREATE TABLE router_accounting_holds(
 attempt_id TEXT PRIMARY KEY REFERENCES ledger_reservations(id),request_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('free','pack')),day_at TIMESTAMPTZ NOT NULL,
 input_bound BIGINT NOT NULL CHECK(input_bound>=0),output_bound BIGINT NOT NULL CHECK(output_bound>=0),
 actual_input BIGINT CHECK(actual_input BETWEEN 0 AND input_bound),actual_output BIGINT CHECK(actual_output BETWEEN 0 AND output_bound),
 state TEXT NOT NULL CHECK(state IN ('DISPATCHED','COMPLETE','PENDING_RECONCILIATION','ESTIMATED','CORRECTED')),
 reconciliation_deadline TIMESTAMPTZ NOT NULL
);
CREATE TABLE router_events(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),actor_role TEXT NOT NULL,request_id TEXT,attempt_id TEXT,kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 40),metadata JSONB NOT NULL CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=8192),created_at TIMESTAMPTZ NOT NULL);
CREATE TRIGGER router_policy_versions_no_change BEFORE UPDATE OR DELETE ON router_policy_versions FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER router_policy_versions_no_truncate BEFORE TRUNCATE ON router_policy_versions FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER router_events_no_change BEFORE UPDATE OR DELETE ON router_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER router_events_no_truncate BEFORE TRUNCATE ON router_events FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE INDEX router_attempts_request ON router_attempts(request_id,ordinal);
CREATE UNIQUE INDEX router_correction_replay ON router_events(actor_id,(metadata->>'keyHash')) WHERE kind='ATTEMPT_CORRECTION';
