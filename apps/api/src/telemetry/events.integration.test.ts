import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  it,
  expect,
  vi,
} from "vitest";
import pg from "pg";
import "../env.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { buildApp } from "../app.js";
import { WorkflowQueue } from "../workflows/queue.js";
import { WorkerRunner } from "../workflows/runtime.js";
import {
  defaultSettings,
  cursor,
  cursorSequence,
  type RunEvent,
} from "@hub/contracts";
import { appendEvent } from "./store.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
const schema = "hub_events_test_" + crypto.randomUUID().replaceAll("-", "");
const admin = createPool(url);
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  max: 10,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});
const queue = new WorkflowQueue(pool, {
  leaseMs: 5000,
  maxRetries: 1,
  retryBaseMs: 60000,
});
const app = buildApp(pool, {}, { pollMs: 20, heartbeatMs: 40 });
let base = "";
const controllers = new Set<AbortController>();
const worker = new WorkerRunner(
  queue,
  { heartbeatMs: 500 },
  {
    http: async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        daily: {
          time: [
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Ho_Chi_Minh",
            }).format(new Date()),
          ],
          temperature_2m_min: [22],
          temperature_2m_max: [30],
          precipitation_probability_max: [65],
          weather_code: [61],
        },
      }),
    }),
  },
);
async function submit() {
  return queue.submit(crypto.randomUUID(), {});
}
async function drain() {
  for (let i = 0; i < 30; i++) {
    if (!(await worker.tick())) return;
  }
  throw new Error("Not drained");
}
async function open(
  id: string,
  value?: string,
  headers?: Record<string, string>,
) {
  const controller = new AbortController();
  controllers.add(controller);
  const response = await fetch(
    base +
      "/api/runs/" +
      id +
      "/events" +
      (value ? "?cursor=" + encodeURIComponent(value) : ""),
    { headers, signal: controller.signal },
  );
  return { response, controller };
}
async function frames(
  response: Response,
  count: number,
  predicate?: (frame: { event: string; id?: string; data: any }) => boolean,
) {
  const reader = response.body!.getReader();
  let buffer = "";
  const result: { event: string; id?: string; data: any }[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buffer += new TextDecoder().decode(part.value);
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const text = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = text.split("\n");
        const event = lines
          .find((line) => line.startsWith("event: "))
          ?.slice(7);
        if (!event) continue;
        const id = lines.find((line) => line.startsWith("id: "))?.slice(4);
        const data = JSON.parse(
          lines.find((line) => line.startsWith("data: "))!.slice(6),
        );
        const frame = { event, id, data };
        result.push(frame);
        if (result.length >= count || predicate?.(frame)) return result;
      }
    }
    return result;
  } finally {
    await reader.cancel();
  }
}
beforeAll(async () => {
  await admin.query("CREATE SCHEMA " + schema);
  await migrate(pool);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
}, 30000);
beforeEach(async () => {
  await pool.query("TRUNCATE workflow_runs,digests CASCADE");
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify({
      ...structuredClone(defaultSettings),
      weather: {
        enabled: true,
        location: "Fixture",
        latitude: 21,
        longitude: 105,
      },
    }),
  ]);
});
afterEach(() => {
  for (const controller of controllers) controller.abort();
  controllers.clear();
});
afterAll(async () => {
  await app.close();
  await pool.end();
  await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
  await admin.end();
});
it("rolls back event and sequence with state, and excludes sensitive data", async () => {
  const accepted = await submit();
  const before = (await queue.get(accepted.runId))!;
  await expect(
    queue.transaction(async (client) => {
      await client.query(
        "SELECT id FROM workflow_runs WHERE id=$1 FOR UPDATE",
        [accepted.runId],
      );
      await client.query(
        "UPDATE workflow_runs SET status='running' WHERE id=$1",
        [accepted.runId],
      );
      await appendEvent(client, accepted.runId, "run.started");
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect((await queue.get(accepted.runId))!.eventCursor).toBe(
    before.eventCursor,
  );
  expect((await queue.get(accepted.runId))!.status).toBe("queued");
  await expect(
    pool.query(
      "INSERT INTO run_events(run_id,sequence,type,payload) VALUES($1,$2,$3,$4::jsonb)",
      [
        accepted.runId,
        999999,
        "run.created",
        JSON.stringify({ padding: "x".repeat(5000) }),
      ],
    ),
  ).rejects.toThrow();
  await worker.tick();
  const jobs = [];
  for (let i = 0; i < 3; i++) jobs.push((await queue.claim("parallel-" + i))!);
  await Promise.all(
    jobs.map((job) =>
      queue.finish(job, {
        status: "failed",
        output: { Authorization: "secret", rawResponse: "sensitive" },
        error: { code: "INVALID_URL", message: "Authorization secret token" },
      }),
    ),
  );
  const rows = await pool.query(
    "SELECT sequence,payload FROM run_events WHERE run_id=$1 ORDER BY sequence",
    [accepted.runId],
  );
  expect(rows.rows.map((row) => Number(row.sequence))).toEqual(
    Array.from({ length: rows.rows.length }, (_, i) => i + 1),
  );
  expect(JSON.stringify(rows.rows)).not.toMatch(
    /secret|sensitive|Authorization|rawResponse/,
  );
});
it("reads consistent snapshot/cursor and replays everything committed before stream attachment", async () => {
  const accepted = await submit();
  const snapshot = (await queue.get(accepted.runId))!;
  expect(snapshot.recentEvents.at(-1)?.id).toBe(snapshot.eventCursor);
  await drain();
  const { response } = await open(accepted.runId, snapshot.eventCursor);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const result = await frames(
    response,
    100,
    (frame) => frame.event === "sync" && frame.data.terminal,
  );
  const events = result
    .filter((frame) => frame.event === "run-event")
    .map((frame) => frame.data as RunEvent);
  const final = (await queue.get(accepted.runId))!;
  expect(events[0]?.sequence).toBe(
    String(cursorSequence(snapshot.eventCursor, accepted.runId) + 1n),
  );
  expect(events.at(-1)?.id).toBe(final.eventCursor);
  expect(events.some((event) => event.type === "run.completed")).toBe(true);
  expect(result.at(-1)?.event).toBe("sync");
  const replay = (
    await open(accepted.runId, cursor(accepted.runId, "0"), {
      "Last-Event-ID": snapshot.eventCursor,
    })
  ).response;
  const again = await frames(replay, 100, (frame) => frame.event === "sync");
  expect(
    again
      .filter((frame) => frame.event === "run-event")
      .map((frame) => frame.id),
  ).toEqual(events.map((event) => event.id));
});
it("snapshot and event projection agree while a transition commits concurrently", async () => {
  for (let i = 0; i < 5; i++) {
    const accepted = await submit();
    const [snapshot] = await Promise.all([
      queue.get(accepted.runId),
      worker.tick(),
    ]);
    expect(snapshot!.recentEvents.at(-1)?.id).toBe(snapshot!.eventCursor);
    const latest = [...snapshot!.recentEvents]
      .reverse()
      .find((event) => event.nodeId === "start");
    if (latest?.payload.node)
      expect(
        snapshot!.nodes.find((node) => node.nodeId === "start")?.status,
      ).toBe(latest.payload.node.status);
    await drain();
  }
});
it("streams retry, recovery, skipped and terminal transitions in sequence", async () => {
  const accepted = await submit();
  await worker.tick();
  const jobs = [];
  for (let i = 0; i < 3; i++) jobs.push((await queue.claim("retry-fixture"))!);
  const weather = jobs.find((job) => job.type === "fetch_weather")!;
  for (const job of jobs.filter((job) => job !== weather))
    await worker.process(job);
  await queue.finish(weather, {
    status: "failed",
    output: null,
    error: { code: "HTTP_503", message: "raw private message" },
  });
  await pool.query(
    "UPDATE workflow_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [weather.id],
  );
  const crashed = (await queue.claim("crashed"))!;
  await pool.query(
    "UPDATE workflow_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [crashed.id],
  );
  await queue.recover();
  await drain();
  const stream = (await open(accepted.runId, cursor(accepted.runId, "0")))
    .response;
  const received = await frames(
    stream,
    100,
    (frame) => frame.event === "sync" && frame.data.terminal,
  );
  const events = received
    .filter((frame) => frame.event === "run-event")
    .map((frame) => frame.data as RunEvent);
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining([
      "run.created",
      "run.started",
      "node.started",
      "node.retry_scheduled",
      "job.recovered",
      "node.skipped",
      "node.succeeded",
      "run.completed",
    ]),
  );
  expect(events.map((event) => Number(event.sequence))).toEqual(
    Array.from({ length: events.length }, (_, i) => i + 1),
  );
});
it("validates before opening and resets a future or missing cursor without changing data", async () => {
  const id = (await submit()).runId;
  expect((await fetch(base + "/api/runs/not-uuid/events")).status).toBe(400);
  expect((await open(crypto.randomUUID())).response.status).toBe(404);
  expect((await open(id, "bad")).response.status).toBe(400);
  expect(
    (await open(id, cursor(crypto.randomUUID(), "0"))).response.status,
  ).toBe(400);
  const future = await frames(
    (await open(id, cursor(id, "999999"))).response,
    1,
  );
  expect(future[0]?.event).toBe("reset");
  expect(future[0]?.data.code).toBe("CURSOR_OUT_OF_RANGE");
  await pool.query("DELETE FROM run_events WHERE run_id=$1 AND sequence=1", [
    id,
  ]);
  const gap = await frames((await open(id, cursor(id, "0"))).response, 1);
  expect(gap[0]?.data.code).toBe("EVENT_GAP");
});
it("shares database reads, emits heartbeat and releases idle resources after disconnect", async () => {
  const id = (await submit()).runId;
  const snapshot = (await queue.get(id))!;
  const spy = vi.spyOn(pool, "query");
  const first = await open(id, snapshot.eventCursor);
  const second = await open(id, snapshot.eventCursor);
  const reader = first.response.body!.getReader();
  let data = "";
  for (let i = 0; i < 10 && !data.includes("heartbeat"); i++) {
    const part = await reader.read();
    data += new TextDecoder().decode(part.value);
  }
  expect(data).toContain(": heartbeat");
  expect(pool.idleCount).toBeGreaterThan(0);
  expect(pool.totalCount - pool.idleCount).toBeLessThanOrEqual(1);
  first.controller.abort();
  second.controller.abort();
  await reader.cancel().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 100));
  const count = spy.mock.calls.filter(
    (args) =>
      typeof args[0] === "string" && args[0].includes("jsonb_to_recordset"),
  ).length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(
    spy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" && args[0].includes("jsonb_to_recordset"),
    ).length,
  ).toBe(count);
  spy.mockRestore();
});

