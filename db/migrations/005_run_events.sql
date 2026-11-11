ALTER TABLE workflow_runs ADD COLUMN event_sequence bigint NOT NULL DEFAULT 0 CHECK (event_sequence >= 0);
CREATE TABLE run_events (
 run_id uuid NOT NULL REFERENCES workflow_runs(id),
 sequence bigint NOT NULL CHECK(sequence > 0),
 type text NOT NULL CHECK(type IN ('run.created','run.started','run.completed','run.failed','node.queued','node.started','node.succeeded','node.failed','node.skipped','node.retry_scheduled','job.recovered')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 node_id text,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=4096),
 PRIMARY KEY(run_id,sequence),
 FOREIGN KEY(run_id,node_id) REFERENCES node_runs(run_id,node_id)
);
