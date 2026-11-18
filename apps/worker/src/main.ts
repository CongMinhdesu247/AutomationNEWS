import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseUrl } from "@hub/api/env";
import { createPool } from "@hub/api/db";
import { WorkflowQueue, WorkerRunner } from "@hub/api/runtime";
import { workerConfig, numberEnv } from "@hub/api/worker-config";

const heartbeatFile = join(tmpdir(), "hub-worker.ready");
async function touchHeartbeat() {
  try {
    await writeFile(heartbeatFile, String(Date.now()));
  } catch {
    // Ignore read-only tmp fallback errors.
  }
}

const config = workerConfig();
const pool = createPool(databaseUrl(), {
  max: Math.max(10, config.concurrency + 4),
});
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
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, stop);

await touchHeartbeat();
const livenessInterval = setInterval(() => {
  if (!controller.signal.aborted) void touchHeartbeat();
}, 10000);
livenessInterval.unref();

console.log("Worker đang chạy.");
try {
  await worker.run(controller.signal);
} catch (error) {
  const code = error instanceof Error ? error.name : "UNKNOWN";
  console.error(`Worker dừng do lỗi nội bộ (${code}).`);
  process.exitCode = 1;
} finally {
  clearInterval(livenessInterval);
  await pool.end();
  clearTimeout(forcedExit);
}
