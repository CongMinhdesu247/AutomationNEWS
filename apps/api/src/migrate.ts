import type { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const directory = new URL("../../../db/migrations/", import.meta.url);

// Historical mixed CRLF/LF checksum produced on Windows before .gitattributes enforced LF.
const LEGACY_EOL_CHECKSUMS: Readonly<Record<string, readonly string[]>> = {
  "006_retention.sql": [
    "b6bd09c9ed990ccd40e90571715fdb8c12596f8431b85e9cf54cdf2252df8862",
  ],
};

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [73142001]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const names = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    for (const name of names) {
      const rawSql = await readFile(new URL(name, directory), "utf8");
      const normalizedLf = rawSql.replace(/\r\n/g, "\n");
      const normalizedCrlf = normalizedLf.replace(/\n/g, "\r\n");
      const canonicalChecksum = sha256(normalizedLf);
      const acceptableChecksums = new Set([
        canonicalChecksum,
        sha256(rawSql),
        sha256(normalizedCrlf),
        ...(LEGACY_EOL_CHECKSUMS[name] ?? []),
      ]);
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [name],
      );
      if (existing.rows[0]) {
        if (!acceptableChecksums.has(existing.rows[0].checksum))
          throw new Error("Migration đã chạy bị chỉnh sửa: " + name);
        if (existing.rows[0].checksum !== canonicalChecksum) {
          await client.query(
            "UPDATE schema_migrations SET checksum = $2 WHERE version = $1",
            [name, canonicalChecksum],
          );
        }
        continue;
      }
      await client.query(normalizedLf);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
        [name, canonicalChecksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
