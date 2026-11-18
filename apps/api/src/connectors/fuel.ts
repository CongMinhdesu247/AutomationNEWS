import { z } from "zod";
import type { FuelData, FuelBaseline, Settings, SourceResult } from "@hub/contracts";
import { safeHttp, ensureOk, cleanError, ConnectorError, type HttpClient, type HttpResponse } from "./http.js";
import { plainText } from "./rss.js";

export const petrolimexHome = "https://www.petrolimex.com.vn/";

// The same anonymous, public JSON request used by Petrolimex's retail-price widget.
export function fuelPriceUrl() {
  const filter = {
    FilterBy: {
      And: Object.entries({
        SystemID: "6783dc1271ff449e95b74a9520964169",
        RepositoryID: "a95451e23b474fe5886bfb7cf843f53c",
        RepositoryEntityID: "3801378fe1e045b1afa10de7c5776124",
        Status: "Published",
      }).map(([key, value]) => ({ [key]: { Equals: value } })),
    },
    SortBy: { LastModified: "Descending" },
    Pagination: { TotalRecords: -1, TotalPages: 0, PageSize: 0, PageNumber: 0 },
  };
  return (
    "https://portals.petrolimex.com.vn/~apis/portals/cms.item/search?x-request=" +
    Buffer.from(JSON.stringify(filter)).toString("base64url")
  );
}

const pricesSchema = z.object({
  Objects: z
    .array(
      z.object({
        ID: z.string().min(1).max(64),
        Title: z.string().min(1).max(100),
        Zone1Price: z.number().int().min(1000).max(100000),
        LastModified: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(30),
});

const reads = new WeakMap<
  HttpClient,
  Map<string, { at: number; pending: Promise<HttpResponse> }>
>();

async function cachedFuelRead(
  url: string,
  http: HttpClient,
  now: Date,
  signal: AbortSignal,
): Promise<string> {
  let cache = reads.get(http);
  if (!cache) {
    cache = new Map();
    reads.set(http, cache);
  }
  for (const [k, v] of cache) {
    if (+now - v.at >= 300000) cache.delete(k);
  }
  const old = cache.get(url);
  const shared =
    old && +now >= old.at && +now - old.at < 300000
      ? old.pending
      : (() => {
          if (cache.size >= 32) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          const pending = http(url, {
            signal: AbortSignal.timeout(8000),
            timeoutMs: 8000,
            maxBytes: 500000,
            maxRedirects: 0,
          }).then(
            (response) => {
              if (response.status < 200 || response.status >= 300) {
                cache!.delete(url);
              }
              return response;
            },
            (error) => {
              cache!.delete(url);
              throw error;
            },
          );
          cache.set(url, { at: +now, pending });
          return pending;
        })();
  const response = await Promise.race([
    shared,
    new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(new ConnectorError("TIMEOUT", "Nguồn vượt thời gian cho phép."));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(new ConnectorError("TIMEOUT", "Nguồn vượt thời gian cho phép.")),
        { once: true },
      );
    }),
  ]);
  ensureOk(response);
  return response.body;
}

function tryParseUrl(raw: string, base: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

export function priceAnnouncement(html: string) {
  const homeOrigin = new URL(petrolimexHome).origin;
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => tryParseUrl(match[1]!, petrolimexHome))
    .filter(
      (url): url is URL =>
        url !== null &&
        url.origin === homeOrigin &&
        /^\/ndi\/thong-cao-bao-chi\/petrolimex-(?:dieu-chinh-gia-xang-dau|thong-bao-gia-ban-le-xang)[\w.-]*\.html$/.test(
          url.pathname,
        ),
    );
  if (!links.length)
    throw new ConnectorError(
      "FUEL_LAYOUT_CHANGED",
      "Chưa xác định được thông cáo giá xăng của Petrolimex.",
    );
  return links[0]!.toString();
}

