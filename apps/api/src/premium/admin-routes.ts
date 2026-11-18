import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { aiControlSchema, normalizeUrl, safeHttpUrlSchema } from "@hub/contracts";
import type { WorkflowQueue } from "../workflows/queue.js";
import { checkUrl, type HttpClient } from "../connectors/http.js";
import { fetchRss } from "../connectors/rss.js";
import { fail, audit } from "./store.js";

const idSchema = z.uuid();

export function registerPremiumAdminRoutes(
  app: FastifyInstance,
  pool: Pool,
  queue: WorkflowQueue,
  parse: <T>(schema: z.ZodType<T>, value: unknown) => T,
  proposeSource: (userId: string, input: unknown) => Promise<string | null>,
  sourceHttp?: HttpClient,
) {
  const admin = (r: { accountUser: { id: string; role: string } | null }) => {
    const u = r.accountUser ?? fail(401, "AUTH_REQUIRED", "Vui lòng đăng nhập.");
    if (u.role !== "admin") fail(403, "ADMIN_REQUIRED", "Cần quyền quản trị.");
    return u;
  };

  app.post("/api/admin/custom-sources", async (r, reply) => {
    const u = admin(r);
    const id = await proposeSource(u.id, r.body);
    if (!id) {
      fail(409, "SOURCE_EXISTS", "Đường dẫn này đã có trong hệ thống.");
    }
    return reply.code(202).send({
      id,
      message:
        "Đã gửi đề nghị. Trang sẽ xuất hiện trong danh sách nếu được duyệt.",
    });
  });

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
      if (body.plan === "premium") {
        await c.query(
          "UPDATE news_plan_requests SET status='approved',reviewed_at=now(),reviewed_by=$2,review_note=NULL WHERE user_id=$1 AND status='pending'",
          [id, actor.id],
        );
      } else {
        await c.query(
          "UPDATE news_plan_requests SET status='declined',reviewed_at=now(),reviewed_by=$2,review_note=$3 WHERE user_id=$1 AND status='pending'",
          [id, actor.id, body.reason],
        );
      }
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
                feedUrl: safeHttpUrlSchema.max(2000).optional(),
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
        url = normalizeUrl(feed.toString());
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
