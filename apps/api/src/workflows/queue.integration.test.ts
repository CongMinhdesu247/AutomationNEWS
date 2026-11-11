import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import "../env.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { buildApp } from "../app.js";
import { WorkflowQueue, WorkerRunner, DigestNodeExecutor } from "./runtime.js";
import type { ClaimedJob } from "./queue.js";
import { defaultSettings, type Settings } from "@hub/contracts";
import type { HttpClient, HttpResponse } from "../connectors/http.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
const schema = "hub_queue_test_" + crypto.randomUUID().replaceAll("-", "");
const admin = createPool(url);
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  max: 12,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});
const at = new Date("2026-11-11T18:00:00Z");
const now = () => at;
let calls: string[] = [];
const http: HttpClient = async (url): Promise<HttpResponse> => {
  calls.push(new URL(url).hostname);
  if (url.includes("rss.example")) throw new Error("secret source error");
  if (url.includes("open-meteo"))
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        daily: {
          time: ["2026-11-12"],
          temperature_2m_min: [22],
          temperature_2m_max: [29],
          precipitation_probability_max: [70],
          weather_code: [61],
        },
      }),
    };
  if (url.includes("api.github.com"))
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        items: [
          {
            id: 555,
            full_name: "fixture/repo",
            description: "fixture",
            language: "TypeScript",
            html_url: "https://github.com/fixture/repo",
            stargazers_count: 50,
            created_at: "2026-11-01T00:00:00Z",
            archived: false,
            fork: false,
          },
        ],
      }),
    };
  throw new Error("External HTTP forbidden");
};
const settings: Settings = {
  ...structuredClone(defaultSettings),
  rss: [
    {
      id: crypto.randomUUID(),
      name: "Fixture",
      url: "https://rss.example/feed",
      enabled: true,
    },
  ],
  weather: {
    enabled: true,
    location: "Fixture Hà Nội",
    latitude: 21,
    longitude: 105,
  },
  github: { ...defaultSettings.github, enabled: true },
};
const queue = new WorkflowQueue(pool, {
  leaseMs: 5000,
  maxRecoveries: 1,
  maxRetries: 0,
});
let app = buildApp(pool);
const worker = (id: string) =>
  new WorkerRunner(queue, { workerId: id, heartbeatMs: 500 }, { http, now });
