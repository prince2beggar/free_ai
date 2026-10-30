-- Disposable test databases only; persistent ledger rollback uses new evidence.
DROP TABLE ledger_alerts;
DROP TABLE ledger_operations;
ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_commit_entry_id_fkey;
DROP TABLE usage_ledger;
DROP TABLE provider_attempts;
DROP TABLE ledger_reservations;
DROP TABLE ledger_entitlements;
DROP TABLE ledger_storage_guard;
DROP FUNCTION ledger_snapshot_immutable();
