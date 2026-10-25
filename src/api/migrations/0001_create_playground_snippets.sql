CREATE TABLE playground_snippets (
  id text PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  content_bytes bigint NOT NULL CHECK (content_bytes >= 0),
  stored_bytes bigint NOT NULL CHECK (stored_bytes >= 0),
  content_sha256 char(64) NOT NULL,
  runtime_version text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready'))
)
