-- Local synthetic accounting is opt-in; original chat usage stays unchanged.
CREATE TABLE ledger_storage_guard (id INTEGER PRIMARY KEY CHECK(id=1));
INSERT INTO ledger_storage_guard(id) VALUES(1);

CREATE TABLE ledger_entitlements (
  id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,160}$'),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('free','pack')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK(ends_at > starts_at),
  synthetic_only BOOLEAN NOT NULL DEFAULT TRUE CHECK(synthetic_only),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id,user_id)
);
CREATE INDEX ledger_entitlements_owner ON ledger_entitlements(user_id,id);

CREATE TABLE ledger_reservations (
  id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,160}$'),
  user_id TEXT NOT NULL,
  entitlement_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_-]{1,160}$'),
  parent_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('request','task','call')),
  state TEXT NOT NULL CHECK(state IN ('RESERVED','DISPATCHED','PENDING_RECONCILIATION','SETTLED','ESTIMATED','CORRECTED','RELEASED','ACTIVE','PAUSED','PLANNING','AWAITING_APPROVAL','REVIEW','COMPLETE','CANCELLED','TIMED_OUT')),
  bound_cost BIGINT NOT NULL CHECK(bound_cost>=0),
  bound_input BIGINT NOT NULL CHECK(bound_input>=0),
  bound_output BIGINT NOT NULL CHECK(bound_output>=0),
  outstanding_cost BIGINT NOT NULL CHECK(outstanding_cost BETWEEN 0 AND bound_cost),
  outstanding_input BIGINT NOT NULL CHECK(outstanding_input BETWEEN 0 AND bound_input),
  outstanding_output BIGINT NOT NULL CHECK(outstanding_output BETWEEN 0 AND bound_output),
  wait_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id,user_id,entitlement_id),
  UNIQUE(user_id,request_id),
  FOREIGN KEY(entitlement_id,user_id) REFERENCES ledger_entitlements(id,user_id),
  FOREIGN KEY(parent_id,user_id,entitlement_id) REFERENCES ledger_reservations(id,user_id,entitlement_id),
  CHECK((kind='call')=(parent_id IS NOT NULL)),
  CHECK((kind='task')=(state IN ('ACTIVE','PAUSED','PLANNING','AWAITING_APPROVAL','REVIEW','COMPLETE','CANCELLED','TIMED_OUT')))
);
CREATE INDEX ledger_reservations_parent ON ledger_reservations(parent_id,state);

CREATE TABLE provider_attempts (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  entitlement_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  model_id TEXT NOT NULL REFERENCES models(id),
  price_version INTEGER NOT NULL CHECK(price_version>0),
  price_snapshot JSONB NOT NULL CHECK(jsonb_typeof(price_snapshot)='object' AND octet_length(price_snapshot::text)<=2048),
  status TEXT NOT NULL CHECK(status IN ('DISPATCHED','PENDING_RECONCILIATION','SETTLED','ESTIMATED','CORRECTED')),
  usage_status TEXT NOT NULL CHECK(usage_status IN ('unknown','estimated','synthetic_reported')),
  reserved_micro_cu BIGINT NOT NULL CHECK(reserved_micro_cu>=0),
  actual_micro_cu BIGINT CHECK(actual_micro_cu BETWEEN 0 AND reserved_micro_cu),
  actual_input BIGINT CHECK(actual_input>=0),
  actual_output BIGINT CHECK(actual_output>=0),
  dispatched_at TIMESTAMPTZ NOT NULL,
  reconciliation_deadline TIMESTAMPTZ NOT NULL CHECK(reconciliation_deadline>=dispatched_at),
  reconciled_at TIMESTAMPTZ,
  commit_entry_id TEXT,
  synthetic_only BOOLEAN NOT NULL DEFAULT TRUE CHECK(synthetic_only),
  FOREIGN KEY(reservation_id,user_id,entitlement_id) REFERENCES ledger_reservations(id,user_id,entitlement_id),
  FOREIGN KEY(model_id,provider_id) REFERENCES models(id,provider_id)
);
CREATE INDEX ledger_attempts_deadline ON provider_attempts(status,reconciliation_deadline);

