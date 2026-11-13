import type { MarketDay } from "@hub/contracts";
import { plainText } from "./rss.js";
import { parseUsd, usdSourceUrl } from "./markets.js";
import { dateInZone } from "./weather.js";
import { pruneMarketHistory, recordMarketHistory } from "./market-history.js";
import { safeHttp, ensureOk, type HttpClient } from "./http.js";

export const goldHistoryUrls = {
  sjc_bar: "https://giavang.pro/gia-vang/sjc/hcm/sjc-1l-10l-1kg?range=60d",
  sjc_ring: "https://giavang.pro/gia-vang/sjc/hcm/nhan-sjc-99-99-1-chi-2-chi-5-chi?range=60d",
};
type GoldCode = keyof typeof goldHistoryUrls;
const names = { sjc_bar: "Vàng SJC 1L, 10L, 1KG", sjc_ring: "Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ" };
export function historicalDays(now: Date) {
  return Array.from({ length: 30 }, (_, i) => dateInZone(new Date(+now - (i + 1) * 86400000), "Asia/Ho_Chi_Minh"));
}
export function parseGoldHistory(html: string, code: GoldCode, now: Date): MarketDay[] {
  const headingMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = headingMatch?.[1];
  if (!heading || plainText(heading) !== names[code] ||
      !/SJC\s*·\s*Hồ Chí Minh/.test(plainText(html.slice(headingMatch!.index, headingMatch!.index! + 500))) ||
      !/<option\b[^>]*value="luong"[^>]*selected[^>]*>đ\/lượng<\/option>/.test(html))
    throw Error("Historical gold product, region or unit could not be verified.");
  const section = html.slice(html.indexOf("Lịch sử theo phiên"));
  const table = section.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table || !/Ngày[\s\S]*Bán ra[\s\S]*Mua vào/.test(plainText(table)))
    throw Error("Historical gold table changed.");
  const wanted = new Set(historicalDays(now));
  const rows: MarketDay[] = [];
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1]!);
    if (cells.length !== 3) continue;
    const date = plainText(cells[0]!).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!date) continue;
    const day = `${date[3]}-${date[2]}-${date[1]}`;
    if (!wanted.has(day)) continue;
    // Use visible prices, not hidden attributes or change amounts in the cells.
    const amount = (cell: string) => {
      const text = plainText(cell).match(/^(\d{1,3}(?:\.\d{3})+)/)?.[1];
      return text ? Number(text.replaceAll(".", "")) : NaN;
    };
    const sell = amount(cells[1]!), buy = amount(cells[2]!);
    if (!Number.isSafeInteger(sell) || !Number.isSafeInteger(buy) || buy < 1000000 || sell > 2000000000 || buy > sell) continue;
    rows.push({ day, prices: { [code]: sell / 10 }, historical: { [code]: goldHistoryUrls[code] } });
  }
  return rows;
}
export function parseUsdHistory(body: string, day: string): MarketDay {
  const envelope = JSON.parse(body);
  if (typeof envelope.Date !== "string" || envelope.Date.slice(0, 10) !== day)
    throw Error("Bank did not return the requested historical date.");
  // Validate freshness relative to the requested historical day, never today.
  const quote = parseUsd(body, new Date(day + "T23:59:59+07:00"));
  if (quote.sell === null) throw Error("Missing historical USD sell price.");
  return { day, prices: { usd: quote.sell }, historical: { usd: usdSourceUrl + "?date=" + day } };
}
export async function backfillMarketHistory(history: MarketDay[], options: {
  gold?: boolean; usd?: boolean; now: Date; signal: AbortSignal; http?: HttpClient;
}): Promise<MarketDay[]> {
  let result = pruneMarketHistory(history, options.now);
  const days = historicalDays(options.now);
  const has = (day: string, key: string) => result.some(row => row.day === day && row.prices[key] !== undefined);
  const tasks: (() => Promise<MarketDay[]>)[] = [];
  const http = options.http ?? safeHttp;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(45000)]);
  const read = async (url: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await http(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), timeoutMs: 5000, maxBytes: 500000, maxRedirects: 1 });
        ensureOk(response);
        return response.body;
      } catch (error) {
        if (attempt >= 1 || signal.aborted) throw error;
      }
    }
  };
  if (options.gold) for (const code of ["sjc_bar", "sjc_ring"] as const)
    if (days.some(day => !has(day, code))) tasks.push(async () => parseGoldHistory(await read(goldHistoryUrls[code]), code, options.now));
  if (options.usd) for (const day of days)
    if (!has(day, "usd")) tasks.push(async () => [parseUsdHistory(await read(usdSourceUrl + "?date=" + day), day)]);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (next < tasks.length && !signal.aborted) {
      const task = tasks[next++]!;
      try {
        const rows = await task();
        // Historical data fills gaps only; existing observed lows remain intact.
        for (const row of rows) {
          const missing = Object.fromEntries(Object.entries(row.prices).filter(([key]) => !has(row.day, key)));
          if (Object.keys(missing).length) result.push({ ...row, prices: missing });
        }
      } catch {
        // A missing/failed day stays missing. Live prices must still be delivered.
      }
    }
  }));
  return recordMarketHistory(result, {}, options.now);
}
