ALTER TABLE workflow_jobs ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count>=0);
ALTER TABLE workflow_jobs ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX workflow_jobs_due_idx ON workflow_jobs(available_at,run_id) WHERE status='queued';
ALTER TABLE workflow_runs ADD COLUMN scheduled_at timestamptz;
ALTER TABLE workflow_runs ADD COLUMN schedule_day text UNIQUE;

CREATE TABLE dead_letters (
 id uuid PRIMARY KEY,
 job_id uuid NOT NULL UNIQUE REFERENCES workflow_jobs(id),
 error jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 replay_run_id uuid REFERENCES workflow_runs(id)
);
CREATE INDEX dead_letters_created_idx ON dead_letters(created_at DESC,id DESC);

CREATE TABLE digest_schedule (
 id smallint PRIMARY KEY CHECK(id=1),
 configuration jsonb,
 next_run_at timestamptz,
 last_run_id uuid REFERENCES workflow_runs(id),
 last_checked_at timestamptz
);
INSERT INTO digest_schedule(id) VALUES(1);

CREATE TABLE scheduled_deliveries (
 id uuid PRIMARY KEY,
 digest_id uuid NOT NULL UNIQUE REFERENCES digests(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','success','failed','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 lease_until timestamptz,
 error jsonb
);
CREATE INDEX scheduled_deliveries_pending_idx ON scheduled_deliveries(created_at,id) WHERE status='pending';
