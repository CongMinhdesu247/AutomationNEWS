import type { Pool } from "pg";
import {
  goldBarItems,
  goldPricePerChi,
  solarToLunarVi,
  upcomingLunarEvents,
  type DigestSources,
  type FuelData,
  type GoldData,
  type MarketDay,
  type NewsItem,
  type PublicTodayEdition,
  type UsdData,
} from "@hub/contracts";
import { DigestStore } from "../digests/store.js";
import { safeHttp, type HttpClient } from "../connectors/http.js";
import { dateInZone, fetchWeather } from "../connectors/weather.js";
import { fetchAirQuality } from "../connectors/air-quality.js";
import { fetchGold, fetchUsd } from "../connectors/markets.js";
import { fetchFuel } from "../connectors/fuel.js";
import { fetchRss } from "../connectors/rss.js";
import { compareMarketHistory } from "../connectors/market-history.js";
import { backfillMarketHistory } from "../connectors/market-backfill.js";

const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

type CachedValue<T> = {
  at: number;
  value: T;
};

const todayCache = new WeakMap<Pool, CachedValue<PublicTodayEdition>>();
const todayInflight = new WeakMap<Pool, Promise<PublicTodayEdition>>();

const sparklineCache = new WeakMap<
  Pool,
  CachedValue<{ sjc: number[]; usd: number[] }>
>();
const sparklineInflight = new WeakMap<
  Pool,
  Promise<{ sjc: number[]; usd: number[] }>
>();

function extractSparklines(
  history: MarketDay[],
  liveGold: GoldData | null,
  liveUsd: UsdData | null,
): { sjc: number[]; usd: number[] } {
  const sorted = [...history].sort((a, b) => a.day.localeCompare(b.day));
  const sjc = sorted
    .map((row) => row.prices.sjc_bar)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  const usd = sorted
    .map((row) => row.prices.usd)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);

  if (liveGold) {
    const bar = goldBarItems(liveGold)[0];
    const perChi = bar ? goldPricePerChi(bar.sell, liveGold.unit) : null;
    if (perChi && Number.isFinite(perChi) && sjc.at(-1) !== perChi) {
      sjc.push(perChi);
    }
  }
  if (liveUsd?.sell && Number.isFinite(liveUsd.sell) && usd.at(-1) !== liveUsd.sell) {
    usd.push(liveUsd.sell);
  }

  return {
    sjc: sjc.slice(-30),
    usd: usd.slice(-30),
  };
}

export async function getMarketSparklines(
  pool: Pool,
  store: DigestStore,
  options: { http?: HttpClient; now?: () => Date } = {},
): Promise<{ sjc: number[]; usd: number[] }> {
  const nowFn = options.now ?? (() => new Date());
  const now = nowFn();
  const nowMs = now.getTime();
  const cached = sparklineCache.get(pool);
  if (cached && nowMs - cached.at < 5 * 60_000) {
    return cached.value;
  }
  const existingFlight = sparklineInflight.get(pool);
  if (existingFlight) return existingFlight;

  const flight = (async () => {
    try {
      let history = await store.marketHistory(now, ZERO_UUID);
      const hasEnoughSjc =
        history.filter((r) => r.prices.sjc_bar !== undefined).length >= 7;
      const hasEnoughUsd =
        history.filter((r) => r.prices.usd !== undefined).length >= 7;
      if ((!hasEnoughSjc || !hasEnoughUsd) && options.http !== undefined) {
        history = await backfillMarketHistory(history, {
          gold: !hasEnoughSjc,
          usd: !hasEnoughUsd,
          now,
          signal: AbortSignal.timeout(4500),
          http: options.http,
          budgetMs: 4500,
        }).catch(() => history);
      } else if (!hasEnoughSjc || !hasEnoughUsd) {
        history = await backfillMarketHistory(history, {
          gold: !hasEnoughSjc,
          usd: !hasEnoughUsd,
          now,
          signal: AbortSignal.timeout(4500),
          http: safeHttp,
          budgetMs: 4500,
        }).catch(() => history);
      }
      const latestDigest = (
        await pool.query<{ sources: DigestSources }>(
          `SELECT sources FROM digests
            WHERE status <> 'running' AND sources IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`,
        )
      ).rows[0]?.sources;
      const value = extractSparklines(
        history,
        latestDigest?.gold?.data ?? null,
        latestDigest?.usd?.data ?? null,
      );
      sparklineCache.set(pool, { at: Date.now(), value });
      return value;
    } catch {
      return { sjc: [], usd: [] };
    } finally {
      sparklineInflight.delete(pool);
    }
  })();

  sparklineInflight.set(pool, flight);
  return flight;
}

