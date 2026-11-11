import { useEffect, useState } from "react";
import type { SourceError } from "@hub/contracts";

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
async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error?.message ?? "Không xử lý được yêu cầu.");
  return body as T;
}
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
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setLoading(true);
    setError("");
    void Promise.all([
      request<Schedule>("/api/schedule", { signal: controller.signal }),
      request<{ items: DeadLetter[]; hasMore: boolean }>(
        "/api/dead-letters?page=" + page + "&pageSize=10",
        { signal: controller.signal },
      ),
    ])
      .then(([schedule, letters]) => {
        if (!disposed) {
          setSchedule(schedule);
          setLetters(letters);
        }
      })
      .catch((cause) => {
        if (!disposed)
          setError(
            cause instanceof Error ? cause.message : "Không tải được dữ liệu.",
          );
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
      const result = await request<{ runId: string }>(
        "/api/dead-letters/" + id + "/replay",
        { method: "POST" },
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
          <p className="breadcrumb">Personal Automation Hub / Tự động hóa</p>
          <h1>Lịch & tác vụ lỗi</h1>
          <p>Lịch sáng, kết quả gửi tự động và các node đã hết lượt thử.</p>
        </div>
        <span className="phase-badge">Bước 4</span>
      </div>
      <div className="digest-toolbar">
        <a href="#newsletter">Chỉnh giờ gửi và nguồn</a>
        <button
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Tải lại
        </button>
      </div>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải…</p>}
      {schedule && (
        <section className="automation-section">
          <h2>Lịch bản tin mỗi ngày</h2>
          <p>
            Lần kế tiếp: <strong>{when(schedule.nextRunAt)}</strong> (giờ trình
            duyệt).
          </p>
          <p>
            Cấu hình scheduler đã đọc:{" "}
            {schedule.configuration
              ? `${schedule.configuration.sendTime} · ${schedule.configuration.timezone} · ${schedule.configuration.active ? "Đang bật" : "Tắt hoặc chưa có nguồn"}`
              : "Chưa khởi tạo"}
            .
          </p>
          <p>
            Scheduler kiểm tra gần nhất: {when(schedule.lastCheckedAt)}.{" "}
            {schedule.lastRunId && (
              <a href={"#/runs/" + schedule.lastRunId}>
                Xem run theo lịch gần nhất
              </a>
            )}
          </p>
          <p className="notice">
            Máy, worker và scheduler phải đang chạy. Bật bản tin và ít nhất một
            nguồn để lên lịch; bật ntfy để tự gửi sau khi lưu. Đổi giờ hoặc múi
            giờ sẽ áp dụng từ lượt kế tiếp. Trang này cập nhật khi bấm Tải lại.
          </p>
          <h3>20 lượt gửi tự động gần nhất</h3>
          {!schedule.deliveries.length && <p>Chưa có lượt gửi tự động.</p>}
          <ul className="digest-history">
            {schedule.deliveries.map((item) => (
              <li key={item.id}>
                <div>
                  <a href={"#/digests/" + item.digestId}>
                    Bản tin {when(item.createdAt)}
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
      <section className="automation-section">
        <h2>Dead-Letter Queue</h2>
        <p>
          Chạy lại tạo toàn bộ workflow mới bằng cấu hình snapshot cũ, giữ
          nguyên bản tin và lịch sử cũ. Run này không tự gửi ntfy. Bấm lặp lại
          trên cùng mục trả về cùng run mới.
        </p>
        {letters && !loading && (
          <>
            <ul className="digest-history">
              {letters.items.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.nodeId}</strong>
                    <p>
                      {item.error.code}: {item.error.message}
                    </p>
                    <small>{when(item.createdAt)}</small>
                    <p>
                      <a href={"#/runs/" + item.runId}>Xem run gốc</a>
                    </p>
                    {item.replayRunId ? (
                      <a href={"#/runs/" + item.replayRunId}>
                        Xem run chạy lại
                      </a>
                    ) : (
                      <button
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
            <div className="pagination">
              <button
                disabled={page === 1 || busy !== null}
                onClick={() => setPage((value) => value - 1)}
              >
                Trang trước
              </button>
              <span>Trang {page}</span>
              <button
                disabled={!letters.hasMore || busy !== null}
                onClick={() => setPage((value) => value + 1)}
              >
                Trang sau
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
