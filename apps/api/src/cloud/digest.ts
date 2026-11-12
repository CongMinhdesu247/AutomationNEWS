import {
  settingsSchema,
  type Settings,
  type Digest,
  type DigestSources,
  type Repository,
  type SourceResult,
} from "@hub/contracts";
import { fetchRss } from "../connectors/rss.js";
import { fetchWeather, dateInZone } from "../connectors/weather.js";
import { createGithubConnector } from "../connectors/github.js";
import { safeHttp, type HttpClient } from "../connectors/http.js";
import { sendNtfy } from "../connectors/ntfy.js";
import { isRetryable, retryDelay } from "../workflows/retry.js";
import { baselineLoader, pruneState, type CloudStateStore } from "./state.js";

export function parseCloudSettings(value: string): Settings {
  const settings = settingsSchema.parse(JSON.parse(value));
  if (!settings.notifications.enabled || !settings.notifications.topic)
    throw new Error("Cloud notifications must be enabled with a topic.");
  if (
    !settings.rss.some((feed) => feed.enabled) &&
    !settings.weather.enabled &&
    !settings.github.enabled
  )
    throw new Error("Enable at least one cloud source.");
  if (new URL(settings.notifications.serverUrl).protocol !== "https:")
    throw new Error("Cloud ntfy requires HTTPS.");
  return settings;
}

export function cloudMessage(digest: Digest) {
  const sources = digest.sources!;
  const weather = sources.weather.data;
  const lines = [
    "Bản tin sáng " +
      dateInZone(
        new Date(digest.createdAt),
        digest.settings.newsletter.timezone,
      ),
  ];
  if (weather)
    lines.push(
      "\nTHỜI TIẾT " +
        weather.location +
        ": " +
        weather.description +
        "; " +
        (weather.minTemperature ?? "?") +
        "–" +
        (weather.maxTemperature ?? "?") +
        " °C; mưa " +
        (weather.rainProbability ?? "?") +
        "%." +
        (weather.umbrella ? " Nên mang ô." : ""),
      "Nguồn: Open-Meteo · CC BY 4.0 · https://open-meteo.com/",
    );
  else if (sources.weather.status !== "disabled")
    lines.push("\nTHỜI TIẾT: chưa lấy được dữ liệu hôm nay.");
  if (sources.rss.status !== "disabled") {
    lines.push("\nTIN TỨC");
    for (const item of sources.rss.data.items.slice(0, 5))
      lines.push("• " + item.title + "\n" + item.url);
    if (!sources.rss.data.items.length)
      lines.push(
        sources.rss.status === "failed"
          ? "Nguồn tin lỗi."
          : "Chưa có bài mới trong 24 giờ.",
      );
  }
  if (sources.github.status !== "disabled") {
    lines.push("\nGITHUB NỔI BẬT");
    for (const repo of sources.github.data.rising)
      lines.push(
        "• " +
          repo.name +
          " (" +
          (repo.starChange > 0 ? "+" : "") +
          repo.starChange +
          " sao / " +
          repo.intervalHours.toFixed(1) +
          "h)\n" +
          repo.url,
      );
    for (const repo of sources.github.data.newNotable)
      lines.push(
        "• " +
          repo.name +
          " (mới đáng chú ý, " +
          repo.stars +
          " sao)\n" +
          repo.url,
      );
    if (
      !sources.github.data.rising.length &&
      sources.github.data.newNotable.length
    )
      lines.push("Chưa đủ lịch sử 20–28 giờ để tính tăng sao.");
    if (
      !sources.github.data.rising.length &&
      !sources.github.data.newNotable.length
    )
      lines.push(
        sources.github.status === "failed"
          ? "Nguồn GitHub lỗi."
          : "Chưa có repository phù hợp.",
      );
  }
  if (digest.status !== "success")
    lines.push("\nMột số nguồn thiếu hoặc lỗi; bản tin không đầy đủ.");
  const text = lines.join("\n");
  let result = "";
  let bytes = 0;
  for (const character of text) {
    bytes += Buffer.byteLength(character);
    if (bytes > 3750) return result + "\n… Nội dung đã được rút gọn.";
    result += character;
  }
  return result;
}

