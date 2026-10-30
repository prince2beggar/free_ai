CREATE TABLE registry_metadata (
  area TEXT NOT NULL CHECK (area IN ('provider','model')),
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  data JSONB NOT NULL CHECK (jsonb_typeof(data)='object'),
  PRIMARY KEY(area,target_id)
);
CREATE TABLE registry_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  area TEXT NOT NULL CHECK (area IN ('provider','model')),
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('create','update','rollback','seed')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('LOCAL_RESEARCH_SEED','CONFIGURATION_CHANGE','ELIGIBILITY_UPDATE','EMERGENCY_DISABLE','ROLLBACK')),
  before_data JSONB,
  after_data JSONB NOT NULL,
  request_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(area,target_id,revision),
  UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX registry_versions_target_idx ON registry_versions(area,target_id,revision);
CREATE FUNCTION registry_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registry history is append-only' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER registry_versions_no_change BEFORE UPDATE OR DELETE ON registry_versions
FOR EACH ROW EXECUTE FUNCTION registry_history_immutable();
CREATE TRIGGER registry_versions_no_truncate BEFORE TRUNCATE ON registry_versions
FOR EACH STATEMENT EXECUTE FUNCTION registry_history_immutable();
