import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import pg from "pg";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { WorkflowQueue, WorkerRunner } from "../workflows/runtime.js";
import { buildApp } from "../app.js";
import { fixtureSettings, fixtureClient } from "./fixtures.js";
import { retainHistory } from "./retention.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
const schema = "hub_retention_" + crypto.randomUUID().replaceAll("-", "");
const admin = createPool(url);
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  statement_timeout: 5000,
});
const queue = new WorkflowQueue(pool, { maxRetries: 0 });
const worker = new WorkerRunner(queue, {}, { http: fixtureClient(1).http });
const app = buildApp(pool, {}, { pollMs: 10 });
let base = "";
beforeAll(async () => {
  await admin.query("CREATE SCHEMA " + schema);
  await migrate(pool);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
}, 30000);
beforeEach(async () => {
  await pool.query("TRUNCATE workflow_runs,digests CASCADE");
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(fixtureSettings),
  ]);
});
afterAll(async () => {
  await app.close();
  await pool.end();
  await admin.query("DROP SCHEMA " + schema + " CASCADE");
  await admin.end();
});
async function completed() {
  const { runId } = await queue.submit(crypto.randomUUID(), {});
  while (await worker.tick()) {}
  return runId;
}
async function age(id: string) {
  await pool.query(
    "UPDATE workflow_runs SET completed_at=clock_timestamp()-interval '100 days' WHERE id=$1",
    [id],
  );
}
it("defaults dry-run, bounds each batch, preserves active runs and attempt totals, resets expired SSE cursors", async () => {
  const old = await completed();
  const recent = await completed();
  const active = (await queue.submit(crypto.randomUUID(), {})).runId;
  await queue.claim("still-working");
  await age(old);
  await age(active);
  const snapshot = (await queue.get(old))!;
  const activeBefore = (await queue.get(active))!;
  const recentBefore = (await queue.get(recent))!;
  expect((await retainHistory(pool, { batchSize: 3 })).mode).toBe("dry-run");
  expect(await queue.get(old)).toEqual(snapshot);
  const batch = await retainHistory(pool, { apply: true, batchSize: 3 });
  expect(batch.events).toBe(3);
  expect(batch.attempts).toBe(3);
  const after = (await queue.get(old))!;
  expect(after.recentEvents.length).toBe(snapshot.recentEvents.length - 3);
  expect(after.nodes.map((node) => node.attempts)).toEqual(
    snapshot.nodes.map((node) => node.attempts),
  );
  expect(after.eventsTruncated).toBe(true);
  expect(after.eventCursor).toBe(snapshot.eventCursor);
  const expired = await fetch(
    base + "/api/runs/" + old + "/events?cursor=" + old + ":0",
    { signal: AbortSignal.timeout(3000) },
  );
  expect(await expired.text()).toContain("CURSOR_EXPIRED");
  for (let i = 0; i < 20; i++) {
    const batch = await retainHistory(pool, { apply: true, batchSize: 3 });
    if (!batch.events && !batch.attempts) break;
  }
  expect((await queue.get(old))!.recentEvents).toEqual([]);
  expect((await queue.get(old))!.nodes.map((node) => node.attempts)).toEqual(
    snapshot.nodes.map((node) => node.attempts),
  );
  expect(await queue.get(active)).toEqual(activeBefore);
  expect(await queue.get(recent)).toEqual(recentBefore);
  const synced = await fetch(
    base +
      "/api/runs/" +
      old +
      "/events?cursor=" +
      encodeURIComponent(snapshot.eventCursor),
    { signal: AbortSignal.timeout(3000) },
  );
  expect(await synced.text()).toContain('"terminal":true');
  const digestId = snapshot.digestId;
  expect(
    (await pool.query("SELECT id FROM digests WHERE id=$1", [digestId]))
      .rowCount,
  ).toBe(1);
});
it("rollback restores deleted rows and watermark if cleanup fails", async () => {
  const id = await completed();
  await age(id);
  const before = await queue.get(id);
  await pool.query(
    "CREATE FUNCTION reject_retention() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture rollback'; END$$",
  );
  await pool.query(
    "CREATE TRIGGER reject_retention BEFORE UPDATE OF events_pruned_through ON workflow_runs FOR EACH ROW EXECUTE FUNCTION reject_retention()",
  );
  try {
    await expect(retainHistory(pool, { apply: true })).rejects.toThrow();
    expect(await queue.get(id)).toEqual(before);
  } finally {
    await pool.query("DROP TRIGGER reject_retention ON workflow_runs");
    await pool.query("DROP FUNCTION reject_retention()");
  }
});
it("concurrent cleanup has unique bounded work without touching active attempts", async () => {
  const id = await completed();
  await age(id);
  const before = (await queue.get(id))!;
  const result = await Promise.all([
    retainHistory(pool, { apply: true, batchSize: 2 }),
    retainHistory(pool, { apply: true, batchSize: 2 }),
  ]);
  const removed = result.reduce((n, row) => n + row.events, 0);
  expect(removed).toBeGreaterThanOrEqual(2);
  expect(removed).toBeLessThanOrEqual(4);
  expect((await queue.get(id))!.recentEvents.length).toBe(
    before.recentEvents.length - removed,
  );
});
it("rejects unsafe or unbounded options", async () => {
  for (const options of [
    { batchSize: 0 },
    { batchSize: 1001 },
    { eventDays: 0 },
    { attemptDays: NaN },
  ])
    await expect(retainHistory(pool, options)).rejects.toThrow();
});
