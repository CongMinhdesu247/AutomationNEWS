CREATE TABLE IF NOT EXISTS web_push_config (
  id smallint PRIMARY KEY CHECK (id = 1),
  public_key text NOT NULL CHECK (char_length(public_key) BETWEEN 60 AND 160),
  private_jwk jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_web_push_subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES hub_users(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (char_length(endpoint) BETWEEN 16 AND 2048),
  p256dh text NOT NULL CHECK (char_length(p256dh) BETWEEN 40 AND 200),
  auth text NOT NULL CHECK (char_length(auth) BETWEEN 12 AND 100),
  user_agent text NOT NULL DEFAULT '' CHECK (char_length(user_agent) <= 260),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS user_web_push_subscriptions_user_idx
  ON user_web_push_subscriptions (user_id, created_at DESC);
