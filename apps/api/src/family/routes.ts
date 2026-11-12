import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  familyConfigSchema,
  familyProfileSchema,
  settingsSchema,
  validationIssues,
  type FamilyConfig,
  type FamilyDocument,
} from "@hub/contracts";
import { RequestError } from "../digests/service.js";
import type { FamilyCloudAdmin } from "./cloud-admin.js";

export function registerFamilyRoutes(
  app: FastifyInstance,
  pool: Pool,
  cloud: FamilyCloudAdmin,
) {
  let syncing = false;
  const adminRequest = async (request: FastifyRequest) => {
    const origin = request.headers.origin;
    const allowed = [
      process.env.HUB_ADMIN_ORIGIN ?? "http://127.0.0.1:8088",
      "http://localhost:8088",
    ];
    if (origin && !allowed.includes(origin))
      throw new RequestError(
        403,
        "ADMIN_ORIGIN",
        "Chỉ quản lý hồ sơ từ dashboard trên máy.",
      );
    if (!request.headers["content-type"]?.startsWith("application/json"))
      throw new RequestError(415, "JSON_REQUIRED", "Yêu cầu phải dùng JSON.");
  };
  async function read(): Promise<FamilyDocument> {
    let row = (
      await pool.query(
        "SELECT config,revision,synced_revision,synced_at FROM family_configuration WHERE id=1",
      )
    ).rows[0];
    if (!row) {
      const settings = settingsSchema.parse(
        (await pool.query("SELECT config FROM settings WHERE id=1")).rows[0]
          ?.config,
      );
      const profile = familyProfileSchema.parse({
        id: "personal",
        name: "Tôi",
        enabled: Boolean(
          settings.notifications.enabled && settings.notifications.topic,
        ),
        city: "hanoi",
        sendTime: settings.newsletter.sendTime
          .replace(/:[0-2]\d$/, ":00")
          .replace(/:[3-5]\d$/, ":30"),
        days: [1, 2, 3, 4, 5, 6, 7],
        newsTopics: settings.rss.some((f) => f.enabled) ? ["technology"] : [],
        weather:
          settings.weather.enabled ||
          !(
            settings.github.enabled ||
            settings.fuel?.enabled ||
            settings.airQuality?.enabled ||
            settings.rss.some((f) => f.enabled)
          ),
        airQuality: settings.airQuality?.enabled ?? false,
        fuel: settings.fuel?.enabled ?? false,
        github: settings.github.enabled,
        topic: settings.notifications.topic,
        githubTopics: settings.github.topics,
        githubLanguages: settings.github.languages,
      });
      await pool.query(
        "INSERT INTO family_configuration(id,config) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING",
        [JSON.stringify({ version: 1, profiles: [profile] })],
      );
      row = (
        await pool.query(
          "SELECT config,revision,synced_revision,synced_at FROM family_configuration WHERE id=1",
        )
      ).rows[0];
    }
    return {
      config: familyConfigSchema.parse(row.config),
      revision: row.revision,
      syncedRevision: row.synced_revision,
      syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : null,
      cloudConfigured: cloud.configured,
    };
  }
  async function sync(config: FamilyConfig, revision: number) {
    if (syncing)
      throw new RequestError(
        409,
        "SYNC_BUSY",
        "Đang đồng bộ; vui lòng thử lại sau.",
      );
    syncing = true;
    try {
      await cloud.sync(config);
      await pool.query(
        "UPDATE family_configuration SET synced_revision=$1,synced_at=now() WHERE id=1 AND revision=$1",
        [revision],
      );
    } finally {
      syncing = false;
    }
  }
  app.get("/api/family", read);
  app.put("/api/family", { preHandler: adminRequest }, async (request) => {
    const parsed = z
      .object({
        config: familyConfigSchema,
        revision: z.number().int().positive(),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      throw new RequestError(
        400,
        "VALIDATION_ERROR",
        "Kiểm tra lại hồ sơ gia đình.",
        validationIssues(parsed.error),
      );
    // Serialize edits and synchronization in this API process; SQL revision protects other instances.
    if (syncing)
      throw new RequestError(
        409,
        "SYNC_BUSY",
        "Đang đồng bộ; dữ liệu nhập vẫn được giữ.",
      );
    const result = await pool.query(
      "UPDATE family_configuration SET config=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1 AND revision=$2 RETURNING revision",
      [JSON.stringify(parsed.data.config), parsed.data.revision],
    );
    if (!result.rowCount)
      throw new RequestError(
        409,
        "REVISION_CONFLICT",
        "Hồ sơ đã được sửa ở cửa sổ khác. Tải lại trước khi lưu.",
      );
    let syncError: string | undefined;
    try {
      await sync(parsed.data.config, result.rows[0].revision);
    } catch {
      syncError =
        "Đã lưu trên máy nhưng chưa đồng bộ cloud. Lịch cloud vẫn dùng cấu hình trước đó; bấm Đồng bộ lại.";
    }
    return { ...(await read()), ...(syncError ? { syncError } : {}) };
  });
  app.post(
    "/api/family/sync",
    { preHandler: adminRequest },
    async (request) => {
      if (!z.object({}).strict().safeParse(request.body).success)
        throw new RequestError(
          400,
          "VALIDATION_ERROR",
          "Yêu cầu không hợp lệ.",
        );
      const document = await read();
      try {
        await sync(document.config, document.revision);
      } catch (error) {
        if (error instanceof RequestError) throw error;
        throw new RequestError(
          502,
          "CLOUD_SYNC_FAILED",
          "Chưa đồng bộ được cloud; cấu hình trên máy vẫn được giữ.",
        );
      }
      return read();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/family/:id/test",
    { preHandler: adminRequest },
    async (request, reply) => {
      if (!z.object({}).strict().safeParse(request.body).success)
        throw new RequestError(
          400,
          "VALIDATION_ERROR",
          "Yêu cầu không hợp lệ.",
        );
      const document = await read();
      const profile = document.config.profiles.find(
        (p) => p.id === request.params.id,
      );
      if (!profile)
        throw new RequestError(
          404,
          "PROFILE_NOT_FOUND",
          "Không tìm thấy hồ sơ.",
        );
      if (!profile.topic)
        throw new RequestError(
          400,
          "TOPIC_REQUIRED",
          "Nhập topic trước khi gửi thử.",
        );
      if (document.revision !== document.syncedRevision)
        throw new RequestError(
          409,
          "SYNC_REQUIRED",
          "Lưu và đồng bộ trước khi gửi thử.",
        );
      try {
        await cloud.test(profile.id);
      } catch {
        throw new RequestError(
          502,
          "CLOUD_TEST_FAILED",
          "Cloud chưa xác nhận yêu cầu gửi thử. Kiểm tra trước khi thử lại.",
        );
      }
      return reply.code(202).send({ status: "queued" });
    },
  );
}
