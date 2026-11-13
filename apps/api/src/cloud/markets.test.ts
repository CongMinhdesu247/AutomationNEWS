import { expect, it } from "vitest";
import { runCloudFamily } from "./family.js";
import {
  initialState,
  type CloudState,
  type CloudStateStore,
} from "./state.js";
import { goldSourceUrl, usdSourceUrl } from "../connectors/markets.js";
import {
  marketAt,
  goldHtml,
  usdJson,
} from "../connectors/test-support/market-fixtures.js";
import type { FamilyConfig } from "@hub/contracts";
import type { HttpClient } from "../connectors/http.js";
it("sends mom's gold/USD-only profile at 09:00, recovers transient bank errors, then deduplicates", async () => {
  let value = initialState();
  let revision = 0;
  const state: CloudStateStore = {
    async load() {
      return { state: structuredClone(value), sha: String(revision) };
    },
    async save(next: CloudState, sha?: string) {
      if (sha !== String(revision)) throw Error("conflict");
      value = structuredClone(next);
      return String(++revision);
    },
  };
  const config: FamilyConfig = {
    version: 1,
    profiles: [
      {
        id: "mom",
        name: "Mẹ",
        enabled: true,
        city: "hanoi",
        newsTopics: [],
        sendTime: "09:00",
        days: [1, 2, 3, 4, 5, 6, 7],
        weather: false,
        airQuality: false,
        fuel: false,
        github: false,
        gold: true,
        usd: true,
        topic: "secret_mom_topic",
      },
    ],
  };
  const messages: string[] = [];
  let bankCalls = 0;
  const http: HttpClient = async (url, options = {}) => {
    if (options.method === "POST") {
      const data = JSON.parse(options.body!);
      expect(data.topic).toBe("secret_mom_topic");
      messages.push(data.message);
      return { status: 200, headers: {}, body: "{}" };
    }
    if (url === goldSourceUrl)
      return { status: 200, headers: {}, body: goldHtml };
    if (url.startsWith(usdSourceUrl)) {
      if (++bankCalls === 1) throw Error("temporary network failure");
      return { status: 200, headers: {}, body: usdJson };
    }
    throw Error("Unexpected source");
  };
  await runCloudFamily(config, {
    state,
    http,
    now: () => new Date("2026-11-12T01:30:00Z"),
    sleep: async () => {},
  });
  expect(bankCalls).toBe(2); // monitoring may collect before the daily send time
  expect(messages).toHaveLength(0);
  await runCloudFamily(config, {
    state,
    http,
    now: () => marketAt,
    sleep: async () => {},
  });
  expect(messages).toHaveLength(1);
  expect(bankCalls).toBe(3);
  expect(messages[0]).toContain("Giá vàng SJC · đồng/chỉ");
  expect(messages[0]).toContain("Miếng SJC: mua 13.600.000");
  expect(messages[0]).toContain("Nhẫn SJC 9999");
  expect(messages[0]).toContain("Ngân hàng bán: 25.870");
  expect(Buffer.byteLength(messages[0]!)).toBeLessThanOrEqual(1600);
  await runCloudFamily(config, {
    state,
    http,
    now: () => marketAt,
    sleep: async () => {},
  });
  expect(messages).toHaveLength(1);
  expect(JSON.stringify(value)).not.toContain("secret_mom_topic");
  expect(JSON.stringify(value)).not.toContain("Mẹ");
});
