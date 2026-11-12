import {
  settingsSchema,
  type Settings,
  type Digest,
  type DigestSources,
  type Repository,
  type SourceResult,
} from "@hub/contracts";
import { fetchRss } from "../connectors/rss.js";
import { fetchAirQuality } from "../connectors/air-quality.js";
import { fetchFuel, fuelBaseline } from "../connectors/fuel.js";
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
    !settings.github.enabled && !settings.fuel?.enabled && !settings.airQuality?.enabled
  )
    throw new Error("Enable at least one cloud source.");
  if (new URL(settings.notifications.serverUrl).protocol !== "https:")
    throw new Error("Cloud ntfy requires HTTPS.");
  return settings;
}

export { formatDigestNotification as cloudMessage } from "../notifications/format.js";
import { formatDigestNotification as cloudMessage } from "../notifications/format.js";

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
  onSummaries?: (counts: {
    total: number;
    vietnamese: number;
    unavailable: number;
  }) => void;
  onFuel?: (result: { status: string; products: number }) => void;
  onAirQuality?: (result: { status: string }) => void;
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
    translationCache:
      revision.state.translations ?? (revision.state.translations = {}),
  });
  const [rss, weather, githubResult, fuel, airQuality] = await Promise.all([
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
    collect(() => fetchFuel(settings.fuel, { ...context, baseline: revision.state.fuelBaseline })),
    collect(() => fetchAirQuality(settings.airQuality, context)),
  ]);
  const sources: DigestSources = { rss, weather, github: githubResult, fuel, airQuality };
  options.onAirQuality?.({ status: airQuality.status });
  options.onFuel?.({ status: fuel.status, products: fuel.data?.items.length ?? 0 });
  const selectedRepos = [
    ...githubResult.data.rising,
    ...githubResult.data.newNotable,
  ];
  options.onSummaries?.({
    total: selectedRepos.length,
    vietnamese: selectedRepos.filter(
      (repo) =>
        repo.summaryViStatus === "translated" ||
        repo.summaryViStatus === "original_vi",
    ).length,
    unavailable: selectedRepos.filter(
      (repo) => repo.summaryViStatus === "unavailable",
    ).length,
  });
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
  const fuelPrices = fuelBaseline(fuel);
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
  if (sendStatus === "sent" && fuelPrices) state.fuelBaseline = fuelPrices;
  await options.state.save(state, sha);
  if (sendStatus !== "sent")
    throw new Error(
      "Cloud push " +
        sendStatus +
        ". Check the phone before explicitly sending again.",
    );
  return { status: "sent" as const, sourceStatus: status };
}
