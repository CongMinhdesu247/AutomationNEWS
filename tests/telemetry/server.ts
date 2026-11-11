// Fixture-only server mounted into a separate Docker project; never part of production image.
import { databaseUrl } from "../env.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { buildApp } from "../app.js";
import { WorkflowQueue, WorkerRunner } from "../workflows/runtime.js";
import { defaultSettings } from "@hub/contracts";
const pool = createPool(databaseUrl());
await migrate(pool);
const settings = {
  ...structuredClone(defaultSettings),
  newsletter: { ...defaultSettings.newsletter, enabled: false },
  weather: {
    enabled: true,
    location: "[Fixture] SSE Hà Nội",
    latitude: 21,
    longitude: 105,
  },
};
await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
  JSON.stringify(settings),
]);
const queue = new WorkflowQueue(pool, {
  maxRetries: 1,
  retryBaseMs: 4000,
  leaseMs: 5000,
});
let calls = 0;
const controller = new AbortController();
let task: Promise<void> | undefined;
const worker = new WorkerRunner(
  queue,
  { concurrency: 3, pollMs: 100, heartbeatMs: 500 },
  {
    http: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      calls++;
      return {
        status: calls === 1 ? 503 : 200,
        headers: calls === 1 ? { "retry-after": "4" } : {},
        body: JSON.stringify({
          daily: {
            time: [
              new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Ho_Chi_Minh",
              }).format(new Date()),
            ],
            temperature_2m_min: [22],
            temperature_2m_max: [30],
            precipitation_probability_max: [65],
            weather_code: [61],
          },
        }),
      };
    },
  },
);
const app = buildApp(pool, {}, { pollMs: 100, heartbeatMs: 1000 });
app.post("/__fixture/start", async () => {
  if (!task) {
    const crashed = await queue.claim("fixture-crashed");
    if (crashed) {
      await pool.query(
        "UPDATE workflow_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [crashed.id],
      );
      await queue.recover();
    }
    task = worker.run(controller.signal);
  }
  return { started: true };
});
async function stop() {
  controller.abort();
  await task;
  await app.close();
  await pool.end();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void stop());
await app.listen({ host: "0.0.0.0", port: 3001 });
console.log("Isolated SSE fixture ready; no external integrations.");
