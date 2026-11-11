import { databaseUrl } from "@hub/api/env";
import { createPool } from "@hub/api/db";
import { WorkflowQueue, WorkerRunner } from "@hub/api/runtime";
import { workerConfig, numberEnv } from "@hub/api/worker-config";
const config = workerConfig();
const pool = createPool(databaseUrl());
const controller = new AbortController();
const worker = new WorkerRunner(new WorkflowQueue(pool, config), config, {
  githubToken: process.env.GITHUB_TOKEN,
  requestTimeoutMs: numberEnv("HTTP_TIMEOUT_MS", 6000, 1, 15000),
});
let forcedExit: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (controller.signal.aborted) return;
  controller.abort();
  forcedExit = setTimeout(() => process.exit(0), config.shutdownMs + 2000);
  forcedExit.unref();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
console.log("Worker đang chạy.");
try {
  await worker.run(controller.signal);
} catch {
  console.error("Worker dừng do lỗi nội bộ.");
  process.exitCode = 1;
} finally {
  await pool.end();
  clearTimeout(forcedExit);
}
