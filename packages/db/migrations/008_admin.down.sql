-- Revert Migration 008: Step 2.6 Control Center Foundation
DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON admin_audit_log;
DROP TRIGGER IF EXISTS admin_audit_log_no_change ON admin_audit_log;
DROP TRIGGER IF EXISTS config_revisions_no_truncate ON config_revisions;
DROP TRIGGER IF EXISTS config_revisions_no_change ON config_revisions;
DROP TABLE IF EXISTS admin_audit_log;
DROP TABLE IF EXISTS config_revisions;
DROP TABLE IF EXISTS kill_switches;
DROP TABLE IF EXISTS staff_sessions;
DROP TABLE IF EXISTS staff_users;
DROP TABLE IF EXISTS staff_roles;

ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_check;
ALTER TABLE providers ADD CONSTRAINT providers_check CHECK (adapter_kind <> 'synthetic_mock' OR (base_url IS NULL AND secret_ref IS NULL));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tier_check;
ALTER TABLE users ADD CONSTRAINT users_tier_check CHECK (tier IN ('free', 'premium'));
