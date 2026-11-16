import { requestSignal } from "./request-signal";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  familyCities,
  familyTopics,
  settingsSchema,
  hasEnabledSources,
  calendarDate,
  type Settings,
} from "@hub/contracts";
import DigestDashboard from "./DigestDashboard";
import RunDashboard from "./RunDashboard";
import { Icon } from "./Icons";
const AdminApp = lazy(() => import("./App"));
const PremiumPortal = lazy(() => import("./PremiumPortal"));
type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
};
type Account = {
  user: User;
  settings: Settings;
  days: number[];
  theme: "light" | "dark";
  revision: number;
  nextRunAt: string | null;
  lastCheckedAt: string | null;
};
type Config = { enabled: boolean; registrationOpen: boolean };
async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : method,
    credentials: "same-origin",
    signal: requestSignal(30000),
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message ?? "Không thể kết nối ứng dụng.");
  return data;
}
const when = (value: string | null, timezone: string) =>
  value
    ? new Date(value).toLocaleString("vi-VN", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "Chưa bật lịch";
function AccountBrand() {
  return (
    <>
      <span className="account-brand-mark">
        <Icon name="sun" size={25} />
      </span>
      <span>
        Bản tin mỗi sáng<small>Một ngày mới, theo cách của bạn</small>
      </span>
    </>
  );
}
function MemberGreeting() {
  const [premium, setPremium] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api<{ plan: { premium: boolean } }>("/api/account/plan")
        .then(({ plan }) => {
          if (active) setPremium(plan.premium);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  if (premium === null) return <h2>Chào bạn</h2>;
  return <h2>{premium ? "Chào Thành viên Premium" : "Chào Thành viên"}</h2>;
}
export default function AccountApp() {
  const [config, setConfig] = useState<Config | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [hash, setHash] = useState(window.location.hash);
  const isRunHistory = hash === "#/runs" || hash === "#/runs/";
  const [adminMode, setAdminMode] = useState(
    window.location.hash === "#/admin",
  );
  useEffect(() => {
    const change = () => setHash(window.location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (account?.user.role === "member" && isRunHistory)
      window.location.replace("#/digests");
  }, [account?.user.role, isRunHistory]);
  useEffect(() => {
    let active = true;
    void api<Config>("/api/auth/config")
      .then(async (value) => {
        if (!active) return;
        setConfig(value);
        if (value.enabled) {
          const response = await fetch("/api/account", {
            signal: requestSignal(10000),
          });
          if (response.status !== 401 && !response.ok)
            throw new Error("Chưa tải được tài khoản. Hãy tải lại trang.");
          if (response.ok) {
            const data = await response.json();
            if (active) setAccount(data);
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);
  if (booting)
    return (
      <main className="account-shell">
        <p role="status">Đang mở bản tin…</p>
      </main>
    );
  if (!config)
    return (
      <main className="account-shell">
        <p role="alert">{error}</p>
        <button onClick={() => window.location.reload()}>Thử lại</button>
      </main>
    );
  if (!config.enabled)
    return (
      <Suspense fallback={<p>Đang tải…</p>}>
        <AdminApp />
      </Suspense>
    );
  if (!account) return <Login config={config} onLogin={setAccount} />;
  const isAdmin = account.user.role === "admin";
  const isRunDetail = hash.startsWith("#/runs/") && hash.length > "#/runs/".length;
  function endSession() {
    setAccount(null);
    setAdminMode(false);
    setError("");
    window.location.hash = "/digests";
  }
  async function logout() {
    try {
      await api("/api/auth/logout", {});
      endSession();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className={"account-root theme-" + account.theme}>
      <header className="account-header">
        <a
          className="account-brand"
          href="#/digests"
          onClick={() => setAdminMode(false)}
        >
          <AccountBrand />
        </a>
        <details className="account-menu">
          <summary aria-label={"Tài khoản của " + account.user.name}>
            <span className="account-avatar">
              {account.user.name
                .trim()
                .split(/\s+/)
                .at(-1)
                ?.slice(0, 1)
                .toUpperCase()}
            </span>
            <span className="account-menu-name">{account.user.name}</span>
            <Icon name="chevron" size={16} />
          </summary>
          <div className="account-menu-panel">
            <strong>{account.user.name}</strong>
            <span>{account.user.email}</span>
            <button onClick={() => void logout()}>
              <Icon name="logout" size={18} />
              Đăng xuất
            </button>
          </div>
        </details>
      </header>
      <div className="account-shell">
        <nav
          className={account.user.role === "admin" ? "account-nav account-nav-admin" : "account-nav"}
          aria-label="Điều hướng tài khoản"
        >
          <a href="#/custom" onClick={() => setAdminMode(false)} aria-current={hash === "#/custom" ? "page" : undefined}><Icon name="brief" /><span>Gói & theo dõi</span></a>
          {account.user.role === "admin" && <a href="#/premium-admin" onClick={() => setAdminMode(false)} aria-current={hash === "#/premium-admin" ? "page" : undefined}><Icon name="settings" /><span>Premium & AI</span></a>}
          <a
            href="#/digests"
            onClick={() => setAdminMode(false)}
            aria-current={
              !hash || hash.startsWith("#/digests") || (!isAdmin && isRunDetail)
                ? "page"
                : undefined
            }
          >
            <Icon name="brief" />
            <span>Bản tin của tôi</span>
          </a>
          <a
            href="#/preferences"
            onClick={() => setAdminMode(false)}
            aria-current={
              hash.includes("preferences") || hash.startsWith("#/settings")
                ? "page"
                : undefined
            }
          >
            <Icon name="settings" />
            <span>Tùy chọn bản tin</span>
          </a>
          {isAdmin && <a
            href="#/runs"
            onClick={() => setAdminMode(false)}
            aria-current={hash.startsWith("#/runs") ? "page" : undefined}
          >
            <Icon name="activity" />
            <span>Lịch sử xử lý</span>
          </a>}
          <a
            href="#/password"
            onClick={() => setAdminMode(false)}
            aria-current={hash === "#/password" ? "page" : undefined}
          >
            <Icon name="lock" />
            <span>Mật khẩu</span>
          </a>
          {account.user.role === "admin" && (
            <>
              <a
                href="#/users"
                onClick={() => setAdminMode(false)}
                aria-current={hash === "#/users" ? "page" : undefined}
              >
                <Icon name="user" />
                <span>Thành viên</span>
              </a>
              <a href="#/admin" onClick={() => setAdminMode(true)}>
                <Icon name="settings" />
                <span>Quản trị hệ thống</span>
              </a>
            </>
          )}
        </nav>
        {error && (
          <p className="status error" role="alert">
            {error}
          </p>
        )}
        {adminMode && account.user.role === "admin" ? (
          <Suspense fallback={<p>Đang tải…</p>}>
            <AdminApp />
          </Suspense>
        ) : hash === "#/custom" || (hash === "#/premium-admin" && account.user.role === "admin") ? (
          <Suspense fallback={<p role="status">Đang tải…</p>}>
            <PremiumPortal
              key={hash}
              admin={hash === "#/premium-admin"}
              email={account.user.email}
            />
          </Suspense>
        ) : hash === "#/users" && account.user.role === "admin" ? (
          <Users />
        ) : hash === "#/password" ? (
          <PasswordForm onLogout={endSession} />
        ) : hash.startsWith("#/settings") || hash === "#/preferences" ? (
          <Preferences
            key={account.user.id}
            account={account}
            onSaved={setAccount}
          />
        ) : isRunDetail || (isAdmin && isRunHistory) ? (
          <RunDashboard hash={hash} listUrl="/api/account/runs" showDiagnostics={isAdmin} />
        ) : (
          <>
            {!hash.startsWith("#/digests/") && (
              <section className="account-welcome">
                <div>
                  <p className="account-date">
                    {new Date().toLocaleDateString("vi-VN", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      timeZone: account.settings.newsletter.timezone,
                    })}
                  </p>
                  {isAdmin ? (
                    <h2>Chào {account.user.name}.</h2>
                  ) : (
                    <MemberGreeting key={account.user.id} />
                  )}
                  {account.settings.weather.location && <div className="account-interest-tags">
                    <span>
                      <Icon name="sun" size={16} />
                      {account.settings.weather.location}
                    </span>
                  </div>}
                </div>
                <div className="account-schedule-preview">
                  <span>
                    <Icon name="calendar" size={18} />
                    Lịch bản tin của bạn
                  </span>
                  <strong>
                    {account.nextRunAt
                      ? when(
                          account.nextRunAt,
                          account.settings.newsletter.timezone,
                        )
                      : "Chưa đặt lịch nhận"}
                  </strong>
                </div>
              </section>
            )}
            <DigestDashboard
              key={account.user.id}
              hash={hash}
              apiBase="/api/account"
              accountId={account.user.id}
              canCreate={hasEnabledSources(account.settings)}
            />
          </>
        )}
      </div>
    </div>
  );
}
function Login({
  config,
  onLogin,
}: {
  config: Config;
  onLogin: (value: Account) => void;
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/" + (register ? "register" : "login"), {
        email: form.get("email"),
        password: form.get("password"),
        ...(register ? { name: form.get("name") } : {}),
      });
      onLogin(await api<Account>("/api/account"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-login">
      <header className="account-login-header">
        <a className="account-brand" href="#">
          <AccountBrand />
        </a>
        <span>Bắt đầu ngày mới thật nhẹ nhàng</span>
      </header>
      <main className="account-login-layout">
        <section className="account-intro">
          <h1>
            Ngày mới bắt đầu.
            <br />
            Theo cách của bạn.
          </h1>
          <p>
            Những tin tức bạn quan tâm, thời tiết nơi bạn sống. Tất cả gọn trong
            một bản tin mỗi sáng.
          </p>
          <div className="account-morning-art" aria-hidden="true">
            <div className="morning-sun" />
            <div className="morning-horizon" />
            <div className="morning-preview">
              <div className="morning-preview-header">
                <span className="morning-preview-icon">
                  <Icon name="brief" size={24} />
                </span>
                <div>
                  <strong>Bản tin buổi sáng</strong>
                  <span>Chỉ những điều bạn quan tâm</span>
                </div>
                <Icon name="check" size={19} />
              </div>
              <div className="morning-preview-topics">
                <span>
                  <Icon name="sun" size={19} />
                  Thời tiết
                </span>
                <span>
                  <Icon name="brief" size={19} />
                  Tin mới
                </span>
                <span>
                  <Icon name="activity" size={19} />
                  Thị trường
                </span>
              </div>
              <div className="morning-preview-footer">
                <Icon name="calendar" size={18} />
                <span>Lịch của bạn. Nhịp sống của bạn.</span>
              </div>
            </div>
          </div>
          <div className="account-benefits">
            <span>
              <Icon name="check" size={17} />
              Nội dung tự chọn
            </span>
            <span>
              <Icon name="check" size={17} />
              Lịch nhận riêng
            </span>
            <span>
              <Icon name="check" size={17} />
              Đọc trên mọi thiết bị
            </span>
          </div>
        </section>
        <section
          className="account-card account-auth-card"
          aria-labelledby="account-auth-title"
        >
          <span className="account-auth-mark">
            <Icon name={register ? "user" : "lock"} size={23} />
          </span>
          <h2 id="account-auth-title">
            {register ? "Tạo tài khoản của bạn" : "Chào mừng trở lại"}
          </h2>
          <p>
            {register
              ? "Bắt đầu bằng những lựa chọn của bạn."
              : "Một chút cập nhật đang chờ bạn."}
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {register && (
                <label>
                  Tên hiển thị
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={60}
                  />
                </label>
              )}
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="ban@example.com"
                  required
                  maxLength={254}
                />
              </label>
              <div className="account-password-field">
                <label htmlFor="account-login-password">Mật khẩu</label>
                <span className="account-password-input">
                  <input
                    id="account-login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                    placeholder={
                      register
                        ? "Tạo mật khẩu từ 12 ký tự"
                        : "Nhập mật khẩu của bạn"
                    }
                    required
                    minLength={12}
                    maxLength={128}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? "Ẩn" : "Hiện"}
                  </button>
                </span>
              </div>
              {register && (
                <small className="account-input-hint">
                  Dùng ít nhất 12 ký tự để bảo vệ tài khoản.
                </small>
              )}
              {error && (
                <p role="alert" className="status error">
                  {error}
                </p>
              )}
              <button className="primary" type="submit">
                {busy ? "Đang xử lý…" : register ? "Đăng ký" : "Đăng nhập"}
              </button>
            </fieldset>
          </form>
          {!register && (
            <details className="account-login-help">
              <summary>Bạn quên mật khẩu?</summary>
              <p>
                Liên hệ người quản trị ứng dụng để đặt lại mật khẩu cho tài
                khoản của bạn.
              </p>
            </details>
          )}
          {config.registrationOpen && (
            <button
              className="account-switch"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register
                ? "Đã có tài khoản? Đăng nhập"
                : "Chưa có tài khoản? Đăng ký"}
            </button>
          )}
        </section>
      </main>
      <footer className="account-login-footer">
        Bản tin của bạn. Một khoảng yên trước ngày bận rộn.
      </footer>
    </div>
  );
}
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
          <span aria-hidden="true">!</span>
        </button>
      </div>
      <div id={helpId} className="account-check-guidance" hidden={!helpOpen}>
        {children}
      </div>
    </div>
  );
}
function Preferences({
  account,
  onSaved,
}: {
  account: Account;
  onSaved: (value: Account) => void;
}) {
  const [draft, setDraft] = useState(account),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const s = draft.settings;
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDate, setTaskDate] = useState(() =>
    calendarDate(new Date(), account.settings.newsletter.timezone),
  );
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
      const result = await api<{ revision: number; nextRunAt: string | null }>(
        "/api/account/preferences",
        {
          settings: parsed.data,
          days: draft.days,
          theme: draft.theme,
          revision: draft.revision,
        },
        "PUT",
      );
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
  return (
    <section className="account-preferences">
      <h1>Tùy chọn bản tin</h1>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <section className="account-card">
            <h2>
              <Icon name="calendar" />
              Thời gian nhận
            </h2>
            <PreferenceCheckbox
              label="Tự động tạo bản tin theo lịch"
              checked={s.newsletter.enabled}
              onChange={(enabled) =>
                patch({ newsletter: { ...s.newsletter, enabled } })
              }
            >
              <p>Lưu lựa chọn để lịch có hiệu lực, kể cả khi bạn đã đóng trang.</p>
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
                  <option value="Europe/London" />
                  <option value="America/New_York" />
                </datalist>
              </label>
            </div>
            <div className="account-choices">
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
                          ? [...draft.days, i + 1].sort()
                          : draft.days.filter((d) => d !== i + 1),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <p>
              Lần gửi tiếp theo:{" "}
              {when(account.nextRunAt, account.settings.newsletter.timezone)}.
            </p>
          </section>
          <section className="account-card">
            <h2>
              <Icon name="brief" />
              Tiện ích buổi sáng
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
                  ["fuel", "Giá xăng"],
                  ["gold", "Vàng miếng SJC"],
                  ["usd", "USD/VND"],
                  ["github", "Dự án GitHub"],
                  ["uv", "Chỉ số UV"],
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
            {s.tasks?.enabled && (
              <div className="account-task-editor">
                <h3>Việc cần làm của bạn</h3>
                <p>
                  Việc đến hạn sẽ xuất hiện trong bản tin nếu chưa hoàn thành.
                </p>
                <label>
                  Tên việc
                  <input
                    value={taskTitle}
                    maxLength={120}
                    placeholder="Ví dụ: Thanh toán hóa đơn điện"
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
                    Thêm việc
                  </button>
                </div>
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
                <small>Tối đa 20 việc. Nhấn Lưu lựa chọn để áp dụng.</small>
              </div>
            )}
            <h3>Chủ đề tin tức</h3>
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
                              ]
                            : s.rss.filter((f) => f.url !== url),
                        })
                      }
                    />
                    {v.name}
                  </label>
                );
              })}
            </div>
            {s.github.enabled && (
              <div className="account-grid">
                <label>
                  Chủ đề GitHub (cách nhau bằng dấu phẩy)
                  <input
                    value={s.github.topics.join(",")}
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
                    value={s.github.repositoryCount}
                    onChange={(e) =>
                      patch({
                        github: {
                          ...s.github,
                          repositoryCount: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}
            {!hasSource && <p>Chọn ít nhất một nội dung để tạo bản tin hoặc bật lịch.</p>}
          </section>
          <section className="account-card">
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
              <p>Bật lịch bản tin rồi lưu lựa chọn. Trong ntfy, đăng ký tại <strong>{s.notifications.serverUrl}</strong> bằng topic bên dưới. Giữ kín topic.</p>
              <p>Để thử, mở bản tin đã tạo và bấm <strong>Gửi đến điện thoại</strong>.</p>
            </PreferenceCheckbox>
            <label>
              Topic riêng
              <input
                readOnly
                value={s.notifications.topic}
                onFocus={(e) => e.target.select()}
              />
            </label>
          </section>
          <section className="account-card">
            <h2>
              <Icon name="sun" />
              Giao diện
            </h2>
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
                <option value="light">Sáng</option>
                <option value="dark">Tối</option>
              </select>
            </label>
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
          <div className="account-actions">
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
                  window.confirm(
                    "Tải lại sẽ bỏ các thay đổi chưa lưu. Tiếp tục?",
                  )
                )
                  window.location.reload();
              }}
            >
              Tải lại cấu hình
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
function PasswordForm({ onLogout }: { onLogout: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/password", {
        currentPassword: form.get("current"),
        password: form.get("password"),
      });
      onLogout();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-card">
      <h1>Đổi mật khẩu</h1>
      <p>Đổi thành công sẽ đăng xuất tất cả thiết bị.</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Mật khẩu hiện tại
            <input
              type="password"
              name="current"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <label>
            Mật khẩu mới
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="primary">
            {busy ? "Đang lưu…" : "Đổi mật khẩu"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
function Users() {
  const [users, setUsers] = useState<(User & { disabled: boolean })[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const data = await api<{ users: (User & { disabled: boolean })[] }>(
      "/api/admin/users",
    );
    setUsers(data.users);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function toggle(user: User & { disabled: boolean }) {
    setBusy(true);
    setError("");
    try {
      await api(
        "/api/admin/users/" + user.id,
        { disabled: !user.disabled },
        "PATCH",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-card">
      <h1>Thành viên</h1>
      <p>
        Khóa tài khoản sẽ thu hồi phiên đăng nhập và dừng các lịch mới. Bản tin
        đang xử lý có thể vẫn hoàn tất.
      </p>
      {error && <p role="alert">{error}</p>}
      <ul>
        {users.map((u) => (
          <li key={u.id}>
            <strong>{u.name}</strong> · {u.email} ·{" "}
            {u.role === "admin"
              ? "Quản trị viên"
              : u.disabled
                ? "Đã khóa"
                : "Đang hoạt động"}{" "}
            {u.role === "member" && (
              <button disabled={busy} onClick={() => void toggle(u)}>
                {u.disabled ? "Mở khóa" : "Khóa"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
