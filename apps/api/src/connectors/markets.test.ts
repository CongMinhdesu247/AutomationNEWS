import { expect, it } from "vitest";
import {
  fetchGold,
  fetchUsd,
  parseGold,
  parseUsd,
  goldSourceUrl,
  usdSourceUrl,
} from "./markets.js";
import type { HttpClient } from "./http.js";
import { marketAt, goldHtml, usdJson } from "./test-support/market-fixtures.js";
const context = { now: () => marketAt, signal: AbortSignal.timeout(10000) };
it("keeps the explicitly declared dong/chi gold quotes and exact SJC product/region", () => {
  const result = parseGold(goldHtml, marketAt);
  expect(result.unit).toBe("VND/chỉ");
  expect(result.source).toContain("tổng hợp");
  expect(result.region).toContain("TP.HCM");
  expect(result.items.map((i) => [i.code, i.buy, i.sell])).toEqual([
    ["sjc_bar", 13600000, 13900000],
    ["sjc_ring", 13480000, 13880000],
  ]);
  expect(result.sourceUpdatedAt).toBe("2026-11-12T01:45:03.000Z");
  expect(result.previousDay).toBe(false);
});
it("does not guess a changed gold unit, decode hidden prices or substitute another ring weight", () => {
  expect(() =>
    parseGold(goldHtml.replace("đồng / chỉ", "ngàn đồng / lượng"), marketAt),
  ).toThrow();
  const hidden = goldHtml.replace(
    "<td>13.480.000</td><td>13.880.000</td>",
    '<td data-price="hidden">webgia.com</td><td>webgia.com</td>',
  );
  expect(parseGold(hidden, marketAt).items.map((i) => i.code)).toEqual([
    "sjc_bar",
  ]);
});
it("keeps USD cash buying, transfer buying and bank selling distinct with an explicit source timezone", () => {
  expect(parseUsd(usdJson, marketAt)).toMatchObject({
    buyCash: 25460,
    buyTransfer: 25490,
    sell: 25870,
    sourceUpdatedAt: "2026-11-12T01:45:59.000Z",
    unit: "VND/USD",
  });
  expect(
    parseUsd(usdJson.replace("08:45:59+07:00", "00:00:00+07:00"), marketAt)
      .sourceUpdatedAt,
  ).toBe("2026-11-11T17:00:00.000Z");
});
it("rejects impossible dates, stale/future quotes and crossed USD prices; preserves missing cash buy as null", () => {
  expect(() =>
    parseUsd(usdJson.replace("2026-11-12", "2026-02-30"), marketAt),
  ).toThrow();
  expect(() =>
    parseUsd(usdJson.replace("2026-11-12", "2026-11-13"), marketAt),
  ).toThrow();
  expect(() =>
    parseUsd(usdJson.replace("25870.00", "25000.00"), marketAt),
  ).toThrow();
  expect(() =>
    parseUsd(
      "<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///etc/passwd'>]>" + usdJson,
      marketAt,
    ),
  ).toThrow();
  expect(
    parseUsd(usdJson.replace('"cash":"25460.00"', '"cash":"-"'), marketAt)
      .buyCash,
  ).toBeNull();
  const old = parseGold(
    goldHtml.replaceAll("12/11/2026", "11/11/2026"),
    marketAt,
  );
  expect(old.previousDay).toBe(true);
  expect(() =>
    parseGold(goldHtml.replaceAll("12/11/2026", "01/11/2026"), marketAt),
  ).toThrow();
});
it("shares public source reads for five minutes, including simultaneous calls, without fabricating failed prices", async () => {
  let gets = 0;
  const http: HttpClient = async (url) => {
    gets++;
    return {
      status: 200,
      headers: {},
      body: url === goldSourceUrl ? goldHtml : usdJson,
    };
  };
  const [a, b] = await Promise.all([
    fetchUsd({ enabled: true }, { ...context, http }),
    fetchUsd({ enabled: true }, { ...context, http }),
  ]);
  expect(gets).toBe(1);
  expect(a.data).toEqual(b.data);
  await fetchUsd(
    { enabled: true },
    { ...context, http, now: () => new Date(+marketAt + 299000) },
  );
  expect(gets).toBe(1);
  await fetchUsd(
    { enabled: true },
    { ...context, http, now: () => new Date(+marketAt + 301000) },
  );
  expect(gets).toBe(2);
  const fail: HttpClient = async () => ({
    status: 403,
    headers: {},
    body: "private upstream details",
  });
  const result = await fetchGold({ enabled: true }, { ...context, http: fail });
  expect(result.data).toBeNull();
  expect(result.errors[0]?.code).toBe("HTTP_403");
  expect((await fetchUsd(undefined, { ...context, http: fail })).status).toBe(
    "disabled",
  );
});
