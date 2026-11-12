import { useEffect, useState, useRef } from "react";
import { applyRunEvent, eventLabels } from "./telemetry-state";
import type {
  RunEvent,
  StreamSync,
  WorkflowRun,
  RunSummary,
} from "@hub/contracts";
const labels: Record<string, string> = {
  queued: "Chờ xử lý",
  running: "Đang chạy",
  completed: "Hoàn tất",
  failed: "Thất bại",
  pending: "Chờ dependency",
  succeeded: "Thành công",
  skipped: "Bỏ qua",
};
const titles: Record<string, string> = {
  start: "Bắt đầu",
  fetch_rss: "Lấy tin RSS",
  fetch_weather: "Lấy thời tiết",
  fetch_github: "Lấy GitHub",
  compose_digest: "Gộp bản tin",
  persist_digest: "Lưu bản tin",
};
const order = [
  "start",
  "fetch_rss",
  "fetch_weather",
  "fetch_github",
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
export default function RunDashboard({ hash }: { hash: string }) {
  const id = hash.startsWith("#/runs/") ? hash.slice("#/runs/".length) : null;
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [list, setList] = useState<{
    items: RunSummary[];
    hasMore: boolean;
  } | null>(null);
  const [elapsedNow, setElapsedNow] = useState(Date.now());
  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run?.status]);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<
    "connecting" | "live" | "reconnecting" | "synced"
  >("connecting");
  const timelineRef = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);
  useEffect(() => {
    const element = timelineRef.current;
    if (element && nearEnd.current) element.scrollTop = element.scrollHeight;
  }, [run?.eventCursor]);
  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let current: WorkflowRun | null = null;
    let synchronized = false;
    setLoading(true);
    setRun(null);
    setError("");
    setConnection("connecting");
    nearEnd.current = true;
    const reset = () => {
      source?.close();
      if (!disposed) {
        setConnection("connecting");
        setRevision((value) => value + 1);
      }
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
        if (!disposed && active === source) setConnection("live");
      };
      active.addEventListener("run-event", (message) => {
        if (disposed || !current || active !== source) return;
        try {
          const event = JSON.parse((message as MessageEvent).data) as RunEvent;
          const next = applyRunEvent(current, event);
          if (next !== current) {
            current = next;
            setRun(next);
          }
        } catch {
          reset();
        }
      });
      active.addEventListener("sync", (message) => {
        if (disposed || !current || active !== source) return;
        try {
          const sync = JSON.parse((message as MessageEvent).data) as StreamSync;
          if (sync.cursor !== current.eventCursor) throw new Error("Sync gap");
          if (sync.terminal) {
            if (!terminal(current.status))
              throw new Error("Invalid terminal sync");
            synchronized = true;
            setConnection("synced");
            active.close();
          } else setConnection("live");
        } catch {
          reset();
        }
      });
      active.addEventListener("reset", () => {
        if (!disposed && active === source) reset();
      });
      active.onerror = () => {
        if (disposed || active !== source || synchronized) return;
        setConnection("reconnecting");
        if (active.readyState === EventSource.CLOSED) {
          clearTimeout(timer);
          timer = setTimeout(connect, 2000);
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
        const response = await fetch(
          id
            ? "/api/runs/" + encodeURIComponent(id)
            : "/api/runs?page=" + page + "&pageSize=10",
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? "Không tải được tiến độ.");
        if (disposed) return;
        if (id) {
          current = body as WorkflowRun;
          setRun(current);
          connect();
        } else setList(body);
      } catch (error) {
        if (!disposed)
          setError(
            error instanceof Error ? error.message : "Không tải được tiến độ.",
          );
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
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [id, page, revision]);
  return (
    <div className="runs-dashboard">
      <div className="page-heading">
        <div>
          <h1>{id ? "Tiến độ tạo bản tin" : "Hoạt động"}</h1>
          <p>
            {id
              ? "Theo dõi từng bước khi bản tin được tạo."
              : "Lịch sử xử lý bản tin trên máy này."}
          </p>
        </div>
      </div>
      <div className="digest-toolbar">
        <a href="#/digests" className="text-link">
          Bản tin
        </a>
        {id && <a href="#/runs">Tất cả workflow</a>}
        {(!id || error || connection === "reconnecting") && (
          <button
            onClick={() => setRevision((value) => value + 1)}
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
          <p className={"stream-connection " + connection} role="status">
            {connection === "connecting"
              ? "Đang kết nối…"
              : connection === "live"
                ? "Trực tiếp"
                : connection === "reconnecting"
                  ? "Đang kết nối lại…"
                  : "Đã đồng bộ sự kiện mới nhất"}
          </p>
          <div className="digest-meta">
            <strong className={"result-badge " + run.status}>
              {labels[run.status]}
            </strong>
            <span>{run.workflowVersion}</span>
            <details>
              <summary>Thông tin lần chạy</summary>
              <small>ID: {run.id}</small>
            </details>
            <small>
              Tạo {date(run.createdAt)} · Bắt đầu {date(run.startedAt)} · Kết
              thúc {date(run.completedAt)}
            </small>
          </div>
          {run.status === "completed" && (
            <p className="status success">
              Đã xử lý xong. Mở bản tin để xem nội dung và tình trạng từng
              nguồn.
            </p>
          )}
          {run.error && <p className="status error">{run.error.message}</p>}
          {run.digestId && (
            <a className="open-digest" href={"#/digests/" + run.digestId}>
              Mở bản tin đã lưu
            </a>
          )}
          <details className="run-timeline" aria-label="Timeline sự kiện">
            <summary>Nhật ký xử lý trực tiếp</summary>
            <p className="muted">
              Tối đa 100 sự kiện gần nhất. Lịch sử trong PostgreSQL có thể được
              dọn theo chính sách lưu trữ; trạng thái workflow vẫn được giữ.
            </p>
            {run.eventsTruncated && (
              <p className="muted">Đang hiển thị phần cuối lịch sử sự kiện.</p>
            )}
            <div
              className="timeline-scroll"
              ref={timelineRef}
              onScroll={() => {
                const element = timelineRef.current;
                if (element)
                  nearEnd.current =
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                    64;
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
                <p>Chưa có sự kiện telemetry được lưu cho run này.</p>
              )}
            </div>
          </details>
          <ol className="run-nodes">
            {[...run.nodes]
              .sort((a, b) => order.indexOf(a.nodeId) - order.indexOf(b.nodeId))
              .map((node) => (
                <li key={node.nodeId}>
                  <div className="run-node-heading">
                    <div>
                      <strong>{titles[node.nodeId] ?? node.nodeId}</strong>
                    </div>
                    <span className={"result-badge " + node.status}>
                      {labels[node.status]}
                    </span>
                    <span>
                      {duration(node.startedAt, node.completedAt, elapsedNow)}
                    </span>
                  </div>
                  <details>
                    <summary>Chi tiết thực thi</summary>
                    <small>
                      {node.attempts} attempt · {node.recoveries} lần phục hồi ·{" "}
                      {node.retryCount} lần lên lịch thử lại
                      {node.workerId ? " · Worker " + node.workerId : ""}
                    </small>
                    {node.status === "queued" &&
                      node.retryCount > 0 &&
                      node.availableAt && (
                        <small>Được thử lại từ {date(node.availableAt)}</small>
                      )}
                    {node.leaseUntil && (
                      <small>Lease đến {date(node.leaseUntil)}</small>
                    )}
                  </details>
                  {node.error && (
                    <p
                      className={
                        node.status === "skipped" ? "muted" : "field-error"
                      }
                    >
                      {node.error.code}: {node.error.message}
                    </p>
                  )}
                </li>
              ))}
          </ol>
        </>
      )}
      {!id && list && !loading && (
        <>
          <ul className="digest-history">
            {list.items.map((item) => (
              <li key={item.id}>
                <a href={"#/runs/" + item.id}>
                  <strong>Workflow {date(item.createdAt)}</strong>
                  <small>{item.workflowVersion}</small>
                </a>
                <span className={"result-badge " + item.status}>
                  {labels[item.status]}
                </span>
              </li>
            ))}
          </ul>
          {list.items.length === 0 && (
            <p className="empty-state">
              Chưa có workflow. Vào bản tin đã lưu để tạo bản tin đầu tiên.
            </p>
          )}
          {(page > 1 || list.hasMore) && (
            <div className="pagination">
              <button
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Trang trước
              </button>
              <span>Trang {page}</span>
              <button
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
