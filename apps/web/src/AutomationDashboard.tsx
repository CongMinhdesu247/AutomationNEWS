import { useEffect, useState } from "react";
import type { SourceError } from "@hub/contracts";
import { Icon } from "./Icons";
import { apiRequest } from "./lib/api-client";
import { ExternalLink } from "./components/ExternalLink";

type DeadLetter = {
  id: string;
  runId: string;
  nodeId: string;
  error: SourceError;
  createdAt: string;
  replayRunId: string | null;
};

type Schedule = {
  nextRunAt: string | null;
  lastCheckedAt: string | null;
  lastRunId: string | null;
  configuration: { active: boolean; timezone: string; sendTime: string } | null;
  deliveries: {
    id: string;
    digestId: string;
    status: string;
    createdAt: string;
    error: SourceError | null;
  }[];
};

const when = (value: string | null) =>
  value ? new Date(value).toLocaleString("vi-VN") : "Chưa có";

const deliveryLabels: Record<string, string> = {
  pending: "Chờ gửi",
  sending: "Đang gửi",
  success: "Đã gửi",
  failed: "Gửi lỗi",
  unknown: "Chưa rõ kết quả",
};

const nodeLabels: Record<string, string> = {
  start: "Khởi tạo quy trình",
  fetch_rss: "Lấy tin RSS",
  fetch_weather: "Lấy thời tiết",
  fetch_github: "Lấy dự án GitHub",
  fetch_fuel: "Lấy giá xăng",
  fetch_air_quality: "Lấy chất lượng không khí",
  fetch_gold: "Lấy giá vàng SJC",
  fetch_usd: "Lấy tỷ giá USD/VND",
  fetch_uv: "Lấy chỉ số UV",
  fetch_holidays: "Tính ngày lễ sắp tới",
  fetch_tasks: "Tổng hợp việc cần làm",
  compose_digest: "Gộp bản tin",
  persist_digest: "Lưu bản tin",
  premium_task: "Tác vụ theo dõi tùy chỉnh",
};

