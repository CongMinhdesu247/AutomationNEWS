import { expect, it } from "vitest";
import { backfillMarketHistory, goldHistoryUrls, historicalDays, parseGoldHistory, parseUsdHistory } from "./market-backfill.js";
import { marketAt, usdJson } from "./test-support/market-fixtures.js";
import type { HttpClient } from "./http.js";
const goldHtml = (code: "sjc_bar" | "sjc_ring") => `<title>Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ</title><h1>${code === "sjc_bar" ? "Vàng SJC 1L, 10L, 1KG" : "Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ"}</h1><p>SJC · Hồ Chí Minh</p><select><option value="luong" selected>đ/lượng</option></select><h2>Lịch sử theo phiên</h2><table><tr><th>Ngày</th><th>Bán ra</th><th>Mua vào</th></tr><tr><th>11/11/2026</th><td><span>139.000.000</span><span>▼ −1.000.000</span></td><td>136.000.000</td></tr><tr><th>12/11/2026</th><td>500</td><td>136.000.000</td></tr><tr><th>12/11/2026</th><td>13.900.000</td><td>136.000.000</td></tr><tr><th>12/11/2026</th><td>138.000.000</td><td>135.000.000</td></tr></table>`;
it("reads only visible sell prices for the exact gold product, region, date and unit, and records provenance", () => {
  const rows = parseGoldHistory(goldHtml("sjc_ring"), "sjc_ring", marketAt);
  expect(rows).toHaveLength(1); // today's rows are excluded, invalid prior-day prices are rejected
  expect(rows[0]).toEqual({ day: "2026-11-11", prices: { sjc_ring: 13900000 }, historical: { sjc_ring: goldHistoryUrls.sjc_ring } });
  expect(() => parseGoldHistory(goldHtml("sjc_ring"), "sjc_bar", marketAt)).toThrow();
  expect(() => parseGoldHistory(goldHtml("sjc_ring").replace("Hồ Chí Minh", "Miền Bắc"), "sjc_ring", marketAt)).toThrow();
  expect(() => parseGoldHistory(goldHtml("sjc_ring").replace("đ/lượng", "đ/chỉ"), "sjc_ring", marketAt)).toThrow();
});
it("validates the bank's requested date and old timestamp relative to that day, not today", () => {
  const body = JSON.stringify({ ...JSON.parse(usdJson), Date: "2026-11-11T00:00:00", UpdatedDate: "2026-11-11T23:00:00+07:00" });
  expect(parseUsdHistory(body, "2026-11-11").prices.usd).toBe(25870);
  expect(() => parseUsdHistory(body, "2026-11-10")).toThrow();
  expect(() => parseUsdHistory(body.replace("2026-11-11T23", "2026-11-12T23"), "2026-11-11")).toThrow();
});
it("backfills missing days only, bounds concurrency, retries transport errors and preserves unavailable dates", async () => {
  let active = 0, peak = 0, retry = 0;
  const urls: string[] = [];
  const http: HttpClient = async url => {
    urls.push(url); active++; peak = Math.max(peak, active);
    await Promise.resolve(); active--;
    if (url.includes("giavang.pro")) return { status: 200, headers: {}, body: goldHtml(url === goldHistoryUrls.sjc_bar ? "sjc_bar" : "sjc_ring") };
    const day = new URL(url).searchParams.get("date")!;
    if (day === "2026-11-10" && retry++ === 0) throw Error("temporary connection");
    const body = { ...JSON.parse(usdJson), Date: day + "T00:00:00", UpdatedDate: day + "T23:00:00+07:00" };
    if (day === "2026-11-09") body.Date = "2026-11-12T00:00:00";
    return { status: 200, headers: {}, body: JSON.stringify(body) };
  };
  const rows = await backfillMarketHistory([{ day: "2026-11-11", prices: { usd: 25000 } }], { gold: true, usd: true, now: marketAt, signal: AbortSignal.timeout(10000), http });
  expect(peak).toBeLessThanOrEqual(4);
  expect(retry).toBe(2);
  expect(urls.some(url => url.endsWith("date=2026-11-11"))).toBe(false);
  expect(rows.find(row => row.day === "2026-11-11")?.prices.usd).toBe(25000);
  expect(rows.find(row => row.day === "2026-11-09")?.prices.usd).toBeUndefined();
  expect(rows.filter(row => row.prices.usd !== undefined)).toHaveLength(29);
  expect(rows.find(row => row.day === "2026-11-11")?.historical?.sjc_bar).toBe(goldHistoryUrls.sjc_bar);
  const calls = urls.length;
  await backfillMarketHistory(historicalDays(marketAt).map(day => ({ day, prices: { usd: 25000, sjc_bar: 13000000, sjc_ring: 13000000 } })), { gold: true, usd: true, now: marketAt, signal: AbortSignal.timeout(1000), http });
  expect(urls).toHaveLength(calls);
});
