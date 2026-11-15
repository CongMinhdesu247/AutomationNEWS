import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { RequestError } from "../digests/service.js";
import { hashPassword, verifyPassword, tokenHash } from "./password.js";
import { initialSettings } from "./preferences.js";
export type AccountUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
};
declare module "fastify" {
  interface FastifyRequest {
    accountUser: AccountUser | null;
  }
}
export type AuthOptions = {
  enabled?: boolean;
  origin?: string;
  registrationOpen?: boolean;
  maxUsers?: number;
  ntfyUrl?: string;
};
const credentials = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();
const registration = credentials.extend({
  name: z.string().trim().min(1).max(60),
});
export function registerAuth(
  app: FastifyInstance,
  pool: Pool,
  options: AuthOptions = {},
) {
  const origin = options.origin ?? "http://127.0.0.1:8088";
  const originUrl = new URL(origin);
  if (
    originUrl.origin !== origin ||
    (originUrl.protocol !== "https:" &&
      !(
        originUrl.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(originUrl.hostname)
      ))
  )
    throw new Error(
      "APP_ORIGIN must be an exact HTTPS origin, or a supported loopback development origin.",
    );
  const secure = new URL(origin).protocol === "https:";
  const cookieName = secure ? "__Host-hub_session" : "hub_session";
  const open = options.registrationOpen ?? false;
  const fail = (status: number, code: string, message: string): never => {
    throw new RequestError(status, code, message);
  };
  const sessionToken = (request: FastifyRequest) =>
    request.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
  const setCookie = (reply: FastifyReply, token: string, age = 604800) =>
    reply.header(
      "Set-Cookie",
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`,
    );
  async function throttle(key: string, max: number, seconds: number) {
    const result = await pool.query(
      "INSERT INTO account_rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN account_rate_limits.expires_at<=now() THEN 1 ELSE account_rate_limits.hits+1 END,expires_at=CASE WHEN account_rate_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE account_rate_limits.expires_at END RETURNING hits",
      [key, seconds],
    );
    if (result.rows[0].hits > max)
      fail(429, "RATE_LIMIT", "Quá nhiều yêu cầu. Vui lòng thử lại sau.");
  }
  app.decorateRequest("accountUser", null);
  app.addHook("onRequest", async (request) => {
    if (options.enabled === false) return;
    const path = request.url.split("?")[0]!;
    if (path === "/api/health" || path === "/api/ready") return;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin !== origin
    )
      fail(403, "ORIGIN", "Yêu cầu phải đến từ ứng dụng.");
    if (
      path.startsWith("/api/auth/") &&
      path !== "/api/auth/logout" &&
      path !== "/api/auth/password"
    )
      return;
    const token = sessionToken(request);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const result = await pool.query<AccountUser>(
        "SELECT u.id,u.email,u.name,u.role FROM user_sessions s JOIN hub_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled",
        [tokenHash(token)],
      );
      request.accountUser = result.rows[0] ?? null;
    }
    if (!request.accountUser) fail(401, "AUTH_REQUIRED", "Vui lòng đăng nhập.");
    const resource = path.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/events)?$/);
    if (request.method === "GET" && resource) {
      const row = await pool.query(
        "SELECT 1 FROM workflow_runs WHERE id=$1 AND user_id=$2",
        [resource[1], request.accountUser!.id],
      );
      if (request.accountUser!.role !== "admin" && !row.rowCount)
        fail(404, "RUN_NOT_FOUND", "Không tìm thấy bản tin.");
      return;
    }
    if (
      path.startsWith("/api/account/") ||
      path === "/api/account" ||
      path === "/api/auth/logout" ||
      path === "/api/auth/password"
    )
      return;
    if (request.accountUser!.role !== "admin")
      fail(
        403,
        "ADMIN_REQUIRED",
        "Chỉ quản trị viên được sử dụng chức năng này.",
      );
  });
  async function issue(reply: FastifyReply, user: AccountUser) {
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [tokenHash(token), user.id],
    );
    setCookie(reply, token);
    return { user };
  }
  app.get("/api/auth/config", async () => ({
    enabled: options.enabled !== false,
    registrationOpen: open,
  }));
  app.post("/api/auth/register", async (request, reply) => {
    if (!open) fail(403, "REGISTRATION_CLOSED", "Đăng ký hiện đang đóng.");
    await throttle("registration", 20, 3600);
    const parsed = registration.safeParse(request.body);
    if (!parsed.success)
      fail(
        400,
        "VALIDATION_ERROR",
        "Nhập tên, email hợp lệ và mật khẩu từ 12 đến 128 ký tự.",
      );
    const data = parsed.data!;
    const hash = await hashPassword(data.password);
    const client = await pool.connect();
    let user: AccountUser;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73142002)");
      if (
        Number(
          (await client.query("SELECT count(*) FROM hub_users")).rows[0].count,
        ) >= (options.maxUsers ?? 100)
      )
        fail(403, "CAPACITY", "Ứng dụng đã đạt giới hạn tài khoản.");
      const created = await client.query<AccountUser>(
        "INSERT INTO hub_users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,email,name,role",
        [crypto.randomUUID(), data.email, data.name, hash],
      );
      if (!created.rowCount)
        fail(
          409,
          "ACCOUNT_EXISTS",
          "Không thể đăng ký email này. Hãy đăng nhập hoặc liên hệ quản trị viên.",
        );
      user = created.rows[0]!;
      await client.query(
        "INSERT INTO user_settings(user_id,config) VALUES($1,$2::jsonb)",
        [
          user.id,
          JSON.stringify(
            initialSettings(options.ntfyUrl ?? "https://ntfy.sh/"),
          ),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return reply.code(201).send(await issue(reply, user!));
  });
  // Derive a dummy hash too, so unknown emails still perform the password KDF.
  const dummy = hashPassword(randomBytes(32).toString("hex"));
  app.post("/api/auth/login", async (request, reply) => {
    await throttle("login-global", 120, 60);
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success)
      fail(
        400,
        "VALIDATION_ERROR",
        "Kiểm tra email và mật khẩu (ít nhất 12 ký tự).",
      );
    const data = parsed.data!;
    await throttle("login:" + tokenHash(data.email), 10, 900);
    const row = (
      await pool.query<
        AccountUser & { password_hash: string; disabled: boolean }
      >(
        "SELECT id,email,name,role,password_hash,disabled FROM hub_users WHERE email=$1",
        [data.email],
      )
    ).rows[0];
    const valid = await verifyPassword(
      data.password,
      row?.password_hash ?? (await dummy),
    );
    if (!row || !valid || row.disabled)
      fail(401, "LOGIN_FAILED", "Email hoặc mật khẩu không đúng.");
    return issue(reply, {
      id: row!.id,
      email: row!.email,
      name: row!.name,
      role: row!.role,
    });
  });
  app.post("/api/auth/logout", async (request, reply) => {
    await pool.query("DELETE FROM user_sessions WHERE token_hash=$1", [
      tokenHash(sessionToken(request) ?? ""),
    ]);
    setCookie(reply, "", 0);
    return { loggedOut: true };
  });
  app.post("/api/auth/password", async (request, reply) => {
    await throttle("password:" + request.accountUser!.id, 5, 900);
    const parsed = z
      .object({
        currentPassword: z.string().max(128),
        password: z.string().min(12).max(128),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      fail(400, "VALIDATION_ERROR", "Mật khẩu mới cần từ 12 đến 128 ký tự.");
    const row = (
      await pool.query("SELECT password_hash FROM hub_users WHERE id=$1", [
        request.accountUser!.id,
      ])
    ).rows[0];
    if (
      !(await verifyPassword(parsed.data!.currentPassword, row.password_hash))
    )
      fail(400, "PASSWORD", "Mật khẩu hiện tại không đúng.");
    const hash = await hashPassword(parsed.data!.password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE hub_users SET password_hash=$2 WHERE id=$1", [
        request.accountUser!.id,
        hash,
      ]);
      await client.query("DELETE FROM user_sessions WHERE user_id=$1", [
        request.accountUser!.id,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    setCookie(reply, "", 0);
    return { loggedOut: true };
  });
  return { throttle };
}
