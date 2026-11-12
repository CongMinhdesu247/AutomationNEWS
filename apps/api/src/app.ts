import { registerRunEvents, type SseOptions } from "./telemetry/sse.js";
import { WorkflowQueue } from "./workflows/queue.js";
import Fastify from "fastify";
import type { Pool } from "pg";
import {
  settingsSchema,
  validationIssues,
  type Settings,
  type ApiError,
} from "@hub/contracts";
import { DigestStore } from "./digests/store.js";
import {
  DigestService,
  RequestError,
  type ServiceOptions,
} from "./digests/service.js";
import { digestRoutes } from "./digests/routes.js";
import { registerFamilyRoutes } from "./family/routes.js";
import { githubFamilyAdmin, type FamilyCloudAdmin } from "./family/cloud-admin.js";
export function buildApp(
  pool: Pool,
  options: ServiceOptions = {},
  sseOptions: SseOptions = {},
  familyCloud: FamilyCloudAdmin = githubFamilyAdmin(process.env.HUB_CLOUD_REPOSITORY,process.env.HUB_CLOUD_ADMIN_TOKEN),
) {
  const app = Fastify({ logger: false, bodyLimit: 262144 });
  const failure = (code: string, message: string): ApiError => ({
    error: { code, message, issues: [] },
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RequestError) {
      reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          issues: error.issues,
        },
      });
      return;
    }
    const statusCode =
      error instanceof Error && "statusCode" in error
        ? error.statusCode
        : undefined;
    const status =
      typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
        ? statusCode
        : 500;
    reply
      .code(status)
      .send(
        failure(
          status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
          status === 500
            ? "Không thể xử lý yêu cầu. Vui lòng thử lại."
            : "Yêu cầu không hợp lệ hoặc vượt giới hạn dung lượng.",
        ),
      );
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(failure("NOT_FOUND", "Không tìm thấy endpoint.")),
  );
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/ready", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply
        .code(503)
        .send(failure("DATABASE_UNAVAILABLE", "Database chưa sẵn sàng."));
    }
  });
  app.get("/api/settings", async () => {
    const result = await pool.query<{ config: Settings }>(
      "SELECT config FROM settings WHERE id = $1",
      [1],
    );
    // Parse on output too: unknown or sensitive fields must never reach the browser.
    return settingsSchema.parse(result.rows[0]?.config);
  });
  app.put("/api/settings", async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Vui lòng kiểm tra các trường được đánh dấu.",
          issues: validationIssues(parsed.error),
        },
      } satisfies ApiError);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ config: Settings }>(
        "UPDATE settings SET config = $1::jsonb, updated_at = now() WHERE id = $2 RETURNING config",
        [JSON.stringify(parsed.data), 1],
      );
      const saved = settingsSchema.parse(result.rows[0]?.config);
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  const store = new DigestStore(pool);
  registerFamilyRoutes(app,pool,familyCloud);
  digestRoutes(
    app,
    store,
    new DigestService(store, options),
    new WorkflowQueue(pool, { sourceTimeoutMs: options.totalTimeoutMs }),
  );
  registerRunEvents(app, pool, sseOptions);
  return app;
}
