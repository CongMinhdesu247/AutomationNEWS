import { useEffect, useState } from "react";
import {
  familyCities,
  familyTopics,
  familyConfigSchema,
  type FamilyDocument,
  type FamilyConfig,
  type FamilyProfile,
} from "@hub/contracts";
import "./family.css";

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(45000),
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error?.message ?? "Chưa xử lý được yêu cầu.");
  return value;
}
const weekdays = [
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
  "Chủ nhật",
];
const times = Array.from(
  { length: 48 },
  (_, i) =>
    `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);
export default function FamilyDashboard() {
  const [document, setDocument] = useState<FamilyDocument | null>(null);
  const [draft, setDraft] = useState<FamilyConfig | null>(null);
  const [selected, setSelected] = useState("personal");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    api<FamilyDocument>("/api/family")
      .then((value) => {
        if (active) {
          setDocument(value);
          setDraft(value.config);
          setSelected(value.config.profiles[0]!.id);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const profile = draft?.profiles.find((p) => p.id === selected);
  const synced = document?.revision === document?.syncedRevision && !dirty;
  const change = (patch: Partial<FamilyProfile>) => {
    if (!draft || !profile) return;
    setDraft({
      ...draft,
      profiles: draft.profiles.map((p) =>
        p.id === profile.id ? { ...p, ...patch } : p,
      ),
    });
    setDirty(true);
    setNotice("");
    setError("");
  };
  async function save() {
    const parsed = familyConfigSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<FamilyDocument & { syncError?: string }>(
        "/api/family",
        "PUT",
        { config: parsed.data, revision: document!.revision },
      );
      setDocument(result);
      setDraft(result.config);
      setDirty(false);
      if (result.syncError) setError(result.syncError);
      else setNotice("Đã lưu và đồng bộ. Cloud sẽ dùng lịch mới dù PC tắt.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    setError("");
    try {
      const result = await api<FamilyDocument>("/api/family/sync", "POST", {});
      setDocument(result);
      setNotice("Đã đồng bộ cấu hình hiện tại lên cloud.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/api/family/" + encodeURIComponent(profile.id) + "/test",
        "POST",
        {},
      );
      setNotice(
        "Đã yêu cầu cloud gửi thử riêng hồ sơ này. Có thể cần vài phút; hãy khóa điện thoại để kiểm tra banner.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function add() {
    if (!draft || draft.profiles.length >= 8) return;
    const id = crypto.randomUUID();
    const next: FamilyProfile = {
      id,
      name: "Thành viên mới",
      enabled: false,
      city: "hanoi",
      newsTopics: [],
      sendTime: "07:00",
      days: [1, 2, 3, 4, 5, 6, 7],
      weather: true,
      airQuality: false,
      fuel: false,
      github: false,
      gold: false,
      usd: false,
      topic: "hub_" + crypto.randomUUID().replaceAll("-", ""),
    };
    setDraft({ ...draft, profiles: [...draft.profiles, next] });
    setSelected(id);
    setDirty(true);
    setNotice("");
  }
  return (
    <div className="family-page">
      <div className="page-heading">
        <div>
          <p className="family-eyebrow">DÀNH CHO GIA ĐÌNH</p>
          <h1>Mỗi người, một bản tin riêng.</h1>
          <p>
            Bạn quản lý hồ sơ. Mỗi người nhận những nội dung mình quan tâm qua
            ntfy.
          </p>
        </div>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? "Đang xử lý…" : "Lưu & đồng bộ"}
        </button>
      </div>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="status success" role="status">
          {notice}
        </p>
      )}
      {!draft && !error && <p role="status">Đang tải hồ sơ…</p>}
      {draft && document && (
        <>
          <div className="family-cloud">
            <span
              className={"result-badge " + (synced ? "success" : "partial")}
            >
              {dirty
                ? "Có thay đổi chưa lưu"
                : synced
                  ? "Đã đồng bộ cloud"
                  : "Chưa đồng bộ cloud"}
            </span>
            <span>
              {document.syncedAt
                ? "Đồng bộ gần nhất: " +
                  new Date(document.syncedAt).toLocaleString("vi-VN")
                : "Lưu và đồng bộ để kích hoạt lịch gia đình."}
            </span>
            {!dirty && !synced && (
              <button
                disabled={busy || !document.cloudConfigured}
                onClick={() => void sync()}
              >
                Đồng bộ lại
              </button>
            )}
          </div>
          {!document.cloudConfigured && (
            <p className="status error">
              Kết nối quản trị cloud chưa sẵn sàng trên máy này. Hồ sơ vẫn lưu
              được trên máy nhưng lịch cloud chưa thay đổi.
            </p>
          )}
          <div className="family-layout">
            <aside className="family-members" aria-label="Thành viên">
              <div className="family-list-heading">
                <h2>
                  Hồ sơ <small>{draft.profiles.length}/8</small>
                </h2>
                <button
                  disabled={busy || draft.profiles.length >= 8}
                  onClick={add}
                >
                  + Thêm người
                </button>
              </div>
              {draft.profiles.map((p) => (
                <button
                  key={p.id}
                  className={
                    "family-member " + (p.id === selected ? "selected" : "")
                  }
                  onClick={() => setSelected(p.id)}
                  disabled={busy}
                  aria-pressed={p.id === selected}
                >
                  <strong>{p.name || "Chưa đặt tên"}</strong>
                  <span>
                    {familyCities[p.city].name} · {p.sendTime}
                  </span>
                  <small>
                    {p.enabled ? "Đang nhận bản tin" : "Đang tạm dừng"}
                  </small>
                </button>
              ))}
            </aside>
            {profile && (
              <section className="family-editor" aria-label="Chỉnh sửa hồ sơ">
                <fieldset disabled={busy}>
                  <div className="family-editor-heading">
                    <h2>{profile.name || "Hồ sơ mới"}</h2>
                    <label className="family-check">
                      <input
                        type="checkbox"
                        checked={profile.enabled}
                        onChange={(e) => change({ enabled: e.target.checked })}
                      />{" "}
                      Nhận bản tin
                    </label>
                  </div>
                  <div className="family-fields">
                    <label>
                      Tên hiển thị
                      <input
                        maxLength={60}
                        value={profile.name}
                        onChange={(e) => change({ name: e.target.value })}
                      />
                    </label>
                    <label>
                      Địa điểm
                      <select
                        value={profile.city}
                        onChange={(e) =>
                          change({
                            city: e.target.value as FamilyProfile["city"],
                          })
                        }
                      >
                        {Object.entries(familyCities).map(([id, city]) => (
                          <option key={id} value={id}>
                            {city.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <h3>Nội dung muốn nhận</h3>
                  <div className="family-choices">
                    {(
                      [
                        ["weather", "Thời tiết"],
                        ["airQuality", "Chất lượng không khí"],
                        ["fuel", "Xăng E10 RON 95-III · vùng 1"],
                        ["github", "5 dự án GitHub · tiếng Việt"],
                        ["gold", "Vàng miếng SJC & nhẫn SJC 9999"],
                        ["usd", "USD/VND · Vietcombank"],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="family-check" key={key}>
                        <input
                          type="checkbox"
                          checked={profile[key] ?? false}
                          onChange={(e) => change({ [key]: e.target.checked })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <h3>Chủ đề tin tức</h3>
                  {(profile.gold || profile.usd) && (
                    <p className="muted">
                      Vàng: bảng SJC tại TP.HCM do Webgia tổng hợp. USD:
                      Vietcombank. Bản tin ghi rõ thời điểm nguồn công bố; giờ
                      nhận không bảo đảm nguồn vừa cập nhật giá mới.
                    </p>
                  )}
                  <p className="muted">
                    Tổng cộng tối đa 3 tin trong thông báo, từ các chủ đề đã
                    chọn.
                  </p>
                  <div className="family-choices">
                    {Object.entries(familyTopics).map(([key, topic]) => (
                      <label className="family-check" key={key}>
                        <input
                          type="checkbox"
                          checked={profile.newsTopics.includes(
                            key as FamilyProfile["newsTopics"][number],
                          )}
                          onChange={(e) =>
                            change({
                              newsTopics: e.target.checked
                                ? [
                                    ...profile.newsTopics,
                                    key as FamilyProfile["newsTopics"][number],
                                  ]
                                : profile.newsTopics.filter((t) => t !== key),
                            })
                          }
                        />
                        {topic.name}
                      </label>
                    ))}
                  </div>
                  <h3>Lịch nhận</h3>
                  <div className="family-fields">
                    <label>
                      Giờ Việt Nam
                      <select
                        value={profile.sendTime}
                        onChange={(e) => change({ sendTime: e.target.value })}
                      >
                        {times.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <p className="muted">
                      Cloud kiểm tra mỗi 30 phút. Thông báo có thể đến muộn; hệ
                      thống gửi bù trong cùng ngày và chống gửi trùng.
                    </p>
                  </div>
                  <div className="family-days">
                    {weekdays.map((label, i) => (
                      <label className="family-check" key={label}>
                        <input
                          type="checkbox"
                          checked={profile.days.includes(i + 1)}
                          onChange={(e) =>
                            change({
                              days: e.target.checked
                                ? [...profile.days, i + 1].sort()
                                : profile.days.filter((d) => d !== i + 1),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <h3>Điện thoại nhận bản tin</h3>
                  <p>
                    Mở ntfy trên điện thoại → dấu + → server{" "}
                    <strong>ntfy.sh</strong> → nhập topic bên dưới. Mỗi người
                    dùng một topic riêng.
                  </p>
                  <label className="family-topic">
                    Topic ntfy
                    <input
                      autoComplete="off"
                      spellCheck={false}
                      value={profile.topic}
                      maxLength={128}
                      onChange={(e) => change({ topic: e.target.value })}
                    />
                  </label>
                  <p className="muted">
                    Topic tự tạo có chuỗi ngẫu nhiên để khó đoán. Không chia sẻ
                    công khai topic nhận tin của gia đình.
                  </p>
                  <button
                    disabled={!profile.topic}
                    onClick={() =>
                      void navigator.clipboard.writeText(profile.topic).then(
                        () =>
                          setNotice(
                            "Đã sao chép topic. Dùng topic này để đăng ký ntfy trên điện thoại của người nhận.",
                          ),
                        () =>
                          setError(
                            "Trình duyệt chưa cho sao chép. Bạn có thể chọn và sao chép trực tiếp trong ô topic.",
                          ),
                      )
                    }
                  >
                    Sao chép topic
                  </button>
                  <div className="family-actions">
                    <button
                      disabled={busy || dirty || !synced || !profile.topic}
                      onClick={() => void test()}
                    >
                      Gửi thử riêng hồ sơ này
                    </button>
                    {draft.profiles.length > 1 && (
                      <button
                        className="family-remove"
                        onClick={() => {
                          const rest = draft.profiles.filter(
                            (p) => p.id !== selected,
                          );
                          setDraft({ ...draft, profiles: rest });
                          setSelected(rest[0]!.id);
                          setDirty(true);
                          setNotice("");
                        }}
                      >
                        Xóa hồ sơ
                      </button>
                    )}
                  </div>
                </fieldset>
              </section>
            )}
          </div>
          <p className="family-footnote">
            Bạn là người quản lý trên máy này. Các thành viên chỉ cần ntfy; chưa
            cần tạo tài khoản hoặc mật khẩu.
          </p>
        </>
      )}
    </div>
  );
}