it("streams internal node failure and failed run as terminal events", async () => {
  const accepted = await submit();
  for (let i = 0; i < 5; i++) await worker.tick();
  const persist = (await queue.claim("failure-fixture"))!;
  expect(persist.type).toBe("persist_digest");
  await queue.finish(persist, {
    status: "failed",
    output: null,
    error: { code: "NODE_EXECUTION_FAILED", message: "private detail" },
  });
  const received = await frames(
    (await open(accepted.runId, cursor(accepted.runId, "0"))).response,
    200,
    (frame) => frame.event === "sync" && frame.data.terminal,
  );
  const events = received
    .filter((frame) => frame.event === "run-event")
    .map((frame) => frame.data as RunEvent);
  expect(events.map((event) => event.type)).toContain("node.failed");
  expect(events.at(-1)?.type).toBe("run.failed");
  expect((await queue.get(accepted.runId))!.status).toBe("failed");
});
it("replays multiple bounded batches while snapshots retain only the last 100 events", async () => {
  const accepted = await submit();
  // Synthetic size fixtures exercise event-store pagination without external calls.
  await queue.transaction(async (client) => {
    await client.query("SELECT id FROM workflow_runs WHERE id=$1 FOR UPDATE", [
      accepted.runId,
    ]);
    for (let i = 0; i < 125; i++)
      await appendEvent(client, accepted.runId, "node.queued", "start");
  });
  await drain();
  const snapshot = (await queue.get(accepted.runId))!;
  expect(snapshot.recentEvents).toHaveLength(100);
  expect(snapshot.eventsTruncated).toBe(true);
  expect(snapshot.recentEvents.at(-1)?.id).toBe(snapshot.eventCursor);
  const received = await frames(
    (await open(accepted.runId, cursor(accepted.runId, "0"))).response,
    500,
    (frame) => frame.event === "sync" && frame.data.terminal,
  );
  const events = received
    .filter((frame) => frame.event === "run-event")
    .map((frame) => frame.data as RunEvent);
  expect(events.map((event) => Number(event.sequence))).toEqual(
    Array.from(
      { length: Number(cursorSequence(snapshot.eventCursor, accepted.runId)) },
      (_, i) => i + 1,
    ),
  );
}, 15000);
