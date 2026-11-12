import { z } from "zod";
import type { GoldData, UsdData, Settings, SourceResult } from "@hub/contracts";
import {
  safeHttp,
  ensureOk,
  cleanError,
  ConnectorError,
  type HttpClient,
} from "./http.js";
import { plainText } from "./rss.js";
import { dateInZone } from "./weather.js";

export const goldSourceUrl = "https://webgia.com/gia-vang/sjc/";
export const usdSourceUrl = "https://www.vietcombank.com.vn/api/exchangerates";
type Context = { http?: HttpClient; now?: () => Date; signal: AbortSignal };
// Cache successful public reads for five minutes and share in-flight requests.
// Evict transport/5xx failures so the engine's bounded retry can recover.
const reads = new WeakMap<
  HttpClient,
  Map<string, { at: number; pending: ReturnType<HttpClient> }>
>();
async function marketRead(
  url: string,
  http: HttpClient,
  now: Date,
  signal: AbortSignal,
) {
  let cache = reads.get(http);
  if (!cache) {
    cache = new Map();
    reads.set(http, cache);
  }
  const old = cache.get(url);
  if (old && +now >= old.at && +now - old.at < 300000) return old.pending;
  const pending = http(url, { signal, maxBytes: 500000, maxRedirects: 1 }).then(
    (response) => {
      if (response.status >= 500) cache!.delete(url);
      return response;
    },
    (error) => {
      cache!.delete(url);
      throw error;
    },
  );
  cache.set(url, { at: +now, pending });
  return pending;
}
function localTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string {
  const local = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  const date = new Date(local + "+07:00");
  if (
    !Number.isFinite(+date) ||
    new Date(+date + 7 * 3600000).toISOString().slice(0, 19) !== local
  )
    throw new ConnectorError(
      "MARKET_INVALID_DATE",
      "Nguồn trả thời gian không hợp lệ.",
    );
  return date.toISOString();
}
function freshness(updated: string, now: Date) {
  const age = +now - Date.parse(updated);
  if (age < -10 * 60000 || age > 7 * 86400000)
    throw new ConnectorError(
      "MARKET_STALE",
      "Nguồn giá quá cũ hoặc có thời gian ở tương lai; chưa hiển thị giá.",
    );
  return (
    dateInZone(new Date(updated), "Asia/Ho_Chi_Minh") !==
    dateInZone(now, "Asia/Ho_Chi_Minh")
  );
}
export function parseGold(html: string, now: Date): GoldData {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const timestamp = plainText(heading).match(
    /Cập nhật lúc\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/i,
  );
  if (!timestamp)
    throw new ConnectorError(
      "GOLD_LAYOUT_CHANGED",
      "Chưa đọc được thời điểm cập nhật của bảng vàng SJC.",
    );
  const [, h, m, s, d, mo, y] = timestamp;
  const sourceUpdatedAt = localTimestamp(+y!, +mo!, +d!, +h!, +m!, +s!);
  const previousDay = freshness(sourceUpdatedAt, now);
  // Read only the visible, documented HCM rows. Never decode obfuscated cells or
  // silently substitute another region, brand, weight, or jewellery purity.
  const scope = html.slice(html.indexOf(heading));
  if (
    !/<div\b[^>]*class=["'][^"']*donvi[^"']*["'][^>]*>\s*Đơn vị:\s*đồng\s*\/\s*chỉ\s*<\/div>/i.test(
      scope,
    )
  )
    throw new ConnectorError(
      "GOLD_UNIT_CHANGED",
      "Đơn vị giá vàng nguồn đã thay đổi; chưa tự chuyển đổi.",
    );
  const table = [...scope.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find(
    (m) => m[1]!.includes("Loại vàng"),
  )?.[1];
  if (!table)
    throw new ConnectorError(
      "GOLD_LAYOUT_CHANGED",
      "Chưa đọc được bảng vàng SJC.",
    );
  let region = "";
  const items: GoldData["items"] = [];
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const head = row[1]!.match(
      /<th\b[^>]*rowspan=["']\d+["'][^>]*>([\s\S]*?)<\/th>/i,
    );
    if (head) region = plainText(head[1]!);
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => plainText(m[1]!, 150),
    );
    if (region !== "Hồ Chí Minh" || cells.length !== 3) continue;
    const code =
      cells[0] === "Vàng SJC 1L, 10L, 1KG"
        ? "sjc_bar"
        : cells[0] === "Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ"
          ? "sjc_ring"
          : null;
    if (!code || items.some((item) => item.code === code)) continue;
    if (!cells.slice(1).every((v) => /^\d{1,3}(?:\.\d{3})+$/.test(v))) continue;
    const buy = Number(cells[1]!.replaceAll(".", "")),
      sell = Number(cells[2]!.replaceAll(".", ""));
    if (
      !Number.isSafeInteger(buy) ||
      !Number.isSafeInteger(sell) ||
      buy < 100000 ||
      sell > 200000000 ||
      buy > sell
    )
      continue;
    items.push({
      code,
      name:
        code === "sjc_bar"
          ? "Vàng miếng SJC"
          : "Nhẫn SJC 9999 (1, 2, 5 chỉ)",
      buy,
      sell,
    });
  }
  if (!items.length)
    throw new ConnectorError(
      "GOLD_MISSING_PRODUCTS",
      "Chưa lấy được giá vàng miếng SJC và nhẫn SJC 9999.",
    );
  return {
    source: "Webgia (tổng hợp giá SJC)",
    sourceUrl: goldSourceUrl,
    sourceUpdatedAt,
    previousDay,
    region: "Bảng SJC tại TP.HCM",
    unit: "VND/chỉ",
    items,
  };
}
export function usdRequestUrl(now: Date) {
  return usdSourceUrl + "?date=" + dateInZone(now, "Asia/Ho_Chi_Minh");
}
export function parseUsd(body: string, now: Date): UsdData {
  // Public JSON endpoint used by Vietcombank's official exchange-rate page.
  const result = z
    .object({
      UpdatedDate: z.iso.datetime({ offset: true }),
      Data: z
        .array(
          z.object({
            currencyCode: z.string(),
            cash: z.string().nullable().optional(),
            transfer: z.string().nullable().optional(),
            sell: z.string().nullable().optional(),
          }),
        )
        .max(100),
    })
    .parse(JSON.parse(body));
  const sourceUpdatedAt = new Date(result.UpdatedDate).toISOString();
  const previousDay = freshness(sourceUpdatedAt, now);
  const usd = result.Data.find((row) => row.currencyCode === "USD");
  if (!usd)
    throw new ConnectorError("USD_MISSING", "Nguồn chưa có tỷ giá USD.");
  const amount = (value: string | null | undefined) => {
    if (
      value === undefined ||
      value === null ||
      value === "-" ||
      value === "" ||
      /^0(?:\.0+)?$/.test(value)
    )
      return null;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value))
      throw new ConnectorError(
        "USD_INVALID_RATE",
        "Nguồn tỷ giá có định dạng không hợp lệ.",
      );
    const number = Number(value.replaceAll(",", ""));
    if (number < 1000 || number > 1000000)
      throw new ConnectorError(
        "USD_INVALID_RATE",
        "Nguồn tỷ giá ngoài giới hạn hợp lệ.",
      );
    return number;
  };
  const buyCash = amount(usd.cash),
    buyTransfer = amount(usd.transfer),
    sell = amount(usd.sell);
  if (
    sell === null ||
    [buyCash, buyTransfer].some((value) => value !== null && value > sell)
  )
    throw new ConnectorError(
      "USD_INVALID_RATE",
      "Chưa xác minh được giá mua/bán USD.",
    );
  return {
    source: "Vietcombank",
    sourceUrl: usdRequestUrl(now),
    sourceUpdatedAt,
    previousDay,
    unit: "VND/USD",
    buyCash,
    buyTransfer,
    sell,
  };
}
export async function fetchGold(
  config: Settings["gold"],
  { http = safeHttp, now = () => new Date(), signal }: Context,
): Promise<SourceResult<GoldData | null>> {
  const fetchedAt = now().toISOString();
  if (!config?.enabled)
    return { status: "disabled", fetchedAt, data: null, errors: [] };
  try {
    const response = await marketRead(goldSourceUrl, http, now(), signal);
    ensureOk(response);
    const data = parseGold(response.body, now());
    const partial = data.previousDay || data.items.length !== 2;
    return {
      status: partial ? "partial" : "success",
      fetchedAt,
      data,
      errors: partial
        ? [
            {
              code: "GOLD_PARTIAL",
              message: data.previousDay
                ? "Nguồn đang công bố giá của ngày trước; xem ngày cập nhật."
                : "Nguồn thiếu một loại vàng đã chọn.",
            },
          ]
        : [],
    };
  } catch (error) {
    return {
      status: "failed",
      fetchedAt,
      data: null,
      errors: [cleanError(error)],
    };
  }
}
export async function fetchUsd(
  config: Settings["usd"],
  { http = safeHttp, now = () => new Date(), signal }: Context,
): Promise<SourceResult<UsdData | null>> {
  const fetchedAt = now().toISOString();
  if (!config?.enabled)
    return { status: "disabled", fetchedAt, data: null, errors: [] };
  try {
    const response = await marketRead(
      usdRequestUrl(now()),
      http,
      now(),
      signal,
    );
    ensureOk(response);
    const data = parseUsd(response.body, now());
    const partial =
      data.previousDay || data.buyCash === null || data.buyTransfer === null;
    return {
      status: partial ? "partial" : "success",
      fetchedAt,
      data,
      errors: partial
        ? [
            {
              code: "USD_PARTIAL",
              message: data.previousDay
                ? "Nguồn đang công bố tỷ giá ngày trước; xem ngày cập nhật."
                : "Nguồn thiếu một chiều mua USD.",
            },
          ]
        : [],
    };
  } catch (error) {
    return {
      status: "failed",
      fetchedAt,
      data: null,
      errors: [cleanError(error)],
    };
  }
}
