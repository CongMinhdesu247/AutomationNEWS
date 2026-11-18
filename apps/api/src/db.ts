import pg from "pg";
import { logEvent } from "./logger.js";

export type PoolOptions = {
  max?: number;
  statementTimeoutMs?: number;
};

function connectionHasPassword(connectionString: string): boolean {
  try {
    return new URL(connectionString).password.length > 0;
  } catch {
    return false;
  }
}

export function createPool(connectionString: string, options: PoolOptions = {}) {
  const configuredMax = Number(process.env.DB_POOL_MAX ?? 10);
  const max =
    options.max ??
    (Number.isInteger(configuredMax) && configuredMax >= 2 && configuredMax <= 50
      ? configuredMax
      : 10);
  const statementTimeout = options.statementTimeoutMs ?? 5000;
  const fallbackPassword =
    !connectionHasPassword(connectionString) && process.env.PGPASSWORD
      ? { password: process.env.PGPASSWORD }
      : {};
  const pool = new pg.Pool({
    connectionString,
    ...fallbackPassword,
    max,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 30000,
    ...(statementTimeout > 0 ? { statement_timeout: statementTimeout } : {}),
  });
  pool.on("error", (err) => {
    logEvent("warn", "db.pool.idle_error", {
      errorCode:
        "code" in err && typeof err.code === "string" ? err.code : "UNKNOWN",
    });
  });
  return pool;
}
