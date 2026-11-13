import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  defaultSettings,
  defaultAlerts,
  nextFamilySend,
  priceFreshness,
  type Digest,
  type FamilyConfig,
} from "@hub/contracts";
import {
  initialState,
  cloudStateSchema,
  pruneState,
  type CloudState,
  type CloudStateStore,
} from "./state.js";
import { runCloudFamily } from "./family.js";
import { sealReport } from "./reports.js";
import { significantChanges } from "./alerts.js";
import type { HttpClient } from "../connectors/http.js";
const at = new Date("2026-11-12T02:00:00Z");
const config: FamilyConfig = {
  version: 1,
  profiles: [
    {
      id: "mom",
      name: "Mẹ",
      topic: "private_mom_topic",
      enabled: true,
      city: "hanoi",
      sendTime: "09:00",
      days: [1, 2, 3, 4, 5, 6, 7],
      newsTopics: [],
      weather: false,
      airQuality: false,
      fuel: false,
      github: false,
      usd: true,
      alerts: { ...defaultAlerts, enabled: true },
    },
  ],
};
class Memory implements CloudStateStore {
  value = initialState();
  revision = 0;
  async load() {
    return { state: structuredClone(this.value), sha: String(this.revision) };
  }
  async save(value: CloudState, sha?: string) {
    if (sha !== String(this.revision)) throw Error("conflict");
    this.value = cloudStateSchema.parse(structuredClone(value));
    return String(++this.revision);
  }
}
it("uses VN weekdays for next schedule and labels old quotes against today's date", () => {
  expect(nextFamilySend(config.profiles[0]!, new Date(+at - 60000))).toBe(
    at.toISOString(),
  );
  expect(nextFamilySend({ ...config.profiles[0]!, days: [1] }, at)).toBe(
    "2026-11-16T02:00:00.000Z",
  );
  expect(
    nextFamilySend({ ...config.profiles[0]!, enabled: false }, at),
  ).toBeNull();
  expect(priceFreshness("2026-11-11T23:00:00Z", at)).toContain(
    "Nguồn cập nhật",
  );
  expect(priceFreshness("2026-11-11T02:00:00Z", at)).toContain("Giá gần nhất");
});
it("compares absolute market movement, treats AQI as crossing, and seeds silently", () => {
  const baseline = {
    at: at.toISOString(),
    values: { sjc_bar_buy: 13600000, usd_sell: 25870, aqi: 149 },
  };
  expect(
    significantChanges(
      { sjc_bar_buy: 13700000, usd_sell: 25770, aqi: 150 },
      baseline,
      defaultAlerts,
    ),
  ).toHaveLength(3);
  expect(
    significantChanges(
      { aqi: 190 },
      { ...baseline, values: { aqi: 160 } },
      defaultAlerts,
    ),
  ).toEqual([]);
  expect(significantChanges({ aqi: 190 }, undefined, defaultAlerts)).toEqual(
    [],
  );
});
it("encrypts full report without persisting keys, settings or destinations and authenticates ciphertext", async () => {
  const digest: Digest = {
    id: crypto.randomUUID(),
    createdAt: at.toISOString(),
    completedAt: at.toISOString(),
    status: "success",
    settings: structuredClone(defaultSettings),
    notifications: [],
    sources: {
      rss: {
        status: "success",
        fetchedAt: at.toISOString(),
        errors: [],
        data: {
          items: [
            {
              id: "x",
              title: "Tin bí mật trong bản tin",
              description: "",
              source: "fixture",
              url: "https://news.example/",
              publishedAt: at.toISOString(),
            },
          ],
          feedsSucceeded: 1,
          feedsTotal: 1,
          skippedInvalidDate: 0,
          skippedInvalidItem: 0,
        },
      },
      weather: {
        status: "disabled",
        fetchedAt: at.toISOString(),
        errors: [],
        data: null,
      },
      github: {
        status: "disabled",
        fetchedAt: at.toISOString(),
        errors: [],
        data: {
          rising: [],
          newNotable: [],
          candidates: 0,
          withoutBaseline: 0,
          comparisonWindowHours: [20, 28],
          rateLimits: [],
        },
      },
    },
  };
  const sealed = sealReport(
    digest,
    "https://fixture.github.io/repo/report.html",
  );
  const keyBytes = Buffer.from(
    new URL(sealed.url).hash.slice(1).split(".")[1]!,
    "base64url",
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decode = () =>
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(sealed.report.iv, "base64url") },
      key,
      Buffer.from(sealed.report.ciphertext, "base64url"),
    );
  const text = new TextDecoder().decode(await decode());
  expect(text).toContain("Tin bí mật trong bản tin");
  expect(text).not.toContain("notifications");
  expect(JSON.stringify(sealed.report)).not.toContain("Tin bí mật");
  expect(JSON.stringify(sealed.report)).not.toContain(
    keyBytes.toString("base64url"),
  );
  const bytes = Buffer.from(sealed.report.ciphertext, "base64url");
  bytes[0] = bytes[0]! ^ 1;
  sealed.report.ciphertext = bytes.toString("base64url");
  await expect(decode()).rejects.toThrow();
});
it("persists delivery/source telemetry and report before POST, limits alerts, avoids retrying ambiguous alerts", async () => {
  const state = new Memory();
  const sends: any[] = [];
  let price = 25870;
  let ambiguous = false;
  const http: HttpClient = async (_url, options = {}) => {
    if (options.method === "POST") {
      const message = JSON.parse(options.body!);
      sends.push(message);
      expect(Object.values(state.value.deliveries).at(-1)?.status).toBe(
        "reserved",
      );
      if (ambiguous) throw Error("transport");
      return { status: 200, headers: {}, body: "{}" };
    }
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        UpdatedDate: "2026-11-12T08:45:00+07:00",
        Data: [
          {
            currencyCode: "USD",
            cash: "25460",
            transfer: "25490",
            sell: String(price),
          },
        ],
      }),
    };
  };
  const run = (date: Date, extra = {}) =>
    runCloudFamily(config, {
      state,
      http,
      now: () => date,
      reportBaseUrl: "https://fixture.github.io/repo/report.html",
      ...extra,
    });
  await run(at);
  expect(sends).toHaveLength(1);
  expect(sends[0]).not.toHaveProperty("click");
  expect(sends[0].message).toContain("Bản web (tùy chọn):\nhttps://fixture.github.io/repo/report.html#");
  expect(sends[0].message).not.toContain("Chạm để");
  const first = Object.values(state.value.deliveries)[0]!;
  expect(first.sources).toMatchObject([{ key: "usd", status: "success" }]);
  expect(first.reportId).toBeTruthy();
  const publicState = JSON.stringify(state.value);
  expect(publicState).not.toContain("private_mom_topic");
  expect(publicState).not.toContain("Mẹ");
  const revision = state.revision;
  await run(new Date(+at + 6 * 3600000), { dryRun: true });
  expect(state.revision).toBe(revision);
  expect(sends).toHaveLength(1);
  price = 26000;
  ambiguous = true;
  await expect(run(new Date(+at + 6 * 3600000))).rejects.toThrow();
  expect(sends).toHaveLength(2);
  await run(new Date(+at + 6.5 * 3600000));
  expect(sends).toHaveLength(2);
  await run(new Date(+at + 12 * 3600000));
  expect(sends).toHaveLength(2); // 21:00, quiet time
  const ns = createHash("sha256").update("mom").digest("hex").slice(0, 16);
  expect(state.value.deliveries["2026-11-12:" + ns + ":alert:0"]?.status).toBe(
    "unknown",
  );
  expect(
    pruneState(state.value, new Date(+at + 15 * 86400000)).reports,
  ).toEqual({});
});
