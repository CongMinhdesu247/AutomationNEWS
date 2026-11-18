import { useEffect, useRef, useState } from "react";
import { applyRunEvent, eventLabels } from "./telemetry-state";
import type {
  RunEvent,
  RunSummary,
  StreamSync,
  WorkflowRun,
} from "@hub/contracts";
import { apiRequest } from "./lib/api-client";

const labels: Record<string, string> = {
  queued: "Chờ xử lý",
  running: "Đang chạy",
  completed: "Hoàn tất",
  failed: "Thất bại",
  pending: "Chờ bước trước",
  succeeded: "Thành công",
  skipped: "Bỏ qua",
};

const titles: Record<string, string> = {
  premium_task: "Cập nhật theo dõi tùy chỉnh",
  start: "Bắt đầu",
  fetch_rss: "Lấy tin RSS",
  fetch_weather: "Lấy thời tiết",
  fetch_github: "Lấy GitHub",
  fetch_fuel: "Lấy giá xăng",
  fetch_air_quality: "Lấy chất lượng không khí",
  fetch_gold: "Lấy giá vàng",
  fetch_usd: "Lấy tỷ giá USD",
  fetch_uv: "Lấy chỉ số UV",
  fetch_holidays: "Tính ngày lễ sắp tới",
  fetch_tasks: "Tổng hợp việc cần làm",
  compose_digest: "Gộp bản tin",
  persist_digest: "Lưu bản tin",
};

const order = [
  "start",
  "premium_task",
  "fetch_rss",
  "fetch_weather",
  "fetch_github",
  "fetch_fuel",
  "fetch_air_quality",
  "fetch_gold",
  "fetch_usd",
  "fetch_uv",
  "fetch_holidays",
  "fetch_tasks",
  "compose_digest",
  "persist_digest",
];

const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("vi-VN") : "—";

const terminal = (status: string) => ["completed", "failed"].includes(status);

function duration(start: string | null, end: string | null, now: number) {
  if (!start) return "—";
  return (
    Math.max(
      0,
      ((end ? Date.parse(end) : now) - Date.parse(start)) / 1000,
    ).toFixed(1) + " giây"
  );
}

const MAX_AUTO_RESETS = 8;

