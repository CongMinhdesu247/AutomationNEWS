import { z } from "zod";
import type { Pool } from "pg";
import { safeHttpUrlSchema } from "@hub/contracts";
import {
  safeHttp,
  checkUrl,
  resolveTarget,
  ensureOk,
  ConnectorError,
  type HttpClient,
} from "../connectors/http.js";
import { plainText } from "../connectors/rss.js";
import { reserveAi, withTransientProviderRetry } from "./ai.js";
import { fail } from "./store.js";

const candidateSchema = z
  .object({
    name: z.string().min(1).max(100),
    url: safeHttpUrlSchema.max(2000),
    evidence: z.string().max(400),
  })
  .strict();

export const discoverySchema = z
  .object({ candidates: z.array(candidateSchema).max(5) })
  .strict();

export interface SearchAdapter {
  search(
    query: string,
    signal: AbortSignal,
    webBrief?: boolean,
  ): Promise<unknown>;
}

export const disabledSearch: SearchAdapter = {
  async search() {
    return fail(503, "SEARCH_DISABLED", "Tìm kiếm nguồn đang tắt.");
  },
};

export const fakeSearch: SearchAdapter = {
  async search(_query, _signal, webBrief) {
    if (webBrief)
      return {
        candidates: [
          {
            name: "[Mô phỏng] Tuyển thực tập web",
            url: "https://93.184.216.34/fixture/web",
            evidence: "Tin mẫu: thực tập phát triển web tại Hà Nội.",
          },
          {
            name: "[Mô phỏng] Tuyển thực tập kiểm thử",
            url: "https://93.184.216.34/fixture/qa",
            evidence: "Tin mẫu: thực tập kiểm thử phần mềm tại Hà Nội.",
          },
        ],
      };
    return {
      candidates: [
        {
          name: "Fixture public source",
          url: "https://93.184.216.34/feed",
          evidence: "RSS public fixture",
        },
      ],
    };
  },
};

export function braveSearch(
  key: string,
  http: HttpClient = safeHttp,
): SearchAdapter {
  return {
    async search(query, signal, webBrief) {
      const url = new URL(
        webBrief
          ? "https://api.search.brave.com/res/v1/llm/context"
          : "https://api.search.brave.com/res/v1/web/search",
      );
      url.searchParams.set("q", webBrief ? query : query + " RSS Atom feed");
      if (webBrief) url.searchParams.set("maximum_number_of_tokens", "2048");
      else {
        url.searchParams.set("count", "5");
        url.searchParams.set("result_filter", "web");
      }
      const response = await withTransientProviderRetry(
        async () => {
          const res = await http(url.toString(), {
            signal,
            timeoutMs: 15000,
            maxBytes: 256000,
            maxRedirects: 0,
            headers: {
              "X-Subscription-Token": key,
              Accept: "application/json",
            },
          });
          ensureOk(res);
          return res;
        },
        signal,
        1,
      );
      const data = JSON.parse(response.body);
      if (webBrief) {
        const rows =
          z
            .object({
              grounding: z
                .object({
                  generic: z
                    .array(
                      z.object({
                        title: z.string(),
                        url: z.string(),
                        snippets: z.array(z.string()).default([]),
                      }),
                    )
                    .default([]),
                })
                .optional(),
            })
            .parse(data).grounding?.generic ?? [];
        return {
          candidates: rows
            .flatMap((row) => {
              const name = plainText(row.title, 100);
              const evidence = plainText(row.snippets.join(" "), 400);
              return name && evidence && row.url.length <= 2000
                ? [{ name, url: row.url, evidence }]
                : [];
            })
            .slice(0, 5),
        };
      }
      if (data === null || typeof data !== "object")
        throw new Error("Invalid search response");
      const rawResults = Array.isArray(data.web?.results)
        ? data.web.results
        : data.web === undefined
          ? []
          : null;
      if (rawResults === null) throw new Error("Invalid search response");
      return {
        candidates: rawResults
          .flatMap(
            (r: { title?: string; url?: string; description?: string }) => {
              const name = plainText(r.title ?? "", 100);
              const urlStr = (r.url ?? "").trim();
              const evidence = plainText(r.description ?? "", 400);
              return name && urlStr && urlStr.length <= 2000
                ? [{ name, url: urlStr, evidence }]
                : [];
            },
          )
          .slice(0, 5),
      };
    },
  };
}

