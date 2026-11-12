import type { DigestSources, FamilyProfile, SourceStatus } from "./index.js";

export const defaultAlerts = {
  enabled: false,
  goldChange: 100000,
  usdChange: 100,
  aqiThreshold: 150,
};
export function nextFamilySend(
  profile: FamilyProfile,
  at = new Date(),
): string | null {
  if (!profile.enabled) return null;
  const local = new Date(+at + 7 * 3600000);
  const [hour, minute] = profile.sendTime.split(":").map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(
      Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate() + offset,
        hour! - 7,
        minute,
      ),
    );
    const weekday = new Date(+day + 7 * 3600000).getUTCDay() || 7;
    if (+day > +at && profile.days.includes(weekday)) return day.toISOString();
  }
  return null;
}
export type SourceHealth = {
  key: keyof DigestSources;
  status: SourceStatus;
  updatedAt?: string;
  previousDay?: boolean;
};
export function sourceHealth(sources: DigestSources): SourceHealth[] {
  return Object.entries(sources)
    .filter(([, s]) => s && s.status !== "disabled")
    .map(([key, s]) => {
      const data = s.data as Record<string, unknown> | null;
      const stamp =
        data?.sourceUpdatedAt ?? data?.forecastAt ?? data?.effectiveAt;
      return {
        key: key as keyof DigestSources,
        status: s.status,
        ...(typeof stamp === "string" ? { updatedAt: stamp } : {}),
        ...(data?.previousDay === true ? { previousDay: true } : {}),
      };
    });
}
export function priceFreshness(updatedAt: string, at = new Date()): string {
  const stamp = new Date(updatedAt);
  if (!Number.isFinite(+stamp)) return "Chưa xác minh thời điểm nguồn";
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const time = stamp.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return (
    (date(stamp) === date(at)
      ? "Nguồn cập nhật: "
      : "Giá gần nhất (khác ngày hôm nay): ") + time
  );
}
export type FamilyDelivery = {
  key: string;
  status: "reserved" | "sent" | "failed" | "unknown";
  at: string;
  sourceStatus?: string;
  sources?: SourceHealth[];
  reportId?: string;
};
export type FamilyHealth = {
  checkedAt: string;
  profiles: {
    id: string;
    nextAt: string | null;
    deliveries: FamilyDelivery[];
  }[];
};