export async function getPublicTodayEdition(
  pool: Pool,
  store: DigestStore,
  options: { http?: HttpClient; now?: () => Date } = {},
): Promise<PublicTodayEdition> {
  const nowFn = options.now ?? (() => new Date());
  const now = nowFn();
  const nowMs = now.getTime();

  const cached = todayCache.get(pool);
  if (cached && nowMs - cached.at < 10 * 60_000) {
    return cached.value;
  }
  const existing = todayInflight.get(pool);
  if (existing) return existing;

  const http = options.http ?? safeHttp;

  const flight = (async (): Promise<PublicTodayEdition> => {
    try {
      const solarDate = dateInZone(now, "Asia/Ho_Chi_Minh");
      const lunar = solarToLunarVi(solarDate);
      const upcomingLunar = upcomingLunarEvents(solarDate, 35, 4);

      const citySpecs = [
        {
          key: "hanoi" as const,
          name: "Hà Nội",
          latitude: 21.0285,
          longitude: 105.8542,
        },
        {
          key: "hcmc" as const,
          name: "TP. Hồ Chí Minh",
          latitude: 10.7769,
          longitude: 106.7009,
        },
      ];

      const [
        cities,
        goldRes,
        usdRes,
        fuelRes,
        rawHistory,
        dbArticlesRes,
        fallbackDigestRes,
      ] = await Promise.all([
        Promise.all(
          citySpecs.map(async (city) => {
            const [w, aq] = await Promise.all([
              fetchWeather(
                {
                  enabled: true,
                  location: city.name,
                  latitude: city.latitude,
                  longitude: city.longitude,
                },
                "Asia/Ho_Chi_Minh",
                {
                  http,
                  now: nowFn,
                  signal: AbortSignal.timeout(4500),
                },
              ).catch(() => null),
              fetchAirQuality(
                {
                  enabled: true,
                  location: city.name,
                  latitude: city.latitude,
                  longitude: city.longitude,
                },
                {
                  http,
                  now: nowFn,
                  signal: AbortSignal.timeout(4500),
                  timezone: "Asia/Ho_Chi_Minh",
                },
              ).catch(() => null),
            ]);
            return {
              key: city.key,
              name: city.name,
              weather: w?.data ?? null,
              airQuality: aq?.data ?? null,
            };
          }),
        ),
        fetchGold(
          { enabled: true },
          { http, now: nowFn, signal: AbortSignal.timeout(5000) },
        ).catch(() => null),
        fetchUsd(
          { enabled: true },
          { http, now: nowFn, signal: AbortSignal.timeout(5000) },
        ).catch(() => null),
        store
          .latestFuelBaseline(null)
          .then((baseline) =>
            fetchFuel(
              { enabled: true },
              { http, now: nowFn, signal: AbortSignal.timeout(5000), baseline },
            ),
          )
          .catch(() => null),
        store.marketHistory(now, ZERO_UUID).catch(() => [] as MarketDay[]),
        pool
          .query<{
            id: string;
            title: string;
            description: string;
            url: string;
            published_at: Date;
            source: string;
          }>(
            `SELECT DISTINCT ON (a.url)
                    a.id,
                    a.title,
                    a.description,
                    a.url,
                    a.published_at,
                    s.name AS source
               FROM news_articles a
               JOIN news_source_articles sa ON sa.article_id = a.id
               JOIN news_sources s ON s.id = sa.source_id
              WHERE s.status = 'approved'
                AND a.published_at >= $1
              ORDER BY a.url, a.published_at DESC
              LIMIT 40`,
            [new Date(nowMs - 48 * 3600_000)],
          )
          .catch(() => ({ rows: [] })),
        pool
          .query<{ sources: DigestSources }>(
            `SELECT sources FROM digests
              WHERE status <> 'running' AND sources IS NOT NULL
              ORDER BY created_at DESC LIMIT 1`,
          )
          .catch(() => ({ rows: [] })),
      ]);

      const fallbackSources = fallbackDigestRes.rows[0]?.sources;
      const effectiveGoldSource =
        goldRes && goldRes.data
          ? goldRes
          : fallbackSources?.gold?.data
            ? fallbackSources.gold
            : null;
      const effectiveUsdSource =
        usdRes && usdRes.data
          ? usdRes
          : fallbackSources?.usd?.data
            ? fallbackSources.usd
            : null;
      const effectiveFuel: FuelData | null =
        fuelRes?.data ?? fallbackSources?.fuel?.data ?? null;

      let history = rawHistory;
      if (
        history.filter((r) => r.prices.sjc_bar !== undefined).length < 7 ||
        history.filter((r) => r.prices.usd !== undefined).length < 7
      ) {
        history = await backfillMarketHistory(history, {
          gold: true,
          usd: true,
          now,
          signal: AbortSignal.timeout(4500),
          http,
          budgetMs: 4500,
        }).catch(() => history);
      }

      if (effectiveGoldSource || effectiveUsdSource) {
        compareMarketHistory(
          {
            ...(effectiveGoldSource ? { gold: effectiveGoldSource } : {}),
            ...(effectiveUsdSource ? { usd: effectiveUsdSource } : {}),
          },
          history,
          now,
        );
      }

      const goldData = effectiveGoldSource?.data
        ? {
            ...effectiveGoldSource.data,
            items: goldBarItems(effectiveGoldSource.data),
          }
        : null;
      const usdData = effectiveUsdSource?.data ?? null;
      const sparklines = extractSparklines(history, goldData, usdData);
      sparklineCache.set(pool, { at: Date.now(), value: sparklines });

      let articles: NewsItem[] = [...dbArticlesRes.rows]
        .sort(
          (a, b) =>
            new Date(b.published_at).getTime() -
            new Date(a.published_at).getTime(),
        )
        .slice(0, 8)
        .map((row) => ({
          id: row.id,
          title: row.title,
          source: row.source,
          url: row.url,
          publishedAt: new Date(row.published_at).toISOString(),
          description: row.description,
        }));

      if (articles.length < 4) {
        const rssFallback = await fetchRss(
          [
            {
              id: "public-vnexpress",
              name: "VnExpress Tin mới",
              url: "https://vnexpress.net/rss/tin-moi-nhat.rss",
              enabled: true,
            },
            {
              id: "public-tuoitre",
              name: "Tuổi Trẻ Tin mới",
              url: "https://tuoitre.vn/rss/tin-moi-nhat.rss",
              enabled: true,
            },
          ],
          {
            http,
            now: nowFn,
            signal: AbortSignal.timeout(4500),
            maxItems: 8,
            maxAgeMs: 48 * 3600_000,
          },
        ).catch(() => null);
        if (rssFallback?.data.items.length) {
          articles = rssFallback.data.items;
        } else if (fallbackSources?.rss?.data.items.length) {
          articles = fallbackSources.rss.data.items.slice(0, 8);
        }
      }

      const edition: PublicTodayEdition = {
        generatedAt: now.toISOString(),
        solarDate,
        lunar,
        upcomingLunar,
        cities,
        markets: {
          gold: goldData,
          usd: usdData,
          fuel: effectiveFuel,
          sparklines,
        },
        articles,
      };
      todayCache.set(pool, { at: Date.now(), value: edition });
      return edition;
    } finally {
      todayInflight.delete(pool);
    }
  })();

  todayInflight.set(pool, flight);
  return flight;
}
