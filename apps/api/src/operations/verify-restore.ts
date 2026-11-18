import pg from "pg";
import { createPool } from "../db.js";

const source = process.env.TEST_DATABASE_URL;
const target = process.env.RESTORE_DATABASE_URL;

if (!source || !target) {
  throw new Error("TEST_DATABASE_URL and RESTORE_DATABASE_URL required");
}
const targetUrl = new URL(target);
if (
  !/^\/hub_restore_[a-z0-9_]+$/.test(targetUrl.pathname) ||
  source === target
) {
  throw new Error("Target must be a separate hub_restore_ database");
}

const first = createPool(source, { statementTimeoutMs: 30000 });
const second = createPool(target, { statementTimeoutMs: 30000 });

function quoteIdent(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error("Unsafe table identifier: " + identifier);
  }
  return pg.escapeIdentifier(identifier);
}

try {
  const [sourceTables, targetTables] = await Promise.all([
    first.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    ),
    second.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    ),
  ]);
  const firstNames = sourceTables.rows.map((r) => r.tablename);
  const secondNames = targetTables.rows.map((r) => r.tablename);
  if (
    firstNames.length === 0 ||
    firstNames.join(",") !== secondNames.join(",")
  ) {
    throw new Error(
      `Restore table set mismatch (${firstNames.length} vs ${secondNames.length})`,
    );
  }
  for (const table of firstNames) {
    const ident = quoteIdent(table);
    const sql = `SELECT count(*)::int AS rows, md5(coalesce(string_agg(row::text, E'\\n' ORDER BY row::text), '')) AS hash FROM (SELECT to_jsonb(t) AS row FROM ${ident} t) s`;
    const [aRes, bRes] = await Promise.all([first.query(sql), second.query(sql)]);
    const a = aRes.rows[0];
    const b = bRes.rows[0];
    if (!a || !b || a.rows !== b.rows || a.hash !== b.hash) {
      throw new Error("Restore mismatch: " + table);
    }
    console.log(JSON.stringify({ table, rows: a.rows, match: true }));
  }
} finally {
  await first.end();
  await second.end();
}
