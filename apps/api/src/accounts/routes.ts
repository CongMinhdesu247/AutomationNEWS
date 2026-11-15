import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  digestIdSchema,
  paginationSchema,
  requestKeySchema,
  settingsSchema,
  hasEnabledSources,
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
export function registerAccountRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: ServiceOptions,
  throttle: (key: string, max: number, seconds: number) => Promise<void>,
) {
  const queue = new WorkflowQueue(pool, {
    sourceTimeoutMs: options.totalTimeoutMs,
  });
  const store = new DigestStore(pool);
  const service = new DigestService(store, options);
  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new RequestError(
        400,
        "VALIDATION_ERROR",
        "Kiểm tra lại các lựa chọn.",
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
      await pool.query(
        "SELECT config,days,theme,revision,next_run_at,last_checked_at FROM user_settings WHERE user_id=$1",
        [request.accountUser!.id],
      )
    ).rows[0];
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
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = (
        await client.query(
          "SELECT config,revision FROM user_settings WHERE user_id=$1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
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
            data.days,
          )
        : null;
      const saved = (
        await client.query(
          "UPDATE user_settings SET config=$2::jsonb,days=$3,theme=$4,revision=revision+1,next_run_at=$5,updated_at=now() WHERE user_id=$1 RETURNING revision,next_run_at",
          [userId, JSON.stringify(data.settings), data.days, data.theme, next],
        )
      ).rows[0];
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
        await client.query(
          "SELECT id FROM workflow_runs WHERE idempotency_key=$1 AND user_id=$2",
          [key, userId],
        )
      ).rows[0];
      if (previous) return previous.id as string;
      const count = (
        await client.query(
          "SELECT count(*) FROM workflow_runs WHERE user_id=$1 AND created_at>now()-interval '1 day' AND scheduled_at IS NULL",
          [userId],
        )
      ).rows[0];
      if (Number(count.count) >= 10)
        throw new RequestError(
          429,
          "RUN_LIMIT",
          "Tối đa 10 bản tin thủ công mỗi ngày.",
        );
      const settings = settingsSchema.parse(
        (
          await client.query(
            "SELECT config FROM user_settings WHERE user_id=$1",
            [userId],
          )
        ).rows[0].config,
      );
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
      return service.localize((await store.get(id))!);
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
          await pool.query(
            "SELECT config FROM user_settings WHERE user_id=$1",
            [userId],
          )
        ).rows[0].config,
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
            await client.query(
              "SELECT config,days FROM user_settings WHERE user_id=$1",
              [id],
            )
          ).rows[0];
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
