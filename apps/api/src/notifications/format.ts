import type { Digest, Repository, RisingRepository, PriceLow30 } from "@hub/contracts";
import { goldPricePerChi, priceLow30Text, priceLow30Notice } from "@hub/contracts";

function clip(value: string, maxBytes: number) {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let text = "";
  for (const character of value) {
    if (Buffer.byteLength(text + character) > maxBytes - 3) break;
    text += character;
  }
  return text.trimEnd() + "…";
}
const oneLine = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export const repositorySummary = (repository: Repository) =>
  clip(
    oneLine(
      repository.summaryVi ||
        repository.description ||
        "Chưa có mô tả từ tác giả.",
    ),
    210,
  );

export function notificationTitle(digest: Digest) {
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: digest.settings.newsletter.timezone,
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(new Date(digest.createdAt));
  return (
    "Bản tin sáng · " +
    parts.find((part) => part.type === "day")!.value +
    "/" +
    parts.find((part) => part.type === "month")!.value
  );
}

/** Plain text for both local and cloud pushes; sections stay legible when expanded on iOS. */
export function formatDigestNotification(
  digest: Digest,
  compact = false,
  tight = false,
  full = false,
  footer = "",
): string {
  const sources = digest.sources;
  if (!sources) return "Bản tin đang được chuẩn bị. Vui lòng thử lại sau.";
  const blocks: string[] = [];
  const money = (value: number | null) =>
    value === null
      ? "chưa có"
      : value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  const asOf = (value: string) =>
    new Date(value).toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  const briefLow = (low?: PriceLow30) =>
    low?.minimum === null || !low
      ? "Đáy bán 30 ngày trước: chưa có lịch sử"
      : "Đáy bán 30 ngày trước: " + money(low.minimum) +
        (low.days < 30 ? `\nLịch sử: ${low.days}/30 ngày` : "") +
        (priceLow30Notice(low) ? "\n" + priceLow30Notice(low) : "");
  const goldHistoryNote = (lows: (PriceLow30 | undefined)[]) =>
    lows.some(low => low?.historySource === "giavang.pro")
      ? ["Đáy vàng: giá chốt phiên (giavang.pro)."] : [];
  if (sources.gold && sources.gold.status !== "disabled") {
    const data = sources.gold.data;
    blocks.push(
      data
        ? !full ? [
            "🟡 Vàng SJC · đ/chỉ",
            data.items.map(item => [
              item.code === "sjc_bar" ? "★ Vàng miếng SJC" : "★ Vàng nhẫn SJC 9999",
              "Mua: " + money(goldPricePerChi(item.buy, data.unit)),
              "Bán: " + money(goldPricePerChi(item.sell, data.unit)),
              briefLow(item.low30),
            ].join("\n")).join("\n\n"),
            "",
            ...goldHistoryNote(data.items.map(item => item.low30)),
            "Webgia · " + asOf(data.sourceUpdatedAt) + (data.previousDay ? " · GIÁ NGÀY TRƯỚC" : ""),
          ].join("\n") : [
            "🟡 Giá vàng SJC · đồng/chỉ",
            ...data.items.map(
              (item) =>
                (item.code === "sjc_bar" ? "Miếng SJC" : "Nhẫn SJC 9999") +
                ": mua " +
                money(goldPricePerChi(item.buy, data.unit)) +
                " · bán " +
                money(goldPricePerChi(item.sell, data.unit)) + "\n" + priceLow30Text(item.low30),
            ),
            "Webgia tổng hợp · TP.HCM · " +
              asOf(data.sourceUpdatedAt) +
              (data.previousDay ? " · Giá gần nhất (ngày trước)" : ""),
          ].join("\n")
        : ["🟡 Chưa lấy được giá vàng SJC hiện tại.",
            ...Object.entries(sources.gold.priceHistory ?? {}).map(([key, low]) =>
              full ? (key === "sjc_bar" ? "Miếng SJC: " : "Nhẫn SJC 9999: ") + priceLow30Text(low) :
              (key === "sjc_bar" ? "\n★ Vàng miếng SJC\n" : "\n★ Vàng nhẫn SJC 9999\n") + briefLow(low)),
            ...(!full ? goldHistoryNote(Object.values(sources.gold.priceHistory ?? {})) : []),
          ].join("\n"),
    );
  }
  if (sources.usd && sources.usd.status !== "disabled") {
    const data = sources.usd.data;
    blocks.push(
      data
        ? !full ? [
            "★ USD · Vietcombank · đ/USD",
            "Mua tiền mặt: " + money(data.buyCash),
            "Mua chuyển khoản: " + money(data.buyTransfer),
            "Bán: " + money(data.sell),
            briefLow(data.low30),
            asOf(data.sourceUpdatedAt) + (data.previousDay ? " · GIÁ NGÀY TRƯỚC" : ""),
          ].join("\n") : [
            "💵 USD/VND · Vietcombank · đồng/USD",
            "Ngân hàng mua: tiền mặt " +
              money(data.buyCash) +
              " · chuyển khoản " +
              money(data.buyTransfer),
            "Ngân hàng bán: " + money(data.sell) + "\n" + priceLow30Text(data.low30),
            "Nguồn công bố: " +
              asOf(data.sourceUpdatedAt) +
              (data.previousDay ? " · Giá gần nhất (ngày trước)" : ""),
          ].join("\n")
        : [full ? "💵 Chưa lấy được tỷ giá USD/VND Vietcombank hiện tại." : "★ USD · Vietcombank · đ/USD\nChưa lấy được giá hiện tại.",
            ...(sources.usd.priceHistory?.usd ? [full ? priceLow30Text(sources.usd.priceHistory.usd) : briefLow(sources.usd.priceHistory.usd)] : []),
          ].join("\n"),
    );
  }
  const weather = sources.weather.data;
  if (weather) {
    blocks.push(
      !full ? "🌤 " + clip(oneLine(weather.location), 65) + ": " +
        (weather.minTemperature ?? "?") + "–" + (weather.maxTemperature ?? "?") + " °C · " +
        clip(oneLine(weather.description), 60) + " · Mưa " + (weather.rainProbability ?? "?") + "%" +
        (weather.umbrella ? " · Mang ô" : "") :
      [
        "🌤 " +
          clip(oneLine(weather.location), 65) +
          ": " +
          (weather.minTemperature ?? "?") +
          "–" +
          (weather.maxTemperature ?? "?") +
          " °C",
        clip(oneLine(weather.description), 80),
        "☔ Khả năng mưa: " +
          (weather.rainProbability ?? "?") +
          "%" +
          (weather.umbrella ? " · Nên mang ô" : ""),
      ].join("\n"),
    );
  } else if (sources.weather.status !== "disabled")
    blocks.push("🌤 Thời tiết\nChưa lấy được dự báo hôm nay.");

  const air = sources.airQuality;
  if (air && air.status !== "disabled") {
    const data = air.data;
    blocks.push(
      data
        ? [
            "💨 " +
              clip(oneLine(data.location), 60) +
              " · AQI Mỹ: " +
              (data.usAqi ?? "?") +
              " · " +
              (data.category ?? "Chưa phân loại"),
            "PM2.5: " +
              (data.pm25?.toLocaleString("vi-VN", {
                maximumFractionDigits: 1,
              }) ?? "?") +
              " µg/m³ · " +
              new Date(data.forecastAt).toLocaleTimeString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
                hour: "2-digit",
                minute: "2-digit",
              }),
            "Dự báo Open-Meteo/CAMS · CC BY 4.0",
            ...(!weather ? ["https://open-meteo.com/"] : []),
          ].join("\n")
        : "💨 Chưa lấy được dự báo chất lượng không khí.",
    );
  }

  const fuel = sources.fuel;
  if (fuel && fuel.status !== "disabled") {
    const selected = fuel.data
      ? {
          ...fuel.data,
          items: fuel.data.items.filter((item) =>
            /^Xăng\s+E10\s+RON\s*95\s*-\s*III$/i.test(item.name.trim()),
          ),
        }
      : null;
    const data = selected?.items.length ? selected : null;
    const money = (value: number) => value.toLocaleString("vi-VN");
    blocks.push(
      data
        ? [
            "⛽ RON 95 · " + data.region,
            ...data.items.map(
              (item) =>
                item.name +
                ": " +
                money(item.price) +
                " đ/lít" +
                (item.change === null
                  ? ""
                  : item.change === 0
                    ? " · Không đổi"
                    : " · " +
                      (item.change > 0 ? "Tăng " : "Giảm ") +
                      money(Math.abs(item.change)) +
                      " đ"),
            ),
            ...(full
              ? [
                  "Hiệu lực: " +
                    new Date(data.effectiveAt).toLocaleString("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "2-digit",
                    }),
                  data.comparedAt
                    ? "So với bản tin " +
                      new Date(data.comparedAt).toLocaleDateString("vi-VN", {
                        timeZone: "Asia/Ho_Chi_Minh",
                      })
                    : "Lần đầu theo dõi; chưa có giá để so sánh.",
                ]
              : []),
            full ? "Nguồn: Petrolimex" : "Petrolimex · " + asOf(data.effectiveAt),
          ].join("\n")
        : "⛽ RON 95\nChưa lấy được giá đã xác minh từ Petrolimex.",
    );
  }

  if (sources.rss.status !== "disabled") {
    const items = sources.rss.data.items.slice(0, 3);
    const lines = ["📰 Tin tức · " + items.length + " tin"];
    for (const item of items) {
      const headline =
        "• " +
        clip(
          oneLine(item.title),
          full ? 1000 : compact ? (tight ? 60 : 75) : 105,
        );
      const link =
        full
          ? "\n" + item.url
          : "";
      lines.push(headline + link);
    }
    if (!items.length)
      lines.push(
        sources.rss.status === "failed"
          ? "Chưa lấy được tin tức."
          : "Chưa có tin mới trong 24 giờ.",
      );
    blocks.push(lines.join("\n\n"));
  }

  if (sources.github.status !== "disabled") {
    const repositories = [
      ...sources.github.data.rising,
      ...sources.github.data.newNotable,
    ]
      .filter(
        (repo, index, all) =>
          all.findIndex((value) => value.id === repo.id) === index,
      )
      .slice(0, 5);
    const lines = ["🚀 GitHub · " + repositories.length + " dự án nổi bật"];
    repositories.forEach((repo, index) => {
      const rising = repo as Partial<RisingRepository>;
      const growth = compact
        ? repo.stars.toLocaleString("vi-VN") + " ★"
        : typeof rising.starChange === "number" &&
            typeof rising.intervalHours === "number"
          ? (rising.starChange > 0 ? "+" : "") +
            rising.starChange +
            " sao / " +
            rising.intervalHours.toFixed(1) +
            "h"
          : repo.stars.toLocaleString("vi-VN") + " sao · Mới đáng chú ý";
      const url =
        full
          ? "\n" + repo.url
          : "";
      lines.push(
        index +
          1 +
          ". " +
          clip(oneLine(repo.name), compact ? 60 : 85) +
          " — " +
          (full
            ? oneLine(repo.summaryVi || repo.description || "Chưa có mô tả.")
            : clip(
                repositorySummary(repo),
                compact ? (tight ? 60 : 85) : 210,
              )) +
          "\n" +
          growth +
          url,
      );
    });
    if (!repositories.length)
      lines.push(
        sources.github.status === "failed"
          ? "Chưa lấy được dự án GitHub."
          : "Chưa có dự án phù hợp.",
      );
    if (!compact && !sources.github.data.rising.length && repositories.length)
      lines.push("Dự án mới đáng chú ý; chưa đủ lịch sử để tính tăng sao.");
    blocks.push(lines.join("\n\n"));
  }
  if (digest.status === "partial" || digest.status === "failed")
    blocks.push("ℹ️ Một số nguồn chưa có đủ dữ liệu.");
  if (weather)
    blocks.push("Thời tiết: Open-Meteo · CC BY 4.0\nhttps://open-meteo.com/");
  if (footer && !full) blocks.push(footer);
  const message = blocks.join("\n\n");
  if (full) return message;
  // ntfy includes content in both FCM data and the APNS custom payload. Leave
  // headroom for those copies and metadata rather than using the 4 KiB HTTP limit.
  if (Buffer.byteLength(message) > 1600 && !compact)
    return formatDigestNotification(digest, true, false, false, footer);
  if (Buffer.byteLength(message) > 1600 && !tight)
    return formatDigestNotification(digest, true, true, false, footer);
  // Never cut a report's encryption key in half. Prefer the complete ntfy
  // summary if an optional web link does not fit after compacting.
  if (Buffer.byteLength(message) > 1600 && footer)
    return formatDigestNotification(digest, true, true);
  return clip(message, 1600);
}
