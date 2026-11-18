import { useEffect, useState } from "react";
import {
  familyCities,
  familyTopics,
  memberPreferencesSchema,
  type MemberPreferences,
} from "@hub/contracts";
import AlertPreferences from "./AlertPreferences";
import { apiRequest } from "./lib/api-client";
import "./family.css";

type MemberDocument = {
  name: string;
  preferences: MemberPreferences;
  revision: number;
  synced: boolean;
  syncError?: string;
};

const SESSION_MEMBER_TOKEN_KEY = "hub-member-portal-token";

function readAndScrubMemberToken(): string {
  const fromHash = window.location.hash.startsWith("#/member/")
    ? window.location.hash.slice("#/member/".length).trim()
    : "";
  if (fromHash) {
    try {
      sessionStorage.setItem(SESSION_MEMBER_TOKEN_KEY, fromHash);
      // Scrub raw capability token from browser URL bar & synced history while keeping member mode active.
      history.replaceState(null, "", window.location.pathname + "#/member");
    } catch {
      // Ignore restricted storage environments.
    }
    return fromHash;
  }
  try {
    return sessionStorage.getItem(SESSION_MEMBER_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function MemberPortal() {
  const [token, setToken] = useState(readAndScrubMemberToken);
  const [document, setDocument] = useState<MemberDocument | null>(null);
  const [draft, setDraft] = useState<MemberPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.startsWith("#/member/")) {
        const nextToken = readAndScrubMemberToken();
        if (nextToken) setToken(nextToken);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  async function request<T>(method = "GET", body?: unknown): Promise<T> {
    return apiRequest<T>("/api/member", {
      method,
      body,
      timeoutMs: 45000,
      notifyUnauthorized: false,
      headers: {
        Authorization: "Bearer " + token,
      },
    });
  }

  useEffect(() => {
    if (!token) {
      setError("Liên kết thành viên không hợp lệ hoặc đã hết hạn.");
      return;
    }
    let active = true;
    setError("");
    void request<MemberDocument>()
      .then((value) => {
        if (active) {
          setDocument(value);
          setDraft(value.preferences);
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
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
      const result = await request<{
        revision: number;
        synced: boolean;
        syncError?: string;
      }>("PUT", {
        preferences: parsed.data,
        revision: document!.revision,
      });
      setDocument({ ...document!, ...result });
      if (result.syncError) {
        setError(result.syncError);
      } else {
        setNotice("Đã lưu và đồng bộ lịch cloud.");
      }
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
        sơ riêng của bạn.
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
                          ? [...new Set([...draft.days, i + 1])].sort(
                              (a, b) => a - b,
                            )
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
                  ["gold", "Vàng miếng SJC · đồng/chỉ"],
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
              Lưu khi máy chủ quản lý đang bật và điện thoại kết nối được với máy
              chủ. Sau khi đồng bộ, lịch cloud vẫn chạy ngay cả khi máy tính tắt.
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