export default function AutomationDashboard() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [letters, setLetters] = useState<{
    items: DeadLetter[];
    hasMore: boolean;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const cloudWorkflowUrl = (
    import.meta.env.VITE_CLOUD_WORKFLOW_URL ?? ""
  ).trim();

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setLoading(true);
    setError("");
    void Promise.all([
      apiRequest<Schedule>("/api/schedule", {
        signal: controller.signal,
        timeoutMs: 10000,
      }),
      apiRequest<{ items: DeadLetter[]; hasMore: boolean }>(
        "/api/dead-letters?page=" + page + "&pageSize=10",
        { signal: controller.signal, timeoutMs: 10000 },
      ),
    ])
      .then(([sched, dlq]) => {
        if (!disposed) {
          setSchedule(sched);
          setLetters(dlq);
        }
      })
      .catch((cause) => {
        if (!disposed) {
          setError(
            cause instanceof Error ? cause.message : "Không tải được dữ liệu.",
          );
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [page, revision]);

  async function replay(id: string) {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      const result = await apiRequest<{ runId: string }>(
        "/api/dead-letters/" + encodeURIComponent(id) + "/replay",
        { method: "POST", body: {}, timeoutMs: 15000 },
      );
      window.location.hash = "/runs/" + result.runId;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không tạo được run mới.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="runs-dashboard">
      <div className="page-heading">
        <div>
          <h1>Lịch gửi bản tin</h1>
          <p>Phân biệt lịch trên GitHub Cloud và lịch chạy trên máy của bạn.</p>
        </div>
      </div>
      <div className="digest-toolbar">
        <a href="#/settings/newsletter" className="text-link">
          Cài đặt lịch trên máy
        </a>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Cập nhật trạng thái
        </button>
      </div>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải…</p>}
      <section className="cloud-panel">
        <div className="cloud-symbol">
          <Icon name="calendar" size={26} />
        </div>
        <div>
          <h2>Nhận bản tin khi PC tắt</h2>
          <p>
            Lịch cloud chạy trên GitHub Actions và kiểm tra hồ sơ gia đình mỗi
            30 phút. Quản lý giờ, ngày nhận và người nhận trong mục Gia đình.
          </p>
          <p>
            <a className="text-link" href="#/family">
              Quản lý lịch của gia đình <Icon name="arrow" size={16} />
            </a>
          </p>
          {cloudWorkflowUrl ? (
            <ExternalLink className="text-link" href={cloudWorkflowUrl}>
              Xem lịch và lần chạy trên GitHub <Icon name="arrow" size={17} />
            </ExternalLink>
          ) : (
            <small className="muted">
              Đặt biến <code>VITE_CLOUD_WORKFLOW_URL</code> nếu muốn hiện liên
              kết trực tiếp tới trang GitHub Actions của kho mã nguồn.
            </small>
          )}
        </div>
      </section>
      {schedule && (
        <section className="automation-section">
          <div className="section-heading">
            <h2>Lịch trên máy này</h2>
            <span
              className={
                "result-badge " +
                (schedule.configuration?.active ? "success" : "disabled")
              }
            >
              {schedule.configuration?.active ? "Đang bật" : "Đang tắt"}
            </span>
          </div>
          <p>
            Lần kế tiếp: <strong>{when(schedule.nextRunAt)}</strong> (giờ trình
            duyệt).
          </p>
          <p>
            Giờ đã cấu hình:{" "}
            {schedule.configuration
              ? `${schedule.configuration.sendTime} · ${schedule.configuration.timezone} · ${schedule.configuration.active ? "Đang bật" : "Tắt hoặc chưa có nguồn"}`
              : "Chưa khởi tạo"}
            .
          </p>
          <details>
            <summary>Trạng thái bộ lập lịch</summary>
            <p>
              Scheduler kiểm tra gần nhất: {when(schedule.lastCheckedAt)}.{" "}
              {schedule.lastRunId && (
                <a href={"#/runs/" + schedule.lastRunId} className="text-link">
                  Xem lần chạy theo lịch gần nhất
                </a>
              )}
            </p>
          </details>
          <p className="help-note">
            Lịch cục bộ cần máy chủ đang hoạt động. Nếu đã dùng lịch cloud, giữ
            lịch này tắt để tránh nhận trùng.
          </p>
          <h3>Lịch sử gửi từ máy</h3>
          {!schedule.deliveries.length && <p>Chưa có lượt gửi tự động.</p>}
          <ul className="digest-history">
            {schedule.deliveries.map((item) => (
              <li key={item.id}>
                <div>
                  <a href={"#/digests/" + item.digestId}>
                    <strong>Bản tin {when(item.createdAt)}</strong>
                  </a>
                  <p>{deliveryLabels[item.status] ?? item.status}</p>
                  {item.error && (
                    <p className="field-error">{item.error.message}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="muted">
            Lượt gửi bị gián đoạn không tự gửi lại. Mở bản tin, kiểm tra điện
            thoại rồi dùng nút gửi thủ công nếu cần.
          </p>
        </section>
      )}
      <details className="automation-section advanced-section" open={Boolean(letters?.items.length)}>
        <summary>
          Tác vụ cần xử lý
          {letters
            ? " (" + letters.items.length + (letters.hasMore ? "+" : "") + ")"
            : ""}
        </summary>
        <p>
          Chạy lại tạo toàn bộ quy trình mới bằng cấu hình đã chụp, giữ nguyên
          bản tin và lịch sử cũ. Lần chạy lại này không tự gửi ntfy. Bấm lặp lại
          trên cùng mục trả về cùng lần chạy mới.
        </p>
        {letters && !loading && (
          <>
            <ul className="digest-history">
              {letters.items.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>
                      {nodeLabels[item.nodeId]
                        ? `${nodeLabels[item.nodeId]} (${item.nodeId})`
                        : item.nodeId}
                    </strong>
                    <p>
                      {item.error.code}: {item.error.message}
                    </p>
                    <small>{when(item.createdAt)}</small>
                    <p>
                      <a href={"#/runs/" + item.runId} className="text-link">
                        Xem lần chạy gốc
                      </a>
                    </p>
                    {item.replayRunId ? (
                      <a
                        href={"#/runs/" + item.replayRunId}
                        className="text-link"
                      >
                        Xem lần chạy lại
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void replay(item.id)}
                      >
                        {busy === item.id ? "Đang tạo…" : "Tạo run chạy lại"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {!letters.items.length && <p>Chưa có tác vụ lỗi.</p>}
            {(page > 1 || letters.hasMore) && (
              <div className="pagination">
                <button
                  type="button"
                  disabled={page === 1 || busy !== null}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Trang trước
                </button>
                <span>Trang {page}</span>
                <button
                  type="button"
                  disabled={!letters.hasMore || busy !== null}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Trang sau
                </button>
              </div>
            )}
          </>
        )}
      </details>
    </div>
  );
}
