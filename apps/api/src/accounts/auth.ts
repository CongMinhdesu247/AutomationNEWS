import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { randomBytes } from "node:crypto";
import ipaddr from "ipaddr.js";
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
  memberOrigin?: string;
  registrationOpen?: boolean;
  maxUsers?: number;
  ntfyUrl?: string;
  trustProxy?: boolean | string[];
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

const STRICT_UUID_PATH =
  /^\/api\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/events)?$/i;

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
  ) {
    throw new Error(
      "APP_ORIGIN must be an exact HTTPS origin, or a supported loopback development origin.",
    );
  }
  const allowedMemberOrigins = new Set<string>([origin]);
  const rawMemberOrigin = options.memberOrigin ?? process.env.MEMBER_PUBLIC_URL;
  if (rawMemberOrigin) {
    try {
      allowedMemberOrigins.add(new URL(rawMemberOrigin).origin);
    } catch {
      // Ignore malformed optional MEMBER_PUBLIC_URL
    }
  }
  const secure = originUrl.protocol === "https:";
  const cookieName = secure ? "__Host-hub_session" : "hub_session";
  const open = options.registrationOpen ?? false;

  const fail = (status: number, code: string, message: string): never => {
    throw new RequestError(status, code, message);
  };

  const sessionTokens = (request: FastifyRequest): string[] =>
    (request.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.startsWith(cookieName + "="))
      .map((v) => v.slice(cookieName.length + 1))
      .filter((token) => /^[a-f0-9]{64}$/.test(token))
      .slice(0, 4);

  const setCookie = (reply: FastifyReply, token: string, age = 604800) =>
    reply.header(
      "Set-Cookie",
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`,
    );

  async function throttle(key: string, max: number, seconds: number) {
    const result = await pool.query<{ hits: number }>(
      "INSERT INTO account_rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN account_rate_limits.expires_at<=now() THEN 1 ELSE account_rate_limits.hits+1 END,expires_at=CASE WHEN account_rate_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE account_rate_limits.expires_at END RETURNING hits",
      [key, seconds],
    );
    if ((result.rows[0]?.hits ?? 0) > max) {
      fail(429, "RATE_LIMIT", "Quá nhiều yêu cầu. Vui lòng thử lại sau.");
    }
  }

  const normalizeIpForThrottle = (rawIp: string): string => {
    try {
      const parsed = ipaddr.process(rawIp);
      if (parsed.kind() === "ipv6") {
        // Normalize IPv6 to /64 subnet prefix so rotating addresses within a /64 cannot evade rate limits.
        return parsed.toNormalizedString().split(":").slice(0, 4).join(":") + "::/64";
      }
      return parsed.toString();
    } catch {
      return rawIp || "127.0.0.1";
    }
  };

  const ipKey = (request: FastifyRequest) =>
    tokenHash(normalizeIpForThrottle(request.ip || "127.0.0.1")).slice(0, 24);

  app.decorateRequest("accountUser", null);

  app.addHook("onRequest", async (request) => {
    if (options.enabled === false) return;
    const rawPath = request.url.split("?")[0] ?? "/";
    let path = "/";
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return fail(400, "BAD_REQUEST", "Đường dẫn yêu cầu không hợp lệ.");
    }
    if (path.includes("//") || /(?:^|\/)\.\.?(?:\/|$)/.test(path)) {
      return fail(400, "BAD_REQUEST", "Đường dẫn yêu cầu không hợp lệ.");
    }
    if (
      path === "/api/health" ||
      path === "/api/ready" ||
      (path === "/api/public/preview" && request.method === "GET")
    ) {
      return;
    }

    // Capability-token Family Member Portal (/api/member) uses Authorization: Bearer <43-char-token>
    // (never ambient cookies), so phones on LAN/MEMBER_PUBLIC_URL can access their own profile.
    if (path === "/api/member" && ["GET", "PUT"].includes(request.method)) {
      await throttle("member-ip:" + ipKey(request), 40, 300);
      const reqOrigin = request.headers.origin;
      if (
        request.method === "PUT" &&
        reqOrigin &&
        !allowedMemberOrigins.has(reqOrigin) &&
        !request.headers.authorization?.startsWith("Bearer ")
      ) {
        fail(403, "ORIGIN", "Yêu cầu không hợp lệ.");
      }
      return;
    }

    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin !== origin
    ) {
      fail(403, "ORIGIN", "Yêu cầu phải đến từ ứng dụng.");
    }

    if (
      path.startsWith("/api/auth/") &&
      path !== "/api/auth/logout" &&
      path !== "/api/auth/password"
    ) {
      return;
    }

    const tokens = sessionTokens(request);
    if (tokens.length) {
      const result = await pool.query<AccountUser>(
        "SELECT u.id,u.email,u.name,u.role FROM user_sessions s JOIN hub_users u ON u.id=s.user_id WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() AND NOT u.disabled ORDER BY s.expires_at DESC LIMIT 1",
        [tokens.map(tokenHash)],
      );
      request.accountUser = result.rows[0] ?? null;
    }
    if (!request.accountUser) {
      fail(401, "AUTH_REQUIRED", "Vui lòng đăng nhập.");
    }

    const resource = path.match(STRICT_UUID_PATH);
    if (request.method === "GET" && resource) {
      const runId = resource[1]!.toLowerCase();
      const row = await pool.query(
        "SELECT 1 FROM workflow_runs WHERE id=$1 AND user_id=$2",
        [runId, request.accountUser!.id],
      );
      if (request.accountUser!.role !== "admin" && !row.rowCount) {
        fail(404, "RUN_NOT_FOUND", "Không tìm thấy bản tin.");
      }
      return;
    }

    if (
      path.startsWith("/api/account/") ||
      path === "/api/account" ||
      path === "/api/auth/logout" ||
      path === "/api/auth/password"
    ) {
      return;
    }

    if (request.accountUser!.role !== "admin") {
      fail(
        403,
        "ADMIN_REQUIRED",
        "Chỉ quản trị viên được sử dụng chức năng này.",
      );
    }
  });

  async function issue(reply: FastifyReply, user: AccountUser) {
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [tokenHash(token), user.id],
    );
    // Keep at most 10 active sessions per user to prevent unbounded session accumulation.
    await pool.query(
      `DELETE FROM user_sessions
       WHERE user_id=$1 AND (
         expires_at<=now() OR token_hash IN (
           SELECT token_hash FROM user_sessions WHERE user_id=$1 ORDER BY expires_at DESC OFFSET 10
         )
       )`,
      [user.id],
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
    const parsed = registration.safeParse(request.body);
    if (!parsed.success) {
      fail(
        400,
        "VALIDATION_ERROR",
        "Nhập tên, email hợp lệ và mật khẩu từ 12 đến 128 ký tự.",
      );
    }
    await throttle("reg-ip:" + ipKey(request), 15, 3600);
    const data = parsed.data!;
    const hash = await hashPassword(data.password);
    const client = await pool.connect();
    let user: AccountUser;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73142002)");
      if (
        Number(
          (
            await client.query<{ count: string }>(
              "SELECT count(*) FROM hub_users",
            )
          ).rows[0]!.count,
        ) >= (options.maxUsers ?? 100)
      ) {
        fail(403, "CAPACITY", "Ứng dụng đã đạt giới hạn tài khoản.");
      }
      const created = await client.query<AccountUser>(
        "INSERT INTO hub_users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,email,name,role",
        [crypto.randomUUID(), data.email, data.name, hash],
      );
      if (!created.rowCount) {
        fail(
          400,
          "REGISTRATION_UNAVAILABLE",
          "Không thể hoàn tất đăng ký với thông tin này. Nếu bạn đã có tài khoản, hãy đăng nhập.",
        );
      }
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
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      fail(
        400,
        "VALIDATION_ERROR",
        "Kiểm tra email và mật khẩu (ít nhất 12 ký tự).",
      );
    }
    const clientIp = ipKey(request);
    await throttle("login-ip:" + clientIp, 30, 300);
    const data = parsed.data!;
    const emailKey = tokenHash(data.email).slice(0, 24);
    await throttle(`login-acct:${clientIp}:${emailKey}`, 10, 900);
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
    if (!row || !valid || row.disabled) {
      await throttle("login-fail-target:" + emailKey, 25, 900);
      return fail(401, "LOGIN_FAILED", "Email hoặc mật khẩu không đúng.");
    }
    return issue(reply, {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const tokens = sessionTokens(request);
    if (tokens.length) {
      await pool.query("DELETE FROM user_sessions WHERE token_hash=ANY($1::text[])", [
        tokens.map(tokenHash),
      ]);
    }
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
    if (!parsed.success) {
      fail(400, "VALIDATION_ERROR", "Mật khẩu mới cần từ 12 đến 128 ký tự.");
    }
    const row = (
      await pool.query<{ password_hash: string }>(
        "SELECT password_hash FROM hub_users WHERE id=$1",
        [request.accountUser!.id],
      )
    ).rows[0];
    if (
      !row ||
      !(await verifyPassword(parsed.data!.currentPassword, row.password_hash))
    ) {
      fail(400, "PASSWORD", "Mật khẩu hiện tại không đúng.");
    }
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
