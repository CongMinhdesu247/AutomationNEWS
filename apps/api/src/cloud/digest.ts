import {
  settingsSchema,
  type Settings,
  type Digest,
  type DigestSources,
  type Repository,
  type SourceResult,
  type FamilyProfile,
  sourceHealth,
} from "@hub/contracts";
import { fetchRss } from "../connectors/rss.js";
import { fetchGold, fetchUsd } from "../connectors/markets.js";
import { fetchAirQuality } from "../connectors/air-quality.js";
import { fetchFuel, fuelBaseline } from "../connectors/fuel.js";
import { fetchWeather, dateInZone } from "../connectors/weather.js";
import { createGithubConnector } from "../connectors/github.js";
import { safeHttp, type HttpClient } from "../connectors/http.js";
import { sendNtfy } from "../connectors/ntfy.js";
import { isRetryable, retryDelay } from "../workflows/retry.js";
import { baselineLoader, pruneState, type CloudStateStore } from "./state.js";
import { sealReport } from "./reports.js";
import { marketSignals, significantChanges } from "./alerts.js";

export function parseCloudSettings(value: string): Settings {
  const settings = settingsSchema.parse(JSON.parse(value));
  if (!settings.notifications.enabled || !settings.notifications.topic)
    throw new Error("Cloud notifications must be enabled with a topic.");
  if (
    !settings.rss.some((feed) => feed.enabled) &&
    !settings.weather.enabled &&
    !settings.github.enabled &&
    !settings.fuel?.enabled &&
    !settings.airQuality?.enabled &&
    !settings.gold?.enabled &&
    !settings.usd?.enabled
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
  deliveryNamespace?: string;
  signalNamespace?: string;
  alertsOnly?: boolean;
  alerts?: FamilyProfile["alerts"];
  reportBaseUrl?: string;
  signal?: AbortSignal;
  onSourceResults?: (results: { source: string; status: string; errorCodes: string[] }[]) => void;
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
  let settings = parseCloudSettings(JSON.stringify(options.settings));
  const now = options.now ?? (() => new Date());
  if (!settings.newsletter.enabled) return { status: "disabled" as const };
  const revision = await options.state.load();
  const day = dateInZone(now(), settings.newsletter.timezone);
  if (
    options.deliveryNamespace &&
    !/^[a-f0-9]{16}$/.test(options.deliveryNamespace)
  )
    throw new Error("Invalid delivery namespace");
  let deliveryKey =
    day + (options.deliveryNamespace ? ":" + options.deliveryNamespace : "");
  const signalKey = options.signalNamespace ?? options.deliveryNamespace;
  const previousSignal = signalKey
    ? revision.state.signals?.[signalKey]
    : undefined;
  if (options.alertsOnly) {
    if (
      !options.alerts?.enabled ||
      !signalKey ||
      !/^[a-f0-9]{16}$/.test(signalKey)
    )
      return { status: "alerts_disabled" as const };
    const hour = new Date(+now() + 7 * 3600000).getUTCHours();
    if (hour < 9 || hour >= 20) return { status: "quiet_hours" as const };
    const lastAttempt =
      previousSignal?.attemptedAt ?? previousSignal?.notifiedAt;
    if (lastAttempt && +now() - Date.parse(lastAttempt) < 6 * 3600000)
      return { status: "alert_cooldown" as const };
    const prefix = day + ":" + signalKey + ":alert:";
    if (revision.state.deliveries[prefix + "1"])
      return { status: "alert_limit" as const };
    deliveryKey =
      prefix + (revision.state.deliveries[prefix + "0"] ? "1" : "0");
    settings = {
      ...settings,
      rss: [],
      github: { ...settings.github, enabled: false },
      weather: { ...settings.weather, enabled: false },
      fuel: { enabled: false },
    };
  }
  if (
    !options.alertsOnly &&
    !options.dryRun &&
    !options.forceSend &&
    revision.state.deliveries[deliveryKey]
  )
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
  const [rss, weather, githubResult, fuel, airQuality, gold, usd] =
    await Promise.all([
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
      collect(() =>
        fetchFuel(settings.fuel, {
          ...context,
          baseline: revision.state.fuelBaseline,
        }),
      ),
      collect(() => fetchAirQuality(settings.airQuality, context)),
      collect(() => fetchGold(settings.gold, context)),
      collect(() => fetchUsd(settings.usd, context)),
    ]);
  const sources: DigestSources = {
    rss,
    weather,
    github: githubResult,
    fuel,
    airQuality,
    gold,
    usd,
  };
  options.onSourceResults?.(Object.entries(sources).filter(([, value]) => value && value.status !== "disabled").map(([source, value]) => ({
    source, status: value.status,
    errorCodes: value.errors.map(error => /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : "UNCLASSIFIED"),
  })));
  options.onAirQuality?.({ status: airQuality.status });
  options.onFuel?.({
    status: fuel.status,
    products: fuel.data?.items.length ?? 0,
  });
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
  const status: "failed" | "success" | "partial" = active.every(
    (source) => source.status === "failed",
  )
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
  const signals = marketSignals(sources);
  const changes = options.alertsOnly
    ? significantChanges(signals, previousSignal, options.alerts!)
    : [];
  if (options.alertsOnly && !changes.length) {
    // Seed without alarming; re-arm AQI only after it falls below the chosen level.
    if (
      !previousSignal ||
      (signals.aqi !== undefined &&
        signals.aqi < options.alerts!.aqiThreshold &&
        previousSignal.values.aqi !== signals.aqi)
    ) {
      state.signals ??= {};
      state.signals[signalKey!] = {
        ...previousSignal,
        at: now().toISOString(),
        values: previousSignal
          ? {
              ...previousSignal.values,
              ...(signals.aqi !== undefined ? { aqi: signals.aqi } : {}),
            }
          : signals,
      };
      await options.state.save(state, revision.sha);
    }
    return { status: "no_significant_change" as const };
  }
  const sealed = options.reportBaseUrl
    ? sealReport(digest, options.reportBaseUrl)
    : undefined;
  if (sealed) {
    state.reports = Object.fromEntries([
      [digest.id, sealed.report],
      ...Object.entries(state.reports ?? {})
        .filter(([id]) => id !== digest.id)
        .sort((a, b) => b[1].at.localeCompare(a[1].at))
        .slice(0, 15),
    ]);
  }
  const metadata = {
    sourceStatus: status,
    sources: sourceHealth(sources),
    ...(sealed ? { reportId: digest.id } : {}),
  };
  const fuelPrices = fuelBaseline(fuel);
  state.snapshots.push(
    ...snapshots.map((repo) => ({
      id: repo.id,
      stars: repo.stars,
      fetchedAt: repo.fetchedAt,
    })),
  );
  state.snapshots = state.snapshots.slice(-4000);
  state.deliveries[deliveryKey] = {
    status: "reserved",
    at: now().toISOString(),
    ...metadata,
  };
  if (signalKey) {
    state.signals ??= {};
    state.signals[signalKey] = {
      ...previousSignal,
      at: now().toISOString(),
      attemptedAt: now().toISOString(),
      values: previousSignal?.values ?? signals,
    };
  }
  // Commit reservation before POST; state write failure must prevent the send.
  const sha = await options.state.save(state, revision.sha);
  const delivered = await sendNtfy(digest, settings.notifications, {
    http: boundedHttp,
    now,
    token: options.ntfyToken,
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    message: options.alertsOnly
      ? changes.join("\n\n") +
        "\n\nSo với lần thông báo gần nhất.\n" +
        sourceHealth(sources)
          .filter((s) => s.updatedAt)
          .map(
            (s) =>
              (s.key === "gold" ? "Vàng" : s.key === "usd" ? "USD" : "AQI") +
              ": " +
              new Date(s.updatedAt!).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
                hour: "2-digit",
                minute: "2-digit",
                day: "2-digit",
                month: "2-digit",
              }),
          )
          .join(" · ") +
        (sealed ? "\n\nBản web (tùy chọn):\n" + sealed.url : "")
      : cloudMessage(digest, false, false, false, sealed ? "Bản web (tùy chọn):\n" + sealed.url : ""),
    ...(sealed ? { clickUrl: sealed.url } : {}),
    ...(options.alertsOnly ? { title: "Biến động đáng chú ý" } : {}),
  });
  const error = delivered.errors[0];
  const sendStatus =
    delivered.status === "success"
      ? "sent"
      : error?.code.startsWith("HTTP_")
        ? "failed"
        : "unknown";
  state.deliveries[deliveryKey] = {
    status: sendStatus,
    at: now().toISOString(),
    ...metadata,
  };
  if (sendStatus === "sent" && signalKey) {
    state.signals ??= {};
    state.signals[signalKey] = {
      at: now().toISOString(),
      attemptedAt: now().toISOString(),
      notifiedAt: now().toISOString(),
      values: { ...previousSignal?.values, ...signals },
    };
  }
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