export async function runDiscovery(
  pool: Pool,
  runId: string,
  userId: string,
  payload: { description: string; cacheKey?: string; webBrief?: boolean },
  signal: AbortSignal,
  adapter?: SearchAdapter,
) {
  const cached =
    payload.cacheKey &&
    (
      await pool.query(
        "SELECT result FROM news_discovery_cache WHERE cache_key=$1 AND created_at>now()-interval '1 day'",
        [payload.cacheKey],
      )
    ).rows[0];
  if (cached) return discoverySchema.parse(cached.result);
  if (!adapter && !process.env.BRAVE_SEARCH_API_KEY) {
    fail(
      503,
      "SEARCH_DISABLED",
      "Tìm kiếm nguồn chưa được cấu hình khóa kết nối trên máy chủ.",
    );
  }
  const config = await reserveAi(pool, runId, userId, "discover");
  const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
  const bounded = AbortSignal.any([signal, timeoutSignal]);
  try {
    const provider =
      adapter ??
      (config.searchProvider === "brave" && process.env.BRAVE_SEARCH_API_KEY
        ? braveSearch(process.env.BRAVE_SEARCH_API_KEY)
        : disabledSearch);
    const result = discoverySchema.parse(
      await provider.search(payload.description, bounded, payload.webBrief),
    );
    const safe: z.infer<typeof candidateSchema>[] = [];
    for (const candidate of result.candidates) {
      bounded.throwIfAborted();
      let onAbort: (() => void) | undefined;
      try {
        const url = checkUrl(candidate.url);
        url.hash = "";
        // Validation only, no candidate page is fetched. Approval and each later fetch recheck DNS.
        await Promise.race([
          resolveTarget(url),
          new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(new Error("timeout"));
            if (bounded.aborted) {
              onAbort();
              return;
            }
            bounded.addEventListener("abort", onAbort, { once: true });
          }),
        ]);
        if (!safe.some((item) => item.url === url.toString()))
          safe.push({ ...candidate, url: url.toString() });
      } catch {
        if (bounded.aborted) throw new Error("timeout");
      } finally {
        if (onAbort) bounded.removeEventListener("abort", onAbort);
      }
    }
    const output = { candidates: safe };
    if (payload.cacheKey)
      await pool.query(
        "INSERT INTO news_discovery_cache(cache_key,result) VALUES($1,$2::jsonb) ON CONFLICT(cache_key) DO UPDATE SET result=EXCLUDED.result,created_at=now()",
        [payload.cacheKey, JSON.stringify(output)],
      );
    await pool.query(
      "UPDATE news_usage SET status='completed',input_tokens=0,output_tokens=0,search_units=1,estimated_micros=reserved_micros,completed_at=now() WHERE run_id=$1",
      [runId],
    );
    return output;
  } catch (error) {
    if (
      error instanceof ConnectorError &&
      /^HTTP_4(?:00|01|03|04|29)$/.test(error.code)
    ) {
      await pool.query(
        "UPDATE news_usage SET status='rejected',input_tokens=0,output_tokens=0,search_units=0,estimated_micros=0,error_code=$2,completed_at=now() WHERE run_id=$1",
        [runId, error.code],
      );
      return fail(
        error.code === "HTTP_429" ? 429 : 502,
        "SEARCH_PROVIDER_REJECTED",
        error.code === "HTTP_429"
          ? "Dịch vụ tìm kiếm đang bận tạm thời. Lượt tìm của bạn chưa bị trừ; hãy thử lại sau ít giây."
          : "Yêu cầu tìm kiếm chưa thể thực hiện lúc này. Lượt tìm của bạn chưa bị trừ.",
      );
    }
    const timedOut = timeoutSignal.aborted || signal.aborted;
    await pool.query(
      "UPDATE news_usage SET status='unknown',error_code=$2,completed_at=now() WHERE run_id=$1",
      [runId, timedOut ? "TIMEOUT" : "SEARCH_UNCERTAIN"],
    );
    return fail(
      502,
      "SEARCH_UNCERTAIN",
      timedOut
        ? "Quá thời gian chờ phản hồi từ dịch vụ tìm kiếm web. Hãy thử lại với từ khóa ngắn gọn hơn."
        : "Chưa nhận được kết quả tìm nguồn hợp lệ từ dịch vụ tìm kiếm.",
    );
  }
}
