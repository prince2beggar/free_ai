-- A separate migration preserves already applied migration 002 checksums.
ALTER TABLE registry_metadata ADD CONSTRAINT registry_metadata_size
  CHECK (octet_length(data::text) <= 65536);
ALTER TABLE registry_versions ADD CONSTRAINT registry_version_after_size
  CHECK (octet_length(after_data::text) <= 65536);
ALTER TABLE registry_versions ADD CONSTRAINT registry_version_before_size
  CHECK (before_data IS NULL OR octet_length(before_data::text) <= 65536);
