import { useEffect, useMemo, useState } from "react";
import {
  formatDateTime,
  type DigestSources,
  type PublicTodayEdition,
} from "@hub/contracts";
import { Icon } from "../../Icons";
import {
  apiRequest,
  readStoredTheme,
  writeStoredTheme,
} from "../../lib/api-client";
import { AccountBrand } from "../../components/AuthPortal";
import { ExternalLink } from "../../components/ExternalLink";
import { MorningBento } from "../digests/MorningBento";
import {
  buildSharePayloadFromPublicToday,
  ShareCardModal,
} from "../share/ShareCardModal";

function toSyntheticSources(
  edition: PublicTodayEdition,
  cityKey: "hanoi" | "hcmc",
): DigestSources {
  const city =
    edition.cities.find((c) => c.key === cityKey) ?? edition.cities[0];
  const at = edition.generatedAt;
  return {
    rss: {
      status: edition.articles.length ? "success" : "partial",
      fetchedAt: at,
      data: {
        items: edition.articles,
        skippedInvalidDate: 0,
        skippedInvalidItem: 0,
        feedsSucceeded: 1,
        feedsTotal: 1,
      },
      errors: [],
    },
    weather: {
      status: city?.weather ? "success" : "failed",
      fetchedAt: at,
      data: city?.weather ?? null,
      errors: [],
    },
    airQuality: {
      status: city?.airQuality ? "success" : "failed",
      fetchedAt: at,
      data: city?.airQuality ?? null,
      errors: [],
    },
    gold: {
      status: edition.markets.gold ? "success" : "failed",
      fetchedAt: at,
      data: edition.markets.gold,
      errors: [],
    },
    usd: {
      status: edition.markets.usd ? "success" : "failed",
      fetchedAt: at,
      data: edition.markets.usd,
      errors: [],
    },
    fuel: {
      status: edition.markets.fuel ? "success" : "failed",
      fetchedAt: at,
      data: edition.markets.fuel,
      errors: [],
    },
    github: {
      status: "disabled",
      fetchedAt: at,
      data: {
        rising: [],
        newNotable: [],
        candidates: 0,
        withoutBaseline: 0,
        comparisonWindowHours: [20, 28],
        rateLimits: [],
      },
      errors: [],
    },
  };
}

