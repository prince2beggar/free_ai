DROP TABLE router_events;
DROP TABLE router_accounting_holds;
DROP TABLE router_breakers;
DROP TABLE router_attempts;
DROP TABLE router_daily_counters;
DROP TABLE router_requests;
DROP TABLE router_policy_versions;
DROP TABLE routing_policies;
DROP TABLE router_storage_guard;
ALTER TABLE messages DROP CONSTRAINT messages_router_provenance;
-- Refuse downgrade if new empty/no-dispatch rows cannot satisfy the earlier contract.
ALTER TABLE messages ADD CONSTRAINT messages_check CHECK(role<>'assistant' OR (provider_id IS NOT NULL AND model_id IS NOT NULL AND routing_record_id IS NOT NULL AND request_id IS NOT NULL));
ALTER TABLE usage_events DROP CONSTRAINT usage_events_router_cost;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_cost_micro_cu_check CHECK(cost_micro_cu=0);
ALTER TABLE routing_records DROP CONSTRAINT routing_records_router_attempts;
ALTER TABLE routing_records ADD CONSTRAINT routing_records_attempt_count_check CHECK(attempt_count=1);
