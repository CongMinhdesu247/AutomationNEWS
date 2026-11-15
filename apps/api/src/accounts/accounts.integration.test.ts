import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import "../env.js";
import { buildApp } from "../app.js";
import { migrate } from "../migrate.js";
import { fixtureClient } from "../operations/fixtures.js";
import { WorkflowQueue, WorkerRunner } from "../workflows/runtime.js";
import { DigestScheduler } from "../workflows/schedule.js";
import { nextAccountSend, tickAccounts } from "./schedule.js";
import { verifyPassword, tokenHash } from "./password.js";
import { defaultSettings } from "@hub/contracts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
const schema = "accounts_test_" + crypto.randomUUID().replaceAll("-", "");
const admin = new pg.Pool({ connectionString: url });
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  max: 10,
  statement_timeout: 10000,
});
const origin = "https://news.example.test";
const fixture = fixtureClient(1);
const app = buildApp(pool, { http: fixture.http }, { pollMs: 10 }, undefined, {
  origin,
  registrationOpen: true,
  maxUsers: 10,
});
const headers = { origin };
const cookie = (response: { headers: Record<string, unknown> }) =>
  String(response.headers["set-cookie"]).split(";")[0]!;
async function signup(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers,
    payload: {
      email,
      name: email.split("@")[0],
      password: "a-long-test-password",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return {
    user: response.json().user,
    headers: { ...headers, cookie: cookie(response) },
  };
}
beforeAll(async () => {
  await admin.query("CREATE SCHEMA " + schema);
  await migrate(pool);
}, 30000);
afterAll(async () => {
  await app.close();
  await pool.end();
  await admin.query("DROP SCHEMA " + schema + " CASCADE");
  await admin.end();
});
it("requires auth on every legacy API and rejects cross-origin writes, without trusting forwarded headers", async () => {
  for (const path of [
    "/api/settings",
    "/api/family",
    "/api/family/status",
    "/api/runs",
    "/api/digests",
    "/api/schedule",
    "/api/dead-letters",
    "/api/account",
    "/api/admin/users",
  ])
    expect((await app.inject(path)).statusCode, path).toBe(401);
  expect((await app.inject("/api/health")).statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers: {
          origin: "https://evil.test",
          "x-forwarded-host": "news.example.test",
        },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
});
it("isolates settings, histories, idempotency, SSE, destinations and simultaneous edits for two accounts", async () => {
  const a = await signup("alice@example.test"),
    b = await signup("bob@example.test");
  expect(
    cookie(
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers,
        payload: { email: a.user.email, password: "a-long-test-password" },
      }),
    ),
  ).toContain("__Host-hub_session=");
  const row = (
    await pool.query("SELECT password_hash FROM hub_users WHERE id=$1", [
      a.user.id,
    ])
  ).rows[0];
  expect(row.password_hash).not.toContain("a-long-test-password");
  expect(await verifyPassword("a-long-test-password", row.password_hash)).toBe(
    true,
  );
  expect(await verifyPassword("incorrect password", row.password_hash)).toBe(
    false,
  );
  const da = (
    await app.inject({ url: "/api/account", headers: a.headers })
  ).json();
  const db = (
    await app.inject({ url: "/api/account", headers: b.headers })
  ).json();
  expect(da.settings.notifications.topic).not.toBe(
    db.settings.notifications.topic,
  );
  expect(da.user.role).toBe("member");
  const prefs = (d: typeof da) => ({
    settings: {
      ...d.settings,
      weather: {
        enabled: true,
        location: "Hà Nội",
        latitude: 21,
        longitude: 105,
      },
      newsletter: { ...d.settings.newsletter, enabled: true },
      notifications: { ...d.settings.notifications, enabled: true },
    },
    days: d.days,
    theme: "dark",
    revision: d.revision,
  });
  const saved = await Promise.all(
    [a, b].map((u, i) =>
      app.inject({
        method: "PUT",
        url: "/api/account/preferences",
        headers: u.headers,
        payload: prefs(i ? db : da),
      }),
    ),
  );
  saved.forEach((r) => expect(r.statusCode, r.body).toBe(200));
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/account/preferences",
        headers: a.headers,
        payload: prefs(da),
      })
    ).statusCode,
  ).toBe(409);
  const fresh = (
    await app.inject({ url: "/api/account", headers: a.headers })
  ).json();
  const malicious = prefs(fresh);
  malicious.settings.notifications.serverUrl = "https://evil.test/";
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/account/preferences",
        headers: a.headers,
        payload: malicious,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: a.headers,
        payload: fresh.settings,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ url: "/api/family", headers: a.headers })).statusCode,
  ).toBe(403);
  const key = crypto.randomUUID();
  async function create(u: typeof a) {
    const r = await app.inject({
      method: "POST",
      url: "/api/account/digests",
      headers: { ...u.headers, "idempotency-key": key },
    });
    expect(r.statusCode, r.body).toBe(202);
    return r.json().runId;
  }
  const ra = await create(a),
    rb = await create(b);
  expect(ra).not.toBe(rb);
  expect(await create(a)).toBe(ra);
  expect(
    (await app.inject({ url: "/api/runs/" + ra, headers: b.headers }))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: "/api/runs/" + ra + "/events",
        headers: b.headers,
      })
    ).statusCode,
  ).toBe(404);
  const queue = new WorkflowQueue(pool, { maxRetries: 0 });
  const runner = new WorkerRunner(
    queue,
    { workerId: "accounts-test" },
    { http: fixture.http },
  );
  for (let i = 0; i < 30 && (await runner.tick()); i++) {
    /* Drain fixture workflows. */
  }
  expect((await queue.get(ra))?.status).toBe("completed");
  const detail = await app.inject({
    url: "/api/account/digests/" + ra,
    headers: a.headers,
  });
  expect(detail.statusCode, detail.body).toBe(200);
  expect(
    (
      await app.inject({
        url: "/api/account/digests/" + ra,
        headers: b.headers,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/account/digests/" + ra + "/notifications",
        headers: { ...b.headers, "idempotency-key": crypto.randomUUID() },
      })
    ).statusCode,
  ).toBe(404);
  const sendHeaders = { ...a.headers, "idempotency-key": crypto.randomUUID() };
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/account/digests/" + ra + "/notifications",
        headers: sendHeaders,
      })
    ).json().status,
  ).toBe("success");
  await app.inject({
    method: "POST",
    url: "/api/account/digests/" + ra + "/notifications",
    headers: sendHeaders,
  });
  expect(fixture.postCalls).toBe(1);
  for (const path of ["/api/account/runs", "/api/account/digests"]) {
    const items = (await app.inject({ url: path, headers: a.headers })).json()
      .items;
    expect(items.map((v: { id: string }) => v.id)).toContain(ra);
    expect(items.map((v: { id: string }) => v.id)).not.toContain(rb);
  }
  // Due accounts share a day, but get independent reservations and deliveries.
  await pool.query(
    "UPDATE user_settings SET next_run_at=now()-interval '1 minute'",
  );
  await Promise.all([tickAccounts(queue, 900000), tickAccounts(queue, 900000)]);
  expect(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM workflow_runs WHERE scheduled_at IS NOT NULL",
        )
      ).rows[0].count,
    ),
  ).toBe(2);
  for (let i = 0; i < 30 && (await runner.tick()); i++) {
    /* Drain scheduled runs. */
  }
  const scheduler = new DigestScheduler(queue, { http: fixture.http });
  await scheduler.deliver();
  await scheduler.deliver();
  expect(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM scheduled_deliveries WHERE status='success'",
        )
      ).rows[0].count,
    ),
  ).toBe(2);
  const userIds = (
    await pool.query("SELECT DISTINCT user_id FROM digests")
  ).rows.map((r) => r.user_id);
  expect(userIds.sort()).toEqual([a.user.id, b.user.id].sort());
  // Admin controls cannot be reached by members; locking revokes existing sessions.
  expect(
    (await app.inject({ url: "/api/admin/users", headers: a.headers }))
      .statusCode,
  ).toBe(403);
  await pool.query("UPDATE hub_users SET role='admin' WHERE id=$1", [
    a.user.id,
  ]);
  const disabled = await app.inject({
    method: "PATCH",
    url: "/api/admin/users/" + b.user.id,
    headers: a.headers,
    payload: { disabled: true },
  });
  expect(disabled.statusCode, disabled.body).toBe(200);
  expect(
    (await app.inject({ url: "/api/account", headers: b.headers })).statusCode,
  ).toBe(401);
  expect(
    (
      await pool.query(
        "SELECT next_run_at FROM user_settings WHERE user_id=$1",
        [b.user.id],
      )
    ).rows[0].next_run_at,
  ).toBeNull();
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/password",
        headers: a.headers,
        payload: {
          currentPassword: "a-long-test-password",
          password: "new-very-long-password",
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: "/api/account", headers: a.headers })).statusCode,
  ).toBe(401);
});
it("handles selected weekdays, timezones, DST and revocation/expiry", async () => {
  expect(
    nextAccountSend(
      new Date("2026-11-13T01:00:00Z"),
      "07:00",
      "Asia/Ho_Chi_Minh",
      [1],
    ).toISOString(),
  ).toBe("2026-11-16T00:00:00.000Z");
  expect(
    nextAccountSend(
      new Date("2026-03-08T06:00:00Z"),
      "02:30",
      "America/New_York",
      [7],
    ).toISOString(),
  ).toBe("2026-03-15T06:30:00.000Z");
  const u = await signup("expiry@example.test");
  const token = u.headers.cookie.split("=")[1]!;
  expect(
    (
      await pool.query(
        "SELECT token_hash FROM user_sessions WHERE user_id=$1",
        [u.user.id],
      )
    ).rows[0].token_hash,
  ).toBe(tokenHash(token));
  await pool.query(
    "UPDATE user_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [u.user.id],
  );
  expect(
    (await app.inject({ url: "/api/account", headers: u.headers })).statusCode,
  ).toBe(401);
});
it("rejects role injection, closes registration, enforces per-account quotas atomically and logs out", async () => {
  const closed = buildApp(pool, {}, {}, undefined, {
    origin,
    registrationOpen: false,
  });
  try {
    expect(
      (
        await closed.inject({
          method: "POST",
          url: "/api/auth/register",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await closed.close();
  }
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers,
        payload: {
          email: "injection@example.test",
          name: "Injection",
          password: "a-long-test-password",
          role: "admin",
        },
      })
    ).statusCode,
  ).toBe(400);
  const user = await signup("quota@example.test");
  const d = (
    await app.inject({ url: "/api/account", headers: user.headers })
  ).json();
  const saved = await app.inject({
    method: "PUT",
    url: "/api/account/preferences",
    headers: user.headers,
    payload: {
      settings: {
        ...d.settings,
        weather: {
          enabled: true,
          location: "Hà Nội",
          latitude: 21,
          longitude: 105,
        },
      },
      days: d.days,
      theme: d.theme,
      revision: d.revision,
    },
  });
  expect(saved.statusCode).toBe(200);
  const results = await Promise.all(
    Array.from({ length: 11 }, () =>
      app.inject({
        method: "POST",
        url: "/api/account/digests",
        headers: { ...user.headers, "idempotency-key": crypto.randomUUID() },
      }),
    ),
  );
  expect(results.filter((r) => r.statusCode === 202)).toHaveLength(10);
  expect(results.filter((r) => r.statusCode === 429)).toHaveLength(1);
  const logout = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: user.headers,
    payload: {},
  });
  expect(logout.headers["set-cookie"]).toContain(
    "HttpOnly; SameSite=Lax; Max-Age=0; Secure",
  );
  expect(
    (await app.inject({ url: "/api/account", headers: user.headers }))
      .statusCode,
  ).toBe(401);
});

