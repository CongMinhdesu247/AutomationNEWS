import { databaseUrl } from "../env.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { buildApp } from "../app.js";
import { WorkflowQueue, WorkerRunner } from "../workflows/runtime.js";
import { DigestScheduler } from "../workflows/schedule.js";
import { fixtureSettings, fixtureClient } from "./fixtures.js";
import { defaultSettings } from "@hub/contracts";
if (
  process.env.PORTFOLIO_FIXTURE !== "1" ||
  new URL(databaseUrl()).pathname !== "/step6"
)
  throw new Error("Fixture server requires isolated step6 database.");
const pool = createPool(databaseUrl());
await migrate(pool);
// Only initialize this dedicated fixture DB. Restart does not overwrite edited demo settings.
await pool.query(
  "UPDATE settings SET config=$1::jsonb WHERE id=1 AND config=$2::jsonb",
  [JSON.stringify(fixtureSettings), JSON.stringify(defaultSettings)],
);
const queue = new WorkflowQueue(pool, {
  leaseMs: 1800,
  maxRetries: 1,
  retryBaseMs: 3000,
  retryMaxMs: 3000,
});
let fixture = fixtureClient(600);
let mode = "success";
let workerAbort: AbortController | undefined;
let task: Promise<void> | undefined;
const http: typeof fixture.http = (...args) => fixture.http(...args);
async function pause() {
  workerAbort?.abort();
  await task;
  task = undefined;
  workerAbort = undefined;
}
function resume() {
  if (task) return;
  workerAbort = new AbortController();
  task = new WorkerRunner(
    queue,
    { concurrency: 3, pollMs: 50, heartbeatMs: 400 },
    { http },
  ).run(workerAbort.signal);
}
const app = buildApp(pool, { http });
const scheduler = new DigestScheduler(queue, { http });
app.get("/api/demo/status", async () => ({
  label: "DEMO FIXTURE — dữ liệu mô phỏng, không gọi dịch vụ thật",
  mode,
  workerRunning: Boolean(task),
  calls: fixture.calls,
  ntfyPosts: fixture.postCalls,
}));
app.post<{ Body: { mode?: string; latencyMs?: number } }>(
  "/api/demo/mode",
  async (request, reply) => {
    const next = request.body?.mode;
    const latency = request.body?.latencyMs ?? 600;
    if (
      !["success", "retry", "dlq"].includes(next ?? "") ||
      !Number.isInteger(latency) ||
      latency < 10 ||
      latency > 5000
    )
      return reply.code(400).send({ error: "mode must be success/retry/dlq" });
    await pause();
    mode = next!;
    fixture = fixtureClient(latency, next as "success" | "retry" | "dlq");
    resume();
    return { mode };
  },
);
app.post("/api/demo/pause", async () => {
  await pause();
  return { paused: true };
});
app.post("/api/demo/resume", async () => {
  resume();
  return { running: true };
});
// Deliberately abandoned claim: no heartbeat or output. Normal lease recovery handles it.
app.post("/api/demo/abandon-lease", async () => {
  if (task) throw new Error("Pause fixture worker first.");
  const claimed = await queue.claim("DEMO-FIXTURE-abandoned-worker");
  return { jobId: claimed?.id, leaseExpiresInMs: 1800 };
});
app.post("/api/demo/schedule-due", async () => {
  await scheduler.tick();
  await pool.query(
    "UPDATE digest_schedule SET next_run_at=clock_timestamp()-interval '1 second' WHERE id=1 AND next_run_at IS NOT NULL",
  );
  const runId = await scheduler.tick();
  return {
    runId: runId ?? (await scheduler.status()).lastRunId,
    created: Boolean(runId),
  };
});
app.post("/api/demo/deliver", async () => {
  await scheduler.deliver();
  return { ntfyPosts: fixture.postCalls };
});
resume();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(
    signal,
    () =>
      void (async () => {
        await pause();
        await app.close();
        await pool.end();
        process.exit(0);
      })(),
  );
await app.listen({ host: "0.0.0.0", port: 3001 });
console.log(
  "DEMO FIXTURE ONLY: all HTTP is synthetic; no external notifications.",
);
