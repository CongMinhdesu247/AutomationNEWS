import { settingsSchema, type Settings } from "@hub/contracts";
import { WorkflowQueue } from "./queue.js";
import { DigestStore } from "../digests/store.js";
import {
  DigestService,
  RequestError,
  type ServiceOptions,
} from "../digests/service.js";

export function localDay(at: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

// Daily wall-clock schedule, not a general Cron parser. Skips nonexistent DST times.
// Only the first occurrence of a repeated local day can produce a scheduled run.
export function nextDaily(after: Date, time: string, timezone: string): Date {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const first = Math.floor(after.getTime() / 60000) * 60000 + 60000;
  for (let index = 0; index < 72 * 60; index++) {
    const at = new Date(first + index * 60000);
    if (format.format(at) === time) return at;
  }
  throw new Error("No daily occurrence within 72 hours.");
}

export class DigestScheduler {
  private service: DigestService;
  constructor(
    public queue: WorkflowQueue,
    private options: ServiceOptions & { graceMs?: number } = {},
  ) {
    this.service = new DigestService(new DigestStore(queue.pool), options);
  }
  async tick() {
    return this.queue.transaction(async (client) => {
      const schedule = (
        await client.query(
          "SELECT * FROM digest_schedule WHERE id=1 FOR UPDATE SKIP LOCKED",
        )
      ).rows[0];
      if (!schedule) return;
      const now: Date = (await client.query("SELECT clock_timestamp() AS at"))
        .rows[0].at;
      const settings = settingsSchema.parse(
        (await client.query("SELECT config FROM settings WHERE id=1")).rows[0]
          ?.config,
      );
      const active =
        settings.newsletter.enabled &&
        (settings.rss.some((feed) => feed.enabled) ||
          settings.weather.enabled ||
          settings.github.enabled || settings.fuel?.enabled === true || settings.airQuality?.enabled === true || settings.gold?.enabled === true || settings.usd?.enabled === true);
      const configuration = { ...settings.newsletter, active };
      // JSONB key order differs from JS insertion order; compare fields explicitly.
      const changed =
        !schedule.configuration ||
        Object.entries(configuration).some(
          ([key, value]) => schedule.configuration[key] !== value,
        );
      let next: Date | null = schedule.next_run_at;
      let runId: string | null = null;
      if (!active) next = null;
      else if (changed || !next)
        next = nextDaily(
          now,
          settings.newsletter.sendTime,
          settings.newsletter.timezone,
        );
      else if (next.getTime() <= now.getTime()) {
        if (
          now.getTime() - next.getTime() <=
          (this.options.graceMs ?? 15 * 60000)
        ) {
          const day = localDay(next, settings.newsletter.timezone);
          const previous = (
            await client.query(
              "SELECT id FROM workflow_runs WHERE schedule_day=$1",
              [day],
            )
          ).rows[0];
          if (!previous)
            runId = await this.queue.enqueue(
              client,
              crypto.randomUUID(),
              {},
              { at: next, day },
              settings,
            );
        }
        next = nextDaily(
          now,
          settings.newsletter.sendTime,
          settings.newsletter.timezone,
        );
      }
      await client.query(
        "UPDATE digest_schedule SET configuration=$1::jsonb,next_run_at=$2,last_run_id=coalesce($3,last_run_id),last_checked_at=$4 WHERE id=1",
        [JSON.stringify(configuration), next, runId, now],
      );
      return runId;
    });
  }
  async deliver() {
    // An interrupted send is ambiguous: never automatically send it a second time.
    await this.queue.transaction(async (client) => {
      const expired = await client.query(
        "UPDATE scheduled_deliveries SET status='unknown',completed_at=clock_timestamp(),lease_until=NULL,error=$1::jsonb WHERE status='sending' AND lease_until<=clock_timestamp() RETURNING id,digest_id",
        [
          JSON.stringify({
            code: "DELIVERY_INTERRUPTED",
            message:
              "Gửi bị gián đoạn; kiểm tra điện thoại trước khi gửi lại thủ công.",
          }),
        ],
      );
      for (const row of expired.rows)
        await client.query(
          "UPDATE notification_attempts SET status='unknown',completed_at=clock_timestamp(),error=$3::jsonb WHERE digest_id=$1 AND idempotency_key=$2 AND status='sending'",
          [
            row.digest_id,
            row.id,
            JSON.stringify({
              code: "DELIVERY_INTERRUPTED",
              message: "Kết quả gửi chưa xác định.",
            }),
          ],
        );
    });
    const delivery = await this.queue.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT * FROM scheduled_deliveries WHERE status='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return;
      await client.query(
        "UPDATE scheduled_deliveries SET status='sending',lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1",
        [row.id],
      );
      return row as { id: string; digest_id: string };
    });
    if (!delivery) return;
    let status: "success" | "failed" | "unknown" = "unknown";
    let error: { code: string; message: string } | null = null;
    try {
      const digest = await new DigestStore(this.queue.pool).get(
        delivery.digest_id,
      );
      if (!digest)
        throw new RequestError(
          404,
          "DIGEST_NOT_FOUND",
          "Không tìm thấy bản tin.",
        );
      const scheduledAt: Date | undefined = (
        await this.queue.pool.query(
          "SELECT scheduled_at FROM workflow_runs WHERE digest_id=$1",
          [digest.id],
        )
      ).rows[0]?.scheduled_at;
      if (
        scheduledAt &&
        localDay(scheduledAt, digest.settings.newsletter.timezone) !==
          localDay(new Date(), digest.settings.newsletter.timezone)
      )
        throw new RequestError(
          409,
          "STALE_SCHEDULED_DIGEST",
          "Bản tin thuộc lịch ngày cũ; bỏ gửi tự động.",
        );
      const result = await this.service.notify(
        delivery.digest_id,
        delivery.id,
        digest.settings.notifications,
      );
      status = result.status === "sending" ? "unknown" : result.status;
      error = result.error;
    } catch (cause) {
      status = cause instanceof RequestError ? "failed" : "unknown";
      error =
        cause instanceof RequestError
          ? { code: cause.code, message: cause.message }
          : {
              code: "AUTO_DELIVERY_FAILED",
              message:
                "Không hoàn tất gửi tự động; kiểm tra trước khi gửi lại thủ công.",
            };
    }
    await this.queue.pool.query(
      "UPDATE scheduled_deliveries SET status=$2,error=$3::jsonb,completed_at=clock_timestamp(),lease_until=NULL WHERE id=$1 AND status='sending' AND lease_until>clock_timestamp()",
      [delivery.id, status, error ? JSON.stringify(error) : null],
    );
  }
  async status() {
    const [schedule, deliveries] = await Promise.all([
      this.queue.pool.query(
        'SELECT next_run_at AS "nextRunAt",last_checked_at AS "lastCheckedAt",last_run_id AS "lastRunId",configuration FROM digest_schedule WHERE id=1',
      ),
      this.queue.pool.query(
        'SELECT id,digest_id AS "digestId",status,created_at AS "createdAt",error FROM scheduled_deliveries ORDER BY created_at DESC,id DESC LIMIT 20',
      ),
    ]);
    return { ...schedule.rows[0], deliveries: deliveries.rows };
  }
}
