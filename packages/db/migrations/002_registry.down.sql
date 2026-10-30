-- Explicitly authorized disposable development databases only.
DROP TABLE registry_versions;
DROP TABLE registry_metadata;
DROP FUNCTION registry_history_immutable();
