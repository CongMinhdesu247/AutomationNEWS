import type { Pool } from "pg";
export type RetentionOptions = {
  eventDays?: number;
  attemptDays?: number;
  batchSize?: number;
  apply?: boolean;
};
// One terminal run per transaction; at most batch rows per category.
export async function retainHistory(
  pool: Pool,
  options: RetentionOptions = {},
) {
  const eventDays = options.eventDays ?? 30,
    attemptDays = options.attemptDays ?? 90,
    batch = options.batchSize ?? 500;
  if (
    !Number.isInteger(eventDays) ||
    eventDays < 1 ||
    eventDays > 36500 ||
    !Number.isInteger(attemptDays) ||
    attemptDays < 1 ||
    attemptDays > 36500 ||
    !Number.isInteger(batch) ||
    batch < 1 ||
    batch > 1000
  )
    throw new Error("Retention: days 1–36500; batch 1–1000.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='2s'");
    const run = (
      await client.query(
        `SELECT r.id,
   r.completed_at<clock_timestamp()-($1*interval '1 day') AS events_due,
   r.completed_at<clock_timestamp()-($2*interval '1 day') AS attempts_due
   FROM workflow_runs r WHERE r.status IN ('completed','failed') AND (
    (r.completed_at<clock_timestamp()-($1*interval '1 day') AND EXISTS(SELECT 1 FROM run_events e WHERE e.run_id=r.id)) OR
    (r.completed_at<clock_timestamp()-($2*interval '1 day') AND EXISTS(SELECT 1 FROM execution_attempts a JOIN workflow_jobs j ON j.id=a.job_id WHERE j.run_id=r.id AND a.status<>'running'))
   ) ORDER BY r.completed_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
        [eventDays, attemptDays],
      )
    ).rows[0];
    let events = 0,
      attempts = 0;
    if (run?.events_due) {
      const rows = await client.query(
        "SELECT sequence::text FROM run_events WHERE run_id=$1 ORDER BY run_events.sequence LIMIT $2",
        [run.id, batch],
      );
      events = rows.rowCount ?? 0;
      if (options.apply && events) {
        const through = rows.rows.at(-1)!.sequence;
        await client.query(
          "DELETE FROM run_events WHERE run_id=$1 AND sequence<=$2",
          [run.id, through],
        );
        await client.query(
          "UPDATE workflow_runs SET events_pruned_through=greatest(events_pruned_through,$2) WHERE id=$1",
          [run.id, through],
        );
      }
    }
    if (run?.attempts_due) {
      const rows = await client.query(
        "SELECT a.id,j.node_id FROM execution_attempts a JOIN workflow_jobs j ON j.id=a.job_id WHERE j.run_id=$1 AND a.status<>'running' ORDER BY a.started_at,a.id LIMIT $2",
        [run.id, batch],
      );
      attempts = rows.rowCount ?? 0;
      if (options.apply && attempts) {
        await client.query(
          "DELETE FROM execution_attempts WHERE id=ANY($1::uuid[])",
          [rows.rows.map((row) => row.id)],
        );
        const counts = new Map<string, number>();
        for (const row of rows.rows)
          counts.set(row.node_id, (counts.get(row.node_id) ?? 0) + 1);
        for (const [node, count] of counts)
          await client.query(
            "UPDATE node_runs SET attempts_pruned=attempts_pruned+$3 WHERE run_id=$1 AND node_id=$2",
            [run.id, node, count],
          );
      }
    }
    await client.query(options.apply ? "COMMIT" : "ROLLBACK");
    return {
      mode: options.apply ? "apply" : "dry-run",
      batchSize: batch,
      eventDays,
      attemptDays,
      events,
      attempts,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
