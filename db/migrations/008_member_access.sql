-- Capability tokens are stored as SHA-256 hashes; config backups exclude them.
CREATE TABLE member_access (
  profile_id text PRIMARY KEY CHECK (profile_id ~ '^[a-zA-Z0-9_-]{1,40}$'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
