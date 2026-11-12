import RunDashboard from "./RunDashboard";
import AutomationDashboard from "./AutomationDashboard";
import FamilyDashboard from "./FamilyDashboard";
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import {
  settingsSchema,
  validationIssues,
  type Settings,
  type FieldIssue,
  type ApiError,
} from "@hub/contracts";

import DigestDashboard from "./DigestDashboard";
import { Icon } from "./Icons";

type Draft = Omit<Settings, "weather" | "github"> & {
  weather: Omit<Settings["weather"], "latitude" | "longitude"> & {
    latitude: string;
    longitude: string;
  };
  github: Omit<
    Settings["github"],
    "topics" | "languages" | "repositoryCount"
  > & { topicsText: string; languagesText: string; repositoryCount: string };
};
function toDraft(s: Settings): Draft {
  return {
    ...s,
    weather: {
      ...s.weather,
      latitude: String(s.weather.latitude),
      longitude: String(s.weather.longitude),
    },
    github: {
      enabled: s.github.enabled,
      topicsText: s.github.topics.join(", "),
      languagesText: s.github.languages.join(", "),
      repositoryCount: String(s.github.repositoryCount),
    },
  };
}
const numberValue = (value: string) =>
  value.trim() === "" ? NaN : Number(value);
function toPayload(d: Draft): unknown {
  return {
    ...d,
    weather: {
      ...d.weather,
      latitude: numberValue(d.weather.latitude),
      longitude: numberValue(d.weather.longitude),
    },
    github: {
      enabled: d.github.enabled,
      topics: d.github.topicsText.split(","),
      languages: d.github.languagesText.split(","),
      repositoryCount: numberValue(d.github.repositoryCount),
    },
  };
}
async function readResponse(response: Response): Promise<Settings> {
  const body: unknown = await response.json();
  if (!response.ok) throw body;
  return settingsSchema.parse(body);
}
function Field({
  name,
  label,
  value,
  onChange,
  issues,
  type = "text",
  hint,
  step,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  issues: FieldIssue[];
  type?: string;
  hint?: string;
  step?: string;
}) {
  const errors = issues.filter(
    (issue) =>
      issue.path.join(".") === name ||
      issue.path.join(".").startsWith(name + "."),
  );
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type={type}
        value={value}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={errors.length > 0}
        aria-describedby={name + "-help"}
      />
      <div id={name + "-help"}>
        {hint && <small>{hint}</small>}
        {errors.map((error, i) => (
          <p className="field-error" key={i}>
            {error.message}
          </p>
        ))}
      </div>
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="section">
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}
const groups = [
  ["newsletter", "Bản tin"],
  ["rss", "Nguồn RSS"],
  ["weather", "Thời tiết"],
  ["github", "GitHub"],
  ["notifications", "Thông báo"],
];
export default function App() {
  const [view, setView] = useState(window.location.hash || "#/digests");
  useEffect(() => {
    const handler = () => setView(window.location.hash || "#/digests");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<
    "loading" | "idle" | "saving" | "success" | "error"
  >("loading");
  const [attempt, setAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const settingsTab =
    groups.find(
      ([id]) => view === "#" + id || view === "#/settings/" + id,
    )?.[0] ?? "newsletter";
  const inSettings =
    !view.startsWith("#/family") &&
    !view.startsWith("#/digests") &&
    !view.startsWith("#/runs") &&
    !view.startsWith("#/automation");
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setMessage("");
    fetch("/api/settings", { signal: controller.signal })
      .then(readResponse)
      .then((settings) => {
        setDraft(toDraft(settings));
        setState("idle");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState("error");
          setMessage(
            "Không thể tải cấu hình. Kiểm tra API, database và migration rồi thử lại.",
          );
        }
      });
    return () => controller.abort();
  }, [attempt]);
  function change(next: Draft) {
    setDirty(true);
    setDraft(next);
    setMessage("");
    setIssues([]);
    setState("idle");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || state === "saving") return;
    const parsed = settingsSchema.safeParse(toPayload(draft));
    if (!parsed.success) {
      const errors = validationIssues(parsed.error);
      setIssues(errors);
      setState("error");
      setMessage("Vui lòng kiểm tra các trường được đánh dấu.");
      window.location.hash =
        "/settings/" + String(errors[0]?.path[0] ?? "newsletter");
      setTimeout(
        () => document.getElementById(errors[0]?.path.join(".") ?? "")?.focus(),
        50,
      );
      return;
    }
    setState("saving");
    setMessage("");
    setIssues([]);
    try {
      const saved = await readResponse(
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
          signal: AbortSignal.timeout(15000),
        }),
      );
      setDraft(toDraft(saved));
      setDirty(false);
      setState("success");
      setMessage("Đã lưu thay đổi trên máy này.");
    } catch (error) {
      const apiError = error as Partial<ApiError> | null;
      setIssues(apiError?.error?.issues ?? []);
      setState("error");
      setMessage(
        apiError?.error?.message ??
          "Chưa xác nhận được kết quả lưu. Dữ liệu đang nhập vẫn được giữ; bạn có thể thử lưu lại.",
      );
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#/digests"
          className="brand"
          aria-label="Automation Hub — Bản tin"
        >
          <span className="brand-mark" aria-hidden="true">
            <Icon name="sun" size={25} />
          </span>
          <span>
            <strong>Morning Hub</strong>
            <small>Bản tin của riêng bạn</small>
          </span>
        </a>
        <nav className="family-navigation" aria-label="Điều hướng">
          <a href="#/family" aria-current={view.startsWith("#/family")?"page":undefined}><Icon name="brief"/>Gia đình</a>
          <a
            href="#/digests"
            aria-current={view.startsWith("#/digests") ? "page" : undefined}
          >
            <Icon name="brief" />
            Bản tin
          </a>
          <a
            href="#/automation"
            aria-current={view.startsWith("#/automation") ? "page" : undefined}
          >
            <Icon name="calendar" />
            Lịch gửi
          </a>
          <a
            href="#/runs"
            aria-current={view.startsWith("#/runs") ? "page" : undefined}
          >
            <Icon name="activity" />
            Hoạt động
          </a>
          <a
            href="#/settings/newsletter"
            aria-current={inSettings ? "page" : undefined}
          >
            <Icon name="settings" />
            Cài đặt
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="local-dot" />
          Không gian cá nhân
          <p>
            Dashboard trên máy.
            <br />
            Thông báo qua ntfy.
          </p>
        </div>
      </aside>
      <main id="main">
        <div className="workspace-header">
          <span>Không gian cá nhân</span>
          <span className="workspace-location">
            <span className="local-dot" />
            Dashboard cục bộ
          </span>
        </div>
        {import.meta.env.VITE_DEMO_MODE === "true" && (
          <p
            className="status"
            style={{
              background: "#fff3cd",
              color: "#664d03",
              border: "1px solid #d9ab35",
            }}
            role="note"
          >
            DEMO FIXTURE · Dữ liệu mô phỏng. Không gọi API ngoài hoặc gửi thông
            báo thật.
          </p>
        )}
        {view.startsWith("#/family") ? <FamilyDashboard/> : view.startsWith("#/automation") ? (
          <AutomationDashboard />
        ) : view.startsWith("#/runs") ? (
          <RunDashboard hash={view} />
        ) : view.startsWith("#/digests") ? (
          <DigestDashboard hash={view} />
        ) : (
          <>
            <div className="page-heading">
              <div>
                <h1>Cài đặt bản tin</h1>
                <p>Chọn nội dung bạn quan tâm và cách nhận thông báo.</p>
                <p>Lịch và bản tin cloud cho từng người được quản lý trong <a href="#/family">Gia đình</a>. Cài đặt dưới đây dùng khi tạo bản tin trên máy.</p>
              </div>
            </div>
            <nav className="settings-tabs" aria-label="Nhóm cài đặt">
              {groups.map(([id, label]) => (
                <a
                  href={"#/settings/" + id}
                  key={id}
                  aria-current={settingsTab === id ? "page" : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>
            <div
              role="status"
              aria-live="polite"
              className={
                message || state === "loading" ? "status " + state : "sr-only"
              }
            >
              {state === "loading" ? "Đang tải cấu hình…" : message}
            </div>
            {!draft && state === "error" && (
              <button type="button" onClick={() => setAttempt((v) => v + 1)}>
                Thử tải lại
              </button>
            )}
            {draft && (
              <form
                className="settings-form"
                data-tab={settingsTab}
                onSubmit={save}
                noValidate
              >
                <fieldset disabled={state === "saving"}>
                  <Section
                    id="newsletter"
                    title="Lịch trên máy"
                    description="Áp dụng cho scheduler cục bộ. Lịch cloud chạy trên GitHub được quản lý riêng."
                  >
                    <Toggle
                      label="Bật lịch gửi trên máy"
                      checked={draft.newsletter.enabled}
                      onChange={(enabled) =>
                        change({
                          ...draft,
                          newsletter: { ...draft.newsletter, enabled },
                        })
                      }
                    />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field
                        name="newsletter.sendTime"
                        label="Giờ gửi"
                        type="time"
                        value={draft.newsletter.sendTime}
                        onChange={(sendTime) =>
                          change({
                            ...draft,
                            newsletter: { ...draft.newsletter, sendTime },
                          })
                        }
                        issues={issues}
                      />
                      <Field
                        name="newsletter.timezone"
                        label="Múi giờ"
                        value={draft.newsletter.timezone}
                        onChange={(timezone) =>
                          change({
                            ...draft,
                            newsletter: { ...draft.newsletter, timezone },
                          })
                        }
                        issues={issues}
                        hint="Tên IANA, ví dụ Asia/Ho_Chi_Minh."
                      />
                    </div>
                  </Section>
                  <Section
                    id="rss"
                    title="Nguồn RSS"
                    description="Chọn các nguồn tin bạn muốn có trong bản tin."
                  >
                    {draft.rss.length === 0 && (
                      <div className="empty-state">
                        <strong>Chưa có nguồn tin nào</strong>
                        <p>
                          Thêm URL RSS đầu tiên để chuẩn bị danh sách đọc của
                          bạn.
                        </p>
                      </div>
                    )}
                    {draft.rss.map((source, index) => (
                      <div className="rss-row" key={source.id}>
                        <div className="rss-row-heading">
                          <Toggle
                            label={"Bật nguồn " + (index + 1)}
                            checked={source.enabled}
                            onChange={(enabled) =>
                              change({
                                ...draft,
                                rss: draft.rss.map((s) =>
                                  s.id === source.id ? { ...s, enabled } : s,
                                ),
                              })
                            }
                          />
                          <button
                            className="delete-button"
                            type="button"
                            aria-label={"Xóa nguồn " + (index + 1)}
                            onClick={() =>
                              change({
                                ...draft,
                                rss: draft.rss.filter(
                                  (s) => s.id !== source.id,
                                ),
                              })
                            }
                          >
                            Xóa
                          </button>
                        </div>
                        <div className="grid gap-5 sm:grid-cols-2">
                          <Field
                            name={"rss." + index + ".name"}
                            label={"Tên nguồn " + (index + 1)}
                            value={source.name}
                            onChange={(name) =>
                              change({
                                ...draft,
                                rss: draft.rss.map((s) =>
                                  s.id === source.id ? { ...s, name } : s,
                                ),
                              })
                            }
                            issues={issues}
                          />
                          <Field
                            name={"rss." + index + ".url"}
                            label={"URL RSS " + (index + 1)}
                            type="url"
                            hint="Dùng link RSS, không dùng trang chủ. Ví dụ: https://vnexpress.net/rss/tin-moi-nhat.rss"
                            value={source.url}
                            onChange={(url) =>
                              change({
                                ...draft,
                                rss: draft.rss.map((s) =>
                                  s.id === source.id ? { ...s, url } : s,
                                ),
                              })
                            }
                            issues={issues}
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={draft.rss.length >= 100}
                      onClick={() =>
                        change({
                          ...draft,
                          rss: [
                            ...draft.rss,
                            {
                              id: crypto.randomUUID(),
                              name: "",
                              url: "",
                              enabled: true,
                            },
                          ],
                        })
                      }
                    >
                      + Thêm nguồn RSS
                    </button>
                  </Section>
                  <Section
                    id="weather"
                    title="Thời tiết & giá xăng"
                    description="Dự báo tại địa điểm bạn chọn và giá Xăng E10 RON 95-III của Petrolimex vùng 1."
                  >
                    <Toggle
                      label="Thêm giá Xăng E10 RON 95-III vào bản tin sáng"
                      checked={draft.fuel?.enabled ?? false}
                      onChange={(enabled) => change({ ...draft, fuel: { enabled } })}
                    />
                    <Toggle
                      label="Thêm chất lượng không khí Hà Nội"
                      checked={draft.airQuality?.enabled ?? false}
                      onChange={(enabled) => change({ ...draft, airQuality: { enabled } })}
                    />
                    <p className="muted">AQI theo thang Mỹ và PM2.5 tại trung tâm Hà Nội, từ mô hình dự báo Open-Meteo/CAMS; không phải số đo tại trạm.</p>
                    <p className="muted">Chỉ theo dõi Xăng E10 RON 95-III. Mức tăng/giảm được so với bản tin trước.</p>
                    <Toggle
                      label="Thêm thời tiết vào bản tin"
                      checked={draft.weather.enabled}
                      onChange={(enabled) =>
                        change({
                          ...draft,
                          weather: { ...draft.weather, enabled },
                        })
                      }
                    />
                    <Field
                      name="weather.location"
                      label="Tên địa điểm"
                      value={draft.weather.location}
                      onChange={(location) =>
                        change({
                          ...draft,
                          weather: { ...draft.weather, location },
                        })
                      }
                      issues={issues}
                    />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field
                        name="weather.latitude"
                        label="Latitude (vĩ độ)"
                        type="number"
                        step="any"
                        value={draft.weather.latitude}
                        onChange={(latitude) =>
                          change({
                            ...draft,
                            weather: { ...draft.weather, latitude },
                          })
                        }
                        issues={issues}
                        hint="Từ -90 đến 90."
                      />
                      <Field
                        name="weather.longitude"
                        label="Longitude (kinh độ)"
                        type="number"
                        step="any"
                        value={draft.weather.longitude}
                        onChange={(longitude) =>
                          change({
                            ...draft,
                            weather: { ...draft.weather, longitude },
                          })
                        }
                        issues={issues}
                        hint="Từ -180 đến 180."
                      />
                    </div>
                  </Section>
                  <Section
                    id="github"
                    title="GitHub"
                    description="Định hình danh sách repository theo mối quan tâm của bạn."
                  >
                    <Toggle
                      label="Thêm GitHub vào bản tin"
                      checked={draft.github.enabled}
                      onChange={(enabled) =>
                        change({
                          ...draft,
                          github: { ...draft.github, enabled },
                        })
                      }
                    />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field
                        name="github.topics"
                        label="Chủ đề quan tâm"
                        value={draft.github.topicsText}
                        onChange={(topicsText) =>
                          change({
                            ...draft,
                            github: { ...draft.github, topicsText },
                          })
                        }
                        issues={issues}
                        hint="Phân cách bằng dấu phẩy, ví dụ automation, self-hosted."
                      />
                      <Field
                        name="github.languages"
                        label="Ngôn ngữ lập trình"
                        value={draft.github.languagesText}
                        onChange={(languagesText) =>
                          change({
                            ...draft,
                            github: { ...draft.github, languagesText },
                          })
                        }
                        issues={issues}
                        hint="Phân cách bằng dấu phẩy, ví dụ TypeScript, Python."
                      />
                    </div>
                    <Field
                      name="github.repositoryCount"
                      label="Số repository trong bản tin"
                      type="number"
                      step="1"
                      value={draft.github.repositoryCount}
                      onChange={(repositoryCount) =>
                        change({
                          ...draft,
                          github: { ...draft.github, repositoryCount },
                        })
                      }
                      issues={issues}
                      hint="Từ 1 đến 20 repository."
                    />
                  </Section>
                  <Section
                    id="notifications"
                    title="Thông báo"
                    description="Nhận bản tin trên điện thoại qua ứng dụng ntfy."
                  >
                    <Toggle
                      label="Bật gửi qua ntfy"
                      checked={draft.notifications.enabled}
                      onChange={(enabled) =>
                        change({
                          ...draft,
                          notifications: { ...draft.notifications, enabled },
                        })
                      }
                    />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field
                        name="notifications.serverUrl"
                        label="ntfy server URL"
                        type="url"
                        value={draft.notifications.serverUrl}
                        onChange={(serverUrl) =>
                          change({
                            ...draft,
                            notifications: {
                              ...draft.notifications,
                              serverUrl,
                            },
                          })
                        }
                        issues={issues}
                      />
                      <Field
                        name="notifications.topic"
                        label="Topic"
                        value={draft.notifications.topic}
                        onChange={(topic) =>
                          change({
                            ...draft,
                            notifications: { ...draft.notifications, topic },
                          })
                        }
                        issues={issues}
                        hint="Chữ, số, dấu gạch ngang và gạch dưới."
                      />
                    </div>
                    <p className="help-note">
                      Server và topic phải trùng với kênh bạn đã đăng ký trong
                      ntfy.
                    </p>
                  </Section>
                </fieldset>
                <div className="save-bar">
                  <p>
                    {state === "saving"
                      ? "Đang lưu cấu hình…"
                      : state === "success"
                        ? message
                        : state === "error"
                          ? "Chưa lưu. Kiểm tra thông báo lỗi."
                          : dirty
                            ? "Bạn có thay đổi chưa lưu."
                            : "Chưa có thay đổi mới."}
                  </p>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={state === "saving" || !dirty}
                  >
                    {state === "saving" ? "Đang lưu…" : "Lưu thay đổi"}
                  </button>
                </div>
                {issues.length > 0 && (
                  <div className="error-summary" role="alert">
                    <strong>Cần kiểm tra lại</strong>
                    <ul>
                      {issues.map((issue, index) => (
                        <li key={index}>
                          <a
                            href={"#/settings/" + String(issue.path[0])}
                            onClick={() =>
                              setTimeout(
                                () =>
                                  document
                                    .getElementById(issue.path.join("."))
                                    ?.focus(),
                                50,
                              )
                            }
                          >
                            {issue.path.join(".")} — {issue.message}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </form>
            )}
          </>
        )}
        <footer>
          <span>Morning Hub</span>
          <span>Tin tức · Thời tiết · GitHub</span>
        </footer>
      </main>
    </div>
  );
}
