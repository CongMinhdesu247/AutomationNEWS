import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import pg from "pg";
import "../env.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { defaultSettings, type Settings } from "@hub/contracts";
import { WorkflowQueue } from "./queue.js";
import { WorkerRunner } from "./runtime.js";
import { DigestScheduler } from "./schedule.js";
import { buildApp } from "../app.js";
import type { HttpClient } from "../connectors/http.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
const schema =
  "hub_reliability_test_" + crypto.randomUUID().replaceAll("-", "");
const admin = createPool(url);
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  max: 12,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});
const config: Settings = {
  ...structuredClone(defaultSettings),
  weather: { enabled: true, location: "Fixture", latitude: 21, longitude: 105 },
  notifications: {
    enabled: true,
    serverUrl: "https://ntfy.example/",
    topic: "fixture",
  },
};
let httpStatus = 200;
let posts = 0;
let ambiguousSend = false;
const http: HttpClient = async (_url, options = {}) => {
  if (options.method === "POST") {
    posts++;
    if (ambiguousSend) throw new Error("lost response");
    return { status: 200, headers: {}, body: "{}" };
  }
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.newsletter.timezone,
  }).format(new Date());
  return {
    status: httpStatus,
    headers: {},
    body: JSON.stringify({
      daily: {
        time: [day],
        temperature_2m_min: [23],
        temperature_2m_max: [29],
        precipitation_probability_max: [70],
        weather_code: [61],
      },
    }),
  };
};
const queue = new WorkflowQueue(pool, {
  maxRetries: 1,
  retryBaseMs: 60000,
  leaseMs: 5000,
});
const worker = new WorkerRunner(queue, { heartbeatMs: 500 }, { http });
async function drain() {
  for (let i = 0; i < 30; i++) {
    if (!(await worker.tick())) return;
  }
  throw new Error("Did not drain");
}
async function submit() {
  return queue.submit(crypto.randomUUID(), {});
}
async function due() {
  await pool.query(
    "UPDATE workflow_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE status='queued'",
  );
}
async function scheduled() {
  const scheduler = new DigestScheduler(queue, { http });
  await scheduler.tick();
  await pool.query(
    "UPDATE digest_schedule SET next_run_at=clock_timestamp()-interval '1 second' WHERE id=1",
  );
  const id = await scheduler.tick();
  if (!id) throw new Error("Missing scheduled run");
  return { id, scheduler };
}
beforeAll(async () => {
  await admin.query("CREATE SCHEMA " + schema);
  await migrate(pool);
}, 30000);
beforeEach(async () => {
  await pool.query("TRUNCATE workflow_runs,digests CASCADE");
  await pool.query(
    "INSERT INTO digest_schedule(id) VALUES(1) ON CONFLICT DO NOTHING",
  );
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(config),
  ]);
  httpStatus = 200;
  posts = 0;
  ambiguousSend = false;
});
afterAll(async () => {
  await pool.end();
  await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
  await admin.end();
});

it("keeps failed source nonterminal until retry is due, then succeeds across worker restart", async () => {
  httpStatus = 503;
  const accepted = await submit();
  await drain();
  let run = (await queue.get(accepted.runId))!;
  expect(run.status).toBe("running");
  expect(run.nodes.find((n) => n.nodeId === "fetch_weather")).toMatchObject({
    status: "queued",
    retryCount: 1,
    attempts: 1,
  });
  expect(run.nodes.find((n) => n.nodeId === "compose_digest")?.status).toBe(
    "pending",
  );
  expect(await queue.claim("too-early")).toBeUndefined();
  httpStatus = 200;
  await due();
  const restarted = new WorkerRunner(new WorkflowQueue(pool), {}, { http });
  for (let i = 0; i < 10 && (await restarted.tick()); i++) {
    /* drain */
  }
  run = (await queue.get(accepted.runId))!;
  expect(run.status).toBe("completed");
  expect(run.nodes.find((n) => n.nodeId === "fetch_weather")).toMatchObject({
    status: "succeeded",
    attempts: 2,
  });
  expect((await queue.deadLetters(1, 10)).items).toHaveLength(0);
});

