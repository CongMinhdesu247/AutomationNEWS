import type { Digest, Repository, RisingRepository } from "@hub/contracts";

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
export function formatDigestNotification(digest: Digest) {
  const sources = digest.sources;
  if (!sources) return "Bản tin đang được chuẩn bị. Vui lòng thử lại sau.";
  const blocks: string[] = [];
  const weather = sources.weather.data;
  if (weather) {
    blocks.push(
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

  const fuel = sources.fuel;
  if (fuel && fuel.status !== "disabled") {
    const data = fuel.data;
    const money = (value: number) => value.toLocaleString("vi-VN");
    blocks.push(data ? [
      "⛽ RON 95 · " + data.region,
      ...data.items.map((item) => item.name + ": " + money(item.price) + " đ/lít" +
        (item.change === null ? "" : item.change === 0 ? " · Không đổi" : " · " + (item.change > 0 ? "Tăng " : "Giảm ") + money(Math.abs(item.change)) + " đ")),
      "Hiệu lực: " + new Date(data.effectiveAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
      data.comparedAt ? "So với bản tin " + new Date(data.comparedAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Lần đầu theo dõi; chưa có giá để so sánh.",
      "Nguồn: Petrolimex",
    ].join("\n") : "⛽ RON 95\nChưa lấy được giá đã xác minh từ Petrolimex.");
  }

  if (sources.rss.status !== "disabled") {
    const items = sources.rss.data.items;
    const lines = ["📰 Tin tức · " + items.length + " tin"];
    for (const item of items.slice(0, 5)) {
      const headline = "• " + clip(oneLine(item.title), 105);
      const link = Buffer.byteLength(item.url) <= 150 ? "\n" + item.url : "";
      if (Buffer.byteLength([...lines, headline + link].join("\n\n")) > 760)
        break;
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
      const growth =
        typeof rising.starChange === "number" &&
        typeof rising.intervalHours === "number"
          ? (rising.starChange > 0 ? "+" : "") +
            rising.starChange +
            " sao / " +
            rising.intervalHours.toFixed(1) +
            "h"
          : repo.stars.toLocaleString("vi-VN") + " sao · Mới đáng chú ý";
      const url = Buffer.byteLength(repo.url) <= 160 ? "\n" + repo.url : "";
      lines.push(
        index +
          1 +
          ". " +
          clip(oneLine(repo.name), 85) +
          " — " +
          repositorySummary(repo) +
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
    if (!sources.github.data.rising.length && repositories.length)
      lines.push("Dự án mới đáng chú ý; chưa đủ lịch sử để tính tăng sao.");
    blocks.push(lines.join("\n\n"));
  }
  if (digest.status === "partial" || digest.status === "failed")
    blocks.push("ℹ️ Một số nguồn chưa có đủ dữ liệu.");
  if (weather)
    blocks.push("Thời tiết: Open-Meteo · CC BY 4.0\nhttps://open-meteo.com/");
  return clip(blocks.join("\n\n"), 3900);
}
