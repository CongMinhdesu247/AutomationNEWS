CREATE TABLE workflow_runs (
 id uuid PRIMARY KEY,
 idempotency_key uuid NOT NULL UNIQUE,
 request_payload jsonb NOT NULL,
 workflow jsonb NOT NULL,
 settings_snapshot jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','completed','failed')),
 digest_id uuid UNIQUE REFERENCES digests(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 completed_at timestamptz,
 error jsonb
);
CREATE INDEX workflow_runs_created_idx ON workflow_runs(created_at DESC,id DESC);
CREATE TABLE node_runs (
 run_id uuid NOT NULL REFERENCES workflow_runs(id),
 node_id text NOT NULL,
 type text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','queued','running','succeeded','failed','skipped')),
 input jsonb,
 output jsonb,
 error jsonb,
 started_at timestamptz,
 completed_at timestamptz,
 PRIMARY KEY(run_id,node_id)
);
CREATE TABLE workflow_jobs (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL,
 node_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','leased','done','failed')),
 worker_id text,
 lease_until timestamptz,
 claim_token uuid,
 recoveries integer NOT NULL DEFAULT 0 CHECK(recoveries>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(run_id,node_id) REFERENCES node_runs(run_id,node_id),
 UNIQUE(run_id,node_id),
 CHECK((status='leased' AND worker_id IS NOT NULL AND lease_until IS NOT NULL AND claim_token IS NOT NULL) OR (status<>'leased' AND worker_id IS NULL AND lease_until IS NULL AND claim_token IS NULL))
);
CREATE INDEX workflow_jobs_ready_idx ON workflow_jobs(created_at,id) WHERE status='queued';
CREATE INDEX workflow_jobs_expired_idx ON workflow_jobs(lease_until,id) WHERE status='leased';
CREATE TABLE execution_attempts (
 id uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES workflow_jobs(id),
 claim_token uuid NOT NULL UNIQUE,
 worker_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','succeeded','failed','skipped','interrupted')),
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 error jsonb
);
CREATE INDEX execution_attempts_job_idx ON execution_attempts(job_id,started_at DESC);
ALTER TABLE digests ADD COLUMN workflow_run_id uuid UNIQUE REFERENCES workflow_runs(id);
