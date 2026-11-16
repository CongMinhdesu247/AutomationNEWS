import type { Pool } from "pg";
import { WorkflowQueue } from "../workflows/queue.js";
// Explicit maintenance, dry-run by default. Financial usage in current periods is never removed.
export async function retainPremium(
  pool: Pool,
  apply = false,
  days = 30,
  batch = 500,
  resultDays = 365,
) {
  if (
    !Number.isInteger(days) ||
    days < 30 ||
    days > 3650 ||
    !Number.isInteger(batch) ||
    batch < 1 ||
    batch > 1000 ||
    !Number.isInteger(resultDays) ||
    resultDays < 90 ||
    resultDays > 36500
  )
    throw new Error("Invalid retention limits");
  return new WorkflowQueue(pool).transaction(async (c) => {
    const tasks = (
      await c.query(
        "SELECT t.run_id FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE t.kind<>'watch' AND t.created_at<now()-$1*interval '1 day' AND r.status IN ('completed','failed') AND (t.payload<>'{}' OR t.result IS NOT NULL) LIMIT $2 FOR UPDATE OF t SKIP LOCKED",
        [days, batch],
      )
    ).rows;
    const articles = (
      await c.query(
        "SELECT id FROM news_articles WHERE fetched_at<now()-$1*interval '1 day' AND description<>'' LIMIT $2 FOR UPDATE SKIP LOCKED",
        [days, batch],
      )
    ).rows;
    const enrich = (
      await c.query(
        "SELECT content_hash,processing_version FROM news_enrichment WHERE created_at<now()-$1*interval '1 day' LIMIT $2 FOR UPDATE SKIP LOCKED",
        [days, batch],
      )
    ).rows;
    const usage = (
      await c.query(
        "SELECT id FROM news_usage WHERE created_at<now()-interval '400 days' AND status='completed' LIMIT $1 FOR UPDATE SKIP LOCKED",
        [batch],
      )
    ).rows;
    const discovery = (
      await c.query(
        "SELECT cache_key FROM news_discovery_cache WHERE created_at<now()-interval '1 day' LIMIT $1 FOR UPDATE SKIP LOCKED",
        [batch],
      )
    ).rows;
    const matches = (
      await c.query(
        "SELECT watch_id,article_id FROM news_matches WHERE NOT saved AND created_at<now()-$1*interval '1 day' LIMIT $2 FOR UPDATE SKIP LOCKED",
        [resultDays, batch],
      )
    ).rows;
    const unused = (
      await c.query(
        "SELECT a.id FROM news_articles a WHERE a.fetched_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM news_matches m WHERE m.article_id=a.id) AND NOT EXISTS(SELECT 1 FROM news_digest_items d WHERE d.article_id=a.id) LIMIT $1 FOR UPDATE OF a SKIP LOCKED",
        [batch],
      )
    ).rows;
    if (apply) {
      await c.query(
        "DELETE FROM news_matches m USING jsonb_to_recordset($1::jsonb) AS x(watch_id uuid,article_id uuid) WHERE m.watch_id=x.watch_id AND m.article_id=x.article_id",
        [JSON.stringify(matches)],
      );
      await c.query(
        "DELETE FROM news_source_articles WHERE article_id=ANY($1::uuid[])",
        [unused.map((a) => a.id)],
      );
      await c.query("DELETE FROM news_articles WHERE id=ANY($1::uuid[])", [
        unused.map((a) => a.id),
      ]);
      await c.query(
        "DELETE FROM news_discovery_cache WHERE cache_key=ANY($1::text[])",
        [discovery.map((d) => d.cache_key)],
      );
      await c.query(
        "UPDATE news_tasks SET payload='{}',result=NULL WHERE run_id=ANY($1::uuid[])",
        [tasks.map((t) => t.run_id)],
      );
      await c.query(
        "UPDATE news_articles SET description='' WHERE id=ANY($1::uuid[])",
        [articles.map((a) => a.id)],
      );
      for (const e of enrich)
        await c.query(
          "DELETE FROM news_enrichment WHERE content_hash=$1 AND processing_version=$2",
          [e.content_hash, e.processing_version],
        );
      await c.query("DELETE FROM news_usage WHERE id=ANY($1::uuid[])", [
        usage.map((u) => u.id),
      ]);
    }
    return {
      mode: apply ? "apply" : "dry-run",
      privateTaskRedactions: tasks.length,
      articleRedactions: articles.length,
      enrichmentDeletes: enrich.length,
      completedUsageDeletes: usage.length,
      discoveryDeletes: discovery.length,
      unsavedResultDeletes: matches.length,
      unusedArticleDeletes: unused.length,
      resultDays,
      days,
      batch,
    };
  });
}