export function effectivePriceTime(html: string): string {
  const text = plainText(html, 100000);
  const match = text.match(
    /Mức giá mới có hiệu lực từ thời điểm (\d{1,2})\s*giờ(?:\s*(\d{1,2})\s*(?:phút)?)?\s*ngày (\d{1,2}) tháng (\d{1,2}) năm (\d{4})/i,
  );
  if (!match)
    throw new ConnectorError(
      "FUEL_MISSING_DATE",
      "Chưa đọc được thời điểm giá xăng có hiệu lực.",
    );
  const [, hour, rawMinute, day, month, year] = match;
  const minute = rawMinute ?? "00";
  const local = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}T${hour!.padStart(2, "0")}:${minute.padStart(2, "0")}:00+07:00`;
  const date = new Date(local);
  if (!Number.isFinite(+date))
    throw new ConnectorError(
      "FUEL_MISSING_DATE",
      "Thời điểm giá xăng không hợp lệ.",
    );
  return date.toISOString();
}

export async function fetchFuel(
  config: Settings["fuel"],
  {
    http = safeHttp,
    now = () => new Date(),
    signal,
    baseline,
  }: {
    http?: HttpClient;
    now?: () => Date;
    signal: AbortSignal;
    baseline?: FuelBaseline;
  },
): Promise<SourceResult<FuelData | null>> {
  const currentNow = now();
  const fetchedAt = currentNow.toISOString();
  if (!config?.enabled)
    return { status: "disabled", fetchedAt, data: null, errors: [] };
  try {
    const get = (url: string) => cachedFuelRead(url, http, currentNow, signal);
    const [json, home] = await Promise.all([
      get(fuelPriceUrl()),
      get(petrolimexHome),
    ]);
    const sourceUrl = priceAnnouncement(home);
    const effectiveAt = effectivePriceTime(await get(sourceUrl));
    const rows = pricesSchema
      .parse(JSON.parse(json))
      .Objects.filter((row) =>
        /^Xăng\s+E10\s+RON\s*95\s*-\s*III$/i.test(plainText(row.Title, 100)),
      );
    if (!rows.length)
      throw new ConnectorError(
        "FUEL_MISSING_PRODUCT",
        "Nguồn chưa có giá Xăng E10 RON 95-III.",
      );
    if (+new Date(effectiveAt) > +currentNow)
      throw new ConnectorError(
        "FUEL_NOT_EFFECTIVE",
        "Bảng giá mới chưa có hiệu lực; chưa hiển thị để tránh nhầm giá.",
      );
    // Reject a mismatched/old widget instead of attaching the newest announcement's date to old prices.
    if (
      rows.some(
        (row) =>
          Math.abs(Date.parse(row.LastModified) - Date.parse(effectiveAt)) >
            24 * 3600000 || Date.parse(row.LastModified) > +currentNow,
      )
    )
      throw new ConnectorError(
        "FUEL_DATE_MISMATCH",
        "Bảng giá và thông cáo chưa đồng bộ; vui lòng đối chiếu Petrolimex.",
      );
    const previous =
      baseline &&
      Date.parse(baseline.at) < +currentNow &&
      +currentNow - Date.parse(baseline.at) <= 14 * 86400000
        ? baseline
        : undefined;
    return {
      status: "success",
      fetchedAt,
      errors: [],
      data: {
        region: "Petrolimex vùng 1",
        sourceUrl,
        effectiveAt,
        updatedAt: rows
          .map((row) => row.LastModified)
          .sort()
          .at(-1)!,
        comparedAt: previous?.at ?? null,
        items: rows
          .sort((a, b) => a.Title.localeCompare(b.Title))
          .map((row) => ({
            code: row.ID,
            name: plainText(row.Title, 100),
            price: row.Zone1Price,
            change:
              previous?.prices[row.ID] === undefined
                ? null
                : row.Zone1Price - previous.prices[row.ID]!,
          })),
      },
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

export function fuelBaseline(
  result: SourceResult<FuelData | null>,
): FuelBaseline | undefined {
  return result.data && result.status === "success"
    ? {
        at: result.fetchedAt,
        prices: Object.fromEntries(
          result.data.items.map((item) => [item.code, item.price]),
        ),
      }
    : undefined;
}
