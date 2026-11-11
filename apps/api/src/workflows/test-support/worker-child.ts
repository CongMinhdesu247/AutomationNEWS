// Test-only entry point. Production worker never enables fixture connectors.
import { createPool } from "../../db.js";
import { WorkflowQueue, WorkerRunner } from "../runtime.js";
const schema = process.env.TEST_SCHEMA;
if (!schema || !/^hub_queue_test_[a-f0-9]{32}$/.test(schema))
  throw new Error("Test schema required.");
const pool = createPool(process.env.TEST_DATABASE_URL!);
pool.options.options = "-c search_path=" + schema;
const controller = new AbortController();
const runner = new WorkerRunner(
  new WorkflowQueue(pool, { leaseMs: 1000, maxRecoveries: 3 }),
  {
    workerId: "kill-test-child",
    concurrency: 3,
    heartbeatMs: 100,
    pollMs: 100,
    shutdownMs: 200,
  },
  {
    http: async () => {
      console.log("FETCH_STARTED");
      return new Promise<never>(() => {});
    },
  },
);
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
try {
  await runner.run(controller.signal);
} finally {
  await pool.end();
}
