import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../Icons";
import {
  apiRequest,
  readStoredTheme,
  writeStoredTheme,
  type Account,
  type AuthConfig,
} from "../lib/api-client";

export function AccountBrand() {
  return (
    <>
      <span className="account-brand-mark">
        <Icon name="sunrise" size={23} />
      </span>
      <span className="account-brand-text">Bản tin mỗi sáng</span>
    </>
  );
}

function passwordStrength(value: string): {
  score: 0 | 1 | 2 | 3;
  label: string;
} {
  if (!value) return { score: 0, label: "Tối thiểu 12 ký tự" };
  if (value.length < 12) {
    return {
      score: 1,
      label: `Cần thêm ${12 - value.length} ký tự nữa (${value.length}/12)`,
    };
  }
  const classes = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;
  if (value.length >= 16 && classes >= 3) {
    return { score: 3, label: "Mật khẩu rất mạnh" };
  }
  return { score: 2, label: "Đạt chuẩn an toàn (12+ ký tự)" };
}

const SNAPSHOT_METRICS = [
  { label: "Hà Nội", value: "23–28°C", sub: "AQI 64" },
  { label: "Vàng SJC", value: "8,92 tr", sub: "Đáy 30N" },
  { label: "USD/VND", value: "25.410", sub: "VCB" },
] as const;

export function AuthPortal({
  config,
  onLogin,
}: {
  config: AuthConfig;
  onLogin: (value: Account) => void;
}) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [darkPreview, setDarkPreview] = useState(() => {
    const stored = readStoredTheme();
    if (stored) return stored === "dark";
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.style.backgroundColor = darkPreview
      ? "#12211c"
      : "#f3f7f6";
    document.documentElement.style.colorScheme = darkPreview ? "dark" : "light";
  }, [darkPreview]);

  const strength = passwordStrength(passwordValue);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest("/api/auth/" + (register ? "register" : "login"), {
        body: {
          email: form.get("email"),
          password: form.get("password"),
          ...(register ? { name: form.get("name") } : {}),
        },
        notifyUnauthorized: false,
      });
      const chosenTheme: "light" | "dark" = darkPreview ? "dark" : "light";
      writeStoredTheme(chosenTheme);
      const account = await apiRequest<Account>("/api/account");
      if (account.theme !== chosenTheme) {
        void apiRequest("/api/account/theme", {
          method: "PATCH",
          body: { theme: chosenTheme },
        }).catch(() => {});
      }
      onLogin({ ...account, theme: chosenTheme });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={darkPreview ? "account-login theme-dark" : "account-login"}>
      <header className="account-login-header">
        <a className="account-brand" href="#">
          <AccountBrand />
        </a>
        <div className="account-login-header-actions">
          <a href="#/today" className="public-today-header-link">
            <Icon name="brief" size={16} />
            <span>Bản tin hôm nay</span>
          </a>
          <button
            type="button"
            className="theme-toggle-pill"
            aria-label={
              darkPreview
                ? "Chuyển sang giao diện sáng"
                : "Chuyển sang giao diện tối"
            }
            onClick={() =>
              setDarkPreview((v) => {
                const next = !v;
                writeStoredTheme(next ? "dark" : "light");
                return next;
              })
            }
          >
            <Icon name={darkPreview ? "sun" : "moon"} size={17} />
            <span>{darkPreview ? "Sáng" : "Tối"}</span>
          </button>
        </div>
      </header>
      <main className="account-login-layout">
        <section className="account-intro">
          <h1>
            Ngày mới bắt đầu.
            <br />
            Theo cách của bạn.
          </h1>
          <p className="account-lead">
            Thời tiết, giá vàng, tỷ giá &amp; tin chọn lọc lúc 07:00.
          </p>

          <div
            className="morning-showcase"
            aria-label="Xem thử nội dung bản tin buổi sáng"
          >
            <div className="morning-showcase-card">
              <div className="morning-showcase-metrics">
                {SNAPSHOT_METRICS.map((m) => (
                  <div key={m.label} className="morning-metric-box">
                    <span>{m.label}</span>
                    <strong>{m.value}</strong>
                    <small>{m.sub}</small>
                  </div>
                ))}
              </div>
              <a href="#/today" className="public-today-entry-btn">
                <Icon name="brief" size={16} />
                <span>Đọc bản tin hôm nay</span>
              </a>
            </div>
          </div>
        </section>

        <section
          id="account-auth-form-card"
          className="account-card account-auth-card"
          aria-labelledby="account-auth-title"
        >
          <span className="account-auth-mark">
            <Icon name={register ? "user" : "lock"} size={22} />
          </span>
          <h2 id="account-auth-title">
            {register ? "Tạo tài khoản" : "Đăng nhập"}
          </h2>
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {register && (
                <label>
                  Tên hiển thị
                  <input
                    name="name"
                    autoComplete="name"
                    placeholder="Ví dụ: Minh Nguyễn"
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
                    value={passwordValue}
                    onChange={(e) => setPasswordValue(e.target.value)}
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
                <div className="password-meter" aria-live="polite">
                  <div
                    className="password-meter-bars"
                    data-score={strength.score}
                  >
                    <span />
                    <span />
                    <span />
                  </div>
                  <small className="account-input-hint">{strength.label}</small>
                </div>
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
              <summary>Quên mật khẩu?</summary>
              <p>Liên hệ quản trị viên để đặt lại mật khẩu.</p>
            </details>
          )}
          {config.registrationOpen ? (
            <button
              type="button"
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
          ) : (
            <p className="invite-only-note">
              Máy chủ mở theo lời mời riêng.
            </p>
          )}
        </section>
      </main>

      <footer className="account-login-footer">
        Bản tin mỗi sáng
      </footer>
    </div>
  );
}
