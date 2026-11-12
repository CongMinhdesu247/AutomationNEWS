import { beforeAll, afterAll, expect, it } from "vitest";
import pg from "pg";
import "../env.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { buildApp } from "../app.js";
import type { FamilyCloudAdmin } from "./cloud-admin.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw Error("TEST_DATABASE_URL required");
const schema = "family_test_" + crypto.randomUUID().replaceAll("-", "");
const admin = createPool(url);
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});
let failSync = false;
let sends = 0;
let syncs = 0;
const cloud: FamilyCloudAdmin = {
  configured: true,
  async sync() {
    syncs++;
    if (failSync) throw Error("private credential");
  },
  async test() {
    sends++;
  },
  async state() {
    return {
      version: 1,
      snapshots: [],
      deliveries: {
        "2026-11-12": { status: "sent", at: "2026-11-12T00:00:00Z" },
      },
    };
  },
};
const app = buildApp(pool, {}, {}, cloud);
beforeAll(async () => {
  await admin.query("CREATE SCHEMA " + schema);
  await migrate(pool);
}, 30000);
afterAll(async () => {
  await app.close();
  await pool.end();
  await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
  await admin.end();
});
it("imports existing settings once, persists independent profiles, syncs encrypted cloud configuration and guards revisions", async () => {
  let d = (await app.inject("/api/family")).json();
  expect(d.revision).toBe(1);
  expect(d.config.profiles[0].id).toBe("personal");
  const config = structuredClone(d.config);
  const p = config.profiles[0];
  p.topic = "private-personal";
  p.enabled = true;
  config.profiles.push({
    ...p,
    id: "dad",
    name: "Bố",
    topic: "private-dad",
    newsTopics: ["sports"],
    city: "danang",
    days: [1, 2, 3, 4, 5],
    sendTime: "06:30",
  });
  const saved = await app.inject({
    method: "PUT",
    url: "/api/family",
    payload: { config, revision: 1 },
  });
  expect(saved.statusCode).toBe(200);
  d = saved.json();
  expect(d.syncedRevision).toBe(2);
  expect(d.config.profiles[1].topic).toBe("private-dad");
  expect(syncs).toBe(1);
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/family",
        payload: { config, revision: 1 },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/family/dad/test",
        payload: {},
      })
    ).statusCode,
  ).toBe(202);
  expect(sends).toBe(1);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/family/missing/test",
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  failSync = true;
  config.profiles[1].enabled = false;
  const pending = (
    await app.inject({
      method: "PUT",
      url: "/api/family",
      payload: { config, revision: 2 },
    })
  ).json();
  expect(pending.revision).toBe(3);
  expect(pending.syncedRevision).toBe(2);
  expect(pending.syncError).toContain("chưa đồng bộ");
  expect(JSON.stringify(pending)).not.toContain("private credential");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/family/dad/test",
        payload: {},
      })
    ).statusCode,
  ).toBe(409);
  failSync = false;
  expect(
    (
      await app.inject({ method: "POST", url: "/api/family/sync", payload: {} })
    ).json().syncedRevision,
  ).toBe(3);
  const fresh = buildApp(pool, {}, {}, cloud);
  expect(
    (await fresh.inject("/api/family")).json().config.profiles[1].enabled,
  ).toBe(false);
  await fresh.close();
});
it("rejects duplicate destinations, arbitrary fields, foreign origins and non-JSON admin mutations", async () => {
  const d = (await app.inject("/api/family")).json();
  const config = structuredClone(d.config);
  config.profiles[1].topic = config.profiles[0].topic;
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/family",
        payload: { config, revision: d.revision },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/family/sync",
        payload: { token: "bad" },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/family/sync",
        headers: { origin: "https://evil.example" },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/family/sync",
        headers: { "content-type": "text/plain" },
        payload: "{}",
      })
    ).statusCode,
  ).toBe(415);
});
it("scopes member links to one profile, rejects privilege changes, rotates/revokes/expires tokens and reports cloud health", async () => {
  const d = (await app.inject("/api/family")).json();
  const created = await app.inject({
    method: "POST",
    url: "/api/family/dad/access",
    payload: {},
  });
  expect(created.statusCode).toBe(200);
  const token = created.json().path.split("/member/")[1];
  const headers = { authorization: "Bearer " + token };
  const member = await app.inject({ url: "/api/member", headers });
  expect(member.statusCode).toBe(200);
  expect(member.json().name).toBe("Bố");
  expect(member.body).not.toContain("private-personal");
  expect(member.body).not.toContain("private-dad");
  const prefs = {
    ...member.json().preferences,
    sendTime: "10:30",
    newsTopics: ["life"],
  };
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/member",
        headers,
        payload: {
          preferences: { ...prefs, topic: "attack" },
          revision: d.revision,
        },
      })
    ).statusCode,
  ).toBe(400);
  const saved = await app.inject({
    method: "PUT",
    url: "/api/member",
    headers,
    payload: { preferences: prefs, revision: d.revision },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().synced).toBe(true);
  const after = (await app.inject("/api/family")).json();
  expect(after.config.profiles[0]).toEqual(d.config.profiles[0]);
  expect(after.config.profiles[1].sendTime).toBe("10:30");
  expect(after.config.profiles[1].topic).toBe("private-dad");
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/member",
        headers,
        payload: { preferences: prefs, revision: d.revision },
      })
    ).statusCode,
  ).toBe(409);
  const rotated = (
    await app.inject({
      method: "POST",
      url: "/api/family/dad/access",
      payload: {},
    })
  )
    .json()
    .path.split("/member/")[1];
  expect((await app.inject({ url: "/api/member", headers })).statusCode).toBe(
    401,
  );
  const newHeaders = { authorization: "Bearer " + rotated };
  expect(
    (await app.inject({ url: "/api/member", headers: newHeaders })).statusCode,
  ).toBe(200);
  await pool.query(
    "UPDATE member_access SET expires_at=now()-interval '1 second' WHERE profile_id='dad'",
  );
  expect(
    (await app.inject({ url: "/api/member", headers: newHeaders })).statusCode,
  ).toBe(401);
  await app.inject({
    method: "POST",
    url: "/api/family/dad/access",
    payload: {},
  });
  expect(
    (
      await pool.query(
        "SELECT token_hash FROM member_access WHERE profile_id='dad'",
      )
    ).rows[0].token_hash,
  ).not.toBe(rotated);
  expect(
    (
      await app.inject({
        method: "DELETE",
        url: "/api/family/dad/access",
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await pool.query("SELECT count(*)::int AS n FROM member_access")).rows[0]
      .n,
  ).toBe(0);
  const health = await app.inject("/api/family/status");
  expect(health.statusCode).toBe(200);
  expect(health.json().profiles[0].deliveries[0].status).toBe("sent");
  expect(health.body).not.toContain("private-dad");
});
