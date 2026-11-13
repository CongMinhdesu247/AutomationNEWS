import { expect, it } from "vitest";
import { defaultSettings, type Settings } from "@hub/contracts";
import { runCloudDigest } from "./digest.js";
import { cloudStateSchema, initialState, type CloudStateStore } from "./state.js";
import { marketAt, usdJson } from "../connectors/test-support/market-fixtures.js";
import { dateInZone } from "../connectors/weather.js";
import type { HttpClient } from "../connectors/http.js";

it("imports verified bank history before formatting and retains it for later runs", async () => {
  let value = initialState();
  let revision = 0;
  const state: CloudStateStore = {
    async load() { return { state: structuredClone(value), sha: String(revision) }; },
    async save(next, sha) {
      expect(sha).toBe(String(revision)); value = cloudStateSchema.parse(next); return String(++revision);
    },
  };
  const settings: Settings = { ...structuredClone(defaultSettings), usd: { enabled: true },
    notifications: { enabled: true, topic: "fixture_private", serverUrl: "https://ntfy.sh/" } };
  let historicalReads = 0;
  const sends: Record<string, unknown>[] = [];
  const http: HttpClient = async (url, request = {}) => {
    if (request.method === "POST") {
      sends.push(JSON.parse(request.body!)); return { status: 200, headers: {}, body: "{}" };
    }
    const day = new URL(url).searchParams.get("date")!;
    const data = JSON.parse(usdJson);
    if (day !== "2026-11-12") {
      historicalReads++; data.Date = day + "T00:00:00"; data.UpdatedDate = day + "T23:00:00+07:00";
      data.Data[0].sell = "25900";
    }
    return { status: 200, headers: {}, body: JSON.stringify(data) };
  };
  await runCloudDigest({ state, settings, http, now: () => marketAt, backfillHistory: true });
  expect(historicalReads).toBe(30);
  expect(sends[0]?.message).toContain("25.900");
  expect(sends[0]?.message).toContain("Vietcombank");
  expect(sends[0]?.priority).toBe(5);
  expect(value.marketHistory).toHaveLength(31);
  expect(value.marketHistory?.[0]?.historical?.usd).toContain("date=2026-10-13");
  expect(value.marketBackfillDays?.usd).toBe("2026-11-12");
});

it("sends urgent lows automatically without general alerts, reserves before POST, deduplicates and permits a further drop within 30 minutes", async () => {
  let value = initialState();
  value.marketHistory = Array.from({ length: 30 }, (_, i) => ({
    day: dateInZone(new Date(+marketAt - (i + 1) * 86400000), "Asia/Ho_Chi_Minh"), prices: { usd: 25900 },
  }));
  let revision = 0;
  const state: CloudStateStore = {
    async load() { return { state: structuredClone(value), sha: String(revision) }; },
    async save(next, sha) {
      expect(sha).toBe(String(revision));
      value = cloudStateSchema.parse(structuredClone(next));
      return String(++revision);
    },
  };
  const settings: Settings = { ...structuredClone(defaultSettings), usd: { enabled: true },
    notifications: { enabled: true, topic: "fixture_private", serverUrl: "https://ntfy.sh/" } };
  const sends: Record<string, unknown>[] = [];
  let price = 25870;
  let ambiguous = false;
  const http: HttpClient = async (_url, request = {}) => {
    if (request.method === "POST") {
      expect(Object.values(value.deliveries).some(v => v.status === "reserved")).toBe(true);
      sends.push(JSON.parse(request.body!));
      if (ambiguous) throw Error("network timeout");
      return { status: 200, headers: {}, body: "{}" };
    }
    return { status: 200, headers: {}, body: usdJson.replace("25870.00", String(price)) };
  };
  let at = marketAt;
  const run = (extra = {}) => runCloudDigest({ settings, state, http, now: () => at,
    signalNamespace: "0123456789abcdef", ...extra });
  await run();
  expect(sends).toHaveLength(1);
  expect(sends[0]?.priority).toBe(5);
  expect(sends[0]?.title).toContain("KHẨN");
  expect(sends[0]?.message).toContain("25.900");
  expect(sends[0]?.message).toContain("thấp nhất 30 ngày");
  at = new Date(+at + 30 * 60000);
  await run({ alertsOnly: true });
  expect(sends).toHaveLength(1);
  price = 25860;
  at = new Date(+at + 30 * 60000);
  await run({ alertsOnly: true });
  expect(sends).toHaveLength(2);
  expect(sends[1]?.message).toContain("25.860");
  price = 25850;
  ambiguous = true;
  at = new Date(+at + 30 * 60000);
  await expect(run({ alertsOnly: true })).rejects.toThrow();
  await run({ alertsOnly: true });
  expect(sends).toHaveLength(3);
  expect(JSON.stringify(value)).not.toContain("fixture_private");
});
