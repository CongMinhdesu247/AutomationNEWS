import { createHash } from "node:crypto";
import {
  familyConfigSchema,
  profileSettings,
  type FamilyProfile,
} from "@hub/contracts";
import { runCloudDigest, type CloudOptions } from "./digest.js";
import { safeHttp, type HttpClient } from "../connectors/http.js";

export function profileDue(profile: FamilyProfile, now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (key: string) => Number(parts.find((p) => p.type === key)!.value);
  const local = new Date(+now + 7 * 3600000);
  const day = local.getUTCDay() || 7;
  const [hour, minute] = profile.sendTime.split(":").map(Number);
  // Catch up within the same local day when Actions starts late. Never send before due.
  return (
    profile.enabled &&
    profile.days.includes(day) &&
    get("hour") * 60 + get("minute") >= hour! * 60 + minute!
  );
}
export function cachedFamilyHttp(http: HttpClient): HttpClient {
  const cache = new Map<string, ReturnType<HttpClient>>();
  return (url, options = {}) => {
    if (options.method === "POST") return http(url, options);
    const key = url + JSON.stringify(options.headers ?? {});
    let pending = cache.get(key);
    if (!pending) {
      pending = http(url, options).then(
        (result) => {
          if (result.status < 200 || result.status >= 300) cache.delete(key);
          return result;
        },
        (error) => {
          cache.delete(key);
          throw error;
        },
      );
      cache.set(key, pending);
    }
    return pending;
  };
}
export async function runCloudFamily(
  config: unknown,
  options: Omit<CloudOptions, "settings"> & { profileId?: string },
) {
  const family = familyConfigSchema.parse(config);
  const now = options.now ?? (() => new Date());
  const selected =
    options.profileId || (options.forceSend ? "personal" : undefined);
  if (selected && !family.profiles.some((p) => p.id === selected))
    throw new Error("Unknown family profile");
  const results: { id: string; status: string }[] = [];
  const errors: string[] = [];
  const sharedHttp = cachedFamilyHttp(options.http ?? safeHttp);
  for (const profile of family.profiles) {
    const localWeekday = new Date(+now() + 7 * 3600000).getUTCDay() || 7;
    const monitorBeforeDue = !selected && profile.enabled && profile.days.includes(localWeekday) &&
      (profile.gold || profile.usd) && !profileDue(profile, now());
    if (selected ? profile.id !== selected : !profileDue(profile, now()) && !monitorBeforeDue)
      continue;
    if (!profile.topic) {
      errors.push(profile.id);
      continue;
    }
    try {
      const namespace = createHash("sha256")
        .update(profile.id)
        .digest("hex")
        .slice(0, 16);
      const digestOptions = {
        ...options,
        http: sharedHttp,
        now,
        settings: profileSettings(
          selected ? { ...profile, enabled: true } : profile,
        ),
        deliveryNamespace: profile.id === "personal" ? undefined : namespace,
        signalNamespace: namespace,
        alerts: profile.alerts,
      };
      let result = await runCloudDigest({ ...digestOptions, ...(monitorBeforeDue ? { alertsOnly: true } : {}) });
      if (
        result.status === "already_attempted" &&
        !selected &&
        (profile.alerts?.enabled || profile.gold || profile.usd)
      )
        result = await runCloudDigest({ ...digestOptions, alertsOnly: true });
      results.push({ id: profile.id, status: result.status });
    } catch {
      errors.push(profile.id);
    }
  }
  if (errors.length)
    throw new Error(
      "Some family profiles failed; successful/reserved deliveries remain deduplicated.",
    );
  return results;
}
