CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  sanitized_name TEXT NOT NULL CHECK (length(sanitized_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'text/plain', 'text/csv')),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_path TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  text_chars INTEGER NOT NULL CHECK (text_chars >= 0),
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens >= 0),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'processing', 'failed', 'deleted')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE (id, user_id)
);
CREATE INDEX files_user_created_idx ON files(user_id, created_at DESC);
