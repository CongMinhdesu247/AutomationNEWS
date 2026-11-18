import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { Pool } from "pg";
import { registerAuth } from "./auth.js";
import { registerAccountRoutes } from "./routes.js";
import { nextAccountSend } from "./schedule.js";
import { safeHttp, isPublicAddress } from "../connectors/http.js";
import { sanitizeLogText, sanitizeValue } from "../logger.js";
import { safeExternalHref, safeHttpUrlSchema } from "@hub/contracts";

function mockPool(): Pool {
  return {
    async query(sql: string) {
      if (sql.includes("FROM user_sessions")) return { rows: [], rowCount: 0 };
      if (sql.includes("account_rate_limits")) return { rows: [{ hits: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
}

describe("Backend security & schedule regressions", () => {
  it("blocks percent-encoded auth bypasses on /api/auth/password and /api/auth/logout", async () => {
    const app = Fastify();
    const origin = "https://news.example.test";
    registerAuth(app, mockPool(), { origin, registrationOpen: false });
    app.get("/api/member", async () => ({ ok: true }));
    app.put("/api/member", async () => ({ updated: true }));

    try {
      const encodedPassword = await app.inject({
        method: "POST",
        url: "/api/auth/%70assword",
        headers: { origin },
        payload: { currentPassword: "a-long-test-password", password: "another-long-password" },
      });
      expect(encodedPassword.statusCode).toBe(401);

      const encodedLogout = await app.inject({
        method: "POST",
        url: "/api/auth/%6cogout",
        headers: { origin },
        payload: {},
      });
      expect(encodedLogout.statusCode).toBe(401);

      const doubleSlash = await app.inject({
        method: "GET",
        url: "//api/account",
      });
      expect(doubleSlash.statusCode).toBe(400);

      // Family member capability endpoint must not be blocked by session-cookie middleware.
      const memberGet = await app.inject({
        method: "GET",
        url: "/api/member",
        headers: { authorization: "Bearer " + "a".repeat(43) },
      });
      expect(memberGet.statusCode).toBe(200);

      const memberPut = await app.inject({
        method: "PUT",
        url: "/api/member",
        headers: {
          origin: "http://192.168.1.50:8089",
          authorization: "Bearer " + "a".repeat(43),
        },
        payload: {},
      });
      expect(memberPut.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("handles spring-forward DST gap on single-weekday schedules without throwing", () => {
    const next = nextAccountSend(
      new Date("2026-03-01T08:00:00Z"),
      "02:30",
      "America/New_York",
      [7],
    );
    expect(next.toISOString()).toBe("2026-03-15T06:30:00.000Z");
  });

  it("rejects javascript:, data:, and credentialed URLs in shared contracts", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("JAVASCRIPT:void(0)")).toBeUndefined();
    expect(safeExternalHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalHref("https://user:secret@example.com/feed")).toBeUndefined();
    expect(safeExternalHref("https://vnexpress.net/rss/tin-moi-nhat.rss")).toBe(
      "https://vnexpress.net/rss/tin-moi-nhat.rss",
    );
    expect(safeHttpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(safeHttpUrlSchema.safeParse("https://tuoitre.vn/rss/tin-moi-nhat.rss").success).toBe(true);
  });

  it("blocks IPv4-compatible IPv6 SSRF bypasses and non-standard untrusted ports", async () => {
    // IPv4-compatible IPv6 loopback [::127.0.0.1] -> ::7f00:1 and metadata [::169.254.169.254]
    expect(isPublicAddress("::7f00:1")).toBe(false);
    expect(isPublicAddress("::127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::a9fe:a9fe")).toBe(false);
    expect(isPublicAddress("fe80::1")).toBe(false);
    expect(isPublicAddress("fc00::1")).toBe(false);
    expect(isPublicAddress("168.63.129.16")).toBe(false);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicAddress("93.184.216.34")).toBe(true);

    await expect(
      safeHttp("http://93.184.216.34:6379/info", { timeoutMs: 2000 }),
    ).rejects.toMatchObject({
      code: "BLOCKED_PORT",
    });
    await expect(
      safeHttp("http://[::127.0.0.1]/api/ready", { timeoutMs: 2000 }),
    ).rejects.toMatchObject({
      code: "BLOCKED_ADDRESS",
    });
  });

  it("recursively redacts API keys, tokens, and sensitive fields in structured logs", () => {
    const raw = sanitizeLogText(
      "Failed calling https://example.com/api?key=AIzaSyDummyKey123456789012345 with Bearer secret_jwt_token and BSA_dummy_brave_key_123456789012",
    );
    expect(raw).not.toContain("AIzaSyDummyKey");
    expect(raw).not.toContain("secret_jwt_token");
    expect(raw).not.toContain("BSA_dummy_brave_key");

    const nested = sanitizeValue({
      userId: "u-1",
      apiKey: "super-secret",
      nested: {
        authorization: "Bearer top-secret",
        note: "github_pat_11ABCDEFG_secret123456789",
      },
    }) as Record<string, unknown>;
    expect(nested.apiKey).toBe("[REDACTED]");
    expect((nested.nested as Record<string, unknown>).authorization).toBe("[REDACTED]");
    expect(String((nested.nested as Record<string, unknown>).note)).toContain(
      "[REDACTED_GH_PAT]",
    );
  });

  it("serves /api/public/preview publicly while protecting /api/account/theme & /api/account/bookmarks", async () => {
    const origin = "https://news.example.test";
    const userId = "11111111-1111-4111-8111-111111111111";
    let storedTheme: "light" | "dark" = "light";
    const pool = {
      totalCount: 2,
      idleCount: 2,
      waitingCount: 0,
      async query(sql: string, params?: unknown[]) {
        if (sql.includes("FROM user_sessions")) {
          if (params?.[0]) {
            return {
              rows: [
                {
                  id: userId,
                  email: "minh@example.test",
                  name: "Minh",
                  role: "member",
                  session_id: "sess-1",
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("account_rate_limits")) {
          return { rows: [{ hits: 1 }], rowCount: 1 };
        }
        if (sql.includes("FROM news_sources")) {
          return { rows: [{ count: 8 }], rowCount: 1 };
        }
        if (sql.includes("FROM news_items")) {
          return {
            rows: [
              {
                title: "Bản tin công nghệ buổi sáng",
                source_name: "VnExpress",
                published_at: new Date("2026-11-18T00:00:00Z"),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("UPDATE user_settings SET theme")) {
          storedTheme = params?.[1] as "light" | "dark";
          return { rows: [{ theme: storedTheme }], rowCount: 1 };
        }
        if (sql.includes("FROM user_bookmarks")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;

    const app = Fastify();
    const { throttle } = registerAuth(app, pool, {
      origin,
      registrationOpen: false,
    });
    registerAccountRoutes(
      app,
      pool,
      { totalTimeoutMs: 5000 },
      throttle,
    );

    try {
      const pub = await app.inject({
        method: "GET",
        url: "/api/public/preview",
      });
      expect(pub.statusCode).toBe(200);
      expect(pub.json()).toMatchObject({
        starterSourcesCount: 8,
      });

      const unauthBookmarks = await app.inject({
        method: "GET",
        url: "/api/account/bookmarks",
      });
      expect(unauthBookmarks.statusCode).toBe(401);

      const sessionCookie = "__Host-hub_session=" + "a".repeat(64);
      const patchTheme = await app.inject({
        method: "PATCH",
        url: "/api/account/theme",
        headers: { origin, cookie: sessionCookie },
        payload: { theme: "dark" },
      });
      expect(patchTheme.statusCode).toBe(200);
      expect(patchTheme.json()).toEqual({ theme: "dark" });

      const authBookmarks = await app.inject({
        method: "GET",
        url: "/api/account/bookmarks",
        headers: { cookie: sessionCookie },
      });
      expect(authBookmarks.statusCode).toBe(200);
      expect(authBookmarks.json()).toEqual({ items: [] });
    } finally {
      await app.close();
    }
  });
});