CREATE TABLE usage_ledger (
  id TEXT PRIMARY KEY,
  sequence_no BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id TEXT NOT NULL,
  entitlement_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('grant','reserve','commit','release','expire','refund','adjust')),
  amount_micro_cu BIGINT NOT NULL,
  tokens_in BIGINT NOT NULL,
  tokens_out BIGINT NOT NULL,
  reservation_id TEXT,
  ref_id TEXT NOT NULL CHECK(length(ref_id) BETWEEN 1 AND 160),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  estimate_flag BOOLEAN NOT NULL DEFAULT FALSE,
  reconciles_entry_id TEXT REFERENCES usage_ledger(id),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('LOCAL_GRANT','RESERVATION','SETTLEMENT','PRE_DISPATCH_CANCEL','DEADLINE_ESTIMATE','LATE_CORRECTION','TASK_TERMINATION','LOCAL_CORRECTION','LOCAL_REFUND','ENTITLEMENT_EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(entitlement_id,user_id) REFERENCES ledger_entitlements(id,user_id),
  FOREIGN KEY(reservation_id,user_id,entitlement_id) REFERENCES ledger_reservations(id,user_id,entitlement_id),
  CHECK(type='adjust' OR
    (type IN ('grant','release','refund') AND amount_micro_cu>=0 AND tokens_in>=0 AND tokens_out>=0) OR
    (type IN ('reserve','commit','expire') AND amount_micro_cu<=0 AND tokens_in<=0 AND tokens_out<=0)),
  CHECK(NOT estimate_flag OR type='commit'),
  CHECK(reconciles_entry_id IS NULL OR type='adjust')
);
CREATE INDEX usage_ledger_owner ON usage_ledger(user_id,entitlement_id,sequence_no);
CREATE UNIQUE INDEX usage_ledger_one_correction ON usage_ledger(reconciles_entry_id) WHERE reconciles_entry_id IS NOT NULL;
ALTER TABLE provider_attempts ADD FOREIGN KEY(commit_entry_id) REFERENCES usage_ledger(id);

CREATE TABLE ledger_operations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL CHECK(actor_role IN ('user','owner','super_admin','admin','support','finance','reviewer')),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 40),
  idempotency_key TEXT NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{8,160}$'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  result JSONB NOT NULL CHECK(octet_length(result::text)<=8192),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(actor_id,idempotency_key)
);
CREATE TABLE ledger_alerts (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES ledger_reservations(id),
  kind TEXT NOT NULL CHECK(kind='UNKNOWN_USAGE_DEADLINE'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(reservation_id,kind)
);
CREATE TRIGGER usage_ledger_no_change BEFORE UPDATE OR DELETE ON usage_ledger FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER usage_ledger_no_truncate BEFORE TRUNCATE ON usage_ledger FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER ledger_operations_no_change BEFORE UPDATE OR DELETE ON ledger_operations FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER ledger_operations_no_truncate BEFORE TRUNCATE ON ledger_operations FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER ledger_alerts_no_change BEFORE UPDATE OR DELETE ON ledger_alerts FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER ledger_alerts_no_truncate BEFORE TRUNCATE ON ledger_alerts FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();

CREATE FUNCTION ledger_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='provider_attempts' THEN
    IF ROW(OLD.reservation_id,OLD.user_id,OLD.entitlement_id,OLD.request_id,OLD.provider_id,OLD.model_id,OLD.price_version,OLD.price_snapshot,OLD.reserved_micro_cu,OLD.dispatched_at,OLD.reconciliation_deadline,OLD.synthetic_only)
       IS DISTINCT FROM ROW(NEW.reservation_id,NEW.user_id,NEW.entitlement_id,NEW.request_id,NEW.provider_id,NEW.model_id,NEW.price_version,NEW.price_snapshot,NEW.reserved_micro_cu,NEW.dispatched_at,NEW.reconciliation_deadline,NEW.synthetic_only) THEN
      RAISE EXCEPTION 'Accounting snapshot is append-only' USING ERRCODE='42501';
    END IF;
  ELSE
    IF ROW(OLD.user_id,OLD.kind,OLD.starts_at,OLD.ends_at,OLD.synthetic_only) IS DISTINCT FROM ROW(NEW.user_id,NEW.kind,NEW.starts_at,NEW.ends_at,NEW.synthetic_only) THEN
      RAISE EXCEPTION 'Entitlement terms are append-only' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER provider_attempt_snapshot BEFORE UPDATE ON provider_attempts FOR EACH ROW EXECUTE FUNCTION ledger_snapshot_immutable();
CREATE TRIGGER entitlement_terms_snapshot BEFORE UPDATE ON ledger_entitlements FOR EACH ROW EXECUTE FUNCTION ledger_snapshot_immutable();
