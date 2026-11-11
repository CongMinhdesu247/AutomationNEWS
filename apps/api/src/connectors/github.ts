import { z } from "zod";
import type {
  Settings,
  Repository,
  SourceResult,
  GithubData,
  RisingRepository,
} from "@hub/contracts";
import {
  safeHttp,
  ensureOk,
  cleanError,
  ConnectorError,
  type HttpClient,
  type HttpResponse,
} from "./http.js";
export type Baseline = { stars: number; fetchedAt: string };
export type BaselineLoader = (
  ids: number[],
  at: Date,
) => Promise<Map<number, Baseline>>;
const repositorySchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  full_name: z.string().max(300),
  description: z.string().nullable(),
  language: z.string().nullable(),
  html_url: z.url(),
  stargazers_count: z.number().int().nonnegative(),
  created_at: z.iso.datetime(),
  archived: z.boolean(),
  fork: z.boolean(),
});
const responseSchema = z.object({
  items: z.array(repositorySchema).max(100),
  incomplete_results: z.boolean().optional(),
});
export const emptyGithub = (): GithubData => ({
  rising: [],
  newNotable: [],
  candidates: 0,
  withoutBaseline: 0,
  comparisonWindowHours: [20, 28],
  rateLimits: [],
});
export function rankRepositories(
  repos: Repository[],
  baselines: Map<number, Baseline>,
  count: number,
  at: Date,
) {
  const rising: RisingRepository[] = [];
  let withoutBaseline = 0;
  const eligible = new Set<number>();
  for (const repo of repos) {
    const baseline = baselines.get(repo.id);
    const hours = baseline
      ? (Date.parse(repo.fetchedAt) - Date.parse(baseline.fetchedAt)) / 3600000
      : 0;
    if (baseline && hours >= 20 && hours <= 28) {
      rising.push({
        ...repo,
        starChange: repo.stars - baseline.stars,
        baselineAt: baseline.fetchedAt,
        intervalHours: hours,
      });
      eligible.add(repo.id);
    } else withoutBaseline++;
  }
  rising.sort(
    (a, b) => b.starChange - a.starChange || b.stars - a.stars || a.id - b.id,
  );
  const selected = rising.slice(0, count);
  const newNotable = repos
    .filter(
      (repo) =>
        !eligible.has(repo.id) &&
        Date.parse(repo.createdAt) >= at.getTime() - 30 * 86400000 &&
        Date.parse(repo.createdAt) <= at.getTime(),
    )
    .sort((a, b) => b.stars - a.stars || a.id - b.id)
    .slice(0, Math.max(0, count - selected.length));
  return { rising: selected, newNotable, withoutBaseline };
}
export function githubQueries(config: Settings["github"]) {
  // Individual qualifiers are quoted; no user-provided query syntax is executed.
  const quote = (value: string) => '"' + value.replace(/["\\\r\n]/g, " ") + '"';
  const topics = config.topics.length ? config.topics : [""];
  const languages = config.languages.length ? config.languages : [""];
  const queries: string[] = [];
  for (const topic of topics)
    for (const language of languages) {
      queries.push(
        "archived:false fork:false stars:>0" +
          (topic ? " topic:" + quote(topic) : "") +
          (language ? " language:" + quote(language) : ""),
      );
      if (queries.length >= 3) return queries;
    }
  return queries;
}
export function createGithubConnector({
  http = safeHttp,
  now = () => new Date(),
  token,
}: { http?: HttpClient; now?: () => Date; token?: string } = {}) {
  const cooldown = new Map<string, number>();
  function rateLimit(response: HttpResponse) {
    const resource = response.headers["x-ratelimit-resource"] || "search";
    const remainingHeader = response.headers["x-ratelimit-remaining"];
    const remaining =
      remainingHeader !== undefined && /^\d+$/.test(remainingHeader)
        ? Number(remainingHeader)
        : null;
    const reset = Number(response.headers["x-ratelimit-reset"]);
    const resetMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 : null;
    const retryHeader = response.headers["retry-after"];
    const retry = retryHeader
      ? /^\d+$/.test(retryHeader)
        ? now().getTime() + Number(retryHeader) * 1000
        : Date.parse(retryHeader)
      : NaN;
    if (
      remaining === 0 ||
      response.status === 429 ||
      (response.status === 403 && !!retryHeader)
    ) {
      const until = Math.max(
        now().getTime() + 60000,
        resetMs ?? 0,
        Number.isFinite(retry) ? retry : 0,
      );
      cooldown.set(resource, until);
      if (response.status === 429 || response.status === 403)
        cooldown.set("secondary", until);
    }
    return {
      resource,
      remaining,
      resetAt: resetMs ? new Date(resetMs).toISOString() : null,
    };
  }
  return async (
    config: Settings["github"],
    {
      signal,
      baselines,
      recordSnapshots = () => {},
    }: {
      signal: AbortSignal;
      baselines: BaselineLoader;
      recordSnapshots?: (repos: Repository[]) => void;
    },
  ): Promise<SourceResult<GithubData>> => {
    const data = emptyGithub();
    const errors: SourceResult<GithubData>["errors"] = [];
    if (!config.enabled)
      return {
        status: "disabled",
        fetchedAt: now().toISOString(),
        data,
        errors,
      };
    const repos = new Map<number, Repository>();
    let successes = 0;
    const queries = githubQueries(config);
    if (
      Math.max(config.topics.length, 1) * Math.max(config.languages.length, 1) >
      3
    )
      errors.push({
        code: "QUERY_LIMIT",
        message:
          "Chỉ dùng ba tổ hợp topic/ngôn ngữ đầu tiên để giới hạn Search API.",
      });
    const cutoff = new Date(now().getTime() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    for (const base of queries) {
      for (const recent of [false, true]) {
        try {
          signal.throwIfAborted();
          if (
            ["search", "secondary"].some(
              (key) => (cooldown.get(key) ?? 0) > now().getTime(),
            )
          )
            throw new ConnectorError(
              "GITHUB_RATE_LIMIT",
              "GitHub đang giới hạn quota; chưa đến thời điểm có thể gọi lại.",
              new Date(Math.max(...cooldown.values())).toISOString(),
            );
          const url = new URL("https://api.github.com/search/repositories");
          url.search = new URLSearchParams({
            q: base + (recent ? " created:>=" + cutoff : ""),
            sort: "stars",
            order: "desc",
            per_page: "100",
            page: "1",
          }).toString();
          const response = await http(url.toString(), {
            signal,
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              ...(token ? { Authorization: "Bearer " + token } : {}),
            },
          });
          data.rateLimits.push(rateLimit(response));
          if (
            response.status === 429 ||
            (response.status === 403 &&
              (response.headers["x-ratelimit-remaining"] === "0" ||
                response.headers["retry-after"]))
          )
            throw new ConnectorError(
              "GITHUB_RATE_LIMIT",
              "GitHub đang giới hạn quota; chờ đến thời điểm được phép thử lại.",
              new Date(Math.max(...cooldown.values())).toISOString(),
            );
          ensureOk(response);
          const parsed = responseSchema.parse(JSON.parse(response.body));
          successes++;
          if (parsed.incomplete_results)
            errors.push({
              code: "INCOMPLETE_SEARCH",
              message: "GitHub chỉ trả một phần kết quả tìm kiếm.",
            });
          const fetchedAt = now().toISOString();
          for (const item of parsed.items) {
            if (item.archived || item.fork) continue;
            const url = new URL(item.html_url);
            if (url.protocol !== "https:" || url.hostname !== "github.com")
              continue;
            repos.set(item.id, {
              id: item.id,
              name: item.full_name,
              description: item.description?.slice(0, 1000) ?? null,
              language: item.language,
              url: url.toString(),
              stars: item.stargazers_count,
              createdAt: item.created_at,
              fetchedAt,
            });
          }
        } catch (error) {
          errors.push(cleanError(error));
        }
      }
    }
    const candidates = [...repos.values()];
    recordSnapshots(candidates);
    data.candidates = candidates.length;
    if (successes) {
      try {
        Object.assign(
          data,
          rankRepositories(
            candidates,
            await baselines(
              candidates.map((repo) => repo.id),
              now(),
            ),
            config.repositoryCount,
            now(),
          ),
        );
      } catch {
        errors.push({
          code: "BASELINE_UNAVAILABLE",
          message: "Không đọc được lịch sử sao để xếp hạng.",
        });
      }
    }
    return {
      status: !successes ? "failed" : errors.length ? "partial" : "success",
      fetchedAt: now().toISOString(),
      data,
      errors,
    };
  };
}
