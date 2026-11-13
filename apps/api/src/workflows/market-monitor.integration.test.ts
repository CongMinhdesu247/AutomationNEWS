import { beforeAll, afterAll, expect, it } from "vitest";
import pg from "pg";
import { defaultSettings } from "@hub/contracts";
import { migrate } from "../migrate.js";
import { checkMarketLows } from "./market-monitor.js";
import { WorkflowQueue, WorkerRunner } from "./runtime.js";
import { DigestStore } from "../digests/store.js";
import { initialState } from "../cloud/state.js";
import { dateInZone } from "../connectors/weather.js";
import { marketAt, usdJson } from "../connectors/test-support/market-fixtures.js";
import type { HttpClient } from "../connectors/http.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw Error("Set TEST_DATABASE_URL to an isolated PostgreSQL test database.");
const schema = "hub_test_" + crypto.randomUUID().replaceAll("-", "");
const admin = new pg.Pool({ connectionString: url });
const pool = new pg.Pool({ connectionString: url, options: "-c search_path=" + schema });
beforeAll(async () => {
  await admin.query("CREATE SCHEMA " + schema);
  await migrate(pool);
}, 30000);
afterAll(async () => {
  await pool.end();
  await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
  await admin.end();
});
it("persists 30-minute checks and low reservations across restarts, merges observed history, and does not send with disabled notifications", async () => {
  const settings = { ...structuredClone(defaultSettings), usd: { enabled: true },
    notifications: { enabled: true, topic: "fixture_only", serverUrl: "https://ntfy.sh/" } };
  const state = initialState();
  state.marketHistory = Array.from({ length: 30 }, (_, i) => ({
    day: dateInZone(new Date(+marketAt - (i + 1) * 86400000), "Asia/Ho_Chi_Minh"), prices: { usd: 25900 },
  }));
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [JSON.stringify(settings)]);
  await pool.query("UPDATE market_monitor SET state=$1::jsonb WHERE id=1", [JSON.stringify(state)]);
  let gets = 0;
  const sends: Record<string, unknown>[] = [];
  const http: HttpClient = async (_url, request = {}) => {
    if (request.method === "POST") {
      sends.push(JSON.parse(request.body!));
      const saved = (await pool.query("SELECT state FROM market_monitor WHERE id=1")).rows[0].state;
      expect(Object.values(saved.deliveries).some((v: any) => v.status === "reserved")).toBe(true);
      return { status: 200, headers: {}, body: "{}" };
    }
    gets++;
    return { status: 200, headers: {}, body: usdJson };
  };
  await checkMarketLows(pool, { http, now: () => marketAt });
  expect(sends).toHaveLength(1);
  expect(sends[0]?.priority).toBe(5);
  await checkMarketLows(pool, { http, now: () => new Date(+marketAt + 29 * 60000) });
  expect(gets).toBe(1);
  await checkMarketLows(pool, { http, now: () => new Date(+marketAt + 30 * 60000) });
  expect(gets).toBe(2);
  expect(sends).toHaveLength(1);
  const history = await new DigestStore(pool).marketHistory(marketAt, crypto.randomUUID());
  expect(history).toHaveLength(31);
  expect(history.find(v => v.day === "2026-11-12")?.prices.usd).toBe(25870);
  settings.notifications.enabled = false;
  await pool.query("UPDATE settings SET config=$1::jsonb WHERE id=1", [JSON.stringify(settings)]);
  await checkMarketLows(pool, { http, now: () => new Date(+marketAt + 60 * 60000) });
  expect(gets).toBe(2);
  const queue = new WorkflowQueue(pool);
  const run = await queue.submit(crypto.randomUUID(), {});
  const worker = new WorkerRunner(queue, {}, { http, now: () => marketAt });
  for (let i = 0; i < 20 && await worker.tick(); i++) { /* drain the bounded DAG */ }
  const digest = await new DigestStore(pool).get(run.runId);
  expect(digest?.sources?.usd?.data?.low30).toEqual({ minimum: 25900, days: 30, isLowest: true });
  await migrate(pool); // upgrade remains idempotent
});
