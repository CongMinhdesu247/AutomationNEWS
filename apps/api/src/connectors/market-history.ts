import { goldPricePerChi, type DigestSources, type MarketDay, type PriceLow30 } from "@hub/contracts";
import { dateInZone } from "./weather.js";

const zone = "Asia/Ho_Chi_Minh";
// Calendar days in Vietnam, excluding the current day. Daily minima preserve
// intraday lows while bounding persisted public data to 31 small records.
export function pruneMarketHistory(history: MarketDay[], now: Date): MarketDay[] {
  const today = dateInZone(now, zone);
  const start = dateInZone(new Date(+now - 30 * 86400000), zone);
  return history.filter(row => row.day >= start && row.day <= today);
}
export function compareMarketHistory(sources: Pick<DigestSources, "gold" | "usd">, history: MarketDay[], now: Date) {
  const today = dateInZone(now, zone);
  const previous = pruneMarketHistory(history, now).filter(row => row.day < today);
  const compare = (key: string, value: number | null, fresh: boolean): PriceLow30 => {
    const days = new Map<string, number>();
    for (const row of previous) {
      const price = row.prices[key];
      if (price !== undefined && Number.isFinite(price) && price > 0)
        days.set(row.day, Math.min(days.get(row.day) ?? Infinity, price));
    }
    const minimum = days.size ? Math.min(...days.values()) : null;
    const intraday = history.filter(row => row.day === today).map(row => row.prices[key]).filter((price): price is number => price !== undefined);
    return { minimum, days: days.size, isLowest: fresh && days.size === 30 && minimum !== null && value !== null && value <= minimum && value <= Math.min(...intraday) };
  };
  const gold = sources.gold?.data;
  if (gold) for (const item of gold.items)
    item.low30 = compare(item.code, goldPricePerChi(item.sell, gold.unit), !gold.previousDay && dateInZone(new Date(gold.sourceUpdatedAt), zone) === today);
  const usd = sources.usd?.data;
  if (usd) usd.low30 = compare("usd", usd.sell, !usd.previousDay && dateInZone(new Date(usd.sourceUpdatedAt), zone) === today);
}
export function recordMarketHistory(history: MarketDay[], sources: Pick<DigestSources, "gold" | "usd">, now: Date): MarketDay[] {
  const rows = new Map<string, Record<string, number>>();
  for (const row of pruneMarketHistory(history, now)) {
    const prices = rows.get(row.day) ?? {};
    for (const [key, value] of Object.entries(row.prices))
      prices[key] = Math.min(prices[key] ?? Infinity, value);
    rows.set(row.day, prices);
  }
  const add = (at: string, key: string, value: number | null) => {
    if (value === null || !Number.isFinite(value) || value <= 0) return;
    const day = dateInZone(new Date(at), zone);
    const prices = rows.get(day) ?? {};
    prices[key] = Math.min(prices[key] ?? Infinity, value);
    rows.set(day, prices);
  };
  const gold = sources.gold?.data;
  if (gold && sources.gold?.status !== "failed") for (const item of gold.items) add(sources.gold!.fetchedAt, item.code, goldPricePerChi(item.sell, gold.unit));
  const usd = sources.usd?.data;
  if (usd && sources.usd?.status !== "failed") add(sources.usd!.fetchedAt, "usd", usd.sell);
  return pruneMarketHistory([...rows].map(([day, prices]) => ({ day, prices })).sort((a, b) => a.day.localeCompare(b.day)), now);
}
export function lowestMarketLabels(sources: Pick<DigestSources, "gold" | "usd">): string[] {
  return [
    ...(sources.gold?.data?.items.filter(item => item.low30?.isLowest).map(item => item.code === "sjc_bar" ? "Vàng miếng SJC" : "Nhẫn SJC 9999") ?? []),
    ...(sources.usd?.data?.low30?.isLowest ? ["USD/VND"] : []),
  ];
}
