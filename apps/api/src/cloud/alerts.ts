import {
  goldPricePerChi,
  type DigestSources,
  type FamilyProfile,
} from "@hub/contracts";
export type SignalBaseline = {
  at: string;
  notifiedAt?: string;
  attemptedAt?: string;
  values: Record<string, number>;
};
export function marketSignals(sources: DigestSources): Record<string, number> {
  const values: Record<string, number> = {};
  // Old-day prices must never trigger a fresh-price alert.
  const gold = sources.gold?.data;
  if (gold && !gold.previousDay)
    for (const item of gold.items) {
      values[item.code + "_buy"] = goldPricePerChi(item.buy, gold.unit);
      values[item.code + "_sell"] = goldPricePerChi(item.sell, gold.unit);
    }
  const usd = sources.usd?.data;
  if (usd && !usd.previousDay)
    for (const [key, value] of Object.entries({
      usd_cash: usd.buyCash,
      usd_transfer: usd.buyTransfer,
      usd_sell: usd.sell,
    }))
      if (value !== null) values[key] = value;
  const aqi = sources.airQuality?.data;
  if (aqi?.usAqi !== null && aqi?.usAqi !== undefined) values.aqi = aqi.usAqi;
  return values;
}
export function significantChanges(
  current: Record<string, number>,
  previous: SignalBaseline | undefined,
  rules: NonNullable<FamilyProfile["alerts"]>,
): string[] {
  if (!previous) return [];
  const labels: Record<string, string> = {
    sjc_bar_buy: "Miếng SJC mua",
    sjc_bar_sell: "Miếng SJC bán",
    sjc_ring_buy: "Nhẫn SJC mua",
    sjc_ring_sell: "Nhẫn SJC bán",
    usd_cash: "USD mua tiền mặt",
    usd_transfer: "USD mua chuyển khoản",
    usd_sell: "USD bán",
  };
  const lines: string[] = [];
  for (const [key, value] of Object.entries(current)) {
    const old = previous.values[key];
    if (old === undefined) continue;
    if (key === "aqi") {
      if (old < rules.aqiThreshold && value >= rules.aqiThreshold)
        lines.push(
          `AQI Mỹ: ${value} · vượt ngưỡng ${rules.aqiThreshold} (dự báo Open-Meteo/CAMS)`,
        );
    } else if (
      Math.abs(value - old) >=
      (key.startsWith("usd") ? rules.usdChange : rules.goldChange)
    ) {
      lines.push(
        `${labels[key]}: ${value.toLocaleString("vi-VN")} · ${value > old ? "tăng" : "giảm"} ${Math.abs(value - old).toLocaleString("vi-VN")} ${key.startsWith("usd") ? "đ/USD" : "đ/chỉ"}`,
      );
    }
  }
  return lines;
}
