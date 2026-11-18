import type { Pool } from "pg";
import {
  watchConditionsSchema,
  aiControlSchema,
  topicSummarySchema,
  type WatchConditions,
} from "@hub/contracts";
import type { HttpClient } from "../connectors/http.js";
import {
  WorkflowQueue,
  type ClaimedJob,
  type NodeResult,
} from "../workflows/queue.js";
import { matchConditions, requirePremium, fail } from "./store.js";
import { refreshSource } from "./sources.js";
import { runAi, type AiAdapter } from "./ai.js";
import { RequestError } from "../digests/service.js";
import { discoverySchema, runDiscovery, type SearchAdapter } from "./search.js";
export async function tickCustom(queue: WorkflowQueue) {
  return queue.transaction(async (c) => {
    // Claim a bounded batch of due watches; never replay missed intervals after a restart.
    const rows = (
      await c.query(`SELECT w.* FROM news_watches w JOIN hub_users u ON u.id=w.user_id
      JOIN news_entitlements e ON e.user_id=w.user_id
      WHERE w.enabled AND w.deleted_at IS NULL AND NOT u.disabled AND w.next_run_at<=now()
      AND e.plan_id='premium' AND e.status='active' AND e.starts_at<=now() AND e.expires_at>now()
      ORDER BY w.next_run_at,w.id FOR UPDATE OF w SKIP LOCKED LIMIT 15`)
    ).rows;
    if (!rows.length) return;
    let firstEnqueued: string | undefined;
    for (const w of rows) {
      await c.query("SAVEPOINT custom_watch_tick");
      try {
        const plan = await requirePremium(c, w.user_id);
        const running = (
          await c.query(
            "SELECT 1 FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE t.watch_id=$1 AND r.status IN ('queued','running')",
            [w.id],
          )
        ).rowCount;
        await c.query(
          "UPDATE news_watches SET next_run_at=now()+greatest(interval_minutes,$2)*interval '1 minute' WHERE id=$1",
          [w.id, plan.min_interval_minutes],
        );
        if (!running) {
          const runId = await queue.enqueueTask(
            c,
            crypto.randomUUID(),
            w.user_id,
            "watch",
            { version: w.version },
            w.id,
          );
          firstEnqueued ??= runId;
        }
        await c.query("RELEASE SAVEPOINT custom_watch_tick");
      } catch {
        await c.query("ROLLBACK TO SAVEPOINT custom_watch_tick");
      }
    }
    return firstEnqueued;
  });
}
export async function executeCustom(
  pool: Pool,
  job: ClaimedJob,
  signal: AbortSignal,
  http?: HttpClient,
  adapter?: AiAdapter,
  searchAdapter?: SearchAdapter,
): Promise<NodeResult> {
  const task = (
    await pool.query("SELECT * FROM news_tasks WHERE run_id=$1", [job.runId])
  ).rows[0];
  if (!task)
    return {
      status: "failed",
      output: null,
      error: { code: "TASK_MISSING", message: "Không tìm thấy tác vụ." },
    };
  try {
    const plan = await requirePremium(pool, task.user_id);
    if (task.kind === "discover") {
      const result =
        task.result ??
        (await runDiscovery(
          pool,
          job.runId,
          task.user_id,
          task.payload,
          signal,
          searchAdapter,
        ));
      await pool.query(
        "UPDATE news_tasks SET result=$2::jsonb WHERE run_id=$1",
        [job.runId, JSON.stringify(result)],
      );
      return { status: "succeeded", output: { available: true }, error: null };
    }
    if (task.kind !== "watch") {
      const previous = task.result;
      if (previous)
        return {
          status: "succeeded",
          output: { available: true },
          error: null,
        };
      if (
        task.kind === "enrich" &&
        (task.payload.summaryWatchId || task.payload.webBriefRunId)
      ) {
        const web = task.payload.webBriefRunId
          ? await webBriefArticles(
              pool,
              task.payload.webBriefRunId,
              task.user_id,
            )
          : null;
        const articles =
          web?.articles ??
          (
            await pool.query<{
              title: string;
              url: string;
              description: string;
            }>(
              `SELECT a.title,a.url,a.description FROM news_matches m
           JOIN news_watches w ON w.id=m.watch_id AND w.user_id=m.user_id
           JOIN news_articles a ON a.id=m.article_id
           WHERE m.user_id=$1 AND m.watch_id=$2 AND w.deleted_at IS NULL AND NOT m.hidden
           ORDER BY a.published_at DESC NULLS LAST,a.id LIMIT 6`,
              [task.user_id, task.payload.summaryWatchId],
            )
          ).rows;
        if (!articles.length)
          fail(409, "NO_MATCHES", "Không còn nguồn để tổng hợp.");
        const text = articles
          .map(
            (article, index) =>
              `[${index + 1}] ${article.title.slice(0, 120)}\n${article.description.slice(0, 350)}`,
          )
          .join("\n\n");
        const { summary } = topicSummarySchema.parse(
          await runAi(
            pool,
            job.runId,
            task.user_id,
            "summarize",
            web ? `Nhu cầu: ${web.topic}\n\nNguồn tham khảo:\n${text}` : text,
            signal,
            adapter,
          ),
        );
        signal.throwIfAborted();
        await pool.query(
          "UPDATE news_tasks SET result=$2::jsonb WHERE run_id=$1",
          [
            job.runId,
            JSON.stringify({
              summary,
              articles: articles.map(({ title, url }) => ({ title, url })),
            }),
          ],
        );
        return {
          status: "succeeded",
          output: { available: true },
          error: null,
        };
      }
      if (task.kind === "enrich") {
        const active = aiControlSchema.parse(
          (await pool.query("SELECT config FROM news_ai_control WHERE id=1"))
            .rows[0].config,
        );
        if (
          task.payload.processingVersion !==
          `extract.v1:${active.provider}:${active.model}:${active.pricingVersion}`
        )
          fail(
            409,
            "PROCESSING_VERSION_CHANGED",
            "Cấu hình trợ lý đã đổi; yêu cầu trích xuất mới cần phiên bản hiện tại.",
          );
        const cached = (
          await pool.query(
            "SELECT result FROM news_enrichment WHERE content_hash=$1 AND processing_version=$2",
            [task.payload.hash, task.payload.processingVersion],
          )
        ).rows[0];
        if (cached) {
          await pool.query(
            "UPDATE news_tasks SET result=$2::jsonb WHERE run_id=$1",
            [job.runId, JSON.stringify(cached.result)],
          );
          return {
            status: "succeeded",
            output: { available: true, cached: true },
            error: null,
          };
        }
      }
      const result = await runAi(
        pool,
        job.runId,
        task.user_id,
        task.kind,
        task.payload.description,
        signal,
        adapter,
      );
      signal.throwIfAborted();
      if (task.kind === "enrich")
        await pool.query(
          "INSERT INTO news_enrichment(content_hash,processing_version,result) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING",
          [
            task.payload.hash,
            task.payload.processingVersion,
            JSON.stringify(result),
          ],
        );
      await pool.query(
        "UPDATE news_tasks SET result=$2::jsonb WHERE run_id=$1",
        [job.runId, JSON.stringify(result)],
      );
      return { status: "succeeded", output: { available: true }, error: null };
    }
    const w = (
      await pool.query(
        "SELECT * FROM news_watches WHERE id=$1 AND user_id=$2 AND enabled AND deleted_at IS NULL",
        [task.watch_id, task.user_id],
      )
    ).rows[0];
    if (!w || w.version !== task.payload.version)
      fail(
        409,
        "WATCH_CHANGED",
        "Nhu cầu đã thay đổi hoặc tạm dừng; bỏ tác vụ cũ.",
      );
    // A lowered plan cannot leave extra previously-active watches running.
    const rank = (
      await pool.query(
        "SELECT id FROM news_watches WHERE user_id=$1 AND enabled AND deleted_at IS NULL ORDER BY created_at,id LIMIT $2",
        [task.user_id, plan.active_watches],
      )
    ).rows;
    if (!rank.some((r) => r.id === w.id))
      fail(
        429,
        "WATCH_LIMIT",
        "Nhu cầu vượt hạn mức hiện tại; hãy tạm dừng bớt.",
      );
    await pool.query(
      "UPDATE news_watches SET last_run_at=now() WHERE id=$1 AND version=$2",
      [w.id, w.version],
    );
    // Bounded sequential fetches avoid multiplying concurrency on the HP server; isolate per-source failures.
    const sourceSignal = AbortSignal.any([signal, AbortSignal.timeout(35000)]);
    for (const source of w.source_ids) {
      sourceSignal.throwIfAborted();
      try {
        await refreshSource(pool, source, sourceSignal, http);
      } catch {
        if (sourceSignal.aborted) throw new Error("timeout");
      }
    }
    const articles = (
      await pool.query(
        `SELECT * FROM (
          SELECT DISTINCT ON(a.id) a.*,s.id AS source_id FROM news_articles a
          JOIN news_source_articles sa ON sa.article_id=a.id JOIN news_sources s ON s.id=sa.source_id
          WHERE sa.source_id=ANY($1::uuid[]) AND s.status='approved' AND a.published_at>=now()-$2*interval '1 day'
          ORDER BY a.id,s.id
        ) candidate
        ORDER BY candidate.published_at DESC NULLS LAST, candidate.id LIMIT 500`,
        [w.source_ids, w.lookback_days],
      )
    ).rows;
    const conditions: WatchConditions = watchConditionsSchema.parse(
      w.conditions,
    );
    let count = 0;
    await new WorkflowQueue(pool).transaction(async (c) => {
      await requirePremium(c, task.user_id);
      const current = (
        await c.query(
          "SELECT * FROM news_watches WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [w.id, task.user_id],
        )
      ).rows[0];
      if (
        !current?.enabled ||
        current.deleted_at ||
        current.version !== w.version
      )
        fail(409, "WATCH_CHANGED", "Nhu cầu đã thay đổi.");
      // Fencing prevents stale workers from persisting matches after losing their lease.
      const lease = await c.query(
        "SELECT 1 FROM workflow_jobs WHERE id=$1 AND claim_token=$2 AND lease_until>clock_timestamp() AND status='leased'",
        [job.id, job.token],
      );
      if (!lease.rowCount || signal.aborted)
        fail(409, "LEASE_EXPIRED", "Tác vụ đã hết lease.");
      for (const a of articles) {
        const reason = matchConditions(
          conditions,
          a.title + "\n" + a.description,
        );
        if (!reason) continue;
        const row = await c.query(
          `INSERT INTO news_matches(watch_id,user_id,article_id,source_id,condition_version,reason)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(watch_id,article_id) DO UPDATE
             SET reason=EXCLUDED.reason,condition_version=EXCLUDED.condition_version
             WHERE news_matches.condition_version<>EXCLUDED.condition_version OR news_matches.reason<>EXCLUDED.reason`,
          [w.id, task.user_id, a.id, a.source_id, w.version, reason],
        );
        count += row.rowCount ?? 0;
      }
      const unavailable = (
        await c.query(
          "SELECT count(*) FROM news_sources WHERE id=ANY($1::uuid[]) AND (last_error IS NOT NULL OR fetched_at IS NULL OR status<>'approved')",
          [w.source_ids],
        )
      ).rows[0];
      if (Number(unavailable.count) > 0) {
        await c.query(
          "UPDATE news_watches SET last_error='Một số nguồn chưa cập nhật được; kết quả có thể thiếu.' WHERE id=$1",
          [w.id],
        );
      } else
        await c.query(
          "UPDATE news_watches SET last_success_at=now(),last_error=NULL WHERE id=$1",
          [w.id],
        );
      await c.query("UPDATE news_tasks SET result=$2::jsonb WHERE run_id=$1", [
        job.runId,
        JSON.stringify({
          matched: count,
          partial: Number(unavailable.count) > 0,
        }),
      ]);
    });
    return { status: "succeeded", output: { matched: count }, error: null };
  } catch (e) {
    const error =
      e instanceof RequestError
        ? { code: e.code, message: e.message }
        : {
            code: "CUSTOM_UNAVAILABLE",
            message:
              "Không cập nhật được trong giới hạn cho phép. Bản tin thường vẫn hoạt động.",
          };
    if (task.watch_id)
      await pool.query(
        "UPDATE news_watches SET last_error=$3 WHERE id=$1 AND user_id=$2 AND version=$4",
        [task.watch_id, task.user_id, error.message, task.payload.version],
      );
    return { status: "failed", output: null, error };
  }
}

async function webBriefArticles(pool: Pool, runId: string, userId: string) {
  const { rows } = await pool.query(
    `SELECT t.result,t.payload->>'description' AS topic FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id
     WHERE t.run_id=$1 AND t.user_id=$2 AND t.kind='discover'
     AND t.payload->'webBrief'='true'::jsonb AND r.status='completed'`,
    [runId, userId],
  );
  if (!rows.length) fail(404, "NOT_FOUND", "Không tìm thấy lượt tìm kiếm.");
  return {
    topic: rows[0].topic as string,
    articles: discoverySchema
      .parse(rows[0].result)
      .candidates.map(({ name, url, evidence }) => ({
        title: name,
        url,
        description: evidence,
      })),
  };
}