it("exhausts retries into one DLQ entry and atomically replays to a new manual run", async () => {
  httpStatus = 503;
  const accepted = await submit();
  await drain();
  await due();
  await drain();
  const run = (await queue.get(accepted.runId))!;
  expect(run.status).toBe("completed");
  const letters = (await queue.deadLetters(1, 10)).items;
  expect(letters).toHaveLength(1);
  expect(letters[0]).toMatchObject({ runId: run.id, nodeId: "fetch_weather" });
  const replays = await Promise.all([
    queue.replay(letters[0]!.id),
    queue.replay(letters[0]!.id),
  ]);
  expect(replays[0]!.runId).toBe(replays[1]!.runId);
  expect(replays[0]!.runId).not.toBe(run.id);
  expect(
    (
      await pool.query("SELECT scheduled_at FROM workflow_runs WHERE id=$1", [
        replays[0]!.runId,
      ])
    ).rows[0].scheduled_at,
  ).toBeNull();
  expect(
    (await pool.query("SELECT status FROM digests WHERE id=$1", [run.digestId]))
      .rows[0].status,
  ).toBe("failed");
});

it("never retries permanent 401 failures", async () => {
  httpStatus = 401;
  const accepted = await submit();
  await drain();
  expect(
    (await queue.get(accepted.runId))!.nodes.find(
      (n) => n.nodeId === "fetch_weather",
    ),
  ).toMatchObject({ status: "failed", retryCount: 0, attempts: 1 });
  expect((await queue.deadLetters(1, 10)).items).toHaveLength(1);
});

it("fences a stale completion after a retry has been leased again", async () => {
  const accepted = await submit();
  const root = (await queue.claim("first"))!;
  await worker.process(root);
  let source = (await queue.claim("first"))!;
  while (source.type !== "fetch_weather") {
    await worker.process(source);
    source = (await queue.claim("first"))!;
  }
  await queue.finish(source, {
    status: "failed",
    output: null,
    error: { code: "HTTP_503", message: "fixture" },
  });
  await drain(); // Finish other ready source nodes before releasing the retry.
  await due();
  const replacement = (await queue.claim("second"))!;
  expect(replacement.id).toBe(source.id);
  expect(
    await queue.finish(source, {
      status: "succeeded",
      output: null,
      error: null,
    }),
  ).toBe(false);
  await worker.process(replacement);
  await drain();
  expect((await queue.get(accepted.runId))!.status).toBe("completed");
});

it("persists Retry-After and refuses early claims even after a new queue instance", async () => {
  await submit();
  await worker.tick();
  let source = (await queue.claim("hint"))!;
  while (source.type !== "fetch_weather") {
    await worker.process(source);
    source = (await queue.claim("hint"))!;
  }
  const retryAt = new Date(Date.now() + 120000).toISOString();
  await queue.finish(source, {
    status: "failed",
    output: null,
    error: { code: "HTTP_429", message: "fixture", retryAt },
  });
  await drain();
  const row = (
    await pool.query("SELECT available_at FROM workflow_jobs WHERE id=$1", [
      source.id,
    ])
  ).rows[0];
  expect(row.available_at.getTime()).toBeGreaterThanOrEqual(
    Date.parse(retryAt),
  );
  expect(await new WorkflowQueue(pool).claim("early")).toBeUndefined();
});

