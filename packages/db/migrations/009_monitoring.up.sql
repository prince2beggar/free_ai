-- Migration 009: Step 2.8 Monitoring, Health, and Owner Alerts
-- Tables for owner alerts and delivery attempts

CREATE TABLE owner_alerts (
  id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  kind TEXT NOT NULL CHECK (kind IN ('PROVIDER_OUTAGE', 'CIRCUIT_BREAKER_OPEN', 'CAPACITY_EXHAUSTED', 'ABUSE_CLUSTER', 'UNKNOWN_USAGE_DEADLINE', 'HEALTH_DEGRADED', 'TEST_ALERT')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 2 AND 2048),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED')),
  delivery_channel TEXT NOT NULL DEFAULT 'in_app' CHECK (delivery_channel IN ('webhook', 'in_app', 'email_log', 'sms_log', 'custom')),
  delivery_target TEXT,
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX owner_alerts_status_idx ON owner_alerts(status, created_at DESC);
CREATE INDEX owner_alerts_kind_idx ON owner_alerts(kind, created_at DESC);

CREATE TABLE alert_delivery_attempts (
  id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  alert_id TEXT NOT NULL REFERENCES owner_alerts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILURE')),
  response_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX alert_delivery_attempts_alert_idx ON alert_delivery_attempts(alert_id, attempted_at DESC);

CREATE TRIGGER alert_delivery_attempts_no_change BEFORE UPDATE OR DELETE ON alert_delivery_attempts FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER alert_delivery_attempts_no_truncate BEFORE TRUNCATE ON alert_delivery_attempts FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
