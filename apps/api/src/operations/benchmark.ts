import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import pg from "pg";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { WorkflowQueue, WorkerRunner } from "../workflows/runtime.js";
import { fixtureSettings, fixtureClient } from "./fixtures.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL to a test database.");
const samples = Number(process.env.BENCH_SAMPLES ?? 12),
  latency = Number(process.env.FIXTURE_LATENCY_MS ?? 200);
if (
  !Number.isInteger(samples) ||
  samples < 5 ||
  samples > 100 ||
  !Number.isInteger(latency) ||
  latency < 10 ||
  latency > 2000
)
  throw new Error("samples 5–100; latency 10–2000ms");
const schema = "hub_bench_" + crypto.randomUUID().replaceAll("-", "");
const admin = createPool(url);
await admin.query("CREATE SCHEMA " + schema);
const pool = new pg.Pool({
  connectionString: url,
  options: "-c search_path=" + schema,
  max: 10,
  statement_timeout: 5000,
});
const results: { concurrency: number; ms: number; runId: string }[] = [];
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;
try {
  await migrate(pool);
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [
    JSON.stringify(fixtureSettings),
  ]);
  const queue = new WorkflowQueue(pool, { maxRetries: 0 });
  async function once(concurrency: number, measured: boolean) {
    const fixture = fixtureClient(latency);
    const controller = new AbortController();
    const worker = new WorkerRunner(
      queue,
      { concurrency, pollMs: 5, heartbeatMs: 1000 },
      { http: fixture.http },
    );
    const start = performance.now();
    const accepted = await queue.submit(crypto.randomUUID(), {});
    const task = worker.run(controller.signal);
    try {
      for (;;) {
        const run = await queue.get(accepted.runId);
        if (run?.status === "completed") {
          if (!run.digestId) throw new Error("Missing digest");
          break;
        }
        if (run?.status === "failed" || performance.now() - start > 15000)
          throw new Error("Benchmark workflow failed/timed out");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const ms = performance.now() - start;
      const sources = (
        await pool.query(
          "SELECT sources FROM digests WHERE workflow_run_id=$1",
          [accepted.runId],
        )
      ).rows[0].sources;
      if (
        Object.values(sources).some(
          (source: any) => source.status !== "success",
        ) ||
        fixture.calls.length !== 4
      )
        throw new Error("Unexpected fixture workload");
      if (measured) results.push({ concurrency, ms, runId: accepted.runId });
    } finally {
      controller.abort();
      await task;
    }
  }
  for (let i = 0; i < 2; i++) {
    await once(1, false);
    await once(3, false);
  }
  // Alternate order to reduce systematic warm-cache/thermal ordering bias.
  for (let i = 0; i < samples; i++)
    for (const concurrency of i % 2 ? [3, 1] : [1, 3])
      await once(concurrency, true);
  const groups = [1, 3].map((concurrency) => {
    const values = results
      .filter((row) => row.concurrency === concurrency)
      .map((row) => row.ms);
    const rates = values.map((ms) => 1000 / ms);
    return {
      concurrency,
      samples: values.length,
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      throughputRunsPerSecond:
        values.length / (values.reduce((a, b) => a + b, 0) / 1000),
      medianThroughput: percentile(rates, 0.5),
      p95Throughput: percentile(rates, 0.95),
    };
  });
  const report = {
    label: "DEMO FIXTURE — not production performance",
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      memoryBytes: os.totalmem(),
      postgres: (await pool.query("SELECT version()")).rows[0].version,
    },
    method: {
      latencyMs: latency,
      httpRequestsPerRun: 4,
      branchRequests: { rss: 1, weather: 1, github: 2 },
      warmupsPerConcurrency: 2,
      queuePollMs: 5,
      snapshotCheckMs: 5,
      workflowVersion: "digest.v1",
      singleInFlightRun: true,
      percentile: "nearest rank",
      clock:
        "performance.now from before submit through observed completed snapshot",
    },
    groups,
    raw: results,
  };
  const output = process.env.BENCH_OUTPUT ?? "/tmp/benchmark-step6.json";
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, groups }));
} finally {
  await pool.end();
  await admin.query("DROP SCHEMA " + schema + " CASCADE");
  await admin.end();
}
