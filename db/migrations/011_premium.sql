-- Additive: no existing account, role, settings, schedules or digest is changed.
CREATE TABLE news_plans (
 id text PRIMARY KEY CHECK(id IN ('free','premium')),
 active_watches integer NOT NULL CHECK(active_watches>=0),
 discovery_month integer NOT NULL CHECK(discovery_month>=0),
 ai_calls_month integer NOT NULL CHECK(ai_calls_month>=0),
 min_interval_minutes integer NOT NULL CHECK(min_interval_minutes>=60)
);
INSERT INTO news_plans VALUES ('free',0,0,0,1440),('premium',10,10,30,360);
CREATE TABLE news_entitlements (
 user_id uuid PRIMARY KEY REFERENCES hub_users(id),
 plan_id text NOT NULL DEFAULT 'free' REFERENCES news_plans(id),
 starts_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 granted_by uuid REFERENCES hub_users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(plan_id='free' OR (expires_at IS NOT NULL AND expires_at>starts_at))
);
INSERT INTO news_entitlements(user_id) SELECT id FROM hub_users ON CONFLICT DO NOTHING;
CREATE FUNCTION news_assign_free() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO news_entitlements(user_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END;
$$;
CREATE TRIGGER news_user_free AFTER INSERT ON hub_users FOR EACH ROW EXECUTE FUNCTION news_assign_free();
CREATE TABLE news_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid REFERENCES hub_users(id),
 subject_id uuid REFERENCES hub_users(id),
 action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_audit_subject_idx ON news_audit(subject_id,created_at DESC);
CREATE TABLE news_sources (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 url text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 proposed_by uuid REFERENCES hub_users(id),
 reviewed_by uuid REFERENCES hub_users(id),
 reviewed_at timestamptz,
 fetched_at timestamptz,
 fetch_token uuid,
 lease_until timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_sources_status_idx ON news_sources(status,created_at);
CREATE TABLE news_watches (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES hub_users(id),
 name text NOT NULL,
 description text NOT NULL,
 conditions jsonb NOT NULL,
 source_ids uuid[] NOT NULL,
 interval_minutes integer NOT NULL CHECK(interval_minutes>=60),
 enabled boolean NOT NULL DEFAULT false,
 deleted_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 lookback_days integer NOT NULL DEFAULT 1 CHECK(lookback_days BETWEEN 1 AND 30),
 next_run_at timestamptz,
 last_run_at timestamptz,
 last_success_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,user_id)
);
CREATE INDEX news_watches_user_idx ON news_watches(user_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX news_watches_due_idx ON news_watches(next_run_at) WHERE enabled AND deleted_at IS NULL;
-- Junction enforces valid source references; source_ids preserves ordered form input.
CREATE TABLE news_watch_sources (
 watch_id uuid NOT NULL REFERENCES news_watches(id),
 source_id uuid NOT NULL REFERENCES news_sources(id),
 PRIMARY KEY(watch_id,source_id)
);
CREATE INDEX news_watch_sources_source_idx ON news_watch_sources(source_id);
CREATE TABLE news_articles (
 id uuid PRIMARY KEY,
 url text NOT NULL UNIQUE,
 content_hash text NOT NULL,
 title text NOT NULL,
 description text NOT NULL,
 published_at timestamptz NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_articles_date_idx ON news_articles(published_at DESC);
CREATE TABLE news_source_articles (
 source_id uuid NOT NULL REFERENCES news_sources(id),
 article_id uuid NOT NULL REFERENCES news_articles(id),
 PRIMARY KEY(source_id,article_id)
);
CREATE INDEX news_source_articles_article_idx ON news_source_articles(article_id);
CREATE TABLE news_matches (
 watch_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES hub_users(id),
 article_id uuid NOT NULL REFERENCES news_articles(id),
 source_id uuid NOT NULL REFERENCES news_sources(id),
 condition_version integer NOT NULL,
 reason text NOT NULL,
 saved boolean NOT NULL DEFAULT false,
 hidden boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(watch_id,article_id),
 FOREIGN KEY(watch_id,user_id) REFERENCES news_watches(id,user_id)
);
CREATE INDEX news_matches_user_idx ON news_matches(user_id,created_at DESC);
CREATE TABLE news_preferences (
 user_id uuid PRIMARY KEY REFERENCES hub_users(id),
 include_digest boolean NOT NULL DEFAULT true
);
-- One public item is attached once per user, even when multiple watches match it.
CREATE TABLE news_digest_items (
 user_id uuid NOT NULL REFERENCES hub_users(id),
 article_id uuid NOT NULL REFERENCES news_articles(id),
 digest_id uuid NOT NULL REFERENCES digests(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,article_id)
);
CREATE INDEX news_digest_items_digest_idx ON news_digest_items(digest_id);
CREATE TABLE news_ai_control (
 id integer PRIMARY KEY CHECK(id=1),
 config jsonb NOT NULL
);
INSERT INTO news_ai_control VALUES(1,'{"enabled":false,"searchEnabled":false,"dailyMicros":0,"monthlyMicros":0,"dailyCalls":0,"monthlyTokens":0,"concurrency":1,"provider":"disabled","model":"","pricingVersion":"","inputMicrosPerMillion":0,"outputMicrosPerMillion":0,"timeoutMs":15000}');
CREATE TABLE news_tasks (
 run_id uuid PRIMARY KEY REFERENCES workflow_runs(id),
 user_id uuid NOT NULL REFERENCES hub_users(id),
 watch_id uuid REFERENCES news_watches(id),
 kind text NOT NULL CHECK(kind IN ('watch','interpret','enrich','discover')),
 payload jsonb NOT NULL,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_tasks_user_idx ON news_tasks(user_id,created_at DESC);
CREATE INDEX news_tasks_watch_idx ON news_tasks(watch_id,created_at DESC);
CREATE TABLE news_usage (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL UNIQUE REFERENCES news_tasks(run_id),
 user_id uuid NOT NULL REFERENCES hub_users(id),
 kind text NOT NULL CHECK(kind IN ('interpret','enrich','discover')),
 provider text NOT NULL,
 model text NOT NULL,
 pricing_version text NOT NULL,
 pricing jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('dispatched','completed','unknown')),
 reserved_micros bigint NOT NULL CHECK(reserved_micros>=0),
 reserved_tokens integer NOT NULL CHECK(reserved_tokens>0),
 input_tokens integer CHECK(input_tokens>=0),
 output_tokens integer CHECK(output_tokens>=0),
 search_units integer CHECK(search_units>=0),
 estimated_micros bigint CHECK(estimated_micros>=0),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX news_usage_user_idx ON news_usage(user_id,created_at DESC);
CREATE INDEX news_usage_date_idx ON news_usage(created_at);
CREATE TABLE news_enrichment (
 content_hash text NOT NULL,
 processing_version text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(content_hash,processing_version)
);
