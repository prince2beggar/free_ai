-- Explicitly authorized disposable development databases only.
ALTER TABLE registry_versions DROP CONSTRAINT registry_version_before_size;
ALTER TABLE registry_versions DROP CONSTRAINT registry_version_after_size;
ALTER TABLE registry_metadata DROP CONSTRAINT registry_metadata_size;
