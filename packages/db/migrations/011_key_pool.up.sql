CREATE TABLE IF NOT EXISTS api_key_pool (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  api_key TEXT NOT NULL,
  key_mask TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  requests_used INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_key_pool_provider_status ON api_key_pool(provider, status);
