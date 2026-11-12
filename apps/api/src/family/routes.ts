import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  familyConfigSchema,
  familyProfileSchema,
  settingsSchema,
  validationIssues,
  type FamilyConfig,
  type FamilyDocument,
  memberPreferencesSchema,
  nextFamilySend,
  type FamilyHealth,
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
  async function saveConfig(config: FamilyConfig, revision: number) {
    if (syncing)
      throw new RequestError(
        409,
        "SYNC_BUSY",
        "Đang đồng bộ; vui lòng thử lại.",
      );
    const updated = await pool.query(
      "UPDATE family_configuration SET config=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1 AND revision=$2 RETURNING revision",
      [JSON.stringify(config), revision],
    );
    if (!updated.rowCount)
      throw new RequestError(
        409,
        "REVISION_CONFLICT",
        "Hồ sơ đã thay đổi. Tải lại trước khi lưu.",
      );
    await pool.query(
      "DELETE FROM member_access WHERE NOT (profile_id = ANY($1::text[]))",
      [config.profiles.map((p) => p.id)],
    );
    let syncError: string | undefined;
    try {
      await sync(config, updated.rows[0].revision);
    } catch {
      syncError =
        "Đã lưu trên máy nhưng chưa đồng bộ cloud. Lịch cloud vẫn dùng cấu hình trước đó; bấm Đồng bộ lại.";
    }
    return { ...(await read()), ...(syncError ? { syncError } : {}) };
  }
  app.get("/api/family/status", async (): Promise<FamilyHealth> => {
    const document = await read();
    if (!cloud.state)
      throw new RequestError(
        503,
        "CLOUD_UNAVAILABLE",
        "Chưa đọc được trạng thái cloud.",
      );
    let state;
    try {
      state = await cloud.state();
    } catch {
      throw new RequestError(
        502,
        "CLOUD_UNAVAILABLE",
        "Chưa đọc được trạng thái cloud. Thử tải lại sau.",
      );
    }
    return {
      checkedAt: new Date().toISOString(),
      profiles: document.config.profiles.map((p) => {
        const namespace = createHash("sha256")
          .update(p.id)
          .digest("hex")
          .slice(0, 16);
        return {
          id: p.id,
          nextAt: nextFamilySend(p),
          deliveries: Object.entries(state.deliveries)
            .filter(([key]) =>
              p.id === "personal"
                ? /^\d{4}-\d{2}-\d{2}$/.test(key) ||
                  key.includes(":" + namespace + ":alert:")
                : key.includes(":" + namespace),
            )
            .map(([key, value]) => ({ key, ...value }))
            .sort((a, b) => b.at.localeCompare(a.at))
            .slice(0, 10),
        };
      }),
    };
  });
  app.post<{ Params: { id: string } }>(
    "/api/family/:id/access",
    { preHandler: adminRequest },
    async (request) => {
      if (!z.object({}).strict().safeParse(request.body).success)
        throw new RequestError(
          400,
          "VALIDATION_ERROR",
          "Yêu cầu không hợp lệ.",
        );
      const document = await read();
      if (!document.config.profiles.some((p) => p.id === request.params.id))
        throw new RequestError(
          404,
          "PROFILE_NOT_FOUND",
          "Không tìm thấy hồ sơ.",
        );
      const token = randomBytes(32).toString("base64url"),
        expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
      await pool.query(
        "INSERT INTO member_access(profile_id,token_hash,expires_at) VALUES($1,$2,$3) ON CONFLICT(profile_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,created_at=now()",
        [
          request.params.id,
          createHash("sha256").update(token).digest("hex"),
          expiresAt,
        ],
      );
      const base = process.env.MEMBER_PUBLIC_URL;
      // In Docker the container IP is not usable by a phone; the dashboard asks for the PC's LAN address.
      return {
        path: "/#/member/" + token,
        expiresAt,
        ...(base ? { baseUrl: base } : {}),
        localOnly: !base,
      };
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/family/:id/access",
    { preHandler: adminRequest },
    async (request) => {
      if (!z.object({}).strict().safeParse(request.body).success)
        throw new RequestError(
          400,
          "VALIDATION_ERROR",
          "Yêu cầu không hợp lệ.",
        );
      await pool.query("DELETE FROM member_access WHERE profile_id=$1", [
        request.params.id,
      ]);
      return { revoked: true };
    },
  );
  async function member(request: FastifyRequest) {
    const token = request.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!token)
      throw new RequestError(
        401,
        "MEMBER_ACCESS",
        "Liên kết không hợp lệ hoặc đã hết hạn.",
      );
    const access = (
      await pool.query(
        "SELECT profile_id FROM member_access WHERE token_hash=$1 AND expires_at>now()",
        [createHash("sha256").update(token).digest("hex")],
      )
    ).rows[0];
    if (!access)
      throw new RequestError(
        401,
        "MEMBER_ACCESS",
        "Liên kết không hợp lệ hoặc đã hết hạn.",
      );
    const document = await read(),
      profile = document.config.profiles.find(
        (p) => p.id === access.profile_id,
      );
    if (!profile)
      throw new RequestError(
        401,
        "MEMBER_ACCESS",
        "Liên kết không hợp lệ hoặc đã hết hạn.",
      );
    return { document, profile };
  }
  app.get("/api/member", async (request) => {
    const { document, profile } = await member(request);
    return {
      name: profile.name,
      preferences: memberPreferencesSchema.parse(
        Object.fromEntries(
          Object.entries(profile).filter(
            ([key]) => key in memberPreferencesSchema.shape,
          ),
        ),
      ),
      revision: document.revision,
      synced: document.revision === document.syncedRevision,
    };
  });
  app.put("/api/member", async (request) => {
    const { document, profile } = await member(request);
    const parsed = z
      .object({
        preferences: memberPreferencesSchema,
        revision: z.number().int().positive(),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      throw new RequestError(
        400,
        "VALIDATION_ERROR",
        "Kiểm tra chủ đề, ngày và giờ nhận.",
      );
    const config = familyConfigSchema.safeParse({
      ...document.config,
      profiles: document.config.profiles.map((p) =>
        p.id === profile.id ? { ...p, ...parsed.data.preferences } : p,
      ),
    });
    if (!config.success)
      throw new RequestError(
        400,
        "VALIDATION_ERROR",
        config.error.issues.map((i) => i.message).join(" "),
      );
    const result = await saveConfig(config.data, parsed.data.revision);
    return {
      revision: result.revision,
      synced: result.revision === result.syncedRevision,
      ...(result.syncError ? { syncError: result.syncError } : {}),
    };
  });
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
    return saveConfig(parsed.data.config, parsed.data.revision);
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
