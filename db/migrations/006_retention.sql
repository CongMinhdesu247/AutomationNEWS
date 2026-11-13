ALTER TABLE workflow_runs ADD COLUMN events_pruned_through bigint NOT NULL DEFAULT 0
 CHECK(events_pruned_through>=0 AND events_pruned_through<=event_sequence);
ALTER TABLE node_runs ADD COLUMN attempts_pruned integer NOT NULL DEFAULT 0 CHECK(attempts_pruned>=0);
CREATE INDEX workflow_runs_retention_idx ON workflow_runs(completed_at,id) WHERE status IN ('completed','failed');
