import { z } from "zod";
import type { Pool } from "pg";
import {
  safeHttp,
  checkUrl,
  resolveTarget,
  ensureOk,
  type HttpClient,
} from "../connectors/http.js";
import { plainText } from "../connectors/rss.js";
import { reserveAi } from "./ai.js";
import { fail } from "./store.js";
const candidateSchema = z
  .object({
    name: z.string().min(1).max(100),
    url: z.url().max(2000),
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
      const response = await http(url.toString(), {
        signal,
        timeoutMs: 15000,
        maxBytes: 256000,
        maxRedirects: 0,
        headers: { "X-Subscription-Token": key, Accept: "application/json" },
      });
      ensureOk(response);
      const data = JSON.parse(response.body);
      if (webBrief) {
        const rows = z
          .object({
            grounding: z.object({
              generic: z.array(
                z.object({
                  title: z.string(),
                  url: z.string(),
                  snippets: z.array(z.string()),
                }),
              ),
            }),
          })
          .parse(data).grounding.generic;
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
      if (!data.web || !Array.isArray(data.web.results))
        throw new Error("Invalid search response");
      return {
        candidates: data.web.results
          .slice(0, 5)
          .map((r: { title?: string; url?: string; description?: string }) => ({
            name: plainText(r.title ?? "", 100),
            url: r.url ?? "",
            evidence: plainText(r.description ?? "", 400),
          })),
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
  const config = await reserveAi(pool, runId, userId, "discover");
  try {
    const provider =
      adapter ??
      (config.searchProvider === "brave" && process.env.BRAVE_SEARCH_API_KEY
        ? braveSearch(process.env.BRAVE_SEARCH_API_KEY)
        : disabledSearch);
    const bounded = AbortSignal.any([
      signal,
      AbortSignal.timeout(config.timeoutMs),
    ]);
    const result = discoverySchema.parse(
      await provider.search(payload.description, bounded, payload.webBrief),
    );
    const safe: z.infer<typeof candidateSchema>[] = [];
    for (const candidate of result.candidates) {
      bounded.throwIfAborted();
      try {
        const url = checkUrl(candidate.url);
        url.hash = "";
        // Validation only, no candidate page is fetched. Approval and each later fetch recheck DNS.
        await Promise.race([
          resolveTarget(url),
          new Promise<never>((_resolve, reject) => {
            if (bounded.aborted) {
              reject(new Error("timeout"));
              return;
            }
            bounded.addEventListener(
              "abort",
              () => reject(new Error("timeout")),
              { once: true },
            );
          }),
        ]);
        if (!safe.some((item) => item.url === url.toString()))
          safe.push({ ...candidate, url: url.toString() });
      } catch {
        if (bounded.aborted) throw new Error("timeout");
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
  } catch {
    await pool.query(
      "UPDATE news_usage SET status='unknown',error_code='SEARCH_UNCERTAIN',completed_at=now() WHERE run_id=$1",
      [runId],
    );
    return fail(
      502,
      "SEARCH_UNCERTAIN",
      "Không nhận được kết quả tìm nguồn hợp lệ. Lượt tìm có thể đã tính phí; không tự gọi lại.",
    );
  }
}
