import { createPool } from "../db.js";
import { databaseUrl } from "../env.js";
import { retainHistory } from "./retention.js";
const args = process.argv.slice(2);
const accepted = /^(--apply|--event-days=\d+|--attempt-days=\d+|--batch=\d+)$/;
if (args.some((arg) => !accepted.test(arg)))
  throw new Error(
    "Usage: retention [--apply] [--event-days=30] [--attempt-days=90] [--batch=500]",
  );
const number = (name: string, fallback: number) =>
  Number(
    args.find((arg) => arg.startsWith(name + "="))?.split("=")[1] ?? fallback,
  );
const pool = createPool(databaseUrl());
try {
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
} catch {
  console.error("Retention failed; no credentials logged.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
