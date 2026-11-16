import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { watchSchema, aiControlSchema } from "@hub/contracts";
import { WorkflowQueue } from "../workflows/queue.js";
import { accountKey } from "../accounts/routes.js";
import {
  checkUrl,
  resolveTarget,
  type HttpClient,
} from "../connectors/http.js";
import { fetchRss } from "../connectors/rss.js";
import { entitlement, requirePremium, fail, audit } from "./store.js";
import { aiAvailability } from "./ai.js";
import { createHash } from "node:crypto";
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    return fail(
      400,
      "VALIDATION_ERROR",
      "Kiểm tra điều kiện, nguồn, lịch và các trường bắt buộc.",
    );
  return result.data;
};
const idSchema = z.uuid();
const sourceSchema = z
  .object({ name: z.string().trim().min(1).max(100), url: z.url().max(2000) })
  .strict();
export function registerPremiumRoutes(
  app: FastifyInstance,
  pool: Pool,
  throttle: (key: string, max: number, seconds: number) => Promise<void>,
  sourceHttp?: HttpClient,
) {
  const queue = new WorkflowQueue(pool);
  async function admit(
    c: PoolClient,
    userId: string,
    key: string,
    search = false,
  ) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "ai-enqueue:" + userId,
    ]);
    if (
      (
        await c.query(
          "SELECT 1 FROM workflow_runs WHERE idempotency_key=$1 AND user_id=$2",
          [key, userId],
        )
      ).rowCount
    )
      return;
    const plan = await requirePremium(c, userId);
    const config = aiControlSchema.parse(
      (await c.query("SELECT config FROM news_ai_control WHERE id=1")).rows[0]
        .config,
    );
    const pending = Number(
      (
        await c.query(
          "SELECT count(*) FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE t.user_id=$1 AND t.kind<>'watch' AND r.status IN ('queued','running')",
          [userId],
        )
      ).rows[0].count,
    );
    const quota = Number(
      (
        await c.query(
          "SELECT (SELECT count(*) FROM news_usage WHERE user_id=$1 AND (kind='discover')=$2 AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+(SELECT count(*) FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE t.user_id=$1 AND (t.kind='discover')=$2 AND t.kind<>'watch' AND r.status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM news_usage u WHERE u.run_id=t.run_id)) AS calls",
          [userId, search],
        )
      ).rows[0].calls,
    );
    if (pending >= config.maxPendingPerUser)
      fail(
        429,
        "AI_BUSY",
        "Đang có yêu cầu chờ xử lý; kiểm tra kết quả trước khi gửi thêm.",
      );
    if (quota >= (search ? plan.discovery_month : plan.ai_calls_month))
      fail(
        429,
        "AI_QUOTA",
        "Đã hết lượt khả dụng trong tháng, gồm các yêu cầu đang chờ.",
      );
  }
  // Explicit guards also protect these endpoints when legacy auth is disabled in tools.
  const user = (r: { accountUser: { id: string; role: string } | null }) =>
    r.accountUser ?? fail(401, "AUTH_REQUIRED", "Vui lòng đăng nhập.");
  const admin = (r: Parameters<typeof user>[0]) => {
    const u = user(r);
    if (u.role !== "admin") fail(403, "ADMIN_REQUIRED", "Cần quyền quản trị.");
    return u;
  };
  app.get("/api/account/plan", async (r) => {
    const u = user(r);
    const [plan, counts, usage, control, pref, signup, offer] =
      await Promise.all([
        entitlement(pool, u.id),
        pool.query(
          "SELECT count(*) FILTER(WHERE enabled) AS active,count(*) AS total FROM news_watches WHERE user_id=$1 AND deleted_at IS NULL",
          [u.id],
        ),
        pool.query(
          "SELECT kind,status,count(*)::int AS calls FROM news_usage WHERE user_id=$1 AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' GROUP BY kind,status",
          [u.id],
        ),
        pool.query(
          "SELECT config->'enabled' AS enabled,config->'searchEnabled' AS search_enabled FROM news_ai_control WHERE id=1",
        ),
        pool.query(
          "SELECT include_digest FROM news_preferences WHERE user_id=$1",
          [u.id],
        ),
        pool.query(
          "SELECT status,requested_at,reviewed_at,review_note FROM news_plan_requests WHERE user_id=$1",
          [u.id],
        ),
        pool.query(
          "SELECT active_watches,discovery_month,ai_calls_month,min_interval_minutes FROM news_plans WHERE id='premium'",
        ),
      ]);
    return {
      plan,
      counts: counts.rows[0],
      usage: usage.rows,
      aiEnabled:
        control.rows[0].enabled === true &&
        process.env.NEWS_AI_KILL_SWITCH !== "true" &&
        process.env.NEWS_FREE_ONLY !== "true",
      searchEnabled:
        control.rows[0].search_enabled === true &&
        process.env.NEWS_SEARCH_KILL_SWITCH !== "true" &&
        process.env.NEWS_FREE_ONLY !== "true",
      includeDigest: pref.rows[0]?.include_digest ?? true,
      signup: signup.rows[0] ?? null,
      premiumOffer: offer.rows[0],
    };
  });
  app.post("/api/account/premium-request", async (r, reply) => {
    const u = user(r),
      body = parse(
        z.object({ note: z.string().trim().max(500).default("") }).strict(),
        r.body,
      );
    const request = await queue.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "premium:" + u.id,
      ]);
      const plan = await entitlement(c, u.id);
      if (plan.premium)
        fail(409, "ALREADY_PREMIUM", "Bạn đang có Premium còn hạn.");
      const prior = (
        await c.query(
          "SELECT *,requested_at>now()-interval '1 day' AS recent FROM news_plan_requests WHERE user_id=$1 FOR UPDATE",
          [u.id],
        )
      ).rows[0];
      if (prior?.status === "pending") return prior;
      if (prior?.recent)
        fail(
          429,
          "REQUEST_LIMIT",
          "Bạn có thể gửi yêu cầu mới sau 24 giờ kể từ lần gửi trước.",
        );
      const row = (
        await c.query(
          "INSERT INTO news_plan_requests(user_id,note) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET status='pending',note=EXCLUDED.note,review_note=NULL,requested_at=now(),reviewed_at=NULL,reviewed_by=NULL RETURNING status,requested_at",
          [u.id, body.note],
        )
      ).rows[0];
      await audit(c, u.id, u.id, "premium.request", {});
      return row;
    });
    return reply.code(202).send({ request });
  });
  app.put("/api/account/custom-preferences", async (r) => {
    const u = user(r),
      body = parse(z.object({ includeDigest: z.boolean() }).strict(), r.body);
    await pool.query(
      "INSERT INTO news_preferences(user_id,include_digest) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET include_digest=EXCLUDED.include_digest",
      [u.id, body.includeDigest],
    );
    return { updated: true };
  });
  app.get("/api/account/custom-sources", async (r) => {
    user(r);
    return {
      sources: (
        await pool.query(
          "SELECT id,name,url,fetched_at,last_error,catalog_rank FROM news_sources WHERE status='approved' ORDER BY catalog_rank NULLS LAST,name LIMIT 500",
        )
      ).rows,
    };
  });
  async function proposeSource(userId: string, input: unknown) {
    const body = parse(sourceSchema, input);
    let url: URL;
    try {
      url = checkUrl(body.url);
      await resolveTarget(url);
    } catch {
      return fail(
        400,
        "INVALID_SOURCE_URL",
        "Hãy nhập đường dẫn RSS/Atom công khai và kiểm tra lại địa chỉ.",
      );
    }
    url.hash = "";
    return queue.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "source-proposals:" + userId,
      ]);
      const count = Number(
        (
          await c.query(
            "SELECT count(*) FROM news_sources WHERE proposed_by=$1 AND status='pending'",
            [userId],
          )
        ).rows[0].count,
      );
      if (count >= 10)
        fail(429, "SOURCE_LIMIT", "Tối đa 10 đề nghị nguồn đang chờ duyệt.");
      const row = (
        await c.query(
          "INSERT INTO news_sources(id,name,url,proposed_by) VALUES($1,$2,$3,$4) ON CONFLICT(url) DO NOTHING RETURNING id",
          [crypto.randomUUID(), body.name, url.toString(), userId],
        )
      ).rows[0];
      return row?.id ?? null;
    });
  }
  app.post("/api/account/custom-sources", async (r, reply) => {
    const u = user(r);
    await requirePremium(pool, u.id);
    await throttle("source-proposals:" + u.id, 20, 900);
    const id = await proposeSource(u.id, r.body);
    if (!id)
      fail(409, "SOURCE_EXISTS", "Đường dẫn này đã có trong hệ thống.");
    return reply.code(202).send({ id });
  });
  app.post("/api/admin/custom-sources", async (r, reply) => {
    const u = admin(r);
    const id = await proposeSource(u.id, r.body);
    return reply.code(202).send({
      id,
      message:
        "Đã gửi đề nghị. Trang sẽ xuất hiện trong danh sách nếu được duyệt.",
    });
  });
  app.get("/api/account/watches", async (r) => ({
    watches: (
      await pool.query(
        "SELECT * FROM news_watches WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200",
        [user(r).id],
      )
    ).rows,
  }));
  for (const method of ["POST", "PUT"] as const)
    app.route<{ Params: { id?: string } }>({
      method,
      url:
        method === "POST" ? "/api/account/watches" : "/api/account/watches/:id",
      handler: async (r, reply) => {
        const u = user(r),
          body = parse(watchSchema, r.body),
          id =
            method === "PUT"
              ? parse(idSchema, r.params.id)
              : crypto.randomUUID();
        await queue.transaction(async (c) => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["premium:" + u.id],
          );
          const plan = await requirePremium(c, u.id);
          if (body.intervalMinutes < plan.min_interval_minutes)
            fail(
              400,
              "FREQUENCY_LIMIT",
              `Khoảng kiểm tra tối thiểu ${plan.min_interval_minutes} phút.`,
            );
          if (
            method === "PUT" &&
            !(
              await c.query(
                "SELECT id FROM news_watches WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE",
                [id, u.id],
              )
            ).rowCount
          )
            fail(404, "NOT_FOUND", "Không tìm thấy nhu cầu.");
          const counts = (
            await c.query(
              "SELECT count(*) AS total,count(*) FILTER(WHERE enabled AND id<>$2) AS active FROM news_watches WHERE user_id=$1 AND deleted_at IS NULL",
              [u.id, id],
            )
          ).rows[0];
          if (method === "POST" && Number(counts.total) >= 100)
            fail(
              429,
              "WATCH_STORAGE_LIMIT",
              "Tối đa 100 nhu cầu được lưu. Xóa nhu cầu không cần dùng.",
            );
          if (body.enabled && Number(counts.active) >= plan.active_watches)
            fail(429, "WATCH_LIMIT", "Đã hết số nhu cầu hoạt động của gói.");
          const ids = [...new Set(body.sourceIds)];
          if (
            (
              await c.query(
                "SELECT id FROM news_sources WHERE id=ANY($1::uuid[]) AND status='approved'",
                [ids],
              )
            ).rowCount !== ids.length
          )
            fail(400, "SOURCE_NOT_APPROVED", "Chỉ chọn nguồn đã duyệt.");
          if (method === "POST")
            await c.query(
              "INSERT INTO news_watches(id,user_id,name,description,conditions,source_ids,interval_minutes,enabled,lookback_days,next_run_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,CASE WHEN $8 THEN now() ELSE NULL END)",
              [
                id,
                u.id,
                body.name,
                body.description,
                JSON.stringify(body.conditions),
                ids,
                body.intervalMinutes,
                body.enabled,
                body.lookbackDays,
              ],
            );
          else
            await c.query(
              "UPDATE news_watches SET name=$3,description=$4,conditions=$5::jsonb,source_ids=$6,interval_minutes=$7,enabled=$8,lookback_days=$9,version=version+1,next_run_at=CASE WHEN $8 THEN greatest(now(),coalesce(last_run_at,now()-interval '1 year')+$7*interval '1 minute') ELSE NULL END,updated_at=now(),last_error=NULL WHERE id=$1 AND user_id=$2",
              [
                id,
                u.id,
                body.name,
                body.description,
                JSON.stringify(body.conditions),
                ids,
                body.intervalMinutes,
                body.enabled,
                body.lookbackDays,
              ],
            );
          await c.query("DELETE FROM news_watch_sources WHERE watch_id=$1", [
            id,
          ]);
          for (const source of ids)
            await c.query(
              "INSERT INTO news_watch_sources(watch_id,source_id) VALUES($1,$2)",
              [id, source],
            );
          await audit(
            c,
            u.id,
            u.id,
            method === "POST" ? "watch.create" : "watch.update",
            { watchId: id },
          );
        });
        return reply.code(method === "POST" ? 201 : 200).send({ id });
      },
    });
  app.delete<{ Params: { id: string } }>(
    "/api/account/watches/:id",
    async (r) => {
      const id = parse(idSchema, r.params.id),
        u = user(r);
      const row = await pool.query(
        "UPDATE news_watches SET enabled=false,deleted_at=now(),next_run_at=NULL WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id",
        [id, u.id],
      );
      if (!row.rowCount) fail(404, "NOT_FOUND", "Không tìm thấy nhu cầu.");
      return { deleted: true };
    },
  );
  app.patch<{ Params: { id: string } }>(
    "/api/account/watches/:id",
    async (r) => {
      const id = parse(idSchema, r.params.id),
        u = user(r),
        body = parse(z.object({ enabled: z.literal(false) }).strict(), r.body);
      const row = await pool.query(
        "UPDATE news_watches SET enabled=$3,next_run_at=NULL,version=version+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id",
        [id, u.id, body.enabled],
      );
      if (!row.rowCount) fail(404, "NOT_FOUND", "Không tìm thấy nhu cầu.");
      return { updated: true };
    },
  );
  app.get("/api/account/custom-results", async (r) => {
    const u = user(r),
      query = parse(
        z
          .object({
            page: z.coerce.number().int().min(1).max(10000).default(1),
          })
          .strict(),
        r.query,
      );
    return {
      results: (
        await pool.query(
          `SELECT m.*,a.title,a.url,a.description,a.published_at,a.fetched_at,s.name AS source_name,s.url AS source_url,w.name AS watch_name
      FROM news_matches m JOIN news_articles a ON a.id=m.article_id JOIN news_sources s ON s.id=m.source_id JOIN news_watches w ON w.id=m.watch_id
      WHERE m.user_id=$1 AND w.deleted_at IS NULL ORDER BY m.created_at DESC,m.watch_id,m.article_id LIMIT 50 OFFSET $2`,
          [u.id, (query.page - 1) * 50],
        )
      ).rows,
    };
  });
  app.patch<{ Params: { watchId: string; articleId: string } }>(
    "/api/account/custom-results/:watchId/:articleId",
    async (r) => {
      const u = user(r),
        w = parse(idSchema, r.params.watchId),
        a = parse(idSchema, r.params.articleId),
        body = parse(
          z.object({ saved: z.boolean(), hidden: z.boolean() }).strict(),
          r.body,
        );
      const row = await pool.query(
        "UPDATE news_matches SET saved=$4,hidden=$5 WHERE user_id=$1 AND watch_id=$2 AND article_id=$3 RETURNING watch_id",
        [u.id, w, a, body.saved, body.hidden],
      );
      if (!row.rowCount) fail(404, "NOT_FOUND", "Không tìm thấy kết quả.");
      return { updated: true };
    },
  );
  app.post("/api/account/custom-interpret", async (r, reply) => {
    const u = user(r),
      body = parse(
        z.object({ description: z.string().trim().min(5).max(2000) }).strict(),
        r.body,
      );
    const key = accountKey(
      "interpret:" + u.id,
      parse(z.uuid(), r.headers["idempotency-key"]),
    );
    await aiAvailability(pool, u.id);
    const id = await queue.transaction(async (c) => {
      await admit(c, u.id, key);
      return queue.enqueueTask(c, key, u.id, "interpret", body);
    });
    return reply
      .code(202)
      .send({ runId: id, statusUrl: "/api/account/custom-jobs/" + id });
  });
  app.get<{ Params: { id: string } }>(
    "/api/account/custom-jobs/:id",
    async (r) => {
      const row = (
        await pool.query(
          "SELECT t.run_id,t.kind,t.result,r.status,r.error FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE t.run_id=$1 AND t.user_id=$2",
          [parse(idSchema, r.params.id), user(r).id],
        )
      ).rows[0];
      return row ?? fail(404, "NOT_FOUND", "Không tìm thấy tác vụ.");
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/account/custom-summary/:id",
    async (r, reply) => {
      const u = user(r);
      const watchId = parse(idSchema, r.params.id);
      const key = accountKey(
        "summary:" + u.id,
        parse(idSchema, r.headers["idempotency-key"]),
      );
      await aiAvailability(pool, u.id);
      const runId = await queue.transaction(async (c) => {
        await admit(c, u.id, key);
        const watch = await c.query(
          "SELECT 1 FROM news_watches WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
          [watchId, u.id],
        );
        if (!watch.rowCount) fail(404, "NOT_FOUND", "Không tìm thấy theo dõi.");
        const matches = await c.query(
          "SELECT 1 FROM news_matches WHERE watch_id=$1 AND user_id=$2 AND NOT hidden LIMIT 1",
          [watchId, u.id],
        );
        if (!matches.rowCount)
          fail(
            409,
            "NO_MATCHES",
            "Cần có ít nhất một tin phù hợp để tổng hợp.",
          );
        return queue.enqueueTask(c, key, u.id, "enrich", {
          summaryWatchId: watchId,
        });
      });
      return reply
        .code(202)
        .send({ runId, statusUrl: "/api/account/custom-jobs/" + runId });
    },
  );
  app.post("/api/account/custom-discover", async (r, reply) => {
    const u = user(r),
      body = parse(
        z.object({ description: z.string().trim().min(5).max(300) }).strict(),
        r.body,
      );
    const config = await aiAvailability(pool, u.id, "discover");
    const cacheKey = createHash("sha256")
      .update(
        `${config.searchProvider}:${config.searchPricingVersion}:${body.description.normalize("NFKC").toLowerCase()}`,
      )
      .digest("hex");
    const cached = (
      await pool.query(
        "SELECT result FROM news_discovery_cache WHERE cache_key=$1 AND created_at>now()-interval '1 day'",
        [cacheKey],
      )
    ).rows[0];
    if (cached) return { result: cached.result, cached: true };
    const key = accountKey(
      "discover:" + u.id,
      parse(z.uuid(), r.headers["idempotency-key"]),
    );
    const runId = await queue.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "discover:" + cacheKey,
      ]);
      const previous = (
        await c.query(
          "SELECT r.id FROM workflow_runs r JOIN news_tasks t ON t.run_id=r.id WHERE r.idempotency_key=$1 AND t.user_id=$2",
          [key, u.id],
        )
      ).rows[0];
      if (previous)
        return queue.enqueueTask(c, key, u.id, "discover", {
          ...body,
          cacheKey,
        });
      const pending = await c.query(
        "SELECT 1 FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE t.kind='discover' AND (t.payload->>'cacheKey'=$1 OR t.user_id=$2) AND r.status IN ('queued','running')",
        [cacheKey, u.id],
      );
      if (pending.rowCount)
        fail(
          409,
          "SEARCH_PENDING",
          "Đang có lượt tìm nguồn chờ xử lý. Kiểm tra kết quả trước khi gửi thêm.",
        );
      await admit(c, u.id, key, true);
      return queue.enqueueTask(c, key, u.id, "discover", { ...body, cacheKey });
    });
    return reply
      .code(202)
      .send({ runId, statusUrl: "/api/account/custom-jobs/" + runId });
  });
  app.post("/api/account/custom-web-brief", async (r, reply) => {
    const u = user(r);
    const body = parse(
      z.union([
        z.object({ description: z.string().trim().min(5).max(300) }).strict(),
        z.object({ searchRunId: idSchema }).strict(),
      ]),
      r.body,
    );
    const searching = "description" in body;
    const key = accountKey(
      "web-brief:" + u.id + (searching ? ":search" : ":summary"),
      parse(idSchema, r.headers["idempotency-key"]),
    );
    await aiAvailability(pool, u.id, "summarize");
    if (searching) await aiAvailability(pool, u.id, "discover");
    const runId = await queue.transaction(async (c) => {
      await admit(c, u.id, key, searching);
      if (searching)
        return queue.enqueueTask(c, key, u.id, "discover", {
          ...body,
          webBrief: true,
        });
      const source = await c.query(
        `SELECT 1 FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id
         WHERE t.run_id=$1 AND t.user_id=$2 AND t.kind='discover'
         AND t.payload->'webBrief'='true'::jsonb AND r.status='completed'
         AND jsonb_array_length(t.result->'candidates')>0`,
        [body.searchRunId, u.id],
      );
      if (!source.rowCount)
        fail(404, "NOT_FOUND", "Không có kết quả web để tổng hợp.");
      return queue.enqueueTask(c, key, u.id, "enrich", {
        webBriefRunId: body.searchRunId,
      });
    });
    return reply
      .code(202)
      .send({ runId, statusUrl: "/api/account/custom-jobs/" + runId });
  });
  app.post<{ Params: { id: string } }>(
    "/api/account/custom-enrich/:id",
    async (r, reply) => {
      const u = user(r),
        id = parse(idSchema, r.params.id),
        config = await aiAvailability(pool, u.id);
      const article = (
        await pool.query(
          "SELECT a.* FROM news_articles a WHERE a.id=$1 AND EXISTS(SELECT 1 FROM news_matches m WHERE m.article_id=a.id AND m.user_id=$2)",
          [id, u.id],
        )
      ).rows[0];
      if (!article) fail(404, "NOT_FOUND", "Không tìm thấy kết quả.");
      const version = `extract.v1:${config.provider}:${config.model}:${config.pricingVersion}`;
      const cached = (
        await pool.query(
          "SELECT result FROM news_enrichment WHERE content_hash=$1 AND processing_version=$2",
          [article.content_hash, version],
        )
      ).rows[0];
      if (cached) return { result: cached.result, cached: true };
      const key = accountKey(
        "enrich:" + u.id,
        parse(z.uuid(), r.headers["idempotency-key"]),
      );
      const runId = await queue.transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "enrich:" + article.content_hash + version,
        ]);
        const payload = {
          description: article.title + "\n" + article.description,
          hash: article.content_hash,
          processingVersion: version,
        };
        if (
          (
            await c.query(
              "SELECT 1 FROM workflow_runs WHERE idempotency_key=$1 AND user_id=$2",
              [key, u.id],
            )
          ).rowCount
        )
          return queue.enqueueTask(c, key, u.id, "enrich", payload);
        const pending = await c.query(
          "SELECT 1 FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE t.kind='enrich' AND t.payload->>'hash'=$1 AND t.payload->>'processingVersion'=$2 AND r.status IN ('queued','running')",
          [article.content_hash, version],
        );
        if (pending.rowCount)
          fail(
            409,
            "ENRICH_PENDING",
            "Nội dung đang được xử lý dùng chung; thử lại sau.",
          );
        await admit(c, u.id, key);
        return queue.enqueueTask(c, key, u.id, "enrich", {
          description: article.title + "\n" + article.description,
          hash: article.content_hash,
          processingVersion: version,
        });
      });
      return reply
        .code(202)
        .send({ runId, statusUrl: "/api/account/custom-jobs/" + runId });
    },
  );
  app.get("/api/admin/premium", async (r) => {
    admin(r);
    const [users, audits, plans, requests] = await Promise.all([
      pool.query(
        "SELECT u.id,u.email,u.name,u.role,e.plan_id,e.starts_at,e.expires_at,e.status FROM hub_users u LEFT JOIN news_entitlements e ON e.user_id=u.id ORDER BY u.created_at LIMIT 1000",
      ),
      pool.query("SELECT * FROM news_audit ORDER BY id DESC LIMIT 100"),
      pool.query("SELECT * FROM news_plans ORDER BY id"),
      pool.query(
        "SELECT r.user_id,r.note,r.requested_at,u.name,u.email FROM news_plan_requests r JOIN hub_users u ON u.id=r.user_id WHERE r.status='pending' AND NOT u.disabled ORDER BY r.requested_at LIMIT 1000",
      ),
    ]);
    return {
      users: users.rows,
      audits: audits.rows,
      plans: plans.rows,
      requests: requests.rows,
    };
  });
  app.put<{ Params: { id: string } }>("/api/admin/premium/:id", async (r) => {
    const actor = admin(r),
      id = parse(idSchema, r.params.id),
      body = parse(
        z
          .object({
            plan: z.enum(["free", "premium"]),
            expiresAt: z.iso.datetime().nullable(),
            reason: z.string().trim().min(1).max(300),
          })
          .strict(),
        r.body,
      );
    if (
      body.plan === "premium" &&
      (!body.expiresAt || Date.parse(body.expiresAt) <= Date.now())
    )
      fail(400, "EXPIRY", "Ngày hết hạn phải ở tương lai.");
    await queue.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "premium:" + id,
      ]);
      if (
        !(await c.query("SELECT id FROM hub_users WHERE id=$1", [id])).rowCount
      )
        fail(404, "NOT_FOUND", "Không tìm thấy tài khoản.");
      const before = (
        await c.query("SELECT * FROM news_entitlements WHERE user_id=$1", [id])
      ).rows[0];
      await c.query(
        "INSERT INTO news_entitlements(user_id,plan_id,starts_at,expires_at,status,granted_by) VALUES($1,$2,now(),$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,starts_at=now(),expires_at=EXCLUDED.expires_at,status=EXCLUDED.status,granted_by=EXCLUDED.granted_by,updated_at=now()",
        [
          id,
          body.plan,
          body.plan === "premium" ? body.expiresAt : null,
          body.plan === "premium" ? "active" : "revoked",
          actor.id,
        ],
      );
      await audit(c, actor.id, id, "entitlement.change", {
        before,
        after: body,
      });
      if (body.plan === "premium")
        await c.query(
          "UPDATE news_plan_requests SET status='approved',reviewed_at=now(),reviewed_by=$2,review_note=NULL WHERE user_id=$1 AND status='pending'",
          [id, actor.id],
        );
    });
    return { updated: true };
  });
  app.post<{ Params: { id: string } }>(
    "/api/admin/premium-requests/:id/decline",
    async (r) => {
      const actor = admin(r),
        id = parse(idSchema, r.params.id),
        body = parse(
          z.object({ reason: z.string().trim().min(1).max(300) }).strict(),
          r.body,
        );
      await queue.transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "premium:" + id,
        ]);
        const row = await c.query(
          "UPDATE news_plan_requests SET status='declined',reviewed_at=now(),reviewed_by=$2,review_note=$3 WHERE user_id=$1 AND status='pending' RETURNING user_id",
          [id, actor.id, body.reason],
        );
        if (!row.rowCount)
          fail(404, "NOT_FOUND", "Yêu cầu đã được xử lý hoặc không tồn tại.");
        await audit(c, actor.id, id, "premium.decline", {
          reason: body.reason,
        });
      });
      return { updated: true };
    },
  );
  app.put<{ Params: { id: string } }>("/api/admin/plans/:id", async (r) => {
    const actor = admin(r),
      id = parse(z.enum(["free", "premium"]), r.params.id),
      body = parse(
        z
          .object({
            activeWatches: z.number().int().min(0).max(100),
            discoveryMonth: z.number().int().min(0).max(100),
            aiCallsMonth: z.number().int().min(0).max(1000),
            minIntervalMinutes: z.number().int().min(60).max(43200),
          })
          .strict(),
        r.body,
      );
    await queue.transaction(async (c) => {
      await c.query(
        "UPDATE news_plans SET active_watches=$2,discovery_month=$3,ai_calls_month=$4,min_interval_minutes=$5 WHERE id=$1",
        [
          id,
          body.activeWatches,
          body.discoveryMonth,
          body.aiCallsMonth,
          body.minIntervalMinutes,
        ],
      );
      await audit(c, actor.id, null, "plan.change", { id, ...body });
    });
    return { updated: true };
  });
  app.get("/api/admin/custom-ai", async (r) => {
    admin(r);
    const [config, usage, jobs, sources] = await Promise.all([
      pool.query("SELECT config FROM news_ai_control WHERE id=1"),
      pool.query("SELECT * FROM news_usage ORDER BY created_at DESC LIMIT 100"),
      pool.query(
        "SELECT t.run_id,t.kind,t.user_id,r.status,r.error FROM news_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE r.status='failed' ORDER BY r.created_at DESC LIMIT 100",
      ),
      pool.query(
        `SELECT s.id,s.name,s.url,s.status,s.created_at,s.last_error,
          s.status<>'approved' AND NOT EXISTS(SELECT 1 FROM news_source_articles a WHERE a.source_id=s.id) AS "canReplaceFeed"
         FROM news_sources s
         ORDER BY (s.status='pending') DESC,s.created_at DESC LIMIT 500`,
      ),
    ]);
    return {
      config: aiControlSchema.parse(config.rows[0].config),
      usage: usage.rows,
      jobs: jobs.rows,
      sources: sources.rows,
    };
  });
  app.put("/api/admin/custom-ai", async (r) => {
    const actor = admin(r),
      body = parse(aiControlSchema, r.body);
    await queue.transaction(async (c) => {
      await c.query("UPDATE news_ai_control SET config=$1::jsonb WHERE id=1", [
        JSON.stringify(body),
      ]);
      await audit(c, actor.id, null, "ai.control", body);
    });
    return { updated: true };
  });
  app.put<{ Params: { id: string } }>(
    "/api/admin/custom-sources/:id",
    async (r) => {
      const actor = admin(r),
        id = parse(idSchema, r.params.id),
        body = parse(
          z.discriminatedUnion("status", [
            z
              .object({
                status: z.literal("approved"),
                feedUrl: sourceSchema.shape.url.optional(),
              })
              .strict(),
            z.object({ status: z.literal("rejected") }).strict(),
          ]),
          r.body,
        );
      const source = (
        await pool.query(
          `SELECT s.name,s.url,s.status,
            EXISTS(SELECT 1 FROM news_source_articles a WHERE a.source_id=s.id) AS "hasArticles"
           FROM news_sources s WHERE s.id=$1`,
          [id],
        )
      ).rows[0];
      if (!source) fail(404, "NOT_FOUND", "Không tìm thấy nguồn.");
      let url = source.url as string;
      if (body.status === "approved") {
        if (
          body.feedUrl &&
          (source.status === "approved" || source.hasArticles)
        )
          fail(
            409,
            "SOURCE_CHANGED",
            "Nguồn này đã được sử dụng. Hãy tạo đề xuất mới nếu cần đổi đường dẫn.",
          );
        const feed = checkUrl(body.feedUrl ?? url);
        feed.hash = "";
        url = feed.toString();
        const checked = await fetchRss(
          [{ id, name: source.name, url, enabled: true }],
          { http: sourceHttp, signal: AbortSignal.timeout(10000) },
        );
        if (checked.status !== "success")
          fail(
            400,
            "SOURCE_NOT_READABLE",
            checked.errors.some(
              (error) =>
                error.code === "NOT_RSS_FEED" ||
                error.code === "RESPONSE_LIMIT",
            )
              ? "Địa chỉ này không đọc được như bảng tin. Hãy nhập đường dẫn RSS/Atom của trang rồi thử lại."
              : "Không mở được bảng tin RSS/Atom. Kiểm tra đường dẫn hoặc thử lại sau.",
          );
      }
      try {
        const reviewed = await queue.transaction(async (c) => {
          const updated = await c.query(
            `UPDATE news_sources SET status=$2,reviewed_by=$3,reviewed_at=now(),url=$4,
                last_error=CASE WHEN $2='approved' THEN NULL ELSE last_error END
             WHERE id=$1 AND url=$5 AND status=$6
               AND ($4=$5 OR NOT EXISTS(SELECT 1 FROM news_source_articles a WHERE a.source_id=$1))
             RETURNING id,name,url,status,last_error,
               status<>'approved' AND NOT EXISTS(SELECT 1 FROM news_source_articles a WHERE a.source_id=$1) AS "canReplaceFeed"`,
            [id, body.status, actor.id, url, source.url, source.status],
          );
          if (!updated.rowCount)
            fail(
              409,
              "SOURCE_CHANGED",
              "Đề nghị đã thay đổi. Tải lại danh sách rồi thử lại.",
            );
          await audit(c, actor.id, null, "source.review", {
            id,
            status: body.status,
          });
          return updated.rows[0];
        });
        return { updated: true, source: reviewed };
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          fail(
            409,
            "SOURCE_EXISTS",
            "Đường dẫn nguồn tin này đã có trong danh sách.",
          );
        throw error;
      }
    },
  );
}
