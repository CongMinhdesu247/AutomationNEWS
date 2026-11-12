import { z } from "zod";
import type { Settings } from "./index.js";
export type SourceStatus = "success" | "partial" | "failed" | "disabled";
export type SourceError = {
  code: string;
  message: string;
  source?: string;
  retryAt?: string;
};
export type SourceResult<T> = {
  status: SourceStatus;
  fetchedAt: string;
  data: T;
  errors: SourceError[];
};
export type NewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  description: string;
};
export type RssData = {
  items: NewsItem[];
  skippedInvalidDate: number;
  skippedInvalidItem: number;
  feedsSucceeded: number;
  feedsTotal: number;
};
export type WeatherData = {
  date: string;
  location: string;
  timezone: string;
  minTemperature: number | null;
  maxTemperature: number | null;
  rainProbability: number | null;
  weatherCode: number | null;
  description: string;
  umbrella: boolean | null;
  attribution: {
    name: string;
    url: string;
    license: string;
    licenseUrl: string;
  };
};
export type Repository = {
  id: number;
  name: string;
  description: string | null;
  summaryVi?: string;
  summaryViStatus?: "translated" | "original_vi" | "unavailable" | "missing";
  language: string | null;
  url: string;
  stars: number;
  createdAt: string;
  fetchedAt: string;
};
export type RisingRepository = Repository & {
  starChange: number;
  baselineAt: string;
  intervalHours: number;
};
export type GithubData = {
  rising: RisingRepository[];
  newNotable: Repository[];
  candidates: number;
  withoutBaseline: number;
  comparisonWindowHours: [number, number];
  rateLimits: {
    resource: string;
    remaining: number | null;
    resetAt: string | null;
  }[];
};
export type DigestSources = {
  gold?: SourceResult<GoldData | null>;
  usd?: SourceResult<UsdData | null>;
  airQuality?: SourceResult<AirQualityData | null>;
  fuel?: SourceResult<FuelData | null>;
  rss: SourceResult<RssData>;
  weather: SourceResult<WeatherData | null>;
  github: SourceResult<GithubData>;
};
export type GoldData = {
  source: string; sourceUrl: string; sourceUpdatedAt: string; previousDay: boolean;
  region: string; unit: "VND/chỉ" | "VND/lượng";
  items: { code: "sjc_bar" | "sjc_ring"; name: string; buy: number; sell: number }[];
};
// Older saved digests use VND/lượng; keep their amounts correct when displayed.
export function goldPricePerChi(price: number, unit: GoldData["unit"]): number {
  return unit === "VND/lượng" ? price / 10 : price;
}
export type UsdData = {
  source: "Vietcombank"; sourceUrl: string; sourceUpdatedAt: string; previousDay: boolean;
  unit: "VND/USD"; buyCash: number | null; buyTransfer: number | null; sell: number | null;
};
export type AirQualityData = {
  location: string;
  forecastAt: string;
  usAqi: number | null;
  pm25: number | null;
  category: string | null;
  sourceUrl: string;
  attribution: string;
};
export type FuelData = {
  region: "Petrolimex vùng 1";
  sourceUrl: string;
  updatedAt: string;
  effectiveAt: string;
  comparedAt: string | null;
  items: { code: string; name: string; price: number; change: number | null }[];
};
export type FuelBaseline = { at: string; prices: Record<string, number> };
export type DigestStatus = "running" | "success" | "partial" | "failed";
export type Digest = {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: DigestStatus;
  settings: Settings;
  sources: DigestSources | null;
  notifications: NotificationAttempt[];
};
export type DigestSummary = Pick<
  Digest,
  "id" | "createdAt" | "completedAt" | "status"
>;
export type NotificationAttempt = {
  id: string;
  digestId: string;
  createdAt: string;
  completedAt: string | null;
  status: "sending" | "success" | "failed" | "unknown";
  error: SourceError | null;
};
export const requestKeySchema = z.uuid("Idempotency-Key phải là UUID.");
export const digestIdSchema = z.uuid("ID bản tin không hợp lệ.");
export const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
