import type { Pool } from "pg";
import type {
  Digest,
  DigestSummary,
  NotificationAttempt,
  DigestSources,
  MarketDay,
  Settings,
  FuelBaseline,
} from "@hub/contracts";
import type { BaselineLoader } from "../connectors/github.js";
import { recordMarketHistory } from "../connectors/market-history.js";
import { fuelBaseline } from "../connectors/fuel.js";

export class DigestStore {
  constructor(public pool: Pool) {}

  async marketHistory(at: Date, excludeId: string): Promise<MarketDay[]> {
    const monitor = await this.pool.query<{ state: { marketHistory?: MarketDay[] } }>(
      "SELECT state FROM market_monitor WHERE id=1",
    );
    const rows = await this.pool.query<{ sources: Pick<DigestSources, "gold" | "usd"> }>(
      "SELECT jsonb_build_object('gold',sources->'gold','usd',sources->'usd') AS sources FROM digests WHERE created_at >= $1 AND created_at <= $2 AND id <> $3 AND sources IS NOT NULL AND (sources->'gold'->>'status' = 'success' OR sources->'usd'->>'status' = 'success') ORDER BY created_at,id",
      [new Date(+at - 31 * 86400000), at, excludeId],
    );
    return rows.rows.reduce(
      (history, row) => recordMarketHistory(history, row.sources, at),
      monitor.rows[0]?.state.marketHistory ?? [],
    );
  }

