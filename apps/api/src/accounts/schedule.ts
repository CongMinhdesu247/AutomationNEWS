import { settingsSchema } from "@hub/contracts";
import type { WorkflowQueue } from "../workflows/queue.js";
import { localDay, nextDaily } from "../workflows/schedule.js";
import { logEvent } from "../logger.js";

export function nextAccountSend(
  after: Date,
  time: string,
  timezone: string,
  days: number[],
) {
  let next = nextDaily(after, time, timezone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  });
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // Search up to 15 daily occurrences so a single-weekday schedule (e.g. Sunday 02:30)
  // that skips a nonexistent spring-forward DST wall-clock time still finds next week's day.
  for (let i = 0; i < 15; i++) {
    if (days.includes(names.indexOf(weekday.format(next)) + 1)) return next;
    next = nextDaily(next, time, timezone);
  }
  throw new Error("No selected weekday.");
}

export async function tickAccounts(queue: WorkflowQueue, graceMs: number) {
  // Claim a bounded batch so account settings remain responsive with many users.
  return queue.transaction(async (client) => {
    const now: Date = (
      await client.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    const rows = await client.query<{
      user_id: string;
      config: unknown;
      days: number[];
      next_run_at: Date;
    }>(
      "SELECT s.user_id,s.config,s.days,s.next_run_at FROM user_settings s JOIN hub_users u ON u.id=s.user_id WHERE NOT u.disabled AND s.next_run_at<=clock_timestamp() ORDER BY s.next_run_at,s.user_id FOR UPDATE OF s SKIP LOCKED LIMIT 25",
    );
    const runs: string[] = [];
    for (const row of rows.rows) {
      await client.query("SAVEPOINT account_tick_item");
      try {
        const settings = settingsSchema.parse(row.config);
        if (settings.newsletter.enabled && +now - +row.next_run_at <= graceMs) {
          const day = localDay(row.next_run_at, settings.newsletter.timezone);
          const previous = (
            await client.query<{ id: string }>(
              "SELECT id FROM workflow_runs WHERE user_id=$1 AND schedule_day=$2",
              [row.user_id, day],
            )
          ).rows[0];
          if (!previous) {
            runs.push(
              await queue.enqueue(
                client,
                crypto.randomUUID(),
                {},
                { at: row.next_run_at, day },
                settings,
                row.user_id,
              ),
            );
          }
        }
        const next = settings.newsletter.enabled
          ? nextAccountSend(
              now,
              settings.newsletter.sendTime,
              settings.newsletter.timezone,
              row.days,
            )
          : null;
        await client.query(
          "UPDATE user_settings SET next_run_at=$2,last_checked_at=$3 WHERE user_id=$1",
          [row.user_id, next, now],
        );
        await client.query("RELEASE SAVEPOINT account_tick_item");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT account_tick_item");
        // Advance next_run_at by 1 hour on broken user config so one bad row never spins in a tight 5s loop.
        await client.query(
          "UPDATE user_settings SET next_run_at=clock_timestamp()+interval '1 hour',last_checked_at=$2 WHERE user_id=$1",
          [row.user_id, now],
        );
        logEvent("error", "scheduler.account_tick_failed", {
          userId: row.user_id,
          error,
        });
      }
    }
    await client.query("DELETE FROM user_sessions WHERE expires_at<now()");
    await client.query("DELETE FROM account_rate_limits WHERE expires_at<now()");
    await client.query("DELETE FROM member_access WHERE expires_at<now()");
    return runs;
  });
}
