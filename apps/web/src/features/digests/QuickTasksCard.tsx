import { useState } from "react";
import {
  calendarDate,
  formatDateTime,
  solarToLunarVi,
  upcomingLunarEvents,
  type DigestSources,
  type SourceResult,
} from "@hub/contracts";
import { Icon } from "../../Icons";
import { ExternalLink } from "../../components/ExternalLink";

function UtilityStatusBadge({ result }: { result: SourceResult<unknown> }) {
  if (result.status === "success" || result.status === "disabled") return null;
  const label = result.status === "partial" ? "Một phần" : "Thất bại";
  return <span className={"result-badge " + result.status}>{label}</span>;
}

export function QuickUtilitiesGrid({
  sources,
  accountDashboard,
  timezone,
  completedTaskIds,
  onToggleTask,
}: {
  sources: DigestSources;
  accountDashboard: boolean;
  timezone?: string;
  completedTaskIds?: ReadonlySet<string>;
  onToggleTask?: (taskId: string, done: boolean) => Promise<void>;
}) {
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const uv = sources.uv;
  const holidays = sources.holidays;
  const tasks = sources.tasks;

  if (
    ![uv, holidays, tasks].some(
      (source) => source && source.status !== "disabled",
    )
  ) {
    return null;
  }

  return (
    <div id="section-utilities" className="daily-utility-grid">
      {tasks && tasks.status !== "disabled" && (
        <section className="daily-utility-card">
          <div className="digest-section-heading">
            <h2>Việc cần làm hôm nay</h2>
            <UtilityStatusBadge result={tasks} />
          </div>
          {tasks.data ? (
            tasks.data.items.length ? (
              <ul className="quick-task-checklist">
                {tasks.data.items.map((item) => {
                  const isDone = completedTaskIds?.has(item.id) ?? false;
                  return (
                    <li key={item.id}>
                      {accountDashboard && onToggleTask ? (
                        <label className="account-check quick-task-row">
                          <input
                            type="checkbox"
                            checked={isDone}
                            disabled={busyTaskId === item.id}
                            onChange={async (e) => {
                              const checked = e.target.checked;
                              setBusyTaskId(item.id);
                              try {
                                await onToggleTask(item.id, checked);
                              } finally {
                                setBusyTaskId(null);
                              }
                            }}
                          />
                          <span className={isDone ? "task-done" : undefined}>
                            <strong>{item.title}</strong>
                            <small>
                              {item.date.split("-").reverse().join("/")}
                              {isDone
                                ? " · Đã xong"
                                : item.overdue
                                  ? " · Quá hạn"
                                  : " · Đến hạn hôm nay"}
                            </small>
                          </span>
                        </label>
                      ) : (
                        <>
                          <strong>{item.title}</strong>
                          <small>
                            {item.date.split("-").reverse().join("/")}
                            {item.overdue ? " · Quá hạn" : " · Đến hạn hôm nay"}
                          </small>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>Không có việc đến hạn chưa hoàn thành.</p>
            )
          ) : (
            <p>Chưa tổng hợp được việc cần làm.</p>
          )}
          <a
            href={accountDashboard ? "#/preferences" : "#/settings/newsletter"}
            className="text-link"
          >
            Quản lý việc của bạn <Icon name="arrow" size={15} />
          </a>
        </section>
      )}

      {holidays && holidays.status !== "disabled" && (
        <section className="daily-utility-card">
          <div className="digest-section-heading">
            <h2>Ngày lễ, Âm lịch &amp; kỷ niệm</h2>
            <UtilityStatusBadge result={holidays} />
          </div>
          {(() => {
            const todayIso = calendarDate(
              new Date(),
              timezone ?? "Asia/Ho_Chi_Minh",
            );
            const lunarToday = solarToLunarVi(todayIso);
            const lunarUpcoming = upcomingLunarEvents(todayIso, 20, 2);
            return (
              <>
                <div className="lunar-today-callout">
                  <strong>{lunarToday.labelFull}</strong>
                  <small>
                    Ngày {lunarToday.canChiDay}
                    {lunarToday.specialBadge
                      ? ` · ${lunarToday.specialBadge}`
                      : ""}
                  </small>
                </div>
                <ul>
                  {lunarUpcoming.map((ev) => (
                    <li key={"lunar-" + ev.date + ev.name}>
                      <strong>{ev.name}</strong>
                      <small>
                        {ev.date.split("-").reverse().join("/")} ({ev.lunarLabel}) ·{" "}
                        {ev.daysAway === 0
                          ? "Hôm nay"
                          : `Còn ${ev.daysAway} ngày`}
                      </small>
                    </li>
                  ))}
                  {holidays.data?.events.map((event) => (
                    <li key={event.date + event.name}>
                      <strong>{event.name}</strong>
                      <small>
                        {event.date.split("-").reverse().join("/")} ·{" "}
                        {event.daysAway === 0
                          ? "Diễn ra hôm nay"
                          : `Còn ${event.daysAway} ngày`}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
          <p className="muted">Âm lịch Việt Nam, Dương lịch &amp; kỷ niệm cá nhân.</p>
        </section>
      )}

      {uv && uv.status !== "disabled" && (
        <section className="daily-utility-card">
          <div className="digest-section-heading">
            <h2>Chỉ số UV hôm nay</h2>
            <UtilityStatusBadge result={uv} />
          </div>
          {uv.data ? (
            <>
              <p>
                {uv.data.location} · Cập nhật{" "}
                {formatDateTime(uv.fetchedAt, timezone)}
              </p>
              <strong className="daily-uv-value">
                {uv.data.maximum.toLocaleString("vi-VN", {
                  maximumFractionDigits: 1,
                })}
                <span>{uv.data.level}</span>
              </strong>
              <p>Dự báo bức xạ cực đại trong ngày.</p>
              <ExternalLink href={uv.data.sourceUrl} className="text-link">
                Open-Meteo · CC BY 4.0
              </ExternalLink>
            </>
          ) : (
            <p>Chưa lấy được dự báo UV.</p>
          )}
        </section>
      )}
    </div>
  );
}
