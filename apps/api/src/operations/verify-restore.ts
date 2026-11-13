import pg from "pg";
const source = process.env.TEST_DATABASE_URL,
  target = process.env.RESTORE_DATABASE_URL;
if (!source || !target)
  throw new Error("TEST_DATABASE_URL and RESTORE_DATABASE_URL required");
const targetUrl = new URL(target);
if (!/^\/hub_restore_[a-z0-9_]+$/.test(targetUrl.pathname) || source === target)
  throw new Error("Target must be a separate hub_restore_ database");
const first = new pg.Pool({ connectionString: source }),
  second = new pg.Pool({ connectionString: target });
const tables = [
  "schema_migrations",
  "settings",
  "digests",
  "github_snapshots",
  "notification_attempts",
  "workflow_runs",
  "node_runs",
  "workflow_jobs",
  "execution_attempts",
  "dead_letters",
  "digest_schedule",
  "scheduled_deliveries",
  "run_events",
];
try {
  for (const table of tables) {
    const sql = `SELECT count(*)::int AS rows,md5(coalesce(string_agg(row::text,E'\\n' ORDER BY row::text),'')) AS hash FROM (SELECT to_jsonb(t) AS row FROM ${table} t) s`;
    const a = (await first.query(sql)).rows[0],
      b = (await second.query(sql)).rows[0];
    if (a.rows !== b.rows || a.hash !== b.hash)
      throw new Error("Restore mismatch: " + table);
    console.log(JSON.stringify({ table, rows: a.rows, match: true }));
  }
} finally {
  await first.end();
  await second.end();
}
