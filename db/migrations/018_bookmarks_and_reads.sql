-- 018: Personal saved reading list (bookmarks) and digest read-state tracking.

CREATE TABLE IF NOT EXISTS user_bookmarks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES hub_users(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 160),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
  kind text NOT NULL DEFAULT 'rss' CHECK (kind IN ('rss', 'github', 'custom')),
  digest_id uuid REFERENCES digests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);

CREATE INDEX IF NOT EXISTS user_bookmarks_user_created_idx
  ON user_bookmarks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_digest_reads (
  user_id uuid NOT NULL REFERENCES hub_users(id) ON DELETE CASCADE,
  digest_id uuid NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, digest_id)
);

CREATE INDEX IF NOT EXISTS user_digest_reads_user_idx
  ON user_digest_reads (user_id, read_at DESC);