export default function RunDashboard({
  hash,
  listUrl = "/api/runs",
  showDiagnostics = true,
}: {
  hash: string;
  listUrl?: string;
  showDiagnostics?: boolean;
}) {
  const id = hash.startsWith("#/runs/") ? hash.slice("#/runs/".length) : null;
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [list, setList] = useState<{
    items: RunSummary[];
    hasMore: boolean;
  } | null>(null);
  const [elapsedNow, setElapsedNow] = useState(Date.now());

  useEffect(() => {
    if (!showDiagnostics || run?.status !== "running") return;
    const timer = setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run?.status, showDiagnostics]);

  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<
    "connecting" | "live" | "reconnecting" | "synced"
  >("connecting");
  const timelineRef = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);
  const autoResetCount = useRef(0);

  // Reset auto-retry counter whenever viewing a different run.
  useEffect(() => {
    autoResetCount.current = 0;
  }, [id]);

  useEffect(() => {
    const element = timelineRef.current;
    if (element && nearEnd.current) element.scrollTop = element.scrollHeight;
  }, [run?.eventCursor]);

  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let current: WorkflowRun | null = null;
    let synchronized = false;

    setLoading(true);
    setRun(null);
    setError("");
    setConnection("connecting");
    nearEnd.current = true;

    const scheduleReset = () => {
      source?.close();
      source = undefined;
      if (disposed) return;
      if (autoResetCount.current >= MAX_AUTO_RESETS) {
        setConnection("reconnecting");
        setError(
          "Luồng sự kiện trực tiếp bị gián đoạn nhiều lần. Bấm Tải lại tiến độ để đồng bộ lại.",
        );
        return;
      }
      const attempt = autoResetCount.current;
      autoResetCount.current += 1;
      // Immediate first resync for genuine cursor reset, then exponential backoff.
      const delayMs =
        attempt === 0 ? 100 : Math.min(10000, 1200 * 2 ** (attempt - 1));
      setConnection("reconnecting");
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        if (!disposed) {
          setConnection("connecting");
          setRevision((value) => value + 1);
        }
      }, delayMs);
    };

    function connect() {
      if (disposed || !id || !current || synchronized) return;
      if (!navigator.onLine) {
        setConnection("reconnecting");
        return;
      }
      source?.close();
      source = new EventSource(
        "/api/runs/" +
          encodeURIComponent(id) +
          "/events?cursor=" +
          encodeURIComponent(current.eventCursor),
      );
      const active = source;
      active.onopen = () => {
        if (!disposed && active === source) {
          setConnection("live");
        }
      };
      active.addEventListener("run-event", (message) => {
        if (disposed || !current || active !== source) return;
        try {
          const event = JSON.parse((message as MessageEvent).data) as RunEvent;
          const next = applyRunEvent(current, event);
          if (next !== current) {
            current = next;
            autoResetCount.current = 0;
            setRun(next);
          }
        } catch {
          scheduleReset();
        }
      });
      active.addEventListener("sync", (message) => {
        if (disposed || !current || active !== source) return;
        try {
          const sync = JSON.parse((message as MessageEvent).data) as StreamSync;
          if (sync.cursor !== current.eventCursor) throw new Error("Sync gap");
          autoResetCount.current = 0;
          if (sync.terminal) {
            if (!terminal(current.status)) {
              throw new Error("Invalid terminal sync");
            }
            synchronized = true;
            setConnection("synced");
            active.close();
          } else {
            setConnection("live");
          }
        } catch {
          scheduleReset();
        }
      });
      active.addEventListener("reset", () => {
        if (!disposed && active === source) scheduleReset();
      });
      active.onerror = () => {
        if (disposed || active !== source || synchronized) return;
        setConnection("reconnecting");
        if (active.readyState === EventSource.CLOSED) {
          clearTimeout(timer);
          scheduleReset();
        }
      };
    }

    const offline = () => {
      if (!disposed && current && !synchronized) {
        source?.close();
        source = undefined;
        clearTimeout(timer);
        setConnection("reconnecting");
      }
    };
    const online = () => {
      if (!disposed && current && !synchronized) {
        clearTimeout(timer);
        connect();
      }
    };

    async function load() {
      try {
        if (id) {
          const body = await apiRequest<WorkflowRun>(
            "/api/runs/" + encodeURIComponent(id),
            { signal: controller.signal, timeoutMs: 10000 },
          );
          if (disposed) return;
          current = body;
          setRun(current);
          connect();
        } else {
          const body = await apiRequest<{
            items: RunSummary[];
            hasMore: boolean;
          }>(listUrl + "?page=" + page + "&pageSize=10", {
            signal: controller.signal,
            timeoutMs: 10000,
          });
          if (disposed) return;
          setList(body);
        }
      } catch (err) {
        if (!disposed) {
          setError(
            err instanceof Error ? err.message : "Không tải được tiến độ.",
          );
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    void load();

    return () => {
      disposed = true;
      controller.abort();
      source?.close();
      clearTimeout(timer);
      clearTimeout(resetTimer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [id, page, revision, listUrl]);

  return (
    <div className="runs-dashboard">
      <div className="page-heading">
        <div>
          <h1>{id ? "Tiến độ tạo bản tin" : "Hoạt động"}</h1>
        </div>
      </div>
      <div className="digest-toolbar">
        <a href="#/digests" className="text-link">
          Bản tin
        </a>
        {id && showDiagnostics && (
          <a href="#/runs" className="text-link">
            Tất cả lần tạo bản tin
          </a>
        )}
        {(!id || error || connection === "reconnecting") && (
          <button
            type="button"
            onClick={() => {
              autoResetCount.current = 0;
              setRevision((value) => value + 1);
            }}
            disabled={loading}
          >
            Tải lại tiến độ
          </button>
        )}
      </div>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải tiến độ…</p>}
      {run && (
        <>
          {(showDiagnostics || connection === "reconnecting") && (
            <p className={"stream-connection " + connection} role="status">
              {connection === "connecting"
                ? "Đang kết nối…"
                : connection === "live"
                  ? "Trực tiếp"
                  : connection === "reconnecting"
                    ? "Đang kết nối lại…"
                    : "Đã đồng bộ sự kiện mới nhất"}
            </p>
          )}
          <div className="digest-meta" role="status">
            <strong className={"result-badge " + run.status}>
              {labels[run.status] ?? run.status}
            </strong>
            {showDiagnostics && (
              <>
                <span>{run.workflowVersion}</span>
                <details>
                  <summary>Thông tin lần chạy</summary>
                  <small>ID: {run.id}</small>
                </details>
                <small>
                  Tạo {date(run.createdAt)} · Bắt đầu {date(run.startedAt)} ·
                  Kết thúc {date(run.completedAt)}
                </small>
              </>
            )}
          </div>
          {run.status === "completed" && (
            <p className="status success">
              {showDiagnostics
                ? "Đã xử lý xong. Mở bản tin để xem nội dung và tình trạng từng nguồn."
                : "Bản tin đã sẵn sàng."}
            </p>
          )}
          {run.error && (
            <p className="status error">
              {showDiagnostics
                ? run.error.message
                : "Chưa tạo được bản tin. Hãy quay lại và thử tạo lại."}
            </p>
          )}
          {run.digestId && (
            <a className="open-digest" href={"#/digests/" + run.digestId}>
              Mở bản tin đã lưu
            </a>
          )}
          {!showDiagnostics && run.nodes.length > 0 && (
            <section className="member-run-progress" aria-label="Các bước tổng hợp">
              <div className="member-progress-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.round(
                      (run.nodes.filter((n) =>
                        ["succeeded", "skipped", "failed"].includes(n.status),
                      ).length /
                        Math.max(1, run.nodes.length)) *
                        100,
                    )}%`,
                  }}
                />
              </div>
              <ul className="member-step-list">
                {[...run.nodes]
                  .filter((n) => n.status !== "skipped")
                  .sort((a, b) => order.indexOf(a.nodeId) - order.indexOf(b.nodeId))
                  .map((node) => (
                    <li key={node.nodeId}>
                      <span>{titles[node.nodeId] ?? node.nodeId}</span>
                      <span className={"result-badge " + node.status}>
                        {labels[node.status] ?? node.status}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
          {showDiagnostics && (
            <>
              <details
                className="run-timeline"
                aria-label="Dòng thời gian sự kiện"
              >
                <summary>Nhật ký xử lý trực tiếp</summary>
                <p className="muted">
                  Tối đa 100 sự kiện gần nhất. Lịch sử trong PostgreSQL có thể
                  được dọn theo chính sách lưu trữ; trạng thái quy trình vẫn
                  được giữ.
                </p>
                {run.eventsTruncated && (
                  <p className="muted">
                    Đang hiển thị phần cuối lịch sử sự kiện.
                  </p>
                )}
                <div
                  className="timeline-scroll"
                  ref={timelineRef}
                  onScroll={() => {
                    const element = timelineRef.current;
                    if (element) {
                      nearEnd.current =
                        element.scrollHeight -
                          element.scrollTop -
                          element.clientHeight <
                        64;
                    }
                  }}
                >
                  <ol>
                    {run.recentEvents.map((event) => (
                      <li
                        key={event.id}
                        data-event-id={event.id}
                        data-event-at={event.timestamp}
                      >
                        <time dateTime={event.timestamp}>
                          {date(event.timestamp)}
                        </time>
                        <strong>
                          {eventLabels[event.type]}
                          {event.nodeId
                            ? " · " + (titles[event.nodeId] ?? event.nodeId)
                            : ""}
                        </strong>
                        {event.payload.node?.error && (
                          <p>{event.payload.node.error.message}</p>
                        )}
                        {event.type === "node.retry_scheduled" &&
                          event.payload.node?.availableAt && (
                            <small>
                              Thử lại từ {date(event.payload.node.availableAt)}
                            </small>
                          )}
                        <small>Sự kiện #{event.sequence}</small>
                      </li>
                    ))}
                  </ol>
                  {run.recentEvents.length === 0 && (
                    <p>Chưa có sự kiện nào được lưu cho lần chạy này.</p>
                  )}
                </div>
              </details>
              <ol className="run-nodes">
                {[...run.nodes]
                  .sort(
                    (a, b) => order.indexOf(a.nodeId) - order.indexOf(b.nodeId),
                  )
                  .map((node) => (
                    <li key={node.nodeId}>
                      <div className="run-node-heading">
                        <div>
                          <strong>{titles[node.nodeId] ?? node.nodeId}</strong>
                        </div>
                        <span className={"result-badge " + node.status}>
                          {node.retryCount > 0 && node.status === "running"
                            ? "Đang thử lại"
                            : node.retryCount > 0 && node.status === "queued"
                              ? "Chờ thử lại"
                              : (labels[node.status] ?? node.status)}
                        </span>
                        <span>
                          {duration(
                            node.startedAt,
                            node.completedAt,
                            elapsedNow,
                          )}
                        </span>
                      </div>
                      <details>
                        <summary>Chi tiết thực thi</summary>
                        <small>
                          {node.attempts} lượt thử · {node.recoveries} lần phục
                          hồi · {node.retryCount} lần lên lịch thử lại
                          {node.workerId ? " · Worker " + node.workerId : ""}
                        </small>
                        {node.status === "queued" &&
                          node.retryCount > 0 &&
                          node.availableAt && (
                            <small>
                              Được thử lại từ {date(node.availableAt)}
                            </small>
                          )}
                        {node.leaseUntil && (
                          <small>Giữ quyền xử lý đến {date(node.leaseUntil)}</small>
                        )}
                      </details>
                      {node.error && (
                        <p
                          className={
                            ["skipped", "queued", "running"].includes(
                              node.status,
                            )
                              ? "muted"
                              : "field-error"
                          }
                        >
                          {["queued", "running"].includes(node.status) &&
                            "Lần thử trước: "}
                          {node.error.code}: {node.error.message}
                        </p>
                      )}
                    </li>
                  ))}
              </ol>
            </>
          )}
        </>
      )}
      {!id && list && !loading && (
        <>
          <ul className="digest-history">
            {list.items.map((item) => (
              <li key={item.id}>
                <a href={"#/runs/" + item.id}>
                  <strong>Lần chạy {date(item.createdAt)}</strong>
                  <small>{item.workflowVersion}</small>
                </a>
                <span className={"result-badge " + item.status}>
                  {labels[item.status] ?? item.status}
                </span>
              </li>
            ))}
          </ul>
          {list.items.length === 0 && (
            <p className="empty-state">
              Chưa có lần chạy nào. Vào mục Bản tin để tạo bản tin đầu tiên.
            </p>
          )}
          {(page > 1 || list.hasMore) && (
            <div className="pagination">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Trang trước
              </button>
              <span>Trang {page}</span>
              <button
                type="button"
                disabled={!list.hasMore}
                onClick={() => setPage((value) => value + 1)}
              >
                Trang sau
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
