import { databaseUrl } from "./env.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
const pool = createPool(databaseUrl());
try {
  await migrate(pool);
  console.log("Migration hoàn tất.");
} catch {
  console.error(
    "Migration thất bại. Kiểm tra cấu hình và tình trạng database.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
