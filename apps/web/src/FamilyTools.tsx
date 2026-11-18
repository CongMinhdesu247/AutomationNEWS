import { useEffect, useRef, useState } from "react";
import {
  nextFamilySend,
  priceFreshness,
  type FamilyConfig,
  type FamilyHealth,
  type FamilyProfile,
} from "@hub/contracts";
import { decryptFamilyBackup, encryptFamilyBackup } from "./family-backup";
import { apiRequest } from "./lib/api-client";

const when = (value: string) =>
  new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

const sourceNames: Record<string, string> = {
  gold: "Vàng SJC",
  usd: "USD/VND",
  airQuality: "AQI (dự báo)",
  weather: "Thời tiết",
  fuel: "Xăng",
  github: "GitHub",
  rss: "Tin tức",
  uv: "Chỉ số UV",
  holidays: "Ngày lễ & kỷ niệm",
  tasks: "Việc cần làm",
};

export function DeliveryPanel({ profile }: { profile: FamilyProfile }) {
  const [health, setHealth] = useState<FamilyHealth | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      if (document.hidden) return;
      try {
        const data = await apiRequest<FamilyHealth>("/api/family/status", {
          signal: controller.signal,
          timeoutMs: 15000,
        });
        if (active) {
          setHealth(data);
          setError("");
        }
      } catch (e) {
        if (active && !controller.signal.aborted) {
          setError((e as Error).message);
        }
      }
    }

    void load();
    const timer = setInterval(() => void load(), 60000);
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const record = health?.profiles.find((p) => p.id === profile.id);
  const latest = record?.deliveries[0];
  const next = nextFamilySend(profile);
  const local = new Date(Date.now() + 7 * 3600000);
  const today = local.toISOString().slice(0, 10);
  const [hour, minute] = profile.sendTime.split(":").map(Number);
  const dueToday =
    profile.enabled &&
    profile.days.includes(local.getUTCDay() || 7) &&
    local.getUTCHours() * 60 + local.getUTCMinutes() >= hour! * 60 + minute!;
  const hasToday = record?.deliveries.some(
    (d) => d.key.startsWith(today) && !d.key.includes(":alert:"),
  );

  return (
    <section className="family-delivery" aria-label="Trạng thái gửi">
      <div className="family-editor-heading">
        <h3>Trạng thái cloud</h3>
        <button type="button" onClick={() => setRefresh((r) => r + 1)}>
          Làm mới
        </button>
      </div>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {!health && !error && <p role="status">Đang đọc trạng thái…</p>}
      {health && !error && dueToday && !hasToday && (
        <p className="status error">
          Hôm nay đã đến giờ nhận nhưng chưa có lượt gửi được ghi nhận. Cloud có
          thể đang chờ hoặc gặp lỗi; hãy kiểm tra trước khi gửi lại.
        </p>
      )}
      {latest ? (
        <>
          <p>
            <strong>
              {
                {
                  sent: "Máy chủ gửi thành công",
                  reserved: "Đã giữ lượt gửi · chưa xác nhận kết quả",
                  failed: "Máy chủ gửi thất bại",
                  unknown: "Chưa xác định kết quả gửi",
                }[latest.status]
              }
            </strong>{" "}
            · {when(latest.at)}
            {latest.key.includes(":alert:")
              ? " · Cảnh báo biến động"
              : " · Bản tin định kỳ"}
          </p>
          <ul className="family-source-health">
            {latest.sources?.map((s) => (
              <li key={s.key}>
                <strong>{sourceNames[s.key] ?? s.key}</strong>
                <span>
                  {s.status === "failed"
                    ? "Chưa lấy được dữ liệu"
                    : s.status === "partial"
                      ? "Dữ liệu một phần"
                      : "Đã thu thập"}
                </span>
                {s.updatedAt && (
                  <small>
                    {s.key === "gold" || s.key === "usd"
                      ? priceFreshness(s.updatedAt)
                      : "Thời điểm nguồn: " + when(s.updatedAt)}
                  </small>
                )}
              </li>
            ))}
          </ul>
          {(latest.status === "reserved" || latest.status === "unknown") && (
            <p className="muted">
              Hãy kiểm tra ntfy trước khi gửi lại để tránh trùng thông báo.
            </p>
          )}
          <details>
            <summary>Lịch sử gần đây</summary>
            <ul>
              {record?.deliveries.map((d) => (
                <li key={d.key}>
                  {when(d.at)} ·{" "}
                  {d.status === "sent"
                    ? "Máy chủ đã gửi"
                    : d.status === "failed"
                      ? "Gửi thất bại"
                      : "Chưa xác nhận"}
                  {d.key.includes(":alert:") ? " · Cảnh báo" : " · Bản tin"}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : health && !error ? (
        <p>Chưa có lượt gửi được ghi nhận cho hồ sơ này.</p>
      ) : null}
      <p>
        Lịch tiếp theo: <strong>{next ? when(next) : "Đang tạm dừng"}</strong>
      </p>
      <p className="muted">
        Giờ dự kiến; GitHub có thể chạy muộn. Máy chủ gửi thành công chưa xác
        nhận điện thoại đã hiện banner.{" "}
        {health ? "Kiểm tra lúc " + when(health.checkedAt) : ""}
      </p>
    </section>
  );
}

export function FamilyBackup({
  config,
  onRestore,
  disabled,
  hasUnsavedChanges = false,
}: {
  config: FamilyConfig;
  onRestore: (config: FamilyConfig) => void;
  disabled: boolean;
  hasUnsavedChanges?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FamilyConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function run(restore: boolean) {
    setBusy(true);
    setMessage("");
    try {
      if (restore) {
        if (!file) throw new Error("Chọn tệp sao lưu trước.");
        if (file.size > 128000) throw new Error("Tệp sao lưu quá lớn.");
        setPreview(await decryptFamilyBackup(await file.text(), password));
        setPassword("");
      } else {
        const text = await encryptFamilyBackup(config, password);
        const url = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download =
          "hub-family-" +
          new Date().toISOString().slice(0, 10) +
          ".encrypted.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setPassword("");
        setMessage(
          "Đã xuất cấu hình hồ sơ được mã hóa. Giữ mật khẩu để khôi phục.",
        );
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const currentTopics = new Map(config.profiles.map((p) => [p.id, p.topic]));
  const topicWillChange = preview?.profiles.some(
    (p) => currentTopics.has(p.id) && currentTopics.get(p.id) !== p.topic,
  );

  return (
    <details className="family-tools">
      <summary>Sao lưu &amp; khôi phục hồ sơ</summary>
      <p>
        Gồm hồ sơ, topic, nội dung, ngưỡng và lịch nhận đã lưu. Không gồm token
        quản trị, liên kết cài đặt riêng hay lịch sử bản tin. Lưu mật khẩu ở nơi
        an toàn.
      </p>
      <fieldset disabled={disabled || busy}>
        <label>
          Mật khẩu sao lưu (ít nhất 10 ký tự)
          <input
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <div className="family-actions">
          <button type="button" onClick={() => void run(false)}>
            Tải bản sao lưu
          </button>
          <label>
            Tệp cần khôi phục
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
          </label>
          <button type="button" disabled={!file} onClick={() => void run(true)}>
            Mở &amp; xem trước
          </button>
        </div>
        {preview && (
          <div className="status">
            <p>Sẽ thay toàn bộ hồ sơ bằng {preview.profiles.length} hồ sơ:</p>
            <ul>
              {preview.profiles.map((p) => (
                <li key={p.id}>
                  {p.name} · {p.sendTime} ·{" "}
                  {p.enabled ? "Đang nhận" : "Tạm dừng"}
                </li>
              ))}
            </ul>
            {topicWillChange && (
              <p className="muted">
                Lưu ý: Một số hồ sơ trong bản sao lưu dùng topic ntfy khác hiện
                tại. Hãy kiểm tra topic sau khi nạp vào bản nháp.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                if (
                  hasUnsavedChanges &&
                  !window.confirm(
                    "Bạn đang có thay đổi chưa lưu. Ghi đè bản nháp bằng dữ liệu sao lưu?",
                  )
                ) {
                  return;
                }
                onRestore(preview);
                setPreview(null);
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
                setMessage(
                  "Đã đưa vào bản nháp. Kiểm tra rồi bấm Lưu & đồng bộ để áp dụng.",
                );
              }}
            >
              Đưa vào bản nháp
            </button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </fieldset>
    </details>
  );
}

function defaultMemberBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return "";
  }
  return `${window.location.protocol}//${host}:8089`;
}

export function MemberAccess({
  id,
  disabled,
}: {
  id: string;
  disabled: boolean;
}) {
  const [base, setBase] = useState(defaultMemberBaseUrl);
  const [path, setPath] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPath("");
    setMessage("");
    setExpiry("");
  }, [id]);

  async function action(revoke = false) {
    setBusy(true);
    setMessage("");
    try {
      const data = await apiRequest<{
        path?: string;
        expiresAt?: string;
        baseUrl?: string;
      }>("/api/family/" + encodeURIComponent(id) + "/access", {
        method: revoke ? "DELETE" : "POST",
        body: {},
        timeoutMs: 15000,
      });
      setPath(revoke ? "" : (data.path ?? ""));
      setExpiry(data.expiresAt ?? "");
      if (data.baseUrl) setBase(data.baseUrl);
      setMessage(
        revoke
          ? "Đã thu hồi liên kết cũ."
          : "Đã tạo liên kết mới; liên kết cũ đã hết hiệu lực.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const validBase = (() => {
    try {
      const url = new URL(base);
      return ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/"
        ? url.origin
        : "";
    } catch {
      return "";
    }
  })();

  return (
    <details className="family-tools">
      <summary>Liên kết cài đặt riêng trên điện thoại</summary>
      <p>
        Người có liên kết được đổi chủ đề, lịch và tạm dừng đúng hồ sơ này. Có
        hiệu lực 90 ngày; tạo lại sẽ hủy liên kết cũ.
      </p>
      <p className="muted">
        Dùng cùng Wi-Fi khi máy chủ đang bật. Cổng mặc định dành cho thành viên
        là 8089 (ví dụ http://192.168.1.10:8089). Không dùng localhost trên điện
        thoại.
      </p>
      <label>
        Địa chỉ máy chủ cho điện thoại
        <input
          type="url"
          placeholder="http://192.168.1.10:8089"
          value={base}
          onChange={(e) => setBase(e.target.value)}
        />
      </label>
      <div className="family-actions">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void action()}
        >
          Tạo / đổi liên kết
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void action(true)}
        >
          Thu hồi liên kết
        </button>
      </div>
      {path && validBase && (
        <>
          <label>
            Liên kết riêng
            <input readOnly value={validBase + path} />
          </label>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(validBase + path).then(
                () => setMessage("Đã sao chép liên kết riêng."),
                () => setMessage("Hãy sao chép trực tiếp trong ô liên kết."),
              )
            }
          >
            Sao chép liên kết
          </button>
        </>
      )}
      {path && !validBase && (
        <p>
          Nhập địa chỉ máy chủ hợp lệ ở trên để lấy liên kết mở được trên điện
          thoại.
        </p>
      )}
      {expiry && <p className="muted">Hết hạn: {when(expiry)}</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
