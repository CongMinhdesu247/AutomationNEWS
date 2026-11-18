import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseUrl } from "@hub/api/env";
import { createPool } from "@hub/api/db";
import { WorkflowQueue } from "@hub/api/runtime";
import { DigestScheduler } from "@hub/api/scheduler";
import { numberEnv } from "@hub/api/worker-config";

const heartbeatFile = join(tmpdir(), "hub-scheduler.ready");
async function touchHeartbeat() {
  try {
    await writeFile(heartbeatFile, String(Date.now()));
  } catch {
    // Ignore read-only tmp fallback errors.
  }
}

const pool = createPool(databaseUrl());
const primaryNtfyOrigin = new URL(
  process.env.ACCOUNT_NTFY_URL ?? "https://ntfy.sh/",
).origin;
const allowedOrigins = (process.env.NTFY_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => new URL(value).origin);
const destinationOrigins = [
  ...new Set([primaryNtfyOrigin, ...allowedOrigins]),
];
const tokenOrigins = process.env.NTFY_AUTH_ORIGIN
  ? [new URL(process.env.NTFY_AUTH_ORIGIN).origin]
  : [primaryNtfyOrigin];

const scheduler = new DigestScheduler(
  new WorkflowQueue(pool, {
    sourceTimeoutMs: numberEnv("DIGEST_TIMEOUT_MS", 25000, 1, 45000),
  }),
  {
    ntfyToken: process.env.NTFY_TOKEN,
    ntfyDestinationOrigins: destinationOrigins,
    ntfyTokenOrigins: tokenOrigins,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    ntfyAllowedOrigins: allowedOrigins,
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

async function runIsolated(name: string, task: () => Promise<unknown>): Promise<boolean> {
  if (controller.signal.aborted) return false;
  try {
    await task();
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.name : "UNKNOWN";
    console.error(
      `Scheduler [${name}] gặp lỗi (${code}); tiếp tục các nhánh còn lại.`,
    );
    return false;
  }
}

console.log("Scheduler đang chạy.");
await touchHeartbeat();
try {
  while (!controller.signal.aborted) {
    const results = [
      await runIsolated("legacy-tick", () => scheduler.tick()),
      await runIsolated("accounts-tick", () => scheduler.tickAccounts()),
      await runIsolated("deliveries", () => scheduler.deliver()),
      await runIsolated("custom-watches", () => scheduler.tickCustom()),
      await runIsolated("market-monitor", () => scheduler.checkMarkets()),
    ];
    if (results.some(Boolean)) {
      await touchHeartbeat();
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
