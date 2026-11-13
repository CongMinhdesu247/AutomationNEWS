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
import { Icon } from "./Icons";
import { goldPricePerChi, priceFreshness, priceLow30Text } from "@hub/contracts";
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
          <p>
            {repo.summaryVi ||
              (repo.description?.trim()
                ? "Chưa có bản dịch tiếng Việt cho mô tả này."
                : "Tác giả chưa cung cấp mô tả cho dự án này.")}
          </p>
          {repo.summaryViStatus === "translated" && (
            <small>Bản dịch tự động từ mô tả của tác giả</small>
          )}
          {repo.description && repo.description !== repo.summaryVi && (
            <details>
              <summary>Mô tả gốc</summary>
              <p lang="und">{repo.description}</p>
            </details>
          )}
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
  const [latest, setLatest] = useState<Digest | null>(null);
  const latestId = !id && page === 1 ? list?.items[0]?.id : undefined;
  useEffect(() => {
    if (!latestId) {
      setLatest(null);
      return;
    }
    const controller = new AbortController();
    void request<Digest>("/api/digests/" + latestId, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setLatest(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLatest(null);
      });
    return () => controller.abort();
  }, [latestId]);
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
          {id && (
            <a className="back-link" href="#/digests">
              ‹ Tất cả bản tin
            </a>
          )}
          <h1>
            {id ? "Bản tin của bạn" : "Buổi sáng, gọn trong một bản tin."}
          </h1>
          <p>
            {id
              ? "Tin tức, thời tiết và những dự án đáng chú ý."
              : "Đọc lại nội dung đã lưu hoặc tạo bản tin mới từ nguồn của bạn."}
          </p>
        </div>
        {id ? (
          <button
            className="primary-button"
            disabled={sending || !digest || digest.status === "running"}
            onClick={() => void send()}
          >
            <Icon name="send" size={17} />
            {sending ? "Đang gửi…" : "Gửi đến điện thoại"}
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={creating}
            onClick={() => void create()}
          >
            <span aria-hidden="true">+</span>{" "}
            {creating ? "Đang tạo…" : "Tạo bản tin"}
          </button>
        )}
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
      {error && (
        <div className="digest-toolbar">
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => setReload((v) => v + 1)}
          >
            Thử tải lại
          </button>
        </div>
      )}
      {loading && <p role="status">Đang tải bản tin…</p>}
      {!id && !loading && list && (
        <>
          {latest?.sources && (
            <section className="latest-brief">
              <div className="brief-heading">
                <div>
                  <span className="section-kicker">Gần nhất trên máy</span>
                  <h2>
                    {new Date(latest.createdAt).toLocaleDateString("vi-VN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </h2>
                </div>
                <a href={"#/digests/" + latest.id} className="text-link">
                  Đọc bản tin <Icon name="arrow" size={17} />
                </a>
              </div>
              <div className="brief-overview">
                <div className="brief-weather">
                  <Icon name="sun" size={34} />
                  <p>{latest.sources.weather.data?.location || "Thời tiết"}</p>
                  <strong>
                    {latest.sources.weather.data
                      ? `${latest.sources.weather.data.minTemperature ?? "—"}–${latest.sources.weather.data.maxTemperature ?? "—"}°`
                      : "Chưa có dữ liệu"}
                  </strong>
                  <p>
                    {latest.sources.weather.data?.description ||
                      "Bật nguồn thời tiết trong cài đặt."}
                  </p>
                  {latest.sources.weather.data?.rainProbability != null && (
                    <small>
                      Khả năng mưa {latest.sources.weather.data.rainProbability}
                      %
                    </small>
                  )}
                </div>
                <div className="brief-highlights">
                  <h3>Dự án đáng chú ý</h3>
                  <ul>
                    {[
                      ...latest.sources.github.data.rising,
                      ...latest.sources.github.data.newNotable,
                    ]
                      .slice(0, 3)
                      .map((repo) => (
                        <li key={repo.id}>
                          <strong>{repo.name}</strong>
                          <p>
                            {repo.summaryVi || "Chưa có bản dịch tiếng Việt."}
                          </p>
                        </li>
                      ))}
                  </ul>
                  {latest.sources.github.data.rising.length +
                    latest.sources.github.data.newNotable.length ===
                    0 && (
                    <p className="muted">
                      Chưa có dự án GitHub trong bản tin này.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}
          <div className="section-heading">
            <h2>Lịch sử bản tin</h2>
            <a href="#/settings/rss" className="text-link">
              Quản lý nguồn
            </a>
          </div>
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
                    <small>
                      {item.completedAt
                        ? "Đã lưu đầy đủ nội dung"
                        : "Đang thu thập nội dung"}
                    </small>
                  </a>
                  <span className={"result-badge " + item.status}>
                    {statusText[item.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(page > 1 || list.hasMore) && (
            <div className="pagination">
              <button
                disabled={page === 1}
                onClick={() => setPage((v) => v - 1)}
              >
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
          )}
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
            <details>
              <summary>Thông tin bản tin</summary>
              <small>
                ID: {digest.id}
                <br />
                Múi giờ: {digest.settings.newsletter.timezone}
              </small>
            </details>
          </div>
          {digest.status === "running" && (
            <div className="notice">
              Bản tin chưa hoàn tất. Nếu API đã restart khi đang tạo, yêu cầu
              này sẽ không tự tiếp tục. Có thể chủ động tạo bản tin mới.
            </div>
          )}
          {digest.sources && (
            <>
              {digest.sources.gold &&
                digest.sources.gold.status !== "disabled" && (
                  <section className="digest-section">
                    <SourceHeader
                      title="Vàng miếng SJC & nhẫn SJC 9999"
                      result={digest.sources.gold}
                    />
                    {digest.sources.gold.data ? (
                      <>
                        <p>
                          {digest.sources.gold.data.region} · Đơn vị: đồng/chỉ
                        </p>
                        <ul className="digest-items">
                          {digest.sources.gold.data.items.map((item) => (
                            <li key={item.code}>
                              <strong>
                                {item.code === "sjc_bar"
                                  ? "Vàng miếng SJC"
                                  : "Nhẫn SJC 9999"}
                              </strong>
                              <div className="weather-facts">
                                <p>
                                  Mua vào
                                  <strong>
                                    {goldPricePerChi(
                                      item.buy,
                                      digest.sources!.gold!.data!.unit,
                                    ).toLocaleString("vi-VN")}
                                  </strong>
                                </p>
                                <p>
                                  Bán ra
                                  <strong>
                                    {goldPricePerChi(
                                      item.sell,
                                      digest.sources!.gold!.data!.unit,
                                    ).toLocaleString("vi-VN")}
                                  </strong>
                                </p>
                              </div>
                              <p>{priceLow30Text(item.low30)}</p>
                            </li>
                          ))}
                        </ul>
                        <p>
                          {priceFreshness(
                            digest.sources.gold.data.sourceUpdatedAt,
                          )}
                        </p>
                        <a
                          href={digest.sources.gold.data.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {digest.sources.gold.data.source}
                        </a>
                        <p className="muted">
                          Giá tham khảo theo bảng nguồn, không phải cam kết giá
                          giao dịch tại cửa hàng.
                        </p>
                      </>
                    ) : (
                      <p>
                        Chưa lấy được giá đã xác minh. Không sử dụng số 0 thay
                        cho giá thiếu.
                      </p>
                    )}
                  </section>
                )}
              {digest.sources.usd &&
                digest.sources.usd.status !== "disabled" && (
                  <section className="digest-section">
                    <SourceHeader
                      title="USD/VND · Vietcombank"
                      result={digest.sources.usd}
                    />
                    {digest.sources.usd.data ? (
                      <>
                        <p>
                          Đơn vị: đồng cho 1 USD. Mua/bán được hiểu từ phía ngân
                          hàng.
                        </p>
                        <div className="weather-facts">
                          <p>
                            Ngân hàng mua tiền mặt
                            <strong>
                              {digest.sources.usd.data.buyCash?.toLocaleString(
                                "vi-VN",
                              ) ?? "Chưa có"}
                            </strong>
                          </p>
                          <p>
                            Ngân hàng mua chuyển khoản
                            <strong>
                              {digest.sources.usd.data.buyTransfer?.toLocaleString(
                                "vi-VN",
                              ) ?? "Chưa có"}
                            </strong>
                          </p>
                          <p>
                            Ngân hàng bán
                            <strong>
                              {digest.sources.usd.data.sell?.toLocaleString(
                                "vi-VN",
                              ) ?? "Chưa có"}
                            </strong>
                            <span>{priceLow30Text(digest.sources.usd.data.low30)}</span>
                          </p>
                        </div>
                        <p>
                          {priceFreshness(
                            digest.sources.usd.data.sourceUpdatedAt,
                          )}
                        </p>
                        <a
                          href="https://www.vietcombank.com.vn/KHCN/Cong-cu-tien-ich/Ty-gia"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Nguồn Vietcombank · tỷ giá tham khảo
                        </a>
                      </>
                    ) : (
                      <p>Chưa lấy được tỷ giá đã xác minh.</p>
                    )}
                  </section>
                )}
              {digest.sources.airQuality &&
                digest.sources.airQuality.status !== "disabled" && (
                  <section className="digest-section">
                    <SourceHeader
                      title={
                        "Chất lượng không khí " +
                        (digest.sources.airQuality.data?.location ??
                          digest.settings.airQuality?.location ??
                          "Hà Nội")
                      }
                      result={digest.sources.airQuality}
                    />
                    {digest.sources.airQuality.data ? (
                      <>
                        <div className="weather-facts">
                          <p>
                            AQI theo thang Mỹ
                            <strong>
                              {digest.sources.airQuality.data.usAqi ??
                                "Chưa có"}
                            </strong>
                          </p>
                          <p>
                            Mức đánh giá
                            <strong>
                              {digest.sources.airQuality.data.category ??
                                "Chưa phân loại"}
                            </strong>
                          </p>
                          <p>
                            PM2.5
                            <strong>
                              {digest.sources.airQuality.data.pm25?.toLocaleString(
                                "vi-VN",
                                { maximumFractionDigits: 1 },
                              ) ?? "Chưa có"}
                              {digest.sources.airQuality.data.pm25 !== null
                                ? " µg/m³"
                                : ""}
                            </strong>
                          </p>
                        </div>
                        <p>
                          Thời điểm dự báo:{" "}
                          {when(digest.sources.airQuality.data.forecastAt)}
                        </p>
                        <p className="attribution">
                          <a
                            href={digest.sources.airQuality.data.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {digest.sources.airQuality.data.attribution}
                          </a>
                        </p>
                      </>
                    ) : (
                      <p>
                        Chưa lấy được dữ liệu mới. Các nội dung khác vẫn có
                        trong bản tin.
                      </p>
                    )}
                  </section>
                )}
              {digest.sources.fuel &&
                digest.sources.fuel.status !== "disabled" && (
                  <section className="digest-section">
                    <SourceHeader
                      title="Giá xăng RON 95"
                      result={digest.sources.fuel}
                    />
                    {digest.sources.fuel.data ? (
                      <>
                        <p>
                          {digest.sources.fuel.data.region} · Đơn vị: đồng/lít
                        </p>
                        <ul className="digest-items">
                          {digest.sources.fuel.data.items.map((item) => (
                            <li key={item.code}>
                              <strong>{item.name}</strong>
                              <p>{item.price.toLocaleString("vi-VN")} đ/lít</p>
                              <small>
                                {item.change === null
                                  ? "Chưa có giá trước để so sánh"
                                  : item.change === 0
                                    ? "Không đổi so với bản tin trước"
                                    : `${item.change > 0 ? "Tăng" : "Giảm"} ${Math.abs(item.change).toLocaleString("vi-VN")} đ/lít so với bản tin trước`}
                              </small>
                            </li>
                          ))}
                        </ul>
                        <p>
                          Hiệu lực từ:{" "}
                          {when(digest.sources.fuel.data.effectiveAt)}
                        </p>
                        {digest.sources.fuel.data.comparedAt && (
                          <p>
                            So với dữ liệu lấy lúc:{" "}
                            {when(digest.sources.fuel.data.comparedAt)}
                          </p>
                        )}
                        <a
                          href={digest.sources.fuel.data.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Nguồn: Petrolimex
                        </a>
                      </>
                    ) : (
                      <p>
                        Chưa lấy được bảng giá đã xác minh. Các nội dung khác
                        vẫn có trong bản tin.
                      </p>
                    )}
                  </section>
                )}
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
                <details>
                  <summary>Thông tin nguồn tin</summary>
                  <small>
                    Bỏ qua {digest.sources.rss.data.skippedInvalidDate} bài
                    thiếu ngày hợp lệ và{" "}
                    {digest.sources.rss.data.skippedInvalidItem} bài thiếu thông
                    tin. Đọc được {digest.sources.rss.data.feedsSucceeded}/
                    {digest.sources.rss.data.feedsTotal} nguồn.
                  </small>
                </details>
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
                {digest.sources.github.status !== "disabled" && (
                  <>
                    {digest.sources.github.data.rising.length ? (
                      <>
                        <h3>Đang được quan tâm</h3>
                        <Repositories
                          items={digest.sources.github.data.rising}
                          rising
                        />
                      </>
                    ) : null}
                    {digest.sources.github.data.newNotable.length ? (
                      <>
                        <h3>Dự án mới đáng chú ý</h3>
                        <Repositories
                          items={digest.sources.github.data.newNotable}
                        />
                      </>
                    ) : (
                      <p>
                        Không có dự án mới phù hợp chưa có baseline trong tập
                        kết quả.
                      </p>
                    )}
                    <details>
                      <summary>Phạm vi theo dõi</summary>
                      <small>
                        {digest.sources.github.data.candidates} ứng viên;{" "}
                        {digest.sources.github.data.withoutBaseline} chưa có
                        baseline hợp lệ. Danh sách có thể ít hơn số lượng yêu
                        cầu.
                      </small>
                      <p>
                        Danh sách trong tập theo dõi; không phải bảng GitHub
                        Trending chính thức.
                      </p>
                    </details>
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
          <details className="delivery-details">
            <summary>
              Lịch sử gửi đến điện thoại ({digest.notifications.length})
            </summary>
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
          </details>
        </>
      )}
    </div>
  );
}
