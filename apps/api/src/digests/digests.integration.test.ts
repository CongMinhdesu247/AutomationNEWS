import { WorkflowQueue, WorkerRunner } from "../workflows/runtime.js";
import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import "../env.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { buildApp } from "../app.js";
import { DigestStore } from "./store.js";
import { DigestService } from "./service.js";
import type { HttpClient, HttpResponse } from "../connectors/http.js";
import { defaultSettings, type Digest, type Settings } from "@hub/contracts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required.");
const schema = "hub_digests_test_" + crypto.randomUUID().replaceAll("-", "");
const admin = createPool(url);
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});
const at = new Date("2026-11-11T18:00:00Z");
const now = () => at;
let calls: string[] = [];
let notificationStatus = 503;
const client: HttpClient = async (value, options): Promise<HttpResponse> => {
  calls.push(value);
  const target = new URL(value);
  if (target.hostname === "rss.example")
    throw new Error("Authorization: secret");
  if (target.hostname === "api.open-meteo.com")
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        daily: {
          time: ["2026-11-12"],
          temperature_2m_min: [22],
          temperature_2m_max: [30],
          precipitation_probability_max: [65],
          weather_code: [61],
        },
      }),
    };
  if (target.hostname === "api.github.com")
    return {
      status: 200,
      headers: {
        "x-ratelimit-resource": "search",
        "x-ratelimit-remaining": "9",
      },
      body: JSON.stringify({
        items: [
          {
            id: 123,
            full_name: "test/automation",
            description: "Original description",
            language: "TypeScript",
            html_url: "https://github.com/test/automation",
            stargazers_count: 50,
            created_at: "2026-11-01T00:00:00Z",
            archived: false,
            fork: false,
          },
        ],
      }),
    };
  if (target.hostname === "ntfy.example") {
    expect(options?.headers?.Authorization).toBe("Bearer backend-only");
    return {
      status: notificationStatus,
      headers: {},
      body: JSON.stringify({ id: "message" }),
    };
  }
  throw new Error("Unexpected external request blocked by test");
};
let app = buildApp(pool, { http: client, now, ntfyToken: "backend-only" });
const headers = (key = crypto.randomUUID()) => ({ "idempotency-key": key });
const setting: Settings = {
  ...structuredClone(defaultSettings),
  rss: [
    {
      id: crypto.randomUUID(),
      name: "Failed feed",
      enabled: true,
      url: "https://rss.example/feed",
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
    topics: ["automation"],
    languages: ["TypeScript"],
    repositoryCount: 5,
  },
  notifications: {
    enabled: true,
    serverUrl: "https://ntfy.example/",
    topic: "configured-topic",
  },
};
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
it("preserves step-one settings across migration and rejects invalid create/list requests", async () => {
  const stored = (await app.inject("/api/settings")).json();
  await migrate(pool);
  expect((await app.inject("/api/settings")).json()).toEqual(stored);
  expect(
    (await app.inject({ method: "POST", url: "/api/digests" })).statusCode,
  ).toBe(400);
  const empty = await app.inject({
    method: "POST",
    url: "/api/digests",
    headers: headers(),
  });
  expect(empty.statusCode).toBe(400);
  expect(empty.json().error.code).toBe("NO_ENABLED_SOURCE");
  expect((await app.inject("/api/digests?pageSize=51")).statusCode).toBe(400);
  expect((await app.inject("/api/digests/not-a-uuid")).statusCode).toBe(400);
  expect(
    (await app.inject("/api/digests/" + crypto.randomUUID())).statusCode,
  ).toBe(404);
  expect(
    (await pool.query("SELECT count(*)::int AS count FROM digests")).rows[0]
      .count,
  ).toBe(0);
});
// These tests isolate connector aggregation; retry timing is covered by reliability tests.
const queue = new WorkflowQueue(pool, { maxRetries: 0 });
const runner = new WorkerRunner(queue, {}, { http: client, now });
async function drain() {
  for (let i = 0; i < 40; i++) {
    if (!(await runner.tick())) return;
  }
  throw new Error("Workflow did not drain");
}
let first: Digest;
it("runs branches independently, saves partial results and deduplicates simultaneous/repeated create requests", async () => {
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/settings",
        payload: setting,
      })
    ).statusCode,
  ).toBe(200);
  calls = [];
  const key = crypto.randomUUID();
  const responses = await Promise.all([
    app.inject({ method: "POST", url: "/api/digests", headers: headers(key) }),
    app.inject({ method: "POST", url: "/api/digests", headers: headers(key) }),
  ]);
  expect(responses.every((r) => r.statusCode === 202)).toBe(true);
  expect(responses[0].json().runId).toBe(responses[1].json().runId);
  expect(calls).toHaveLength(0);
  await drain();
  first = (
    await app.inject(
      "/api/digests/" + (await queue.get(responses[0].json().runId))!.digestId,
    )
  ).json();
  expect(first.status).toBe("partial");
  expect(first.sources?.rss.status).toBe("failed");
  expect(first.sources?.weather.status).toBe("success");
  expect(first.sources?.github.status).toBe("success");
  expect(first.sources?.github.data.newNotable).toHaveLength(1);
  expect(first.sources?.github.data.rising).toHaveLength(0);
  const count = calls.length;
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/digests",
        headers: headers(key),
      })
    ).json().runId,
  ).toBe(responses[0].json().runId);
  expect(calls).toHaveLength(count);
  expect(
    (await pool.query("SELECT count(*)::int AS count FROM digests")).rows[0]
      .count,
  ).toBe(1);
  expect(
    (await pool.query("SELECT count(*)::int AS count FROM github_snapshots"))
      .rows[0].count,
  ).toBe(1);
  expect(JSON.stringify(first)).not.toContain("backend-only");
  expect(JSON.stringify(first)).not.toContain("Authorization");
  await app.close();
  app = buildApp(pool, { http: client, now, ntfyToken: "backend-only" });
  expect((await app.inject("/api/digests/" + first.id)).json()).toEqual(first);
});
it("records ntfy failure separately, deduplicates sends and allows deliberate new attempts", async () => {
  const key = crypto.randomUUID();
  const before = calls.length;
  const failed = await app.inject({
    method: "POST",
    url: "/api/digests/" + first.id + "/notifications",
    headers: headers(key),
  });
  expect(failed.statusCode).toBe(200);
  expect(failed.json().status).toBe("failed");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/digests/" + first.id + "/notifications",
        headers: headers(key),
      })
    ).json().id,
  ).toBe(failed.json().id);
  expect(calls.length - before).toBe(1);
  notificationStatus = 200;
  const sent = await app.inject({
    method: "POST",
    url: "/api/digests/" + first.id + "/notifications",
    headers: headers(),
  });
  expect(sent.json().status).toBe("success");
  const digest = (await app.inject("/api/digests/" + first.id)).json();
  expect(digest.status).toBe("partial");
  expect(digest.sources).toEqual(first.sources);
  expect(digest.notifications).toHaveLength(2);
  expect(JSON.stringify(digest)).not.toContain("backend-only");
});
it("selects nearest 24h baseline instead of same-day snapshots and retains it for repeated runs", async () => {
  for (const hours of [24.5, 23.75, 2]) {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO digests(id,idempotency_key,settings_snapshot,status,created_at,completed_at) VALUES($1,$2,$3::jsonb,$4,$5,$5)",
      [
        id,
        crypto.randomUUID(),
        JSON.stringify(setting),
        "failed",
        new Date(at.getTime() - hours * 3600000),
      ],
    );
    await pool.query(
      "INSERT INTO github_snapshots(repository_id,digest_id,stars,fetched_at) VALUES($1,$2,$3,$4)",
      [
        123,
        id,
        hours === 23.75 ? 60 : 99,
        new Date(at.getTime() - hours * 3600000),
      ],
    );
  }
  for (let i = 0; i < 2; i++) {
    const response = await app.inject({
      method: "POST",
      url: "/api/digests",
      headers: headers(),
    });
    expect(response.statusCode).toBe(202);
    await drain();
    const digest = (
      await app.inject(
        "/api/digests/" + (await queue.get(response.json().runId))!.digestId,
      )
    ).json();
    expect(digest.sources.github.data.rising[0]).toMatchObject({
      starChange: -10,
      intervalHours: 23.75,
    });
    expect(digest.sources.github.data.newNotable).toHaveLength(0);
  }
  const before = (
    await pool.query("SELECT count(*)::int AS count FROM github_snapshots")
  ).rows[0].count;
  await Promise.all([migrate(pool), migrate(pool)]);
  expect(
    (await pool.query("SELECT count(*)::int AS count FROM github_snapshots"))
      .rows[0].count,
  ).toBe(before);
  const list = (await app.inject("/api/digests?page=1&pageSize=2")).json();
  expect(list.items).toHaveLength(2);
  expect(list.hasMore).toBe(true);
  expect(
    (await app.inject("/api/digests?page=2&pageSize=2")).json().items,
  ).toHaveLength(2);
});
it("bounds source execution time and completes a workflow even when digest quality is failed", async () => {
  let unblock: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let started: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const slow: HttpClient = async () => {
    started();
    await waiting;
    throw new Error("private transport detail");
  };
  const timeoutQueue = new WorkflowQueue(pool, {
    sourceTimeoutMs: 40,
    maxRetries: 0,
  });
  const worker = new WorkerRunner(timeoutQueue, {}, { http: slow, now });
  const accepted = await timeoutQueue.submit(crypto.randomUUID(), {});
  while (await worker.tick()) {}
  const run = (await timeoutQueue.get(accepted.runId))!;
  expect(run.status).toBe("completed");
  const result = (await new DigestStore(pool).get(run.digestId!))!;
  expect(result.status).toBe("failed");
  expect(result.sources?.weather.errors[0]?.code).toBe("TOTAL_TIMEOUT");
  unblock();
});
it("marks ambiguous delivery unknown and never initiates it twice with the same key", async () => {
  let count = 0;
  const service = new DigestService(new DigestStore(pool), {
    now,
    http: async () => {
      count++;
      throw new Error("socket lost after send secret");
    },
  });
  const key = crypto.randomUUID();
  const firstAttempt = await service.notify(first.id, key);
  expect(firstAttempt.status).toBe("unknown");
  expect((await service.notify(first.id, key)).id).toBe(firstAttempt.id);
  expect(count).toBe(1);
  expect((await new DigestStore(pool).get(first.id))?.status).toBe("partial");
});