  async latestFuelBaseline(userId?: string | null): Promise<FuelBaseline | undefined> {
    const row = (
      await this.pool.query<{ sources: DigestSources }>(
        `SELECT sources FROM digests
         WHERE status <> 'running'
           AND sources->'fuel'->>'status' = 'success'
           AND (($1::uuid IS NULL AND user_id IS NULL) OR user_id = $1)
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [userId ?? null],
      )
    ).rows[0];
    return row?.sources?.fuel ? fuelBaseline(row.sources.fuel) : undefined;
  }

  async settings() {
    const row = await this.pool.query<{ config: Settings }>(
      "SELECT config FROM settings WHERE id=$1",
      [1],
    );
    return row.rows[0]?.config;
  }

  async get(id: string, legacyOnly = false): Promise<Digest | undefined> {
    const result = await this.pool.query<Digest & { user_id: string | null }>(
      'SELECT id, user_id, created_at AS "createdAt", completed_at AS "completedAt", status, settings_snapshot AS settings, sources FROM digests WHERE id=$1 AND (NOT $2::boolean OR user_id IS NULL)',
      [id, legacyOnly],
    );
    const row = result.rows[0];
    if (!row) return;
    const { user_id: _ignored, ...digestRow } = row;
    return {
      ...digestRow,
      createdAt: new Date(row.createdAt).toISOString(),
      completedAt: row.completedAt
        ? new Date(row.completedAt).toISOString()
        : null,
      notifications: await this.notifications(id),
    };
  }

  async list(page: number, pageSize: number, userId?: string | null) {
    // userId === null -> legacy singleton digests (user_id IS NULL);
    // userId === string -> authenticated account digests with read state & highlights.
    if (typeof userId === "string") {
      try {
        const rows = await this.pool.query<
          DigestSummary & {
            readAt: Date | string | null;
            articleCount: number | null;
            repoCount: number | null;
            headline: string | null;
            minTemp: number | null;
            maxTemp: number | null;
            location: string | null;
            sjcSell: number | null;
            goldUnit: string | null;
            usdSell: number | null;
          }
        >(
          `SELECT d.id,
                  d.created_at AS "createdAt",
                  d.completed_at AS "completedAt",
                  d.status,
                  rd.read_at AS "readAt",
                  (coalesce(jsonb_array_length(d.sources->'rss'->'data'->'items'), 0) +
                   coalesce(jsonb_array_length(d.sources->'custom'->'data'->'items'), 0))::int AS "articleCount",
                  (coalesce(jsonb_array_length(d.sources->'github'->'data'->'rising'), 0) +
                   coalesce(jsonb_array_length(d.sources->'github'->'data'->'newNotable'), 0))::int AS "repoCount",
                  d.sources->'rss'->'data'->'items'->0->>'title' AS "headline",
                  (d.sources->'weather'->'data'->>'minTemperature')::numeric::float8 AS "minTemp",
                  (d.sources->'weather'->'data'->>'maxTemperature')::numeric::float8 AS "maxTemp",
                  d.sources->'weather'->'data'->>'location' AS "location",
                  (d.sources->'gold'->'data'->'items'->0->>'sell')::numeric::float8 AS "sjcSell",
                  d.sources->'gold'->'data'->>'unit' AS "goldUnit",
                  (d.sources->'usd'->'data'->>'sell')::numeric::float8 AS "usdSell"
             FROM digests d
             LEFT JOIN user_digest_reads rd ON rd.user_id = $3 AND rd.digest_id = d.id
            WHERE d.user_id = $3
            ORDER BY d.created_at DESC, d.id DESC
            LIMIT $1 OFFSET $2`,
          [pageSize + 1, (page - 1) * pageSize, userId],
        );
        return {
          items: rows.rows.slice(0, pageSize).map((row) => {
            const temps = [...new Set([row.minTemp, row.maxTemp])].filter(
              (v): v is number => v !== null && Number.isFinite(v),
            );
            const sjcPerChi =
              row.sjcSell !== null && Number.isFinite(row.sjcSell)
                ? row.goldUnit === "VND/lượng"
                  ? row.sjcSell / 10
                  : row.sjcSell
                : null;
            return {
              id: row.id,
              createdAt: new Date(row.createdAt).toISOString(),
              completedAt: row.completedAt
                ? new Date(row.completedAt).toISOString()
                : null,
              status: row.status,
              readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
              highlights: {
                articleCount: row.articleCount ?? 0,
                repoCount: row.repoCount ?? 0,
                headline: row.headline ?? null,
                temperature: temps.length ? `${temps.join("–")}°C` : null,
                location: row.location ?? null,
                sjcSell: sjcPerChi,
                usdSell:
                  row.usdSell !== null && Number.isFinite(row.usdSell)
                    ? row.usdSell
                    : null,
              },
            };
          }),
          page,
          pageSize,
          hasMore: rows.rows.length > pageSize,
        };
      } catch {
        // Fallback cleanly if user_digest_reads is not yet created in an older test schema.
      }
    }
    const rows = await this.pool.query<DigestSummary>(
      userId === null
        ? 'SELECT id, created_at AS "createdAt", completed_at AS "completedAt", status FROM digests WHERE user_id IS NULL ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2'
        : 'SELECT id, created_at AS "createdAt", completed_at AS "completedAt", status FROM digests WHERE ($3::uuid IS NULL OR user_id=$3) ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2',
      userId === null
        ? [pageSize + 1, (page - 1) * pageSize]
        : [pageSize + 1, (page - 1) * pageSize, userId ?? null],
    );
    return {
      items: rows.rows.slice(0, pageSize).map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
        completedAt: row.completedAt
          ? new Date(row.completedAt).toISOString()
          : null,
      })),
      page,
      pageSize,
      hasMore: rows.rows.length > pageSize,
    };
  }

  baselines: BaselineLoader = async (ids, at) => {
    if (!ids.length) return new Map();
    const result = await this.pool.query<{
      repository_id: string;
      stars: string;
      fetched_at: Date;
    }>(
      "SELECT DISTINCT ON (repository_id) repository_id, stars, fetched_at FROM github_snapshots WHERE repository_id=ANY($1::bigint[]) AND fetched_at BETWEEN $2 AND $3 ORDER BY repository_id,abs(extract(epoch FROM (fetched_at-$4::timestamptz))),fetched_at DESC",
      [
        ids,
        new Date(at.getTime() - 28 * 3600000),
        new Date(at.getTime() - 20 * 3600000),
        new Date(at.getTime() - 24 * 3600000),
      ],
    );
    return new Map(
      result.rows.map((row) => [
        Number(row.repository_id),
        { stars: Number(row.stars), fetchedAt: row.fetched_at.toISOString() },
      ]),
    );
  };

  async notifications(digestId: string): Promise<NotificationAttempt[]> {
    const result = await this.pool.query<NotificationAttempt>(
      'SELECT id,digest_id AS "digestId",created_at AS "createdAt",completed_at AS "completedAt",status,error FROM notification_attempts WHERE digest_id=$1 ORDER BY created_at DESC,id DESC',
      [digestId],
    );
    return result.rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      completedAt: row.completedAt
        ? new Date(row.completedAt).toISOString()
        : null,
    }));
  }

  async notificationByKey(digestId: string, key: string) {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM notification_attempts WHERE digest_id=$1 AND idempotency_key=$2",
      [digestId, key],
    );
    return (await this.notifications(digestId)).find(
      (row) => row.id === result.rows[0]?.id,
    );
  }

  async reserveNotification(
    id: string,
    digestId: string,
    key: string,
    destination: Settings["notifications"],
    at: Date,
  ) {
    return (
      (
        await this.pool.query(
          "INSERT INTO notification_attempts(id,digest_id,idempotency_key,destination,status,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(digest_id,idempotency_key) DO NOTHING RETURNING id",
          [id, digestId, key, JSON.stringify(destination), "sending", at],
        )
      ).rowCount === 1
    );
  }

  async finishNotification(
    id: string,
    status: NotificationAttempt["status"],
    error: NotificationAttempt["error"],
    at: Date,
  ) {
    await this.pool.query(
      "UPDATE notification_attempts SET status=$2,error=$3::jsonb,completed_at=$4 WHERE id=$1 AND status='sending'",
      [id, status, error ? JSON.stringify(error) : null, at],
    );
  }
}
