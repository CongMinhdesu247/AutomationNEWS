import RunDashboard from "./RunDashboard";
import AutomationDashboard from "./AutomationDashboard";
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import {
  settingsSchema,
  validationIssues,
  type Settings,
  type FieldIssue,
  type ApiError,
} from "@hub/contracts";

import DigestDashboard from "./DigestDashboard";

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
      document.getElementById(errors[0]?.path.join(".") ?? "")?.focus();
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
      setState("success");
      setMessage("Đã lưu cấu hình vào PostgreSQL.");
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
        <a href="#main" className="brand">
          <span className="brand-mark" aria-hidden="true">
            h
          </span>
          <span>
            Personal
            <br />
            <strong>Automation Hub</strong>
          </span>
        </a>
        <p className="nav-label">Không gian cá nhân</p>
        <nav aria-label="Điều hướng">
          <a href="#/automation">Lịch & tác vụ lỗi</a>
          <a href="#/runs">Tiến độ workflow</a>
          <a href="#/digests">Bản tin đã lưu</a>
          {groups.map(([id, label]) => (
            <a key={id} href={"#" + id}>
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="local-dot" />
          Chỉ chạy cục bộ<p>Nền tảng cho bản tin mỗi sáng của bạn.</p>
        </div>
      </aside>
      <main id="main">
        {view.startsWith("#/automation") ? (
          <AutomationDashboard />
        ) : view.startsWith("#/runs") ? (
          <RunDashboard hash={view} />
        ) : view.startsWith("#/digests") ? (
          <DigestDashboard hash={view} />
        ) : (
          <>
            <div className="page-heading">
              <div>
                <p className="breadcrumb">Personal Automation Hub / Cài đặt</p>
                <h1>Một buổi sáng, theo cách của bạn.</h1>
                <p>Chọn nội dung và cách nhận bản tin trong cùng một nơi.</p>
              </div>
              <span className="phase-badge">Cấu hình nguồn</span>
            </div>
            <div className="notice">
              <strong>Lưu cấu hình trước khi tạo bản tin.</strong>
              <p>
                Scheduler dùng cấu hình đã lưu để tạo bản tin mỗi ngày. Bật ntfy
                để gửi tự động sau khi bản tin hoàn tất.
              </p>
            </div>
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
              <form onSubmit={save} noValidate>
                <fieldset disabled={state === "saving"}>
                  <Section
                    id="newsletter"
                    title="Bản tin"
                    description="Lịch mỗi ngày theo múi giờ đã chọn. Máy và scheduler cần đang chạy; có thể tạo thêm bản tin thủ công."
                  >
                    <Toggle
                      label="Bật bản tin"
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
                    title="Thời tiết"
                    description="Nhập tọa độ địa điểm. Chưa hỗ trợ tìm địa điểm tự động."
                  >
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
                    description="Chuẩn bị kênh nhận thông báo qua ntfy."
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
                      Nếu cần token, cấu hình NTFY_TOKEN ở backend. Token không
                      được lưu trong cài đặt hoặc gửi về trình duyệt.
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
                          : "Lưu đồng thời tất cả nhóm cài đặt."}
                  </p>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={state === "saving"}
                  >
                    {state === "saving" ? "Đang lưu…" : "Lưu cấu hình"}
                  </button>
                </div>
                {issues.length > 0 && (
                  <div className="error-summary" role="alert">
                    <strong>Cần kiểm tra lại</strong>
                    <ul>
                      {issues.map((issue, index) => (
                        <li key={index}>
                          <a href={"#" + issue.path.join(".")}>
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
          Personal Automation Hub{" "}
          <span>Được thiết kế cho một người dùng, chạy trên máy của bạn.</span>
        </footer>
      </main>
    </div>
  );
}
