import { useEffect, useState } from "react";
import {
  familyCities,
  familyTopics,
  memberPreferencesSchema,
  type MemberPreferences,
} from "@hub/contracts";
import AlertPreferences from "./AlertPreferences";
import "./family.css";
type Document = {
  name: string;
  preferences: MemberPreferences;
  revision: number;
  synced: boolean;
};
export default function MemberPortal() {
  const [token] = useState(() =>
    window.location.hash.slice("#/member/".length),
  );
  const [document, setDocument] = useState<Document | null>(null),
    [draft, setDraft] = useState<MemberPreferences | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function request(method = "GET", body?: unknown) {
    const response = await fetch("/api/member", {
      method,
      signal: AbortSignal.timeout(45000),
      headers: {
        Authorization: "Bearer " + token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error?.message ?? "Chưa kết nối được máy chủ.");
    return data;
  }
  useEffect(() => {
    let active = true;
    void request()
      .then((value) => {
        if (active) {
          setDocument(value);
          setDraft(value.preferences);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function save() {
    const parsed = memberPreferencesSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request("PUT", {
        preferences: parsed.data,
        revision: document!.revision,
      });
      setDocument({ ...document!, ...result });
      setNotice(result.syncError ?? "Đã lưu và đồng bộ lịch cloud.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="member-portal">
      <p className="family-eyebrow">BẢN TIN CỦA BẠN</p>
      <h1>{document?.name ?? "Cài đặt bản tin"}</h1>
      <p>
        Chọn điều bạn quan tâm và thời gian thuận tiện. Trang này chỉ chỉnh hồ
        sơ của bạn.
      </p>
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
      {!draft && !error && <p role="status">Đang tải…</p>}
      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <label className="family-check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              Nhận bản tin (bỏ chọn để tạm dừng)
            </label>
            <div className="family-fields">
              <label>
                Địa điểm
                <select
                  value={draft.city}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      city: e.target.value as MemberPreferences["city"],
                    })
                  }
                >
                  {Object.entries(familyCities).map(([key, city]) => (
                    <option key={key} value={key}>
                      {city.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Giờ Việt Nam
                <select
                  value={draft.sendTime}
                  onChange={(e) =>
                    setDraft({ ...draft, sendTime: e.target.value })
                  }
                >
                  {Array.from(
                    { length: 48 },
                    (_, i) =>
                      `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
                  ).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <h3>Ngày nhận</h3>
            <div className="family-choices">
              {[
                "Thứ Hai",
                "Thứ Ba",
                "Thứ Tư",
                "Thứ Năm",
                "Thứ Sáu",
                "Thứ Bảy",
                "Chủ nhật",
              ].map((name, i) => (
                <label key={name} className="family-check">
                  <input
                    type="checkbox"
                    checked={draft.days.includes(i + 1)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        days: e.target.checked
                          ? [...draft.days, i + 1].sort()
                          : draft.days.filter((d) => d !== i + 1),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <h3>Nội dung</h3>
            <div className="family-choices">
              {(
                [
                  ["weather", "Thời tiết"],
                  ["airQuality", "Chất lượng không khí"],
                  ["fuel", "Xăng E10 RON 95-III"],
                  ["gold", "Vàng SJC · đồng/chỉ"],
                  ["usd", "USD/VND"],
                  ["github", "Dự án GitHub"],
                ] as const
              ).map(([key, name]) => (
                <label key={key} className="family-check">
                  <input
                    type="checkbox"
                    checked={draft[key] ?? false}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.checked })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <h3>Tin tức</h3>
            <div className="family-choices">
              {Object.entries(familyTopics).map(([key, value]) => (
                <label className="family-check" key={key}>
                  <input
                    type="checkbox"
                    checked={draft.newsTopics.includes(
                      key as MemberPreferences["newsTopics"][number],
                    )}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        newsTopics: e.target.checked
                          ? [
                              ...draft.newsTopics,
                              key as MemberPreferences["newsTopics"][number],
                            ]
                          : draft.newsTopics.filter((k) => k !== key),
                      })
                    }
                  />
                  {value.name}
                </label>
              ))}
            </div>
            <AlertPreferences
              value={draft.alerts}
              onChange={(alerts) => setDraft({ ...draft, alerts })}
            />
            <p className="muted">
              Lưu khi máy chủ quản lý đang bật và bạn kết nối được với máy chủ.
              Sau khi đồng bộ, lịch cloud vẫn chạy khi PC tắt. GitHub có thể gửi
              muộn so với giờ đã chọn.
            </p>
            <button className="primary" type="submit">
              {busy ? "Đang lưu…" : "Lưu lựa chọn"}
            </button>
          </fieldset>
        </form>
      )}
    </main>
  );
}
