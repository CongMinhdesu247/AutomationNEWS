import { databaseUrl } from "@hub/api/env";
import { createPool } from "@hub/api/db";
import { WorkflowQueue } from "@hub/api/runtime";
import { DigestScheduler } from "@hub/api/scheduler";
import { numberEnv } from "@hub/api/worker-config";

const pool = createPool(databaseUrl());
const scheduler = new DigestScheduler(
  new WorkflowQueue(pool, {
    sourceTimeoutMs: numberEnv("DIGEST_TIMEOUT_MS", 25000, 1, 45000),
  }),
  {
    ntfyToken: process.env.NTFY_TOKEN,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    ntfyAllowedOrigins: (process.env.NTFY_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value).origin),
    requestTimeoutMs: numberEnv("HTTP_TIMEOUT_MS", 6000, 1, 15000),
    graceMs: numberEnv("SCHEDULER_GRACE_MS", 900000, 0, 3600000),
  },
);
const pollMs = numberEnv("SCHEDULER_POLL_MS", 5000, 100, 60000);
const controller = new AbortController();
let forcedExit: ReturnType<typeof setTimeout> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    controller.abort();
    forcedExit = setTimeout(() => process.exit(0), 20000);
    forcedExit.unref();
  });
console.log("Scheduler đang chạy.");
try {
  while (!controller.signal.aborted) {
    try {
      await scheduler.tick();
      if (!controller.signal.aborted) await scheduler.deliver();
      if (!controller.signal.aborted) await scheduler.checkMarkets();
    } catch {
      console.error("Scheduler chưa xử lý được công việc; sẽ kiểm tra lại.");
    }
    if (!controller.signal.aborted)
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, pollMs);
        controller.signal.addEventListener("abort", finish, { once: true });
        if (controller.signal.aborted) finish();
      });
  }
} finally {
  await pool.end();
  clearTimeout(forcedExit);
}
