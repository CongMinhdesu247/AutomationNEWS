import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  bookmarkInputSchema,
  digestIdSchema,
  normalizeUrl,
  paginationSchema,
  requestKeySchema,
  safeExternalHref,
  settingsSchema,
  hasEnabledSources,
  validationIssues,
  type BookmarkItem,
  type Settings,
} from "@hub/contracts";
import { WorkflowQueue } from "../workflows/queue.js";
import { DigestStore } from "../digests/store.js";
import {
  DigestService,
  RequestError,
  type ServiceOptions,
} from "../digests/service.js";
import { accountPreferencesSchema } from "./preferences.js";
import { nextAccountSend } from "./schedule.js";

// Keep the existing UUID idempotency contract, scoped to the authenticated account.
export function accountKey(userId: string, key: string) {
  const hex = createHash("sha256")
    .update(userId + ":" + key)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type AccountSettingsRow = {
  config: Settings;
  days: number[];
  theme: "light" | "dark";
  revision: number;
  next_run_at: Date | null;
  last_checked_at: Date | null;
};

export function registerAccountRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: ServiceOptions,
  throttle: (key: string, max: number, seconds: number) => Promise<void>,
  shared?: {
    store: DigestStore;
    service: DigestService;
    queue: WorkflowQueue;
  },
) {
  const queue =
    shared?.queue ??
    new WorkflowQueue(pool, {
      sourceTimeoutMs: options.totalTimeoutMs,
    });
  const store = shared?.store ?? new DigestStore(pool);
  const service = shared?.service ?? new DigestService(store, options);

  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new RequestError(
        400,
        "VALIDATION_ERROR",
        "Kiểm tra lại các lựa chọn.",
        validationIssues(result.error),
      );
    return result.data;
  }

  async function owned(
    table: "digests" | "workflow_runs",
    id: string,
    userId: string,
  ) {
    if (
      !(
        await pool.query(`SELECT 1 FROM ${table} WHERE id=$1 AND user_id=$2`, [
          id,
          userId,
        ])
      ).rowCount
    )
      throw new RequestError(404, "NOT_FOUND", "Không tìm thấy bản tin.");
  }

  app.get("/api/account", async (request) => {
    const result = (
      await pool.query<AccountSettingsRow>(
        "SELECT config,days,theme,revision,next_run_at,last_checked_at FROM user_settings WHERE user_id=$1",
        [request.accountUser!.id],
      )
    ).rows[0];
    if (!result)
      throw new RequestError(
        404,
        "ACCOUNT_SETTINGS_MISSING",
        "Không tìm thấy cấu hình tài khoản.",
      );
    return {
      user: request.accountUser,
      settings: settingsSchema.parse(result.config),
      days: result.days,
      theme: result.theme,
      revision: result.revision,
      nextRunAt: result.next_run_at,
      lastCheckedAt: result.last_checked_at,
    };
  });

  app.put("/api/account/preferences", async (request) => {
    const userId = request.accountUser!.id;
    const data = parse(accountPreferencesSchema, request.body);
    if (data.settings.newsletter.enabled && !hasEnabledSources(data.settings))
      throw new RequestError(
        400,
        "NO_ENABLED_SOURCE",
        "Chọn ít nhất một nội dung trước khi bật lịch.",
      );
    const uniqueDays = [...new Set(data.days)].sort((a, b) => a - b);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = (
        await client.query<{ config: Settings; revision: number }>(
          "SELECT config,revision FROM user_settings WHERE user_id=$1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
      if (!current)
        throw new RequestError(
          404,
          "ACCOUNT_SETTINGS_MISSING",
          "Không tìm thấy cấu hình tài khoản.",
        );
      if (current.revision !== data.revision)
        throw new RequestError(
          409,
          "REVISION_CONFLICT",
          "Cấu hình đã thay đổi. Tải lại trước khi lưu.",
        );
      // Destination is provisioned by the server. Members cannot send the shared token elsewhere.
      if (
        data.settings.notifications.topic !==
          current.config.notifications.topic ||
        data.settings.notifications.serverUrl !==
          current.config.notifications.serverUrl
      )
        throw new RequestError(
          400,
          "DESTINATION",
          "Không được thay đổi địa chỉ nhận do hệ thống cấp.",
        );
      if (data.settings.rss.length > 16)
        throw new RequestError(
          400,
          "SOURCE_LIMIT",
          "Tối đa 16 nguồn RSS cho mỗi tài khoản.",
        );
      const next = data.settings.newsletter.enabled
        ? nextAccountSend(
            new Date(),
            data.settings.newsletter.sendTime,
            data.settings.newsletter.timezone,
            uniqueDays,
          )
        : null;
      const saved = (
        await client.query<{ revision: number; next_run_at: Date | null }>(
          "UPDATE user_settings SET config=$2::jsonb,days=$3,theme=$4,revision=revision+1,next_run_at=$5,updated_at=now() WHERE user_id=$1 RETURNING revision,next_run_at",
          [userId, JSON.stringify(data.settings), uniqueDays, data.theme, next],
        )
      ).rows[0]!;
      await client.query("COMMIT");
      return { revision: saved.revision, nextRunAt: saved.next_run_at };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/account/digests", async (request, reply) => {
    const userId = request.accountUser!.id;
    const key = accountKey(
      userId,
      parse(requestKeySchema, request.headers["idempotency-key"]),
    );
    const id = await queue.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["manual:" + userId],
      );
      const previous = (
        await client.query<{ id: string }>(
          "SELECT id FROM workflow_runs WHERE idempotency_key=$1 AND user_id=$2",
          [key, userId],
        )
      ).rows[0];
      if (previous) return previous.id;
      const count = (
        await client.query<{ count: string }>(
          "SELECT count(*) FROM workflow_runs WHERE user_id=$1 AND workflow->>'version'='digest.v1' AND created_at>now()-interval '1 day' AND scheduled_at IS NULL",
          [userId],
        )
      ).rows[0]!;
      if (Number(count.count) >= 10)
        throw new RequestError(
          429,
          "RUN_LIMIT",
          "Tối đa 10 bản tin thủ công mỗi ngày.",
        );
      const settingsRow = (
        await client.query<{ config: Settings }>(
          "SELECT config FROM user_settings WHERE user_id=$1",
          [userId],
        )
      ).rows[0];
      const settings = settingsSchema.parse(settingsRow?.config);
      return queue.enqueue(client, key, {}, undefined, settings, userId);
    });
    return reply.code(202).send({ runId: id, statusUrl: "/api/runs/" + id });
  });

  app.get("/api/account/runs", async (request) => {
    const { page, pageSize } = parse(paginationSchema, request.query);
    return queue.list(page, pageSize, request.accountUser!.id);
  });

  app.get("/api/account/digests", async (request) => {
    const { page, pageSize } = parse(paginationSchema, request.query);
    return store.list(page, pageSize, request.accountUser!.id);
  });

  app.get<{ Params: { id: string } }>(
    "/api/account/digests/:id",
    async (request) => {
      const id = parse(digestIdSchema, request.params.id);
      await owned("digests", id, request.accountUser!.id);
      return service.localize((await store.get(id))!, { allowExternalFetch: false });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/account/digests/:id/notifications",
    async (request) => {
      const userId = request.accountUser!.id;
      const id = parse(digestIdSchema, request.params.id);
      const key = parse(requestKeySchema, request.headers["idempotency-key"]);
      await owned("digests", id, userId);
      const previous = await store.notificationByKey(id, key);
      if (previous) return previous;
      await throttle("send:" + userId, 5, 3600);
      const settings = settingsSchema.parse(
        (
          await pool.query<{ config: Settings }>(
            "SELECT config FROM user_settings WHERE user_id=$1",
            [userId],
          )
        ).rows[0]?.config,
      );
      return service.notify(id, key, settings.notifications);
    },
  );

  app.get("/api/admin/users", async () => ({
    users: (
      await pool.query(
        "SELECT id,email,name,role,disabled,created_at FROM hub_users ORDER BY created_at,id LIMIT 1000",
      )
    ).rows,
  }));

  let cachedPublicPreview: {
    at: number;
    data: {
      starterSourcesCount: number;
      latestCatalogArticles: Array<{
        title: string;
        source: string;
        publishedAt: string;
      }>;
    };
  } | null = null;

  app.get("/api/public/preview", async () => {
    const now = Date.now();
    if (cachedPublicPreview && now - cachedPublicPreview.at < 300000) {
      return cachedPublicPreview.data;
    }
    try {
      const [sourcesRes, articlesRes] = await Promise.all([
        pool.query<{ count: string }>(
          "SELECT count(*) FROM news_sources WHERE status='approved'",
        ),
        pool.query<{
          title: string;
          source: string;
          published_at: Date;
        }>(
          `SELECT a.title, s.name AS source, a.published_at
             FROM news_articles a
             JOIN news_source_articles sa ON sa.article_id = a.id
             JOIN news_sources s ON s.id = sa.source_id
            WHERE s.status = 'approved'
              AND s.catalog_rank IS NOT NULL
              AND a.published_at IS NOT NULL
            ORDER BY a.published_at DESC
            LIMIT 4`,
        ),
      ]);
      const data = {
        starterSourcesCount: Number(sourcesRes.rows[0]?.count ?? 0),
        latestCatalogArticles: articlesRes.rows.map((r) => ({
          title: r.title,
          source: r.source,
          publishedAt: new Date(r.published_at).toISOString(),
        })),
      };
      cachedPublicPreview = { at: now, data };
      return data;
    } catch {
      return { starterSourcesCount: 0, latestCatalogArticles: [] };
    }
  });

  app.patch("/api/account/theme", async (request) => {
    const userId = request.accountUser!.id;
    const body = parse(
      z.object({ theme: z.enum(["light", "dark"]) }).strict(),
      request.body,
    );
    const updated = await pool.query<{ theme: "light" | "dark" }>(
      "UPDATE user_settings SET theme=$2, updated_at=now() WHERE user_id=$1 RETURNING theme",
      [userId, body.theme],
    );
    if (!updated.rowCount)
      throw new RequestError(
        404,
        "ACCOUNT_SETTINGS_MISSING",
        "Không tìm thấy cấu hình tài khoản.",
      );
    return { theme: updated.rows[0]!.theme };
  });

  app.patch<{ Params: { id: string } }>(
    "/api/account/tasks/:id",
    async (request) => {
      const userId = request.accountUser!.id;
      const taskId = parse(digestIdSchema, request.params.id);
      const body = parse(
        z.object({ done: z.boolean() }).strict(),
        request.body,
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = (
          await client.query<{ config: Settings; revision: number }>(
            "SELECT config, revision FROM user_settings WHERE user_id=$1 FOR UPDATE",
            [userId],
          )
        ).rows[0];
        if (!row)
          throw new RequestError(
            404,
            "ACCOUNT_SETTINGS_MISSING",
            "Không tìm thấy cấu hình tài khoản.",
          );
        const settings = settingsSchema.parse(row.config);
        const items = settings.tasks?.items ?? [];
        if (!items.some((item) => item.id === taskId))
          throw new RequestError(
            404,
            "TASK_NOT_FOUND",
            "Không tìm thấy việc cần làm.",
          );
        const nextSettings: Settings = {
          ...settings,
          tasks: {
            enabled: settings.tasks?.enabled ?? true,
            items: items.map((item) =>
              item.id === taskId ? { ...item, done: body.done } : item,
            ),
          },
        };
        const saved = (
          await client.query<{ revision: number }>(
            "UPDATE user_settings SET config=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision",
            [userId, JSON.stringify(nextSettings)],
          )
        ).rows[0]!;
        await client.query("COMMIT");
        return {
          updated: true,
          done: body.done,
          revision: saved.revision,
          settings: nextSettings,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post("/api/account/ntfy-topic/rotate", async (request) => {
    const userId = request.accountUser!.id;
    parse(z.object({}).strict(), request.body ?? {});
    await throttle("topic-rotate:" + userId, 5, 3600);
    const nextTopic = "hub_" + randomBytes(24).toString("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query<{ config: Settings }>(
          "SELECT config FROM user_settings WHERE user_id=$1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
      if (!row)
        throw new RequestError(
          404,
          "ACCOUNT_SETTINGS_MISSING",
          "Không tìm thấy cấu hình tài khoản.",
        );
      const settings = settingsSchema.parse(row.config);
      const nextSettings: Settings = {
        ...settings,
        notifications: {
          ...settings.notifications,
          topic: nextTopic,
        },
      };
      const saved = (
        await client.query<{ revision: number }>(
          "UPDATE user_settings SET config=$2::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$1 RETURNING revision",
          [userId, JSON.stringify(nextSettings)],
        )
      ).rows[0]!;
      await client.query("COMMIT");
      return { topic: nextTopic, revision: saved.revision };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/account/digests/:id/read",
    async (request) => {
      const userId = request.accountUser!.id;
      const digestId = parse(digestIdSchema, request.params.id);
      await owned("digests", digestId, userId);
      try {
        const res = await pool.query<{ read_at: Date }>(
          `INSERT INTO user_digest_reads(user_id, digest_id, read_at)
           VALUES ($1, $2, now())
           ON CONFLICT (user_id, digest_id) DO UPDATE SET read_at = EXCLUDED.read_at
           RETURNING read_at`,
          [userId, digestId],
        );
        return {
          read: true,
          readAt: new Date(res.rows[0]!.read_at).toISOString(),
        };
      } catch {
        return { read: true, readAt: new Date().toISOString() };
      }
    },
  );

  app.get("/api/account/bookmarks", async (request) => {
    const userId = request.accountUser!.id;
    try {
      const rows = await pool.query<{
        id: string;
        url: string;
        title: string;
        source: string;
        summary: string;
        kind: BookmarkItem["kind"];
        digest_id: string | null;
        created_at: Date;
      }>(
        `SELECT id, url, title, source, summary, kind, digest_id, created_at
           FROM user_bookmarks
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 200`,
        [userId],
      );
      return {
        items: rows.rows.map(
          (row): BookmarkItem => ({
            id: row.id,
            url: row.url,
            title: row.title,
            source: row.source,
            summary: row.summary,
            kind: row.kind,
            digestId: row.digest_id,
            createdAt: new Date(row.created_at).toISOString(),
          }),
        ),
      };
    } catch {
      return { items: [] as BookmarkItem[] };
    }
  });

  app.post("/api/account/bookmarks", async (request, reply) => {
    const userId = request.accountUser!.id;
    const body = parse(bookmarkInputSchema, request.body);
    const safeHref = safeExternalHref(body.url);
    if (!safeHref)
      throw new RequestError(
        400,
        "INVALID_URL",
        "Đường dẫn bài viết cần là HTTP/HTTPS hợp lệ.",
      );
    const canonicalUrl = normalizeUrl(safeHref);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "bookmarks:" + userId,
      ]);
      const existing = await client.query<{
        id: string;
        url: string;
        title: string;
        source: string;
        summary: string;
        kind: BookmarkItem["kind"];
        digest_id: string | null;
        created_at: Date;
      }>(
        "SELECT id, url, title, source, summary, kind, digest_id, created_at FROM user_bookmarks WHERE user_id=$1 AND url=$2",
        [userId, canonicalUrl],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        const row = existing.rows[0];
        return {
          bookmark: {
            id: row.id,
            url: row.url,
            title: row.title,
            source: row.source,
            summary: row.summary,
            kind: row.kind,
            digestId: row.digest_id,
            createdAt: new Date(row.created_at).toISOString(),
          } satisfies BookmarkItem,
        };
      }
      const count = Number(
        (
          await client.query<{ count: string }>(
            "SELECT count(*) FROM user_bookmarks WHERE user_id=$1",
            [userId],
          )
        ).rows[0]?.count ?? 0,
      );
      if (count >= 200)
        throw new RequestError(
          429,
          "BOOKMARK_LIMIT",
          "Tối đa 200 mục lưu đọc sau. Hãy xóa bớt mục cũ.",
        );
      let digestId: string | null = null;
      if (body.digestId) {
        const ownedDigest = await client.query(
          "SELECT 1 FROM digests WHERE id=$1 AND user_id=$2",
          [body.digestId, userId],
        );
        if (ownedDigest.rowCount) digestId = body.digestId;
      }
      const inserted = (
        await client.query<{
          id: string;
          url: string;
          title: string;
          source: string;
          summary: string;
          kind: BookmarkItem["kind"];
          digest_id: string | null;
          created_at: Date;
        }>(
          `INSERT INTO user_bookmarks(id, user_id, url, title, source, summary, kind, digest_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, url, title, source, summary, kind, digest_id, created_at`,
          [
            crypto.randomUUID(),
            userId,
            canonicalUrl,
            body.title,
            body.source,
            body.summary,
            body.kind,
            digestId,
          ],
        )
      ).rows[0]!;
      await client.query("COMMIT");
      return reply.code(201).send({
        bookmark: {
          id: inserted.id,
          url: inserted.url,
          title: inserted.title,
          source: inserted.source,
          summary: inserted.summary,
          kind: inserted.kind,
          digestId: inserted.digest_id,
          createdAt: new Date(inserted.created_at).toISOString(),
        } satisfies BookmarkItem,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/account/bookmarks/:id",
    async (request) => {
      const userId = request.accountUser!.id;
      const id = parse(digestIdSchema, request.params.id);
      const removed = await pool.query(
        "DELETE FROM user_bookmarks WHERE id=$1 AND user_id=$2 RETURNING id",
        [id, userId],
      );
      if (!removed.rowCount)
        throw new RequestError(
          404,
          "BOOKMARK_NOT_FOUND",
          "Không tìm thấy mục đã lưu.",
        );
      return { deleted: true };
    },
  );

  app.get("/api/admin/system-health", async () => {
    const [jobsRes, usersRes, schedRes] = await Promise.all([
      pool.query<{
        queued: number;
        leased: number;
        dead_letters: number;
        failed_24h: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM workflow_jobs WHERE status='queued') AS queued,
           (SELECT count(*)::int FROM workflow_jobs WHERE status='leased') AS leased,
           (SELECT count(*)::int FROM dead_letters WHERE replay_run_id IS NULL) AS dead_letters,
           (SELECT count(*)::int FROM workflow_runs WHERE status='failed' AND created_at > now() - interval '24 hours') AS failed_24h`,
      ),
      pool.query<{ active_users: number; scheduled_users: number }>(
        `SELECT
           (SELECT count(*)::int FROM hub_users WHERE NOT disabled) AS active_users,
           (SELECT count(*)::int FROM user_settings s JOIN hub_users u ON u.id=s.user_id WHERE NOT u.disabled AND s.next_run_at IS NOT NULL) AS scheduled_users`,
      ),
      pool.query<{ last_checked_at: Date | null }>(
        `SELECT greatest(
           (SELECT last_checked_at FROM digest_schedule WHERE id=1),
           (SELECT max(last_checked_at) FROM user_settings)
         ) AS last_checked_at`,
      ),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      dbPool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
      queue: jobsRes.rows[0] ?? {
        queued: 0,
        leased: 0,
        dead_letters: 0,
        failed_24h: 0,
      },
      users: usersRes.rows[0] ?? { active_users: 0, scheduled_users: 0 },
      schedulerLastCheckedAt: schedRes.rows[0]?.last_checked_at
        ? new Date(schedRes.rows[0].last_checked_at).toISOString()
        : null,
    };
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/users/:id",
    async (request) => {
      const id = parse(digestIdSchema, request.params.id);
      const body = parse(
        z.object({ disabled: z.boolean() }).strict(),
        request.body,
      );
      if (id === request.accountUser!.id)
        throw new RequestError(
          400,
          "SELF_DISABLE",
          "Không thể khóa chính tài khoản đang sử dụng.",
        );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          "UPDATE hub_users SET disabled=$2 WHERE id=$1 AND role='member' RETURNING id",
          [id, body.disabled],
        );
        if (!result.rowCount)
          throw new RequestError(
            404,
            "USER_NOT_FOUND",
            "Không tìm thấy thành viên.",
          );
        await client.query("DELETE FROM user_sessions WHERE user_id=$1", [id]);
        if (body.disabled)
          await client.query(
            "UPDATE user_settings SET next_run_at=NULL WHERE user_id=$1",
            [id],
          );
        else {
          const row = (
            await client.query<{ config: Settings; days: number[] }>(
              "SELECT config,days FROM user_settings WHERE user_id=$1",
              [id],
            )
          ).rows[0];
          if (row) {
            const settings = settingsSchema.parse(row.config);
            if (settings.newsletter.enabled)
              await client.query(
                "UPDATE user_settings SET next_run_at=$2 WHERE user_id=$1",
                [
                  id,
                  nextAccountSend(
                    new Date(),
                    settings.newsletter.sendTime,
                    settings.newsletter.timezone,
                    row.days,
                  ),
                ],
              );
          }
        }
        await client.query("COMMIT");
        return { updated: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