it("two schedulers enqueue one daily run and preserve manual creation", async () => {
  const scheduler = new DigestScheduler(queue, { http });
  await scheduler.tick();
  expect((await scheduler.status()).nextRunAt).toBeInstanceOf(Date);
  await pool.query(
    "UPDATE digest_schedule SET next_run_at=clock_timestamp()-interval '1 second'",
  );
  await Promise.all([scheduler.tick(), new DigestScheduler(queue).tick()]);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM workflow_runs WHERE scheduled_at IS NOT NULL",
      )
    ).rows[0].count,
  ).toBe(1);
  await pool.query(
    "UPDATE digest_schedule SET next_run_at=clock_timestamp()-interval '1 second'",
  );
  await scheduler.tick();
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM workflow_runs WHERE scheduled_at IS NOT NULL",
      )
    ).rows[0].count,
  ).toBe(1);
  await submit();
  expect(
    (await pool.query("SELECT count(*)::int count FROM workflow_runs")).rows[0]
      .count,
  ).toBe(2);
});

it("skips old missed schedules, reschedules settings changes and respects disable", async () => {
  const scheduler = new DigestScheduler(queue);
  await scheduler.tick();
  await pool.query(
    "UPDATE digest_schedule SET next_run_at=clock_timestamp()-interval '2 hours'",
  );
  expect(await scheduler.tick()).toBeNull();
  expect(
    (await pool.query("SELECT count(*)::int count FROM workflow_runs")).rows[0]
      .count,
  ).toBe(0);
  const updated = structuredClone(config);
  updated.newsletter.sendTime = "09:23";
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(updated),
  ]);
  await scheduler.tick();
  expect((await scheduler.status()).configuration.sendTime).toBe("09:23");
  updated.newsletter.enabled = false;
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(updated),
  ]);
  await scheduler.tick();
  expect((await scheduler.status()).nextRunAt).toBeNull();
});

it("persists a notification outbox atomically and only one scheduler sends with the snapshot destination", async () => {
  const { id, scheduler } = await scheduled();
  await drain();
  expect((await queue.get(id))!.status).toBe("completed");
  expect(
    (await pool.query("SELECT * FROM scheduled_deliveries")).rows,
  ).toHaveLength(1);
  // Settings changed after run creation; snapshot destination is still used.
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(defaultSettings),
  ]);
  await Promise.all([
    scheduler.deliver(),
    new DigestScheduler(queue, { http }).deliver(),
  ]);
  expect(posts).toBe(1);
  expect(
    (await pool.query("SELECT status FROM scheduled_deliveries")).rows[0]
      .status,
  ).toBe("success");
  await scheduler.deliver();
  expect(posts).toBe(1);
});

it("does not automatically resend ambiguous or interrupted notifications", async () => {
  const { scheduler } = await scheduled();
  await drain();
  ambiguousSend = true;
  await scheduler.deliver();
  await scheduler.deliver();
  expect(posts).toBe(1);
  expect(
    (await pool.query("SELECT status FROM scheduled_deliveries")).rows[0]
      .status,
  ).toBe("unknown");
  await pool.query(
    "UPDATE scheduled_deliveries SET status='sending',lease_until=clock_timestamp()-interval '1 second'",
  );
  await scheduler.deliver();
  expect(posts).toBe(1);
  expect(
    (await pool.query("SELECT status FROM scheduled_deliveries")).rows[0]
      .status,
  ).toBe("unknown");
});

it("suppresses automatic delivery for schedules from an earlier local day", async () => {
  const { id, scheduler } = await scheduled();
  await drain();
  await pool.query(
    "UPDATE workflow_runs SET scheduled_at=clock_timestamp()-interval '2 days' WHERE id=$1",
    [id],
  );
  await scheduler.deliver();
  expect(posts).toBe(0);
  const delivery = (
    await pool.query("SELECT status,error FROM scheduled_deliveries")
  ).rows[0];
  expect(delivery.status).toBe("failed");
  expect(delivery.error.code).toBe("STALE_SCHEDULED_DIGEST");
});

it("exposes schedule and DLQ API with pagination and rejects invalid replay", async () => {
  const app = buildApp(pool);
  try {
    expect((await app.inject({ url: "/api/schedule" })).statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/api/dead-letters?pageSize=999" })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/dead-letters/" + crypto.randomUUID() + "/replay",
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
