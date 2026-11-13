import type { Pool } from "pg";
import { settingsSchema } from "@hub/contracts";
import { cloudStateSchema, type CloudStateStore } from "../cloud/state.js";
import { runCloudDigest } from "../cloud/digest.js";
import { DigestStore } from "../digests/store.js";
import { safeHttp } from "../connectors/http.js";
import type { ServiceOptions } from "../digests/service.js";

export async function checkMarketLows(pool: Pool, options: ServiceOptions = {}) {
  const at = (options.now ?? (() => new Date()))();
  // Atomic claim across scheduler replicas. Leave the 30-minute claim in place
  // on network/ambiguous delivery failures to avoid retry storms.
  const claimed = await pool.query(
    "UPDATE market_monitor SET checked_at=$1 WHERE id=1 AND (checked_at IS NULL OR checked_at <= $1::timestamptz - interval '30 minutes') RETURNING id", [at],
  );
  if (!claimed.rowCount) return;
  const config = (await pool.query("SELECT config FROM settings WHERE id=1")).rows[0]?.config;
  if (!config) return;
  const settings = settingsSchema.parse(config);
  if (!settings.newsletter.enabled || !settings.notifications.enabled ||
      (!settings.gold?.enabled && !settings.usd?.enabled)) return;
  const state: CloudStateStore = {
    async load() {
      const row = (await pool.query("SELECT state,revision::text FROM market_monitor WHERE id=1")).rows[0];
      const value = cloudStateSchema.parse(row.state);
      value.marketHistory = await new DigestStore(pool).marketHistory(at, "00000000-0000-4000-8000-000000000000");
      return { state: value, sha: row.revision };
    },
    async save(value, sha) {
      const saved = await pool.query(
        "UPDATE market_monitor SET state=$1::jsonb,revision=revision+1 WHERE id=1 AND revision=$2 RETURNING revision::text",
        [JSON.stringify(cloudStateSchema.parse(value)), sha],
      );
      if (!saved.rowCount) throw new Error("Market monitor state conflict; no automatic resend.");
      return saved.rows[0].revision;
    },
  };
  const http = options.http ?? safeHttp;
  return runCloudDigest({
    backfillHistory: true,
    state,
    settings: { ...settings, airQuality: { enabled: false } },
    now: () => at,
    alertsOnly: true,
    signalNamespace: "0000000000000001",
    ntfyToken: options.ntfyToken,
    http: (url, request = {}) => http(url, {
      ...request,
      ...(request.method === "POST" ? { allowedOrigins: options.ntfyAllowedOrigins ?? [] } : {}),
    }),
  });
}
