import { beforeAll, afterAll, expect, it } from "vitest";
import pg from "pg";
import "./env.js";
import { createPool } from "./db.js";
import { buildApp } from "./app.js";
import { migrate } from "./migrate.js";
import { defaultSettings, type Settings } from "@hub/contracts";
// Require an explicit opt-in URL. Every object belongs to a random isolated schema.
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set TEST_DATABASE_URL to a local development PostgreSQL database.",
  );
const schema = "hub_test_" + crypto.randomUUID().replaceAll("-", "");
const admin = createPool(url);
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});
let app = buildApp(pool);
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
it("persists all five groups, survives API restart, rejects invalid writes, reruns migrations and rolls back database failures", async () => {
  expect((await app.inject("/api/health")).statusCode).toBe(200);
  expect((await app.inject("/api/ready")).statusCode).toBe(200);
  expect((await app.inject("/api/settings")).json()).toEqual(defaultSettings);
  const value: Settings = {
    newsletter: {
      enabled: false,
      sendTime: "08:15",
      timezone: "Asia/Ho_Chi_Minh",
    },
    rss: [
      {
        id: crypto.randomUUID(),
        name: "Nguồn kiểm thử",
        url: "https://example.com/rss",
        enabled: true,
      },
    ],
    weather: {
      enabled: true,
      location: "Hà Nội",
      latitude: 21.0285,
      longitude: 105.8542,
    },
    github: {
      enabled: true,
      topics: ["automation", " AUTOMATION ", ""],
      languages: ["TypeScript"],
      repositoryCount: 8,
    },
    notifications: {
      enabled: true,
      serverUrl: "https://ntfy.sh/",
      topic: "hub-local-test",
    },
  };
  const saved = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: value,
  });
  expect(saved.statusCode).toBe(200);
  const expected = {
    ...value,
    github: { ...value.github, topics: ["automation"] },
  };
  expect(saved.json()).toEqual(expected);
  await app.close();
  app = buildApp(pool);
  expect((await app.inject("/api/settings")).json()).toEqual(expected);
  const invalid = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { ...value, weather: { ...value.weather, latitude: 91 } },
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().error.issues[0].path).toEqual(["weather", "latitude"]);
  const duplicate = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: {
      ...value,
      rss: [
        value.rss[0],
        {
          ...value.rss[0],
          id: crypto.randomUUID(),
          url: "https://EXAMPLE.com:443/rss/#fragment",
        },
      ],
    },
  });
  expect(duplicate.statusCode).toBe(400);
  expect((await app.inject("/api/settings")).json()).toEqual(expected);
  await Promise.all([migrate(pool), migrate(pool)]);
  expect(
    (await pool.query("SELECT count(*)::int AS count FROM schema_migrations"))
      .rows[0].count,
  ).toBe(5);
  expect((await app.inject("/api/settings")).json()).toEqual(expected);
  // Force a real database write failure after UPDATE and ensure transaction rollback.
  await pool.query(
    `CREATE FUNCTION reject_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private database failure'; END $$; CREATE TRIGGER fail_update AFTER UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION reject_update();`,
  );
  const failed = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: {
      ...expected,
      newsletter: { ...expected.newsletter, sendTime: "09:00" },
    },
  });
  expect(failed.statusCode).toBe(500);
  expect(failed.body).not.toContain("private database failure");
  expect((await app.inject("/api/settings")).json()).toEqual(expected);
  await pool.query("DROP TRIGGER fail_update ON settings");
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { "content-type": "application/json" },
        payload: "{broken",
      })
    ).statusCode,
  ).toBe(400);
  const unavailable = createPool(
    "postgresql://invalid:invalid@127.0.0.1:1/invalid",
  );
  const offline = buildApp(unavailable);
  try {
    expect((await offline.inject("/api/health")).statusCode).toBe(200);
    expect((await offline.inject("/api/ready")).statusCode).toBe(503);
  } finally {
    await offline.close();
    await unavailable.end();
  }
}, 30000);
