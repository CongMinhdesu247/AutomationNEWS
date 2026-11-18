import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  calendarDate,
  familyCities,
  familyTopics,
  formatDateTime,
  hasEnabledSources,
  isValidMonthDay,
  safeHttpUrlSchema,
  settingsSchema,
  type Settings,
} from "@hub/contracts";
import { Icon } from "../Icons";
import { apiRequest, type Account } from "../lib/api-client";
import { ExternalLink } from "./ExternalLink";

type PreferenceCategory =
  | "all"
  | "schedule"
  | "environment"
  | "news"
  | "personal"
  | "delivery";

const CATEGORY_TABS: ReadonlyArray<{
  id: PreferenceCategory;
  label: string;
}> = [
  { id: "all", label: "Tất cả mục" },
  { id: "schedule", label: "Lịch & Giao diện" },
  { id: "environment", label: "Khu vực & Thị trường" },
  { id: "news", label: "Nguồn tin & GitHub" },
  { id: "personal", label: "Việc làm & Kỷ niệm" },
  { id: "delivery", label: "Thông báo điện thoại" },
];

function PreferenceCheckbox({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();

  return (
    <div>
      <div className="account-check-help">
        <label className="account-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
          />
          {label}
        </label>
        <button
          type="button"
          className="account-help-toggle"
          aria-label={`Hướng dẫn về “${label}”`}
          aria-expanded={helpOpen}
          aria-controls={helpId}
          onClick={() => setHelpOpen((open) => !open)}
        >
          <span aria-hidden="true">?</span>
        </button>
      </div>
      <div id={helpId} className="account-check-guidance" hidden={!helpOpen}>
        {children}
      </div>
    </div>
  );
}

const STARTER_FEED_URLS = new Set(
  Object.values(familyTopics).map(
    (v) => `https://vnexpress.net/rss/${v.feed}.rss`,
  ),
);

export function PreferencesView({
  account,
  onSaved,
}: {
  account: Account;
  onSaved: (value: Account) => void;
}) {
  const [draft, setDraft] = useState(account);
  const [category, setCategory] = useState<PreferenceCategory>("all");
  const [busy, setBusy] = useState(false);
  const [rotatingTopic, setRotatingTopic] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showTopic, setShowTopic] = useState(false);
  const [copiedTopic, setCopiedTopic] = useState(false);

  // Task draft inputs
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDate, setTaskDate] = useState(() =>
    calendarDate(new Date(), account.settings.newsletter.timezone),
  );

  // Personal holiday draft inputs
  const [holidayTitle, setHolidayTitle] = useState("");
  const [holidayMonthDay, setHolidayMonthDay] = useState("01-01");

  // Custom RSS draft inputs
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedError, setFeedError] = useState("");

  const s = draft.settings;
  const dirty = useMemo(
    () =>
      JSON.stringify({
        settings: draft.settings,
        days: draft.days,
        theme: draft.theme,
      }) !==
      JSON.stringify({
        settings: account.settings,
        days: account.days,
        theme: account.theme,
      }),
    [draft, account],
  );

  // Sync external updates (e.g., header quick theme switch or task toggle) so revision never drifts.
  useEffect(() => {
    setDraft((curr) => {
      const next = { ...curr, revision: account.revision, nextRunAt: account.nextRunAt };
      if (!dirty) {
        return account;
      }
      if (curr.theme === account.theme) {
        return next;
      }
      // Sync header quick-theme switch without clobbering unsaved settings edits.
      return { ...next, theme: account.theme };
    });
  }, [account.revision, account.theme, account.nextRunAt]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const patch = (value: Partial<Settings>) =>
    setDraft((v) => ({ ...v, settings: { ...v.settings, ...value } }));

  function selectCity(key: keyof typeof familyCities) {
    const city = familyCities[key];
    patch({
      weather: {
        ...s.weather,
        location: city.name,
        latitude: city.latitude,
        longitude: city.longitude,
      },
      airQuality: {
        ...s.airQuality,
        enabled: s.airQuality?.enabled ?? false,
        location: city.name,
        latitude: city.latitude,
        longitude: city.longitude,
      },
    });
  }

  function applyPreset(preset: "essential" | "finance" | "developer") {
    const hanoi = familyCities.hanoi;
    const currentLocation = s.weather.location
      ? {
          location: s.weather.location,
          latitude: s.weather.latitude,
          longitude: s.weather.longitude,
        }
      : {
          location: hanoi.name,
          latitude: hanoi.latitude,
          longitude: hanoi.longitude,
        };
    if (preset === "essential") {
      patch({
        weather: { enabled: true, ...currentLocation },
        airQuality: { enabled: true, ...currentLocation },
        uv: { enabled: true },
        holidays: { enabled: true, items: s.holidays?.items },
        tasks: { enabled: true, items: s.tasks?.items ?? [] },
      });
    } else if (preset === "finance") {
      const bizUrl = `https://vnexpress.net/rss/${familyTopics.business.feed}.rss`;
      patch({
        gold: { enabled: true },
        usd: { enabled: true },
        fuel: { enabled: true },
        weather: { enabled: true, ...currentLocation },
        rss: s.rss.some((f) => f.url === bizUrl)
          ? s.rss.map((f) => (f.url === bizUrl ? { ...f, enabled: true } : f))
          : [
              ...s.rss,
              {
                id: crypto.randomUUID(),
                name: "VnExpress · Kinh doanh",
                url: bizUrl,
                enabled: true,
              },
            ].slice(0, 16),
      });
    } else {
      const techUrl = `https://vnexpress.net/rss/${familyTopics.technology.feed}.rss`;
      patch({
        github: {
          enabled: true,
          topics: s.github.topics.length ? s.github.topics : ["ai", "automation"],
          languages: s.github.languages.length
            ? s.github.languages
            : ["TypeScript", "Python"],
          repositoryCount: s.github.repositoryCount || 5,
        },
        weather: { enabled: true, ...currentLocation },
        rss: s.rss.some((f) => f.url === techUrl)
          ? s.rss.map((f) => (f.url === techUrl ? { ...f, enabled: true } : f))
          : [
              ...s.rss,
              {
                id: crypto.randomUUID(),
                name: "VnExpress · Công nghệ",
                url: techUrl,
                enabled: true,
              },
            ].slice(0, 16),
      });
    }
    setNotice("Đã áp dụng bộ gợi ý nhanh. Bấm Lưu lựa chọn ở cuối trang để hoàn tất.");
  }

  function addCustomFeed() {
    setFeedError("");
    const trimmedName = feedName.trim();
    const validUrl = safeHttpUrlSchema.safeParse(feedUrl);
    if (!trimmedName) {
      setFeedError("Nhập tên hiển thị cho nguồn RSS.");
      return;
    }
    if (!validUrl.success) {
      setFeedError("Nhập đường dẫn RSS/Atom hợp lệ bắt đầu bằng https:// hoặc http://.");
      return;
    }
    if (s.rss.length >= 16) {
      setFeedError("Tối đa 16 nguồn RSS trên mỗi tài khoản.");
      return;
    }
    if (s.rss.some((f) => f.url.toLowerCase() === validUrl.data.toLowerCase())) {
      setFeedError("Nguồn RSS này đã có trong danh sách của bạn.");
      return;
    }
    patch({
      rss: [
        ...s.rss,
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          url: validUrl.data,
          enabled: true,
        },
      ],
    });
    setFeedName("");
    setFeedUrl("");
  }

  async function copyTopic() {
    try {
      await navigator.clipboard.writeText(s.notifications.topic);
      setCopiedTopic(true);
      setTimeout(() => setCopiedTopic(false), 2500);
    } catch {
      setShowTopic(true);
    }
  }

  async function rotateTopic() {
    if (
      !window.confirm(
        "Đổi mã topic mới sẽ ngắt kênh ntfy cũ trên điện thoại của bạn. Bạn cần đăng ký lại mã mới trong ứng dụng ntfy. Tiếp tục?",
      )
    ) {
      return;
    }
    setRotatingTopic(true);
    setError("");
    setNotice("");
    try {
      const res = await apiRequest<{ topic: string; revision: number }>(
        "/api/account/ntfy-topic/rotate",
        {
          method: "POST",
          body: {},
        },
      );
      const nextSettings: Settings = {
        ...draft.settings,
        notifications: {
          ...draft.settings.notifications,
          topic: res.topic,
        },
      };
      const updatedAccount: Account = {
        ...account,
        settings: {
          ...account.settings,
          notifications: {
            ...account.settings.notifications,
            topic: res.topic,
          },
        },
        revision: res.revision,
      };
      setDraft((curr) => ({
        ...curr,
        settings: nextSettings,
        revision: res.revision,
      }));
      onSaved(updatedAccount);
      setShowTopic(true);
      setNotice(
        "Đã tạo mã topic ntfy mới. Hãy sao chép và đăng ký lại trong ứng dụng ntfy trên điện thoại.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRotatingTopic(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const parsed = settingsSchema.safeParse(s);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest<{
        revision: number;
        nextRunAt: string | null;
      }>("/api/account/preferences", {
        method: "PUT",
        body: {
          settings: parsed.data,
          days: draft.days,
          theme: draft.theme,
          revision: draft.revision,
        },
      });
      const saved = { ...draft, settings: parsed.data, ...result };
      setDraft(saved);
      onSaved(saved);
      setNotice("Đã lưu. Lịch gửi đã được cập nhật trên máy chủ.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hasSource = hasEnabledSources(s);
  const customRssFeeds = s.rss.filter((f) => !STARTER_FEED_URLS.has(f.url));
  const ntfyTopicWebUrl = `${s.notifications.serverUrl.replace(/\/$/, "")}/${encodeURIComponent(s.notifications.topic)}`;
  const validHolidayInput =
    Boolean(holidayTitle.trim()) && isValidMonthDay(holidayMonthDay);

  const showSection = (target: Exclude<PreferenceCategory, "all">) =>
    category === "all" || category === target;

  return (
    <section className="account-preferences">
      <div className="preferences-hero">
        <div>
          <h1>Tùy chọn bản tin</h1>
          <p className="muted">
            Thiết kế nội dung buổi sáng theo mối quan tâm và múi giờ của riêng bạn.
          </p>
        </div>
        <div className="preset-bar" aria-label="Bộ thiết lập nhanh">
          <span>Gợi ý nhanh:</span>
          <button type="button" onClick={() => applyPreset("essential")}>
            Nhịp sáng thiết yếu
          </button>
          <button type="button" onClick={() => applyPreset("finance")}>
            Tài chính &amp; Giá cả
          </button>
          <button type="button" onClick={() => applyPreset("developer")}>
            Công nghệ &amp; GitHub
          </button>
        </div>
      </div>

      <div
        className="preferences-category-tabs"
        role="tablist"
        aria-label="Nhóm tùy chọn bản tin"
      >
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={category === tab.id}
            className={category === tab.id ? "pill-active" : undefined}
            onClick={() => setCategory(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={save}>
        <fieldset disabled={busy || rotatingTopic}>
          <section
            className="account-card pref-schedule-card"
            hidden={!showSection("schedule")}
          >
            <h2>
              <Icon name="calendar" />
              Thời gian nhận &amp; Giao diện
            </h2>
            <PreferenceCheckbox
              label="Tự động tạo bản tin theo lịch"
              checked={s.newsletter.enabled}
              onChange={(enabled) =>
                patch({ newsletter: { ...s.newsletter, enabled } })
              }
            >
              <p>
                Lưu lựa chọn để lịch có hiệu lực tự động mỗi ngày, kể cả khi bạn đã
                đóng trình duyệt.
              </p>
            </PreferenceCheckbox>
            <div className="account-grid">
              <label>
                Giờ nhận
                <input
                  type="time"
                  required
                  value={s.newsletter.sendTime}
                  onChange={(e) =>
                    patch({
                      newsletter: { ...s.newsletter, sendTime: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Múi giờ
                <input
                  required
                  value={s.newsletter.timezone}
                  list="account-timezones"
                  onChange={(e) =>
                    patch({
                      newsletter: { ...s.newsletter, timezone: e.target.value },
                    })
                  }
                />
                <datalist id="account-timezones">
                  <option value="Asia/Ho_Chi_Minh" />
                  <option value="Asia/Tokyo" />
                  <option value="Asia/Singapore" />
                  <option value="Europe/London" />
                  <option value="America/New_York" />
                </datalist>
              </label>
            </div>
            <div className="account-choices pref-days-grid">
              {[
                "Thứ 2",
                "Thứ 3",
                "Thứ 4",
                "Thứ 5",
                "Thứ 6",
                "Thứ 7",
                "Chủ nhật",
              ].map((name, i) => (
                <label key={name} className="account-check">
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
            <p className="schedule-next-hint">
              Lần gửi tiếp theo:{" "}
              <strong>
                {formatDateTime(
                  account.nextRunAt,
                  account.settings.newsletter.timezone,
                  "Chưa bật lịch",
                )}
              </strong>
              .
            </p>
            <label>
              Màu giao diện
              <select
                value={draft.theme}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    theme: e.target.value as Account["theme"],
                  })
                }
              >
                <option value="light">Sáng (Giấy báo buổi sớm)</option>
                <option value="dark">Tối (Dịu mắt ban đêm)</option>
              </select>
            </label>
          </section>

          <section
            className="account-card"
            hidden={!showSection("environment")}
          >
            <h2>
              <Icon name="sun" />
              Tiện ích buổi sáng &amp; Thị trường
            </h2>
            <label>
              Địa điểm
              <select
                value={
                  Object.entries(familyCities).find(
                    ([, v]) => v.name === s.weather.location,
                  )?.[0] ?? ""
                }
                onChange={(e) =>
                  selectCity(e.target.value as keyof typeof familyCities)
                }
              >
                <option value="" disabled>
                  Chọn thành phố
                </option>
                {Object.entries(familyCities).map(([key, v]) => (
                  <option key={key} value={key}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="account-choices">
              {(
                [
                  ["weather", "Thời tiết"],
                  ["airQuality", "Chất lượng không khí"],
                  ["uv", "Chỉ số UV"],
                  ["fuel", "Giá xăng"],
                  ["gold", "Vàng miếng SJC"],
                  ["usd", "USD/VND"],
                  ["github", "Dự án GitHub"],
                  ["holidays", "Ngày lễ & kỷ niệm"],
                  ["tasks", "Việc cần làm hôm nay"],
                ] as const
              ).map(([key, name]) => (
                <label className="account-check" key={key}>
                  <input
                    type="checkbox"
                    checked={s[key]?.enabled ?? false}
                    onChange={(e) =>
                      patch({
                        [key]: {
                          ...s[key],
                          enabled: e.target.checked,
                          ...(key === "tasks"
                            ? { items: s.tasks?.items ?? [] }
                            : {}),
                        },
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            {!hasSource && (
              <p className="status">
                Chọn ít nhất một nội dung để tạo bản tin hoặc bật lịch tự động.
              </p>
            )}
          </section>

          <section className="account-card" hidden={!showSection("news")}>
            <h2>
              <Icon name="brief" />
              Nguồn tin &amp; GitHub
            </h2>
            <h3>Chủ đề tin tức chọn nhanh ({s.rss.length}/16 nguồn)</h3>
            <div className="account-choices">
              {Object.entries(familyTopics).map(([key, v]) => {
                const url = `https://vnexpress.net/rss/${v.feed}.rss`;
                return (
                  <label className="account-check" key={key}>
                    <input
                      type="checkbox"
                      checked={s.rss.some((f) => f.url === url && f.enabled)}
                      onChange={(e) =>
                        patch({
                          rss: e.target.checked
                            ? [
                                ...s.rss.filter((f) => f.url !== url),
                                {
                                  id: crypto.randomUUID(),
                                  name: "VnExpress · " + v.name,
                                  url,
                                  enabled: true,
                                },
                              ].slice(0, 16)
                            : s.rss.filter((f) => f.url !== url),
                        })
                      }
                    />
                    {v.name}
                  </label>
                );
              })}
            </div>

            <details
              className="custom-rss-Accordion"
              open={customRssFeeds.length > 0}
            >
              <summary>
                Nguồn RSS / Atom tự chọn ({customRssFeeds.length})
              </summary>
              <div className="account-task-editor">
                <div className="account-grid">
                  <label>
                    Tên nguồn báo / blog
                    <input
                      value={feedName}
                      maxLength={80}
                      placeholder="Ví dụ: Hacker News, Tuổi Trẻ Công Nghệ"
                      onChange={(e) => setFeedName(e.target.value)}
                    />
                  </label>
                  <label>
                    Đường dẫn RSS/Atom
                    <input
                      type="url"
                      value={feedUrl}
                      maxLength={2000}
                      placeholder="https://example.com/rss.xml"
                      onChange={(e) => setFeedUrl(e.target.value)}
                    />
                  </label>
                </div>
                {feedError && (
                  <p className="status error" role="alert">
                    {feedError}
                  </p>
                )}
                <button
                  type="button"
                  disabled={s.rss.length >= 16}
                  onClick={addCustomFeed}
                >
                  <Icon name="plus" size={16} /> Thêm nguồn vào bản tin
                </button>
                {customRssFeeds.length > 0 && (
                  <ul className="account-task-list">
                    {customRssFeeds.map((feed) => (
                      <li key={feed.id}>
                        <label className="account-check">
                          <input
                            type="checkbox"
                            checked={feed.enabled}
                            onChange={(e) =>
                              patch({
                                rss: s.rss.map((f) =>
                                  f.id === feed.id
                                    ? { ...f, enabled: e.target.checked }
                                    : f,
                                ),
                              })
                            }
                          />
                          <span>
                            <strong>{feed.name}</strong>
                            <small>{feed.url}</small>
                          </span>
                        </label>
                        <button
                          type="button"
                          aria-label={"Xóa nguồn " + feed.name}
                          onClick={() =>
                            patch({
                              rss: s.rss.filter((f) => f.id !== feed.id),
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>

            <div className="account-task-editor">
              <label className="account-check">
                <input
                  type="checkbox"
                  checked={s.github.enabled}
                  onChange={(e) =>
                    patch({
                      github: { ...s.github, enabled: e.target.checked },
                    })
                  }
                />
                Theo dõi dự án GitHub nổi bật (kèm tóm tắt tiếng Việt)
              </label>
              {s.github.enabled && (
                <div className="account-grid">
                  <label>
                    Chủ đề GitHub (cách nhau bằng dấu phẩy)
                    <input
                      value={s.github.topics.join(",")}
                      placeholder="ai, llm, typescript"
                      onChange={(e) =>
                        patch({
                          github: {
                            ...s.github,
                            topics: e.target.value.split(","),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Ngôn ngữ lập trình
                    <input
                      value={s.github.languages.join(",")}
                      placeholder="TypeScript, Python, Rust"
                      onChange={(e) =>
                        patch({
                          github: {
                            ...s.github,
                            languages: e.target.value.split(","),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Số dự án
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={s.github.repositoryCount || ""}
                      onChange={(e) =>
                        patch({
                          github: {
                            ...s.github,
                            repositoryCount: Math.max(
                              1,
                              Math.min(20, Number(e.target.value) || 1),
                            ),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          </section>

          <section
            className="account-card"
            hidden={!showSection("personal")}
          >
            <h2>
              <Icon name="check" />
              Nhắc việc &amp; Kỷ niệm cá nhân
            </h2>
            <div className="account-choices">
              <label className="account-check">
                <input
                  type="checkbox"
                  checked={s.tasks?.enabled ?? false}
                  onChange={(e) =>
                    patch({
                      tasks: {
                        enabled: e.target.checked,
                        items: s.tasks?.items ?? [],
                      },
                    })
                  }
                />
                Bật nhắc việc buổi sáng
              </label>
              <label className="account-check">
                <input
                  type="checkbox"
                  checked={s.holidays?.enabled ?? false}
                  onChange={(e) =>
                    patch({
                      holidays: {
                        ...s.holidays,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
                Bật lịch lễ &amp; kỷ niệm
              </label>
            </div>

            {s.tasks?.enabled && (
              <div className="account-task-editor">
                <h3>Việc cần làm của bạn ({s.tasks.items.length}/20)</h3>
                <p>
                  Việc đến hạn sẽ tự động xuất hiện đầu bản tin buổi sáng cho đến khi
                  bạn đánh dấu hoàn thành.
                </p>
                <label>
                  Tên việc
                  <input
                    value={taskTitle}
                    maxLength={120}
                    placeholder="Ví dụ: Thanh toán hóa đơn điện, Gửi báo cáo tuần"
                    onChange={(e) => setTaskTitle(e.target.value)}
                  />
                </label>
                <div className="account-grid">
                  <label>
                    Ngày cần làm
                    <input
                      type="date"
                      value={taskDate}
                      onChange={(e) => setTaskDate(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      !taskTitle.trim() ||
                      !taskDate ||
                      s.tasks.items.length >= 20
                    }
                    onClick={() => {
                      patch({
                        tasks: {
                          enabled: true,
                          items: [
                            ...s.tasks!.items,
                            {
                              id: crypto.randomUUID(),
                              title: taskTitle.trim(),
                              date: taskDate,
                              done: false,
                            },
                          ],
                        },
                      });
                      setTaskTitle("");
                    }}
                  >
                    <Icon name="plus" size={16} /> Thêm việc
                  </button>
                </div>
                {s.tasks.items.length > 0 && (
                  <ul className="account-task-list">
                    {s.tasks.items.map((task) => (
                      <li key={task.id}>
                        <label className="account-check">
                          <input
                            type="checkbox"
                            checked={task.done}
                            onChange={(e) =>
                              patch({
                                tasks: {
                                  enabled: true,
                                  items: s.tasks!.items.map((item) =>
                                    item.id === task.id
                                      ? { ...item, done: e.target.checked }
                                      : item,
                                  ),
                                },
                              })
                            }
                          />
                          <span className={task.done ? "task-done" : undefined}>
                            {task.title}
                            <small>
                              {task.date.split("-").reverse().join("/")}
                            </small>
                          </span>
                        </label>
                        <button
                          type="button"
                          aria-label={"Xóa việc " + task.title}
                          onClick={() =>
                            patch({
                              tasks: {
                                enabled: true,
                                items: s.tasks!.items.filter(
                                  (item) => item.id !== task.id,
                                ),
                              },
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {s.holidays?.enabled && (
              <div className="account-task-editor">
                <h3>Ngày kỷ niệm &amp; sinh nhật riêng</h3>
                <p>
                  Bổ sung các ngày đáng nhớ hàng năm (định dạng Tháng-Ngày hợp lệ) bên
                  cạnh các ngày lễ chung của Việt Nam.
                </p>
                <div className="account-grid">
                  <label>
                    Sự kiện kỷ niệm
                    <input
                      value={holidayTitle}
                      maxLength={120}
                      placeholder="Ví dụ: Sinh nhật Mẹ, Kỷ niệm ngày cưới"
                      onChange={(e) => setHolidayTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    Tháng - Ngày (MM-DD)
                    <input
                      value={holidayMonthDay}
                      placeholder="MM-DD (VD: 10-20)"
                      pattern="(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])"
                      onChange={(e) => setHolidayMonthDay(e.target.value)}
                    />
                  </label>
                </div>
                {holidayMonthDay &&
                  /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(holidayMonthDay) &&
                  !isValidMonthDay(holidayMonthDay) && (
                    <small className="field-error">
                      Ngày {holidayMonthDay.split("-").reverse().join("/")} không tồn tại
                      trong lịch dương.
                    </small>
                  )}
                <button
                  type="button"
                  disabled={
                    !validHolidayInput || (s.holidays.items?.length ?? 0) >= 30
                  }
                  onClick={() => {
                    patch({
                      holidays: {
                        enabled: true,
                        items: [
                          ...(s.holidays?.items ?? []),
                          {
                            id: crypto.randomUUID(),
                            title: holidayTitle.trim(),
                            monthDay: holidayMonthDay,
                          },
                        ],
                      },
                    });
                    setHolidayTitle("");
                  }}
                >
                  <Icon name="plus" size={16} /> Thêm ngày kỷ niệm
                </button>
                {(s.holidays.items?.length ?? 0) > 0 && (
                  <ul className="account-task-list">
                    {s.holidays.items!.map((item) => (
                      <li key={item.id}>
                        <span>
                          <strong>{item.title}</strong> · Ngày{" "}
                          {item.monthDay.split("-").reverse().join("/")} hàng năm
                        </span>
                        <button
                          type="button"
                          aria-label={"Xóa kỷ niệm " + item.title}
                          onClick={() =>
                            patch({
                              holidays: {
                                enabled: true,
                                items: s.holidays!.items!.filter(
                                  (x) => x.id !== item.id,
                                ),
                              },
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section
            className="account-card pref-delivery-card"
            hidden={!showSection("delivery")}
          >
            <h2>
              <Icon name="send" />
              Thông báo trên điện thoại
            </h2>
            <PreferenceCheckbox
              label="Gửi thông báo qua ntfy sau bản tin theo lịch"
              checked={s.notifications.enabled}
              onChange={(enabled) =>
                patch({ notifications: { ...s.notifications, enabled } })
              }
            >
              <p>
                Bật lịch bản tin rồi lưu lựa chọn. Cài ứng dụng{" "}
                <strong>ntfy</strong> trên iOS/Android, đăng ký máy chủ{" "}
                <strong>{s.notifications.serverUrl}</strong> với mã topic riêng bên
                dưới. Giữ kín mã topic để bảo mật kênh nhận tin của bạn.
              </p>
              <p>
                Để thử ngay, mở một bản tin đã tạo và bấm{" "}
                <strong>Gửi đến điện thoại</strong>.
              </p>
            </PreferenceCheckbox>
            <div className="secret-topic-box">
              <label htmlFor="account-ntfy-topic">Topic riêng (giữ bí mật)</label>
              <div className="secret-topic-controls">
                <input
                  id="account-ntfy-topic"
                  type={showTopic ? "text" : "password"}
                  readOnly
                  value={s.notifications.topic}
                  onFocus={(e) => {
                    if (showTopic) e.target.select();
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowTopic((v) => !v)}
                  aria-label={showTopic ? "Ẩn mã topic" : "Hiện mã topic"}
                >
                  <Icon name={showTopic ? "eyeOff" : "eye"} size={17} />
                  {showTopic ? "Ẩn" : "Hiện"}
                </button>
                <button type="button" onClick={() => void copyTopic()}>
                  <Icon name={copiedTopic ? "check" : "copy"} size={17} />
                  {copiedTopic ? "Đã chép" : "Sao chép"}
                </button>
                <button
                  type="button"
                  disabled={rotatingTopic}
                  onClick={() => void rotateTopic()}
                  title="Tạo mã topic bí mật mới nếu nghi ngờ lộ kênh nhận tin"
                >
                  <Icon name="refresh" size={16} />
                  {rotatingTopic ? "Đang đổi…" : "Đổi mã topic mới"}
                </button>
              </div>
              {s.notifications.topic && (
                <small className="account-input-hint">
                  Hoặc mở nhanh trên trình duyệt:{" "}
                  <ExternalLink href={ntfyTopicWebUrl} className="text-link">
                    Mở kênh ntfy của bạn
                  </ExternalLink>
                </small>
              )}
            </div>
          </section>

          {error && (
            <p role="alert" className="status error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="status success">
              {notice}
            </p>
          )}

          <div
            className={
              dirty ? "account-actions sticky-save-bar" : "account-actions"
            }
          >
            {dirty && (
              <span className="unsaved-pill">Bạn có thay đổi chưa lưu</span>
            )}
            <button
              type="submit"
              className="primary"
              disabled={
                draft.days.length === 0 || (s.newsletter.enabled && !hasSource)
              }
            >
              {busy ? "Đang lưu…" : "Lưu lựa chọn"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm(
                    "Tải lại sẽ bỏ các thay đổi chưa lưu. Tiếp tục?",
                  )
                ) {
                  setDraft(account);
                  setError("");
                  setNotice("");
                }
              }}
            >
              Đặt lại theo bản đã lưu
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
