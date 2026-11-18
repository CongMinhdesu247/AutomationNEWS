import { databaseUrl } from "./env.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { logEvent } from "./logger.js";

// Disable 5s statement_timeout during DDL/index migrations on large tables.
const pool = createPool(databaseUrl(), { max: 2, statementTimeoutMs: 0 });
try {
  await migrate(pool);
  logEvent("info", "db.migrate.completed");
} catch (error) {
  logEvent("error", "db.migrate.failed", { error });
  process.exitCode = 1;
} finally {
  await pool.end();
}