export type CloudOptions = {
  state: CloudStateStore;
  settings: Settings;
  http?: HttpClient;
  now?: () => Date;
  githubToken?: string;
  ntfyToken?: string;
  dryRun?: boolean;
  forceSend?: boolean;
  signal?: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export async function runCloudDigest(options: CloudOptions) {
  const settings = parseCloudSettings(JSON.stringify(options.settings));
  const now = options.now ?? (() => new Date());
  if (!settings.newsletter.enabled) return { status: "disabled" as const };
  const revision = await options.state.load();
  const day = dateInZone(now(), settings.newsletter.timezone);
  if (!options.dryRun && !options.forceSend && revision.state.deliveries[day])
    return { status: "already_attempted" as const };
  const signal = options.signal ?? AbortSignal.timeout(150000);
  const http = options.http ?? safeHttp;
  const boundedHttp: HttpClient = (url, request = {}) =>
    http(url, { ...request, timeoutMs: 10000 });
  const sleep =
    options.sleep ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          reject(new Error("Cloud operation timeout."));
        };
        const timer = setTimeout(finish, ms);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }));
  async function collect<T>(
    operation: () => Promise<SourceResult<T>>,
  ): Promise<SourceResult<T>> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const result = await operation();
      const retryable = result.errors.filter(isRetryable);
      if (result.status !== "failed" || !retryable.length || attempt >= 2)
        return result;
      const delay = Math.max(
        ...retryable.map((error) =>
          retryDelay(attempt, error, { now: now().getTime() }),
        ),
      );
      // Never retry earlier than the server hint. Long rate limits become a partial digest.
      if (delay > 20000) return result;
      await sleep(delay, signal);
    }
  }
  const context = { http: boundedHttp, now, signal };
  let snapshots: Repository[] = [];
  const github = createGithubConnector({
    http: boundedHttp,
    now,
    token: options.githubToken,
  });
  const [rss, weather, githubResult] = await Promise.all([
    collect(() => fetchRss(settings.rss, context)),
    collect(() =>
      fetchWeather(settings.weather, settings.newsletter.timezone, context),
    ),
    collect(() =>
      github(settings.github, {
        signal,
        baselines: baselineLoader(revision.state),
        recordSnapshots: (values) => {
          snapshots = values;
        },
      }),
    ),
  ]);
  const sources: DigestSources = { rss, weather, github: githubResult };
  const active = Object.values(sources).filter(
    (source) => source.status !== "disabled",
  );
  const status = active.every((source) => source.status === "failed")
    ? "failed"
    : active.every((source) => source.status === "success")
      ? "success"
      : "partial";
  const digest: Digest = {
    id: crypto.randomUUID(),
    createdAt: now().toISOString(),
    completedAt: now().toISOString(),
    settings,
    status,
    sources,
    notifications: [],
  };
  if (options.dryRun)
    return { status: "dry_run" as const, sourceStatus: status };
  signal.throwIfAborted();
  if (dateInZone(now(), settings.newsletter.timezone) !== day)
    throw new Error("Local day changed during collection; no send.");
  const state = pruneState(revision.state, now());
  state.snapshots.push(
    ...snapshots.map((repo) => ({
      id: repo.id,
      stars: repo.stars,
      fetchedAt: repo.fetchedAt,
    })),
  );
  state.snapshots = state.snapshots.slice(-4000);
  state.deliveries[day] = { status: "reserved", at: now().toISOString() };
  // Commit reservation before POST; state write failure must prevent the send.
  const sha = await options.state.save(state, revision.sha);
  const delivered = await sendNtfy(digest, settings.notifications, {
    http: boundedHttp,
    now,
    token: options.ntfyToken,
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    message: cloudMessage(digest),
  });
  const error = delivered.errors[0];
  const sendStatus =
    delivered.status === "success"
      ? "sent"
      : error?.code.startsWith("HTTP_")
        ? "failed"
        : "unknown";
  state.deliveries[day] = { status: sendStatus, at: now().toISOString() };
  await options.state.save(state, sha);
  if (sendStatus !== "sent")
    throw new Error(
      "Cloud push " +
        sendStatus +
        ". Check the phone before explicitly sending again.",
    );
  return { status: "sent" as const, sourceStatus: status };
}
