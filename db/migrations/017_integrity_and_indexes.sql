-- 017: Referential integrity cascades, missing indexes, and defensive constraints.

DROP INDEX IF EXISTS workflow_jobs_ready_idx;

CREATE INDEX IF NOT EXISTS news_articles_fetched_idx ON news_articles(fetched_at);
CREATE INDEX IF NOT EXISTS news_articles_hash_idx ON news_articles(content_hash);
CREATE INDEX IF NOT EXISTS scheduled_deliveries_sending_idx ON scheduled_deliveries(lease_until) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS member_access_expiry_idx ON member_access(expires_at);
CREATE INDEX IF NOT EXISTS dead_letters_replay_run_idx ON dead_letters(replay_run_id) WHERE replay_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS news_audit_actor_idx ON news_audit(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS news_sources_proposed_by_idx ON news_sources(proposed_by) WHERE proposed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS news_sources_reviewed_by_idx ON news_sources(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS news_plan_requests_reviewed_by_idx ON news_plan_requests(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS news_sources_catalog_rank_uidx ON news_sources(catalog_rank) WHERE catalog_rank IS NOT NULL;

-- Break non-deferrable cycle between workflow_runs and digests and allow history pruning.
ALTER TABLE workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_digest_id_fkey,
  ADD CONSTRAINT workflow_runs_digest_id_fkey FOREIGN KEY (digest_id) REFERENCES digests(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  DROP CONSTRAINT IF EXISTS workflow_runs_user_id_fkey,
  ADD CONSTRAINT workflow_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;

ALTER TABLE digests
  DROP CONSTRAINT IF EXISTS digests_workflow_run_id_fkey,
  ADD CONSTRAINT digests_workflow_run_id_fkey FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  DROP CONSTRAINT IF EXISTS digests_user_id_fkey,
  ADD CONSTRAINT digests_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;

ALTER TABLE github_snapshots
  DROP CONSTRAINT IF EXISTS github_snapshots_digest_id_fkey,
  ADD CONSTRAINT github_snapshots_digest_id_fkey FOREIGN KEY (digest_id) REFERENCES digests(id) ON DELETE CASCADE;

ALTER TABLE notification_attempts
  DROP CONSTRAINT IF EXISTS notification_attempts_digest_id_fkey,
  ADD CONSTRAINT notification_attempts_digest_id_fkey FOREIGN KEY (digest_id) REFERENCES digests(id) ON DELETE CASCADE;

ALTER TABLE node_runs
  DROP CONSTRAINT IF EXISTS node_runs_run_id_fkey,
  ADD CONSTRAINT node_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE;

ALTER TABLE workflow_jobs
  DROP CONSTRAINT IF EXISTS workflow_jobs_run_id_node_id_fkey,
  ADD CONSTRAINT workflow_jobs_run_id_node_id_fkey FOREIGN KEY (run_id, node_id) REFERENCES node_runs(run_id, node_id) ON DELETE CASCADE;

ALTER TABLE execution_attempts
  DROP CONSTRAINT IF EXISTS execution_attempts_job_id_fkey,
  ADD CONSTRAINT execution_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES workflow_jobs(id) ON DELETE CASCADE;

ALTER TABLE dead_letters
  DROP CONSTRAINT IF EXISTS dead_letters_job_id_fkey,
  ADD CONSTRAINT dead_letters_job_id_fkey FOREIGN KEY (job_id) REFERENCES workflow_jobs(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS dead_letters_replay_run_id_fkey,
  ADD CONSTRAINT dead_letters_replay_run_id_fkey FOREIGN KEY (replay_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL;

ALTER TABLE digest_schedule
  DROP CONSTRAINT IF EXISTS digest_schedule_last_run_id_fkey,
  ADD CONSTRAINT digest_schedule_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL;

ALTER TABLE scheduled_deliveries
  DROP CONSTRAINT IF EXISTS scheduled_deliveries_digest_id_fkey,
  ADD CONSTRAINT scheduled_deliveries_digest_id_fkey FOREIGN KEY (digest_id) REFERENCES digests(id) ON DELETE CASCADE;

ALTER TABLE run_events
  DROP CONSTRAINT IF EXISTS run_events_run_id_fkey,
  ADD CONSTRAINT run_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS run_events_run_id_node_id_fkey,
  ADD CONSTRAINT run_events_run_id_node_id_fkey FOREIGN KEY (run_id, node_id) REFERENCES node_runs(run_id, node_id) ON DELETE CASCADE;

-- User & Premium cascades so user accounts and watches can be cleanly deleted without orphan locks.
ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_user_id_fkey,
  ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;

ALTER TABLE news_entitlements
  DROP CONSTRAINT IF EXISTS news_entitlements_user_id_fkey,
  ADD CONSTRAINT news_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_entitlements_granted_by_fkey,
  ADD CONSTRAINT news_entitlements_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES hub_users(id) ON DELETE SET NULL;

ALTER TABLE news_audit
  DROP CONSTRAINT IF EXISTS news_audit_actor_id_fkey,
  ADD CONSTRAINT news_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES hub_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS news_audit_subject_id_fkey,
  ADD CONSTRAINT news_audit_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES hub_users(id) ON DELETE SET NULL;

ALTER TABLE news_sources
  DROP CONSTRAINT IF EXISTS news_sources_proposed_by_fkey,
  ADD CONSTRAINT news_sources_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES hub_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS news_sources_reviewed_by_fkey,
  ADD CONSTRAINT news_sources_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES hub_users(id) ON DELETE SET NULL;

ALTER TABLE news_watches
  DROP CONSTRAINT IF EXISTS news_watches_user_id_fkey,
  ADD CONSTRAINT news_watches_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;

ALTER TABLE news_watch_sources
  DROP CONSTRAINT IF EXISTS news_watch_sources_watch_id_fkey,
  ADD CONSTRAINT news_watch_sources_watch_id_fkey FOREIGN KEY (watch_id) REFERENCES news_watches(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_watch_sources_source_id_fkey,
  ADD CONSTRAINT news_watch_sources_source_id_fkey FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE CASCADE;

ALTER TABLE news_source_articles
  DROP CONSTRAINT IF EXISTS news_source_articles_source_id_fkey,
  ADD CONSTRAINT news_source_articles_source_id_fkey FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_source_articles_article_id_fkey,
  ADD CONSTRAINT news_source_articles_article_id_fkey FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE;

ALTER TABLE news_matches
  DROP CONSTRAINT IF EXISTS news_matches_user_id_fkey,
  ADD CONSTRAINT news_matches_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_matches_article_id_fkey,
  ADD CONSTRAINT news_matches_article_id_fkey FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_matches_source_id_fkey,
  ADD CONSTRAINT news_matches_source_id_fkey FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_matches_watch_id_user_id_fkey,
  ADD CONSTRAINT news_matches_watch_id_user_id_fkey FOREIGN KEY (watch_id, user_id) REFERENCES news_watches(id, user_id) ON DELETE CASCADE;

ALTER TABLE news_preferences
  DROP CONSTRAINT IF EXISTS news_preferences_user_id_fkey,
  ADD CONSTRAINT news_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;

ALTER TABLE news_digest_items
  DROP CONSTRAINT IF EXISTS news_digest_items_user_id_fkey,
  ADD CONSTRAINT news_digest_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_digest_items_article_id_fkey,
  ADD CONSTRAINT news_digest_items_article_id_fkey FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_digest_items_digest_id_fkey,
  ADD CONSTRAINT news_digest_items_digest_id_fkey FOREIGN KEY (digest_id) REFERENCES digests(id) ON DELETE CASCADE;

ALTER TABLE news_tasks
  DROP CONSTRAINT IF EXISTS news_tasks_run_id_fkey,
  ADD CONSTRAINT news_tasks_run_id_fkey FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_tasks_user_id_fkey,
  ADD CONSTRAINT news_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_tasks_watch_id_fkey,
  ADD CONSTRAINT news_tasks_watch_id_fkey FOREIGN KEY (watch_id) REFERENCES news_watches(id) ON DELETE SET NULL;

-- Preserve financial AI/search spend ledger rows across user or run deletion.
ALTER TABLE news_usage
  ALTER COLUMN run_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS news_usage_status_check,
  ADD CONSTRAINT news_usage_status_check CHECK (status IN ('dispatched', 'completed', 'unknown', 'rejected')),
  DROP CONSTRAINT IF EXISTS news_usage_run_id_fkey,
  ADD CONSTRAINT news_usage_run_id_fkey FOREIGN KEY (run_id) REFERENCES news_tasks(run_id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS news_usage_user_id_fkey,
  ADD CONSTRAINT news_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE SET NULL;

ALTER TABLE news_plan_requests
  DROP CONSTRAINT IF EXISTS news_plan_requests_user_id_fkey,
  ADD CONSTRAINT news_plan_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS news_plan_requests_reviewed_by_fkey,
  ADD CONSTRAINT news_plan_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES hub_users(id) ON DELETE SET NULL;

-- Normalize any pre-existing rows before adding defensive constraints.
UPDATE user_settings
SET days = COALESCE(ARRAY(SELECT DISTINCT v FROM unnest(days) AS v ORDER BY v), ARRAY[]::smallint[])
WHERE days IS NOT NULL;

UPDATE news_plan_requests
SET review_note = left(review_note, 500)
WHERE review_note IS NOT NULL AND length(review_note) > 500;

-- Prevent duplicate weekday values in user_settings.days and enforce bounded text/JSONB objects.
CREATE OR REPLACE FUNCTION hub_unique_smallints(arr smallint[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*) = count(DISTINCT v) FROM unnest(arr) AS v;
$$;

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_unique_days_chk,
  ADD CONSTRAINT user_settings_unique_days_chk CHECK (hub_unique_smallints(days)),
  DROP CONSTRAINT IF EXISTS user_settings_config_obj_chk,
  ADD CONSTRAINT user_settings_config_obj_chk CHECK (jsonb_typeof(config) = 'object');

ALTER TABLE news_plan_requests
  DROP CONSTRAINT IF EXISTS news_plan_requests_review_note_len_chk,
  ADD CONSTRAINT news_plan_requests_review_note_len_chk CHECK (review_note IS NULL OR length(review_note) <= 500);
