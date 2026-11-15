CREATE TABLE hub_users (
 id uuid PRIMARY KEY,
 email text NOT NULL UNIQUE CHECK(email = lower(email)),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
 disabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES hub_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id);
CREATE INDEX user_sessions_expiry_idx ON user_sessions(expires_at);
CREATE TABLE user_settings (
 user_id uuid PRIMARY KEY REFERENCES hub_users(id),
 config jsonb NOT NULL,
 days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
 theme text NOT NULL DEFAULT 'light' CHECK(theme IN ('light','dark')),
 revision integer NOT NULL DEFAULT 1,
 next_run_at timestamptz,
 last_checked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
);
CREATE INDEX user_settings_due_idx ON user_settings(next_run_at) WHERE next_run_at IS NOT NULL;
ALTER TABLE workflow_runs ADD COLUMN user_id uuid REFERENCES hub_users(id);
ALTER TABLE digests ADD COLUMN user_id uuid REFERENCES hub_users(id);
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_schedule_day_key;
CREATE UNIQUE INDEX workflow_runs_user_day_idx ON workflow_runs(user_id,schedule_day) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX workflow_runs_legacy_day_idx ON workflow_runs(schedule_day) WHERE user_id IS NULL;
CREATE INDEX workflow_runs_user_created_idx ON workflow_runs(user_id,created_at DESC,id DESC);
CREATE INDEX digests_user_created_idx ON digests(user_id,created_at DESC,id DESC);
-- Database-backed throttling works across API replicas and restarts.
CREATE TABLE account_rate_limits (
 key text PRIMARY KEY,
 hits integer NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX account_rate_limits_expiry_idx ON account_rate_limits(expires_at);