it("runs utilities without any news/weather and keeps personal tasks scoped to their owner", async () => {
  const a = await signup("utilities@example.test"),
    b = await signup("utilities-other@example.test");
  const d = (
    await app.inject({ url: "/api/account", headers: a.headers })
  ).json();
  const title = "Việc riêng chỉ chủ tài khoản được xem";
  const settings = {
    ...structuredClone(defaultSettings),
    newsletter: { ...defaultSettings.newsletter, enabled: true },
    notifications: d.settings.notifications,
    holidays: { enabled: true },
    tasks: {
      enabled: true,
      items: [
        { id: crypto.randomUUID(), title, date: "2026-11-15", done: false },
      ],
    },
  };
  const saved = await app.inject({
    method: "PUT",
    url: "/api/account/preferences",
    headers: a.headers,
    payload: { settings, days: d.days, theme: d.theme, revision: d.revision },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const accepted = await app.inject({
    method: "POST",
    url: "/api/account/digests",
    headers: { ...a.headers, "idempotency-key": crypto.randomUUID() },
  });
  expect(accepted.statusCode, accepted.body).toBe(202);
  const id = accepted.json().runId;
  const worker = new WorkerRunner(
    new WorkflowQueue(pool, { maxRetries: 0 }),
    {},
    {
      now: () => new Date("2026-11-15T01:00:00Z"),
      http: async () => {
        throw Error("Utilities must not call external HTTP");
      },
    },
  );
  for (let i = 0; i < 200 && (await worker.tick()); i++) {
    /* isolated utility DAG */
  }
  const detail = await app.inject({
    url: "/api/account/digests/" + id,
    headers: a.headers,
  });
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().status).toBe("success");
  expect(detail.json().sources.tasks.data.items[0].title).toBe(title);
  expect(detail.json().sources.holidays.data.events[0].name).toBe(
    "Ngày Nhà giáo Việt Nam",
  );
  expect(
    (
      await app.inject({
        url: "/api/account/digests/" + id,
        headers: b.headers,
      })
    ).statusCode,
  ).toBe(404);
});
