import { createPool } from "../db.js";
import { databaseUrl } from "../env.js";
import { retainHistory } from "./retention.js";
import { retainPremium } from "../premium/retention.js";
import { logEvent } from "../logger.js";

const args = process.argv.slice(2);
const accepted =
  /^(--apply|--premium|--result-days=\d+|--content-days=\d+|--event-days=\d+|--attempt-days=\d+|--batch=\d+)$/;
if (args.some((arg) => !accepted.test(arg)))
  throw new Error(
    "Usage: retention [--apply] [--premium] [--event-days=30] [--attempt-days=90] [--batch=500]",
  );
const number = (name: string, fallback: number) =>
  Number(
    args.find((arg) => arg.startsWith(name + "="))?.split("=")[1] ?? fallback,
  );
const pool = createPool(databaseUrl(), { max: 3, statementTimeoutMs: 30000 });
try {
  if (args.includes("--premium")) {
    console.log(
      JSON.stringify(
        await retainPremium(
          pool,
          args.includes("--apply"),
          number("--content-days", 30),
          number("--batch", 500),
          number("--result-days", 365),
        ),
      ),
    );
  }
  console.log(
    JSON.stringify(
      await retainHistory(pool, {
        apply: args.includes("--apply"),
        eventDays: number("--event-days", 30),
        attemptDays: number("--attempt-days", 90),
        batchSize: number("--batch", 500),
      }),
    ),
  );
} catch (error) {
  logEvent("error", "ops.retention_failed", { error });
  process.exitCode = 1;
} finally {
  await pool.end();
}