async function submit(config: Settings = settings) {
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(config),
  ]);
  return queue.submit(crypto.randomUUID(), {});
}
async function drain(runner = worker("drain")) {
  for (let i = 0; i < 60; i++) {
    if (!(await runner.tick())) return;
  }
  throw new Error("Queue did not drain");
}
async function expire(job: ClaimedJob) {
  await pool.query(
    "UPDATE workflow_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [job.id],
  );
}
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
it("enqueues root atomically, canonicalizes payload, preserves snapshots and conflicts on changed payload", async () => {
  const key = crypto.randomUUID();
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(settings),
  ]);
  const responses = await Promise.all([
    app.inject({
      method: "POST",
      url: "/api/digests",
      headers: { "idempotency-key": key },
    }),
    app.inject({
      method: "POST",
      url: "/api/digests",
      headers: { "idempotency-key": key },
      payload: { workflowVersion: "digest.v1" },
    }),
  ]);
  expect(responses.map((r) => r.statusCode)).toEqual([202, 202]);
  const id = responses[0].json().runId;
  expect(responses[1].json().runId).toBe(id);
  expect(responses[0].json().statusUrl).toBe("/api/runs/" + id);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM workflow_jobs WHERE run_id=$1",
        [id],
      )
    ).rows[0].count,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM node_runs WHERE run_id=$1",
        [id],
      )
    ).rows[0].count,
  ).toBe(6);
  const conflict = await app.inject({
    method: "POST",
    url: "/api/digests",
    headers: { "idempotency-key": key },
    payload: { workflowVersion: "digest.v2" },
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(defaultSettings),
  ]);
  expect((await queue.submit(key, {})).runId).toBe(id);
  expect(
    (
      await pool.query(
        "SELECT settings_snapshot FROM workflow_runs WHERE id=$1",
        [id],
      )
    ).rows[0].settings_snapshot,
  ).toEqual(settings);
  await drain();
  expect((await queue.get(id))?.status).toBe("completed");
  const legacyKey = crypto.randomUUID();
  await pool.query(
    "INSERT INTO digests(id,idempotency_key,settings_snapshot,status,completed_at) VALUES($1,$2,$3::jsonb,$4,clock_timestamp())",
    [crypto.randomUUID(), legacyKey, JSON.stringify(settings), "failed"],
  );
  await expect(queue.submit(legacyKey, {})).rejects.toMatchObject({
    statusCode: 409,
    code: "LEGACY_IDEMPOTENCY_KEY",
  });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM workflow_runs WHERE idempotency_key=$1",
        [legacyKey],
      )
    ).rows[0].count,
  ).toBe(0);
  expect((await app.inject("/api/runs?pageSize=51")).statusCode).toBe(400);
});
it("two workers cannot claim the same valid lease; concurrent branches enqueue compose exactly once", async () => {
  const accepted = await submit();
  const claims = await Promise.all([queue.claim("one"), queue.claim("two")]);
  const valid = claims.filter(Boolean) as ClaimedJob[];
  expect(valid).toHaveLength(1);
  expect(
    (await queue.get(accepted.runId))?.nodes.find((n) => n.nodeId === "start")
      ?.attempts,
  ).toBe(1);
  await worker("one").process(valid[0]!);
  const branches: ClaimedJob[] = [];
  for (let i = 0; i < 3; i++)
    branches.push((await queue.claim("branch-" + i))!);
  expect(new Set(branches.map((job) => job.id)).size).toBe(3);
  expect(branches.every((job) => job.type.startsWith("fetch_"))).toBe(true);
  await Promise.all(
    branches.map((job, index) => worker("branch-" + index).process(job)),
  );
  const compose = await pool.query(
    "SELECT count(*)::int count FROM workflow_jobs WHERE run_id=$1 AND node_id='compose_digest'",
    [accepted.runId],
  );
  expect(compose.rows[0].count).toBe(1);
  await drain();
  const run = (await queue.get(accepted.runId))!;
  expect(run.status).toBe("completed");
  const digest = (await app.inject("/api/digests/" + run.digestId)).json();
  expect(digest.status).toBe("partial");
  expect(digest.sources.rss.status).toBe("failed");
  expect(digest.sources.weather.status).toBe("success");
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM digests WHERE workflow_run_id=$1",
        [run.id],
      )
    ).rows[0].count,
  ).toBe(1);
});
it("recovers a crashed worker, rejects late output and never reruns successful connectors", async () => {
  const accepted = await submit();
  await worker("original").tick();
  const jobs: ClaimedJob[] = [];
  for (let i = 0; i < 3; i++) jobs.push((await queue.claim("original"))!);
  const weather = jobs.find((job) => job.type === "fetch_weather")!;
  const dead = jobs.find((job) => job.type === "fetch_rss")!;
  const github = jobs.find((job) => job.type === "fetch_github")!;
  calls = [];
  await worker("original").process(weather);
  await worker("original").process(github);
  expect(calls.filter((host) => host.includes("open-meteo"))).toHaveLength(1);
  await expire(dead);
  expect(await queue.heartbeat(dead)).toBe(false);
  expect(await queue.recover()).toBe(1);
  const reclaimed = (await queue.claim("replacement"))!;
  expect(reclaimed.id).toBe(dead.id);
  expect(reclaimed.token).not.toBe(dead.token);
  expect(
    await queue.finish(dead, {
      status: "succeeded",
      output: { malicious: "late" },
      error: null,
    }),
  ).toBe(false);
  await worker("replacement").process(reclaimed);
  await drain(worker("restarted"));
  const run = (await queue.get(accepted.runId))!;
  expect(run.status).toBe("completed");
  expect(calls.filter((host) => host.includes("open-meteo"))).toHaveLength(1);
  expect(run.nodes.find((n) => n.nodeId === "fetch_weather")?.attempts).toBe(1);
  expect(run.nodes.find((n) => n.nodeId === "fetch_rss")?.attempts).toBe(2);
  expect(
    (
      await pool.query(
        "SELECT status FROM execution_attempts WHERE claim_token=$1",
        [dead.token],
      )
    ).rows[0].status,
  ).toBe("interrupted");
  expect(JSON.stringify(await queue.get(run.id))).not.toContain(dead.token);
});
it("bounds crash recovery and does not retry connector errors", async () => {
  const accepted = await submit({
    ...structuredClone(defaultSettings),
    weather: settings.weather,
  });
  const root = (await queue.claim("crasher"))!;
  await expire(root);
  await queue.recover();
  const again = (await queue.claim("crasher-again"))!;
  await expire(again);
  await queue.recover();
  await drain();
  const run = (await queue.get(accepted.runId))!;
  expect(run.nodes.find((node) => node.nodeId === "start")).toMatchObject({
    status: "failed",
    attempts: 2,
    recoveries: 1,
    error: { code: "RECOVERY_LIMIT" },
  });
  expect(
    run.nodes
      .filter((node) => node.type.startsWith("fetch_"))
      .every((node) => node.status === "skipped"),
  ).toBe(true);
  // all_settled still composes an explicitly failed digest from missing dependencies.
  expect(run.status).toBe("completed");
  expect((await app.inject("/api/digests/" + run.digestId)).json().status).toBe(
    "failed",
  );
  const sourceRun = await submit();
  await drain();
  const source = (await queue.get(sourceRun.runId))!.nodes.find(
    (node) => node.nodeId === "fetch_rss",
  )!;
  expect(source.status).toBe("failed");
  expect(source.attempts).toBe(1);
});
it("fences late persist and snapshots, and a deliberate replay cannot duplicate a digest", async () => {
  const accepted = await submit();
  const execute = worker("before-persist");
  for (let i = 0; i < 5; i++) expect(await execute.tick()).toBe(true);
  const stale = (await queue.claim("stale-persister"))!;
  expect(stale.type).toBe("persist_digest");
  await expire(stale);
  await queue.recover();
  const fresh = (await queue.claim("new-persister"))!;
  await worker("new-persister").process(fresh);
  const before = await pool.query(
    "SELECT repository_id,stars FROM github_snapshots WHERE digest_id=$1",
    [accepted.runId],
  );
  expect(before.rows).toHaveLength(1);
  expect(
    await queue.finish(stale, {
      status: "succeeded",
      output: { late: true },
      error: null,
    }),
  ).toBe(false);
  expect(
    (
      await pool.query(
        "SELECT repository_id,stars FROM github_snapshots WHERE digest_id=$1",
        [accepted.runId],
      )
    ).rows,
  ).toEqual(before.rows);
  // Force an administrative replay to exercise SQL idempotency in addition to lease fencing.
  await pool.query(
    "UPDATE workflow_runs SET status='running',completed_at=NULL WHERE id=$1",
    [accepted.runId],
  );
  await pool.query(
    "UPDATE node_runs SET status='queued',completed_at=NULL WHERE run_id=$1 AND node_id='persist_digest'",
    [accepted.runId],
  );
  await pool.query(
    "UPDATE workflow_jobs SET status='queued' WHERE run_id=$1 AND node_id='persist_digest'",
    [accepted.runId],
  );
  const replay = (await queue.claim("replay"))!;
  expect(replay.type).toBe("persist_digest");
  await worker("replay").process(replay);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM digests WHERE workflow_run_id=$1",
        [accepted.runId],
      )
    ).rows[0].count,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT repository_id,stars FROM github_snapshots WHERE digest_id=$1",
        [accepted.runId],
      )
    ).rows,
  ).toEqual(before.rows);
});
it("rolls back digest and snapshots if lease expires during a database write", async () => {
  const accepted = await submit();
  for (let i = 0; i < 5; i++) await worker("prepare").tick();
  const job = (await queue.claim("slow-persist"))!;
  await pool.query(
    "UPDATE workflow_jobs SET lease_until=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",
    [job.id],
  );
  await pool.query(
    "CREATE FUNCTION slow_digest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.25); RETURN NEW; END $$; CREATE TRIGGER slow_digest BEFORE INSERT ON digests FOR EACH ROW EXECUTE FUNCTION slow_digest();",
  );
  try {
    await expect(
      queue.finish(job, { status: "succeeded", output: null, error: null }),
    ).rejects.toThrow("Lease");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM digests WHERE workflow_run_id=$1",
          [accepted.runId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM github_snapshots WHERE digest_id=$1",
          [accepted.runId],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await pool.query(
      "DROP TRIGGER slow_digest ON digests;DROP FUNCTION slow_digest();",
    );
  }
  await queue.recover();
  await drain();
  expect((await queue.get(accepted.runId))?.status).toBe("completed");
});
it("fails execution when an internal persistence error prevents saving the digest", async () => {
  const accepted = await submit();
  for (let i = 0; i < 5; i++) await worker("prepare").tick();
  await pool.query(
    "CREATE FUNCTION reject_digest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private detail'; END $$; CREATE TRIGGER reject_digest BEFORE INSERT ON digests FOR EACH ROW EXECUTE FUNCTION reject_digest();",
  );
  try {
    await worker("persist").tick();
    const run = (await queue.get(accepted.runId))!;
    expect(run.status).toBe("failed");
    expect(run.digestId).toBeNull();
    expect(
      run.nodes.find((node) => node.type === "persist_digest")?.error?.code,
    ).toBe("NODE_PERSIST_FAILED");
    expect(JSON.stringify(run)).not.toContain("private detail");
  } finally {
    await pool.query(
      "DROP TRIGGER reject_digest ON digests;DROP FUNCTION reject_digest();",
    );
  }
});
it("heartbeats extend leases and cancel work after ownership is lost", async () => {
  const accepted = await submit({
    ...structuredClone(defaultSettings),
    weather: settings.weather,
  });
  await worker("start").tick();
  let release: () => void = () => {};
  let signal: AbortSignal | undefined;
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controlled: HttpClient = async (_url, options) => {
    signal = options?.signal;
    entered();
    await waiting;
    return { status: 500, headers: {}, body: "" };
  };
  const runner = new WorkerRunner(
    queue,
    { workerId: "heartbeat", heartbeatMs: 20 },
    { http: controlled, now },
  );
  let weather: ClaimedJob | undefined;
  for (let i = 0; i < 3; i++) {
    const job = (await queue.claim("heartbeat"))!;
    if (job.type === "fetch_weather") weather = job;
    else await runner.process(job);
  }
  const task = runner.process(weather!);
  await started;
  const oldLease = (
    await pool.query("SELECT lease_until FROM workflow_jobs WHERE id=$1", [
      weather!.id,
    ])
  ).rows[0].lease_until.getTime();
  await new Promise((resolve) => setTimeout(resolve, 70));
  const newLease = (
    await pool.query("SELECT lease_until FROM workflow_jobs WHERE id=$1", [
      weather!.id,
    ])
  ).rows[0].lease_until.getTime();
  expect(newLease).toBeGreaterThan(oldLease);
  await pool.query(
    "UPDATE workflow_jobs SET claim_token=$2,worker_id='another' WHERE id=$1",
    [weather!.id, crypto.randomUUID()],
  );
  await task;
  expect(signal?.aborted).toBe(true);
  release();
  await expire(weather!);
  await queue.recover();
  await drain();
  expect((await queue.get(accepted.runId))?.status).toBe("completed");
});

it("recovers after killing a real worker process without rerunning completed nodes", async () => {
  const accepted = await submit({
    ...structuredClone(defaultSettings),
    weather: settings.weather,
  });
  const child = spawn(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      fileURLToPath(new URL("./test-support/worker-child.ts", import.meta.url)),
    ],
    {
      env: { ...process.env, TEST_DATABASE_URL: url, TEST_SCHEMA: schema },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Child worker did not start: " + output)),
        10000,
      );
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("FETCH_STARTED")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.once("error", reject);
    });
    const running = (await queue.get(accepted.runId))!;
    expect(
      running.nodes.find((node) => node.nodeId === "fetch_weather")?.status,
    ).toBe("running");
    expect(running.nodes.find((node) => node.nodeId === "start")?.status).toBe(
      "succeeded",
    );
    child.kill("SIGKILL");
    await exited;
    for (let i = 0; i < 60; i++) {
      const expired = (
        await pool.query(
          "SELECT 1 FROM workflow_jobs WHERE run_id=$1 AND status='leased' AND lease_until<=clock_timestamp()",
          [accepted.runId],
        )
      ).rowCount;
      if (expired) break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const replacement = worker("after-kill");
    await drain(replacement);
    const recovered = (await queue.get(accepted.runId))!;
    expect(recovered.status).toBe("completed");
    expect(
      recovered.nodes.find((node) => node.nodeId === "start")?.attempts,
    ).toBe(1);
    expect(
      recovered.nodes.find((node) => node.nodeId === "fetch_weather")?.attempts,
    ).toBe(2);
    expect(
      (
        await pool.query(
          "SELECT status FROM execution_attempts WHERE worker_id='kill-test-child' ORDER BY started_at DESC LIMIT 1",
        )
      ).rows[0].status,
    ).toBe("interrupted");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}, 20000);

it("does not overclaim worker capacity and leaves interrupted work recoverable on shutdown", async () => {
  const accepted = await submit();
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controlled: HttpClient = async (url, options) => {
    entered();
    await waiting;
    return http(url, options);
  };
  const controller = new AbortController();
  const runner = new WorkerRunner(
    queue,
    {
      workerId: "single-slot",
      concurrency: 1,
      pollMs: 10,
      heartbeatMs: 20,
      shutdownMs: 40,
    },
    { http: controlled, now },
  );
  const running = runner.run(controller.signal);
  await started;
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM workflow_jobs WHERE run_id=$1 AND status='leased'",
        [accepted.runId],
      )
    ).rows[0].count,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM workflow_jobs WHERE run_id=$1 AND status='queued'",
        [accepted.runId],
      )
    ).rows[0].count,
  ).toBe(2);
  controller.abort();
  await running;
  release();
  expect((await queue.get(accepted.runId))?.status).toBe("running");
  await pool.query(
    "UPDATE workflow_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1 AND status='leased'",
    [accepted.runId],
  );
  await queue.recover();
  await drain();
  expect((await queue.get(accepted.runId))?.status).toBe("completed");
});
