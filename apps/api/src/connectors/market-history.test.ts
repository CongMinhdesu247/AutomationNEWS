import { expect, it } from "vitest";
import type { MarketDay, DigestSources } from "@hub/contracts";
import { priceLow30Text } from "@hub/contracts";
import { parseGold, parseUsd } from "./markets.js";
import { compareMarketHistory, recordMarketHistory } from "./market-history.js";
import { marketAt, goldHtml, usdJson } from "./test-support/market-fixtures.js";
import { dateInZone } from "./weather.js";

export const history30 = (): MarketDay[] => Array.from({ length: 30 }, (_, i) => ({
  day: dateInZone(new Date(+marketAt - (i + 1) * 86400000), "Asia/Ho_Chi_Minh"),
  prices: { sjc_bar: 14000000 + i, sjc_ring: 13900000 + i, usd: 25900 + i },
}));
const sources = () => ({
  gold: { status: "success" as const, fetchedAt: marketAt.toISOString(), errors: [], data: parseGold(goldHtml, marketAt) },
  usd: { status: "success" as const, fetchedAt: marketAt.toISOString(), errors: [], data: parseUsd(usdJson, marketAt) },
});
it("compares each sell price against the previous 30 VN days, excluding today, future and expired lows", () => {
  const data = sources();
  const history = [...history30(),
    { day: "2026-11-12", prices: { usd: 25870 } },
    { day: "2026-11-13", prices: { usd: 1000 } },
    { day: "2026-10-12", prices: { usd: 1000 } },
  ];
  data.gold.data.items[1]!.sell = 15000000;
  compareMarketHistory(data, history, marketAt);
  expect(data.usd.data.low30).toEqual({ minimum: 25900, days: 30, isLowest: true });
  expect(data.gold.data.items[0]!.low30?.isLowest).toBe(true);
  expect(data.gold.data.items[1]!.low30?.isLowest).toBe(false);
  data.usd.data.sell = 25900;
  compareMarketHistory(data, history.filter(row => row.day !== "2026-11-12"), marketAt);
  expect(data.usd.data.low30?.isLowest).toBe(true);
});
it("shows partial history without claiming a 30-day low, and never alerts for old quotes", () => {
  const data = sources();
  compareMarketHistory(data, history30().slice(0, 29), marketAt);
  expect(data.usd.data.low30?.isLowest).toBe(false);
  expect(priceLow30Text(data.usd.data.low30)).toContain("29/30");
  data.usd.data.previousDay = true;
  compareMarketHistory(data, history30(), marketAt);
  expect(data.usd.data.low30?.isLowest).toBe(false);
  compareMarketHistory(data, [], marketAt);
  expect(priceLow30Text(data.usd.data.low30)).toContain("chưa có lịch sử");
});
it("does not announce a new low when a quote rebounds above an earlier intraday low", () => {
  const data = sources();
  compareMarketHistory(data, [...history30(), { day: "2026-11-12", prices: { usd: 25800 } }], marketAt);
  expect(data.usd.data.low30).toEqual({ minimum: 25900, days: 30, isLowest: false });
});
it("keeps historical comparisons available without alerting when live sources fail", () => {
  const failed = { status: "failed" as const, fetchedAt: marketAt.toISOString(), data: null, errors: [] };
  const data: Pick<DigestSources, "gold" | "usd"> = { gold: { ...failed }, usd: { ...failed } };
  compareMarketHistory(data, history30(), marketAt);
  expect(data.gold?.priceHistory?.sjc_bar).toEqual({ minimum: 14000000, days: 30, isLowest: false });
  expect(data.usd?.priceHistory?.usd).toEqual({ minimum: 25900, days: 30, isLowest: false });
});
it("keeps intraday minima, counts duplicate days once, normalizes legacy units and preserves independent products", () => {
  const data = sources();
  data.gold.data.unit = "VND/lượng";
  for (const item of data.gold.data.items) { item.buy *= 10; item.sell *= 10; }
  let history = recordMarketHistory(history30(), data, marketAt);
  data.usd.data.sell = 26000;
  history = recordMarketHistory(history, data, marketAt);
  expect(history).toHaveLength(31);
  expect(history.at(-1)?.prices).toEqual({ sjc_bar: 13900000, sjc_ring: 13880000, usd: 25870 });
  const next = new Date(+marketAt + 86400000);
  compareMarketHistory(data, history.concat(history), next);
  expect(data.usd.data.low30?.days).toBe(30);
  expect(data.usd.data.low30?.minimum).toBe(25870);
});
