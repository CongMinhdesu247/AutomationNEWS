import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fetchRss } from "../connectors/rss.js";
import { safeHttp, type HttpClient } from "../connectors/http.js";
// Only approved public feeds enter this shared cache; account RSS settings are never imported.
export async function refreshSource(
  pool: Pool,
  id: string,
  signal: AbortSignal,
  http: HttpClient = safeHttp,
) {
  const token = crypto.randomUUID();
  const source = (
    await pool.query(
      `UPDATE news_sources SET fetch_token=$2,lease_until=now()+interval '40 seconds'
    WHERE id=$1 AND status='approved' AND (lease_until IS NULL OR lease_until<now())
    AND (fetched_at IS NULL OR fetched_at<now()-interval '15 minutes') RETURNING *`,
      [id, token],
    )
  ).rows[0];
  if (!source) {
    // Share an in-flight fetch across workers without holding a connection/transaction.
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      const current = (
        await pool.query(
          "SELECT fetch_token,lease_until FROM news_sources WHERE id=$1 AND status='approved'",
          [id],
        )
      ).rows[0];
      if (
        !current?.fetch_token ||
        !current.lease_until ||
        +new Date(current.lease_until) <= Date.now()
      )
        return;
      await delay(250, undefined, { signal });
    }
    return;
  }
  try {
    const result = await fetchRss(
      [{ id, name: source.name, url: source.url, enabled: true }],
      { http, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) },
    );
    // All cache writes and lease release commit together, fenced against stale fetches.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query(
        "SELECT id FROM news_sources WHERE id=$1 AND fetch_token=$2 AND status='approved' AND lease_until>now() FOR UPDATE",
        [id, token],
      );
      if (owned.rowCount) {
        for (const item of result.data.items) {
          const hash = createHash("sha256")
            .update(item.title + "\n" + item.description)
            .digest("hex");
          const article = (
            await client.query(
              `INSERT INTO news_articles(id,url,content_hash,title,description,published_at) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(url) DO UPDATE SET content_hash=EXCLUDED.content_hash,title=EXCLUDED.title,description=EXCLUDED.description,fetched_at=now() RETURNING id`,
              [
                crypto.randomUUID(),
                item.url,
                hash,
                item.title,
                item.description,
                item.publishedAt,
              ],
            )
          ).rows[0];
          await client.query(
            "INSERT INTO news_source_articles(source_id,article_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [id, article.id],
          );
        }
        await client.query(
          "UPDATE news_sources SET fetched_at=now(),fetch_token=NULL,lease_until=NULL,last_error=$3 WHERE id=$1 AND fetch_token=$2",
          [id, token, result.status === "failed" ? "SOURCE_UNAVAILABLE" : null],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    await pool.query(
      "UPDATE news_sources SET fetched_at=now(),fetch_token=NULL,lease_until=NULL,last_error='SOURCE_UNAVAILABLE' WHERE id=$1 AND fetch_token=$2",
      [id, token],
    );
    throw e;
  }
}
