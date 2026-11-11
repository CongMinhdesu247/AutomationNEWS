CREATE TABLE digests (
  id uuid PRIMARY KEY,
  idempotency_key uuid NOT NULL UNIQUE,
  settings_snapshot jsonb NOT NULL CHECK (jsonb_typeof(settings_snapshot) = 'object'),
  status text NOT NULL CHECK (status IN ('running','success','partial','failed')),
  sources jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'running' AND completed_at IS NULL) OR (status <> 'running' AND completed_at IS NOT NULL))
);
CREATE INDEX digests_created_at_idx ON digests (created_at DESC, id DESC);
CREATE TABLE github_snapshots (
  repository_id bigint NOT NULL,
  digest_id uuid NOT NULL REFERENCES digests(id),
  stars bigint NOT NULL CHECK (stars >= 0),
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (repository_id, digest_id)
);
CREATE INDEX github_snapshots_baseline_idx ON github_snapshots (repository_id, fetched_at DESC);
CREATE TABLE notification_attempts (
  id uuid PRIMARY KEY,
  digest_id uuid NOT NULL REFERENCES digests(id),
  idempotency_key uuid NOT NULL,
  destination jsonb NOT NULL CHECK (jsonb_typeof(destination) = 'object'),
  status text NOT NULL CHECK (status IN ('sending','success','failed','unknown')),
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (digest_id, idempotency_key)
);
CREATE INDEX notification_attempts_digest_idx ON notification_attempts (digest_id, created_at DESC);
