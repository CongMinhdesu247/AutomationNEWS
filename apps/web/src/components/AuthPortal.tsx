import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../Icons";
import { apiRequest, type Account, type AuthConfig } from "../lib/api-client";

export function AccountBrand() {
  return (
    <>
      <span className="account-brand-mark">
        <Icon name="sun" size={24} />
      </span>
      <span>
        Bản tin mỗi sáng<small>Một ngày mới, theo cách của bạn</small>
      </span>
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

const PREVIEW_TABS = [
  {
    key: "weather",
    label: "Thời tiết & AQI",
    badge: "Hà Nội · 23–28°C",
    headline: "Sáng mát dịu, nắng nhẹ trưa — chất lượng không khí ở mức Trung bình",
    metrics: [
      { label: "Nhiệt độ", value: "23–28°C", sub: "Mưa chiều 15%" },
      { label: "Không khí", value: "AQI 64", sub: "PM2.5: 18.2 µg/m³" },
      { label: "Chỉ số UV", value: "5.2", sub: "Trung bình" },
    ],
    bullets: [
      "Thuận lợi cho chạy bộ buổi sáng và di chuyển ngoài trời",
      "Nhắc lịch cá nhân: 2 việc cần hoàn thành trước 17:00 hôm nay",
    ],
  },
  {
    key: "markets",
    label: "Vàng SJC & Tỷ giá",
    badge: "Đối chiếu 30 ngày",
    headline: "Vàng miếng SJC lùi về vùng đáy 30 ngày · Tỷ giá USD ổn định",
    metrics: [
      { label: "Vàng SJC", value: "8.920.000 đ", sub: "Chạm đáy 30 ngày" },
      { label: "USD/VND", value: "25.410 đ", sub: "Vietcombank bán" },
      { label: "Xăng RON 95", value: "20.540 đ/l", sub: "▼ -280 đ kỳ này" },
    ],
    bullets: [
      "Tự động đối chiếu dữ liệu lịch sử 30 ngày đã xác minh mỗi sáng",
      "Cảnh báo nổi bật trên điện thoại ngay khi chạm vùng giá thấp nhất",
    ],
  },
  {
    key: "news",
    label: "Tin chọn lọc",
    badge: "RSS & Theo dõi riêng",
    headline: "Đọc lướt toàn cảnh trong 2 phút, không quảng cáo & giật tít",
    metrics: [
      { label: "Nguồn báo", value: "Đa đầu báo", sub: "Khử bài trùng lặp" },
      { label: "Theo dõi", value: "Từ khóa riêng", sub: "Việc làm & Học bổng" },
      { label: "Đọc sau", value: "1 chạm", sub: "Đồng bộ tài khoản" },
    ],
    bullets: [
      "Chọn nhanh VnExpress hoặc tự thêm bất kỳ kênh RSS/Atom yêu thích",
      "Tích hợp trợ lý AI tóm tắt chủ đề & lọc cơ hội theo điều kiện riêng",
    ],
  },
  {
    key: "github",
    label: "GitHub tiếng Việt",
    badge: "Bản dịch tự động",
    headline: "Bắt kịp các dự án mã nguồn mở tăng sao nhanh nhất 24 giờ qua",
    metrics: [
      { label: "Ngôn ngữ", value: "TS · Python", sub: "Lọc theo chủ đề" },
      { label: "Tóm tắt", value: "Tiếng Việt", sub: "Dịch tự động gọn rõ" },
      { label: "Đà tăng", value: "+420 ★/24h", sub: "So với snapshot hôm qua" },
    ],
    bullets: [
      "Theo dõi tốc độ tăng sao thực tế qua snapshot 24 giờ riêng",
      "Lưu nhanh repository hay vào danh sách đọc sau chỉ với một cú nhấp",
    ],
  },
] as const;

type PublicPreview = {
  starterSourcesCount: number;
  latestCatalogArticles: Array<{
    title: string;
    source: string;
    publishedAt: string;
  }>;
};

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
  const [previewTab, setPreviewTab] =
    useState<(typeof PREVIEW_TABS)[number]["key"]>("weather");
  const [darkPreview, setDarkPreview] = useState(() => {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });
  const [publicPreview, setPublicPreview] = useState<PublicPreview | null>(null);
  const sampleDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    document.documentElement.style.backgroundColor = darkPreview
      ? "#12211c"
      : "#f3f7f6";
    document.documentElement.style.colorScheme = darkPreview ? "dark" : "light";
  }, [darkPreview]);

  useEffect(() => {
    let active = true;
    void apiRequest<PublicPreview>("/api/public/preview", {
      timeoutMs: 6000,
      notifyUnauthorized: false,
    })
      .then((res) => {
        if (active) setPublicPreview(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const activeSample =
    PREVIEW_TABS.find((t) => t.key === previewTab) ?? PREVIEW_TABS[0];
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
      onLogin(await apiRequest<Account>("/api/account"));
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
            <Icon name="sun" size={16} />
            <span>Ấn bản Sáng nay</span>
          </a>
          <span className="account-login-tagline">
            Khoảng lặng thông tin mỗi 7 giờ sáng
          </span>
          <a href="#account-auth-form-card" className="mobile-jump-login">
            Đăng nhập
          </a>
          <button
            type="button"
            className="theme-icon-button"
            aria-label={
              darkPreview
                ? "Chuyển sang giao diện sáng"
                : "Xem thử giao diện tối"
            }
            onClick={() => setDarkPreview((v) => !v)}
          >
            <Icon name={darkPreview ? "sun" : "moon"} size={18} />
          </button>
        </div>
      </header>
      <main className="account-login-layout">
        <section className="account-intro">
          <div className="account-eyebrow-pill">
            <Icon name="sparkle" size={15} />
            <span>
              Tự động hóa bản tin cá nhân &amp; gia đình
              {publicPreview && publicPreview.starterSourcesCount > 0
                ? ` · ${publicPreview.starterSourcesCount} nguồn chọn sẵn`
                : ""}
            </span>
          </div>
          <h1>
            Ngày mới bắt đầu.
            <br />
            Theo cách của bạn.
          </h1>
          <p className="account-lead">
            Tin tức chọn lọc, thời tiết, chất lượng không khí, giá vàng SJC, tỷ
            giá USD, xăng dầu và những việc cần làm hôm nay — biên tập gọn gàng
            trong một trang báo sáng yên tĩnh gửi thẳng tới điện thoại của bạn.
          </p>

          <div
            className="morning-showcase"
            aria-label="Xem thử nội dung bản tin buổi sáng"
          >
            <div className="morning-showcase-tabs" role="tablist">
              {PREVIEW_TABS.map((tab) => (
                <button
                  key={tab.key}
                  id={`preview-tab-${tab.key}`}
                  type="button"
                  role="tab"
                  aria-selected={previewTab === tab.key}
                  aria-controls={`preview-panel-${tab.key}`}
                  className={
                    previewTab === tab.key
                      ? "morning-tab active"
                      : "morning-tab"
                  }
                  onClick={() => setPreviewTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              id={`preview-panel-${activeSample.key}`}
              className="morning-showcase-card"
              role="tabpanel"
              aria-labelledby={`preview-tab-${activeSample.key}`}
            >
              <div className="morning-showcase-meta">
                <span className="morning-preview-icon">
                  <Icon name="brief" size={20} />
                </span>
                <div>
                  <strong>Bản tin mẫu · 07:00 sáng</strong>
                  <span>{activeSample.badge}</span>
                </div>
                <span className="morning-live-pill">Tự động</span>
              </div>
              <h3 className="morning-showcase-headline">
                {activeSample.headline}
              </h3>
              <div className="morning-showcase-metrics">
                {activeSample.metrics.map((m) => (
                  <div key={m.label} className="morning-metric-box">
                    <span>{m.label}</span>
                    <strong>{m.value}</strong>
                    <small>{m.sub}</small>
                  </div>
                ))}
              </div>
              <ul className="morning-showcase-list">
                {activeSample.bullets.map((bullet) => (
                  <li key={bullet}>
                    <Icon name="check" size={16} />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <div className="morning-showcase-footer">
                <a href="#/today" className="public-today-entry-btn">
                  <Icon name="sun" size={16} />
                  <span>Đọc Ấn bản Sáng nay (Không cần đăng nhập)</span>
                </a>
                <button
                  type="button"
                  className="sample-reader-trigger"
                  onClick={() => sampleDialogRef.current?.showModal()}
                >
                  <Icon name="eye" size={16} />
                  <span>Xem cấu trúc mẫu</span>
                </button>
              </div>
            </div>
          </div>

          <div className="account-benefits">
            <span>
              <Icon name="check" size={17} />
              Không quảng cáo &amp; thuật toán gây xao nhãng
            </span>
            <span>
              <Icon name="bell" size={17} />
              Thông báo trực tiếp ngay trên trình duyệt
            </span>
            <span>
              <Icon name="shield" size={17} />
              Dữ liệu cách ly riêng từng tài khoản
            </span>
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
            {register ? "Tạo tài khoản của bạn" : "Chào mừng trở lại"}
          </h2>
          <p className="account-auth-subtitle">
            {register
              ? "Thiết lập không gian đọc tin riêng chỉ trong 30 giây."
              : "Đăng nhập để đọc bản tin và quản lý lịch nhận tin của bạn."}
          </p>
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
              <summary>Bạn quên mật khẩu?</summary>
              <p>
                Liên hệ người quản trị ứng dụng để đặt lại mật khẩu an toàn cho
                tài khoản của bạn.
              </p>
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
              Máy chủ đang mở theo lời mời riêng cho thành viên gia đình &amp;
              nhóm nội bộ.
            </p>
          )}
        </section>
      </main>

      <dialog
        ref={sampleDialogRef}
        className="sample-digest-dialog"
        aria-labelledby="sample-digest-dialog-title"
        onClick={(e) => {
          if (e.target === sampleDialogRef.current) {
            sampleDialogRef.current.close();
          }
        }}
      >
        <div className="sample-digest-sheet">
          <div className="sample-digest-header">
            <div>
              <span className="section-kicker">Ấn bản minh họa · 07:00 sáng</span>
              <h2 id="sample-digest-dialog-title">Bản tin buổi sáng của Minh</h2>
            </div>
            <button
              type="button"
              onClick={() => sampleDialogRef.current?.close()}
            >
              Đóng
            </button>
          </div>
          <div className="sample-digest-grid">
            <div className="sample-digest-block">
              <strong className="sample-block-title">
                <Icon name="sun" size={17} />
                <span>Hà Nội · 23–28°C · Trời mát nhẹ</span>
              </strong>
              <p>
                Khả năng mưa 15% · AQI Mỹ 64 (Trung bình) · UV cực đại 5.2.
                Thuận lợi di chuyển buổi sáng.
              </p>
            </div>
            <div className="sample-digest-block">
              <strong className="sample-block-title">
                <Icon name="activity" size={17} />
                <span>Thị trường sáng nay</span>
              </strong>
              <p>
                Vàng SJC: Mua 8.770.000 · Bán 8.920.000 đ/chỉ (Đáy 30 ngày)
                <br />
                USD Vietcombank: 25.410 đ · Xăng RON 95-III: 20.540 đ/lít
              </p>
            </div>
          </div>
          <div className="sample-digest-articles">
            <h3>Điểm tin chọn lọc</h3>
            <ul>
              {(publicPreview?.latestCatalogArticles.length
                ? publicPreview.latestCatalogArticles
                : [
                    {
                      title:
                        "Hạ tầng số và tự động hóa giúp tiết kiệm hàng giờ tổng hợp thông tin mỗi tuần",
                      source: "VnExpress · Công nghệ",
                    },
                    {
                      title:
                        "Lãi suất liên ngân hàng và tỷ giá duy trì biên độ ổn định trong tuần mới",
                      source: "VnExpress · Kinh doanh",
                    },
                    {
                      title:
                        "Gợi ý thói quen 10 phút buổi sáng giúp giữ sự tập trung suốt ngày làm việc",
                      source: "Đời sống · Chuyên mục sáng",
                    },
                  ]
              ).map((a) => (
                <li key={a.title}>
                  <strong>{a.title}</strong>
                  <small>{a.source}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </dialog>

      <footer className="account-login-footer">
        Bản tin của bạn · Một khoảng yên tĩnh trước ngày bận rộn.
      </footer>
    </div>
  );
}
