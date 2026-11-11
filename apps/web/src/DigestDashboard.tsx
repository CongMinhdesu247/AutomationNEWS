import { useEffect, useRef, useState } from "react";
import type {
  Digest,
  DigestSummary,
  RunAccepted,
  NotificationAttempt,
  SourceResult,
  Repository,
  RisingRepository,
} from "@hub/contracts";
const statusText: Record<string, string> = {
  success: "Thành công",
  partial: "Một phần",
  failed: "Thất bại",
  disabled: "Đã tắt",
  running: "Đang tạo",
  sending: "Đang gửi",
  unknown: "Chưa xác định",
};
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString("vi-VN") : "Chưa hoàn tất";
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(60000),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "Không đọc được phản hồi API. Giữ nguyên yêu cầu để thử lại.",
    );
  }
  if (!response.ok)
    throw new Error(body.error?.message ?? "Không xử lý được yêu cầu.");
  return body as T;
}
function SourceHeader({
  title,
  result,
}: {
  title: string;
  result: SourceResult<unknown>;
}) {
  return (
    <>
      <div className="digest-section-heading">
        <h2>{title}</h2>
        <span className={"result-badge " + result.status}>
          {statusText[result.status]}
        </span>
      </div>
      <p className="muted">Lấy dữ liệu: {when(result.fetchedAt)}</p>
      {result.status === "disabled" && (
        <p>Nguồn này đã tắt trong cấu hình lúc tạo bản tin.</p>
      )}
      {result.errors.length > 0 && (
        <ul className="source-errors">
          {result.errors.map((error, index) => (
            <li key={index}>
              {error.source ? error.source + ": " : ""}
              {error.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
function Repositories({
  items,
  rising = false,
}: {
  items: (Repository | RisingRepository)[];
  rising?: boolean;
}) {
  return (
    <ul className="digest-items">
      {items.map((repo) => (
        <li key={repo.id}>
          <a href={repo.url} target="_blank" rel="noreferrer">
            {repo.name}
          </a>
          <p>{repo.description ?? "Không có mô tả."}</p>
          <small>
            {repo.language ?? "Chưa xác định ngôn ngữ"} ·{" "}
            {repo.stars.toLocaleString("vi-VN")} sao tổng · Snapshot{" "}
            {when(repo.fetchedAt)}
          </small>
          {rising && "starChange" in repo && (
            <p className="growth">
              {repo.starChange > 0 ? "+" : ""}
              {repo.starChange} sao trong {repo.intervalHours.toFixed(2)} giờ;
              nền {when(repo.baselineAt)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
export default function DigestDashboard({ hash }: { hash: string }) {
  const id = hash.startsWith("#/digests/")
    ? hash.slice("#/digests/".length)
    : null;
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{
    items: DigestSummary[];
    hasMore: boolean;
  } | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const busy = useRef(false);
  const sendBusy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDigest(null);
    (id
      ? request<Digest>("/api/digests/" + encodeURIComponent(id), {
          signal: controller.signal,
        }).then(setDigest)
      : request<{ items: DigestSummary[]; hasMore: boolean }>(
          "/api/digests?page=" + page + "&pageSize=10",
          { signal: controller.signal },
        ).then(setList)
    )
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Không tải được bản tin.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, page, reload]);
  async function create() {
    if (busy.current) return;
    busy.current = true;
    setCreating(true);
    setError("");
    setNotice("Đang lưu yêu cầu workflow. Chỉ cấu hình đã lưu được sử dụng.");
    let key = sessionStorage.getItem("hub-create-key");
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem("hub-create-key", key);
    }
    try {
      const result = await request<RunAccepted>("/api/digests", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
      sessionStorage.removeItem("hub-create-key");
      window.location.hash = "/runs/" + result.runId;
      setNotice("Yêu cầu đã được lưu bền vững. Worker sẽ tạo bản tin.");
      setReload((v) => v + 1);
    } catch (error) {
      setError((error as Error).message);
      setNotice("Lần bấm tiếp theo dùng lại cùng yêu cầu để tránh tạo trùng.");
    } finally {
      busy.current = false;
      setCreating(false);
    }
  }
  async function send() {
    if (!digest || sendBusy.current) return;
    sendBusy.current = true;
    setSending(true);
    setError("");
    setNotice("");
    const storage = "hub-notification-key-" + digest.id;
    let key = sessionStorage.getItem(storage);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(storage, key);
    }
    try {
      const attempt = await request<NotificationAttempt>(
        "/api/digests/" + digest.id + "/notifications",
        { method: "POST", headers: { "Idempotency-Key": key } },
      );
      sessionStorage.removeItem(storage);
      setNotice(
        attempt.status === "success"
          ? "Đã gửi thông báo qua ntfy."
          : attempt.status === "sending"
            ? "Lần gửi này đang xử lý hoặc đã gián đoạn; không tự gửi lại."
            : attempt.status === "unknown"
              ? "Chưa xác định ntfy đã nhận hay chưa. Gửi lại có thể tạo thông báo trùng."
              : (attempt.error?.message ?? "Gửi thông báo thất bại."),
      );
      setReload((v) => v + 1);
    } catch (error) {
      setError((error as Error).message);
      setNotice(
        "Giữ cùng yêu cầu cho lần bấm tiếp theo. Khi ntfy đã nhận nhưng kết nối bị mất, không thể đảm bảo exactly-once.",
      );
    } finally {
      sendBusy.current = false;
      setSending(false);
    }
  }
  return (
    <div className="digests-dashboard">
      <div className="page-heading">
        <div>
          <p className="breadcrumb">Personal Automation Hub / Bản tin</p>
          <h1>{id ? "Bản tin của bạn" : "Một nơi cho buổi sáng của bạn."}</h1>
          <p>
            Tạo theo cấu hình đã lưu. Xem lịch tự động tại Lịch & tác vụ lỗi.
          </p>
        </div>
        <span className="phase-badge">Bản tin · Chạy nền</span>
      </div>
      <div className="digest-toolbar">
        <a href="#newsletter" className="settings-link">
          Chỉnh cấu hình nguồn
        </a>
        <button
          className="primary-button"
          disabled={creating}
          onClick={() => void create()}
        >
          {creating ? "Đang tạo bản tin…" : "Tạo bản tin ngay"}
        </button>
      </div>
      {notice && (
        <div className="status" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="status error" role="alert">
          {error}
        </div>
      )}
      <div className="digest-toolbar">
        {id && <a href="#/digests">Tất cả bản tin</a>}
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => setReload((v) => v + 1)}
        >
          Tải lại bản tin
        </button>
      </div>
      {loading && <p role="status">Đang tải bản tin…</p>}
      {!id && !loading && list && (
        <>
          <h2>Bản tin đã lưu</h2>
          {list.items.length === 0 ? (
            <div className="empty-state">
              <strong>Chưa có bản tin nào</strong>
              <p>
                Bật ít nhất một nguồn trong cài đặt, lưu rồi bấm tạo bản tin.
              </p>
            </div>
          ) : (
            <ul className="digest-history">
              {list.items.map((item) => (
                <li key={item.id}>
                  <a href={"#/digests/" + item.id}>
                    <strong>Bản tin {when(item.createdAt)}</strong>
                    <small>{item.id}</small>
                  </a>
                  <span className={"result-badge " + item.status}>
                    {statusText[item.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
              Trang trước
            </button>
            <span>Trang {page}</span>
            <button
              disabled={!list.hasMore}
              onClick={() => setPage((v) => v + 1)}
            >
              Trang sau
            </button>
          </div>
        </>
      )}
      {digest && !loading && (
        <>
          <div className="digest-meta">
            <span className={"result-badge " + digest.status}>
              {statusText[digest.status]}
            </span>
            <span>
              Tạo: {when(digest.createdAt)} · Hoàn tất:{" "}
              {when(digest.completedAt)}
            </span>
            <small>
              ID: {digest.id} · Múi giờ: {digest.settings.newsletter.timezone}
            </small>
          </div>
          {digest.status === "running" && (
            <div className="notice">
              Bản tin chưa hoàn tất. Nếu API đã restart khi đang tạo, yêu cầu
              này sẽ không tự tiếp tục. Có thể chủ động tạo bản tin mới.
            </div>
          )}
          {digest.sources && (
            <>
              <section className="digest-section">
                <SourceHeader title="Tin tức" result={digest.sources.rss} />
                {digest.sources.rss.data.items.length > 0 ? (
                  <ul className="digest-items">
                    {digest.sources.rss.data.items.map((item) => (
                      <li key={item.url}>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.title}
                        </a>
                        <small>
                          {item.source} · {when(item.publishedAt)}
                        </small>
                        <p>{item.description}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  digest.sources.rss.status !== "disabled" && (
                    <p>Không có bài hợp lệ trong 24 giờ gần nhất.</p>
                  )
                )}
                <small>
                  Bỏ qua {digest.sources.rss.data.skippedInvalidDate} bài thiếu
                  ngày hợp lệ và {digest.sources.rss.data.skippedInvalidItem}{" "}
                  bài thiếu thông tin. Đọc được{" "}
                  {digest.sources.rss.data.feedsSucceeded}/
                  {digest.sources.rss.data.feedsTotal} nguồn.
                </small>
              </section>
              <section className="digest-section">
                <SourceHeader
                  title="Thời tiết"
                  result={digest.sources.weather}
                />
                {digest.sources.weather.data ? (
                  <>
                    <h3>
                      {digest.sources.weather.data.location} ·{" "}
                      {digest.sources.weather.data.date}
                    </h3>
                    <p>{digest.sources.weather.data.description}</p>
                    <div className="weather-facts">
                      <p>
                        Thấp nhất
                        <strong>
                          {digest.sources.weather.data.minTemperature ??
                            "Chưa có"}
                          {digest.sources.weather.data.minTemperature !== null
                            ? " °C"
                            : ""}
                        </strong>
                      </p>
                      <p>
                        Cao nhất
                        <strong>
                          {digest.sources.weather.data.maxTemperature ??
                            "Chưa có"}
                          {digest.sources.weather.data.maxTemperature !== null
                            ? " °C"
                            : ""}
                        </strong>
                      </p>
                      <p>
                        Xác suất mưa
                        <strong>
                          {digest.sources.weather.data.rainProbability ??
                            "Chưa có"}
                          {digest.sources.weather.data.rainProbability !== null
                            ? "%"
                            : ""}
                        </strong>
                      </p>
                    </div>
                    {digest.sources.weather.data.umbrella && (
                      <p className="umbrella">Nên mang ô hôm nay.</p>
                    )}
                    <p className="attribution">
                      <a
                        href={digest.sources.weather.data.attribution.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {digest.sources.weather.data.attribution.name}
                      </a>{" "}
                      <a
                        href={
                          digest.sources.weather.data.attribution.licenseUrl
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Giấy phép
                      </a>
                    </p>
                  </>
                ) : (
                  digest.sources.weather.status !== "disabled" && (
                    <p>Chưa có dữ liệu thời tiết.</p>
                  )
                )}
              </section>
              <section className="digest-section">
                <SourceHeader title="GitHub" result={digest.sources.github} />
                <p className="muted">
                  Repository nổi bật trong tập theo dõi; không phải GitHub
                  Trending chính thức.
                </p>
                {digest.sources.github.status !== "disabled" && (
                  <>
                    <h3>Tăng sao theo snapshot</h3>
                    {digest.sources.github.data.rising.length ? (
                      <Repositories
                        items={digest.sources.github.data.rising}
                        rising
                      />
                    ) : (
                      <p>
                        Chưa đủ lịch sử so sánh 20–28 giờ để tính tăng sao.
                        Không gán mức tăng giả.
                      </p>
                    )}
                    <h3>Dự án mới đáng chú ý</h3>
                    {digest.sources.github.data.newNotable.length ? (
                      <Repositories
                        items={digest.sources.github.data.newNotable}
                      />
                    ) : (
                      <p>
                        Không có dự án mới phù hợp chưa có baseline trong tập
                        kết quả.
                      </p>
                    )}
                    <small>
                      {digest.sources.github.data.candidates} ứng viên;{" "}
                      {digest.sources.github.data.withoutBaseline} chưa có
                      baseline hợp lệ. Danh sách có thể ít hơn số lượng yêu cầu.
                    </small>
                    {digest.sources.github.data.rateLimits.length > 0 && (
                      <details>
                        <summary>Quota GitHub Search/REST</summary>
                        <ul>
                          {digest.sources.github.data.rateLimits.map(
                            (limit, index) => (
                              <li key={index}>
                                {limit.resource}: còn{" "}
                                {limit.remaining ?? "không rõ"}, reset{" "}
                                {when(limit.resetAt)}
                              </li>
                            ),
                          )}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </section>
            </>
          )}
          <section className="digest-section">
            <h2>Gửi thông báo</h2>
            <p className="muted">
              Dùng server và topic ntfy đang được lưu trong cài đặt. Mỗi lần gửi
              mới được ghi nhận riêng; không tự gửi sau khi tạo.
            </p>
            <button
              className="primary-button"
              disabled={sending || digest.status === "running"}
              onClick={() => void send()}
            >
              {sending ? "Đang gửi…" : "Gửi qua ntfy"}
            </button>
            {digest.notifications.length === 0 ? (
              <p>Chưa có lần gửi nào.</p>
            ) : (
              <ul className="notification-history">
                {digest.notifications.map((attempt) => (
                  <li key={attempt.id}>
                    <strong>{statusText[attempt.status]}</strong> ·{" "}
                    {when(attempt.createdAt)}
                    {attempt.error && <p>{attempt.error.message}</p>}
                    {["sending", "unknown"].includes(attempt.status) && (
                      <p>
                        Kết quả có thể chưa xác định. Một lần gửi mới có thể tạo
                        thông báo trùng.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