export function PublicTodayView({
  authenticated,
  registrationOpen = true,
  initialTheme,
}: {
  authenticated: boolean;
  registrationOpen?: boolean;
  initialTheme?: "light" | "dark";
}) {
  const [edition, setEdition] = useState<PublicTodayEdition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cityKey, setCityKey] = useState<"hanoi" | "hcmc">("hanoi");
  const [shareOpen, setShareOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [dark, setDark] = useState(() => {
    if (initialTheme) return initialTheme === "dark";
    const stored = readStoredTheme();
    if (stored) return stored === "dark";
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (authenticated) return;
    document.documentElement.style.backgroundColor = dark
      ? "#12211c"
      : "#f3f7f6";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark, authenticated]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void apiRequest<PublicTodayEdition>("/api/public/today", {
      signal: controller.signal,
      timeoutMs: 20000,
      notifyUnauthorized: false,
    })
      .then((res) => {
        if (!controller.signal.aborted) setEdition(res);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Chưa tải được Ấn bản Sáng nay. Vui lòng thử lại.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadTick]);

  const syntheticSources = useMemo(
    () => (edition ? toSyntheticSources(edition, cityKey) : null),
    [edition, cityKey],
  );

  const sharePayload = useMemo(
    () =>
      edition ? buildSharePayloadFromPublicToday(edition, cityKey) : null,
    [edition, cityKey],
  );

  const content = (
    <div className="public-today-page">
      <section className="public-today-hero">
        <div className="public-today-hero-top">
          <div>
            <span className="account-eyebrow-pill">
              <Icon name="brief" size={14} />
              <span>Bản tin sáng nay</span>
            </span>
            <h1>
              {edition
                ? new Date(
                    edition.solarDate + "T00:00:00+07:00",
                  ).toLocaleDateString("vi-VN", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "Asia/Ho_Chi_Minh",
                  })
                : "Ấn bản Buổi sáng Việt Nam"}
            </h1>
          </div>

          <div className="public-today-controls">
            <div
              className="city-switch-pills"
              role="group"
              aria-label="Chọn thành phố xem thời tiết"
            >
              <button
                type="button"
                aria-pressed={cityKey === "hanoi"}
                className={cityKey === "hanoi" ? "pill-active" : undefined}
                onClick={() => setCityKey("hanoi")}
              >
                Hà Nội
              </button>
              <button
                type="button"
                aria-pressed={cityKey === "hcmc"}
                className={cityKey === "hcmc" ? "pill-active" : undefined}
                onClick={() => setCityKey("hcmc")}
              >
                TP. Hồ Chí Minh
              </button>
            </div>
            {edition && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShareOpen(true)}
              >
                <Icon name="share" size={16} />
                Chia sẻ thẻ sáng nay
              </button>
            )}
          </div>
        </div>
      </section>

      {loading && (
        <div className="digest-skeleton-stack" role="status">
          <div className="skeleton-bento">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
          <div className="skeleton-card skeleton-list" />
        </div>
      )}

      {error && (
        <div className="account-card">
          <p className="status error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => setReloadTick((v) => v + 1)}
          >
            Thử tải lại
          </button>
        </div>
      )}

      {edition && syntheticSources && !loading && (
        <>
          <MorningBento
            sources={syntheticSources}
            sparklines={edition.markets.sparklines}
          />

          <section className="digest-section" aria-label="Điểm tin sáng nay">
            <div className="digest-section-heading">
              <h2>Điểm tin chọn lọc sáng nay</h2>
              <span className="muted">
                Cập nhật {formatDateTime(edition.generatedAt, "Asia/Ho_Chi_Minh")}
              </span>
            </div>
            {edition.articles.length > 0 ? (
              <ul className="digest-items">
                {edition.articles.map((item) => (
                  <li key={item.id}>
                    <div className="digest-item-toprow">
                      <ExternalLink href={item.url}>{item.title}</ExternalLink>
                    </div>
                    {item.description && <p>{item.description}</p>}
                    <small>
                      {item.source} ·{" "}
                      {formatDateTime(item.publishedAt, "Asia/Ho_Chi_Minh")}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Đang cập nhật tin mới từ các đầu báo chính thống…</p>
            )}
          </section>

          <section className="public-cta-banner" aria-label="Cá nhân hóa bản tin">
            <div>
              <span className="section-kicker">Miễn phí · Không quảng cáo</span>
              <h2>
                {authenticated
                  ? "Tùy chỉnh nguồn tin, thành phố và lịch nhận thông báo"
                  : "Nhận bản tin riêng lúc 07:00 mỗi sáng"}
              </h2>
              <p>
                Chọn tỉnh thành, chủ đề yêu thích và nhận thông báo trực tiếp
                trên điện thoại hoặc máy tính.
              </p>
            </div>
            <div className="public-cta-actions">
              {authenticated ? (
                <>
                  <a href="#/digests" className="primary-button">
                    Mở Bản tin của tôi <Icon name="arrow" size={16} />
                  </a>
                  <a href="#/preferences" className="secondary-button">
                    Cài đặt thông báo
                  </a>
                </>
              ) : (
                <>
                  <a href="#/login" className="primary-button">
                    <Icon name="bell" size={17} />
                    {registrationOpen ? "Tạo bản tin riêng" : "Đăng nhập"}
                  </a>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShareOpen(true)}
                  >
                    <Icon name="share" size={16} />
                    Chia sẻ
                  </button>
                </>
              )}
            </div>
          </section>
        </>
      )}

      <ShareCardModal
        open={shareOpen}
        payload={sharePayload}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );

  if (authenticated) {
    return content;
  }

  return (
    <div className={dark ? "account-root theme-dark" : "account-root"}>
      <header className="account-header">
        <a className="account-brand" href="#/today">
          <AccountBrand />
        </a>
        <div className="account-header-controls">
          <a href="#/login" className="primary-button public-header-cta">
            Đăng nhập
          </a>
          <button
            type="button"
            className="theme-toggle-pill"
            aria-label={
              dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"
            }
            onClick={() =>
              setDark((v) => {
                const next = !v;
                writeStoredTheme(next ? "dark" : "light");
                return next;
              })
            }
          >
            <Icon name={dark ? "sun" : "moon"} size={17} />
            <span>{dark ? "Sáng" : "Tối"}</span>
          </button>
        </div>
      </header>
      <main className="account-shell public-standalone-shell">{content}</main>
    </div>
  );
}
