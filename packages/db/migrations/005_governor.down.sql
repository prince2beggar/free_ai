-- Explicitly authorized disposable test databases only.
DROP TABLE capacity_fair_share;
DROP TABLE capacity_job_runs;
DROP TABLE capacity_events;
DROP TABLE capacity_operations;
DROP TABLE capacity_allocations;
DROP TABLE capacity_reservations;
DROP TABLE capacity_counters;
DROP TABLE capacity_routes;
DROP TABLE capacity_limits;
DROP TABLE capacity_pools;
DROP TABLE capacity_storage_guard;
DROP FUNCTION capacity_pool_definition_immutable();
