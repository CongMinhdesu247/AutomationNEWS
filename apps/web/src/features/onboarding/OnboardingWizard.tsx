import { useState } from "react";
import {
  familyCities,
  familyTopics,
  settingsSchema,
  type Settings,
} from "@hub/contracts";
import { Icon } from "../../Icons";
import { apiRequest, type Account } from "../../lib/api-client";
import {
  isWebPushSupported,
  subscribeThisBrowser,
} from "../../lib/web-push-client";

type InterestPackKey =
  | "news_biz"
  | "markets"
  | "air_uv"
  | "tech_github"
  | "lunar_tasks";

const INTEREST_PACKS: ReadonlyArray<{
  key: InterestPackKey;
  label: string;
  desc: string;
}> = [
  {
    key: "news_biz",
    label: "Thời sự & Kinh doanh",
    desc: "Điểm tin chính thống từ VnExpress mỗi sáng",
  },
  {
    key: "markets",
    label: "Vàng SJC, USD & Xăng",
    desc: "Biểu đồ 30 ngày & cảnh báo khi chạm đáy",
  },
  {
    key: "air_uv",
    label: "Không khí AQI & UV",
    desc: "Chỉ số bụi mịn PM2.5, mưa & bức xạ cực đại",
  },
  {
    key: "tech_github",
    label: "Công nghệ & GitHub",
    desc: "Tin số hóa & mã nguồn mở kèm bản dịch tiếng Việt",
  },
  {
    key: "lunar_tasks",
    label: "Âm lịch, Lễ Tết & Nhắc việc",
    desc: "Mùng 1, Ngày Rằm & danh sách việc hôm nay",
  },
];

export function OnboardingWizard({
  account,
  onCompleted,
  onCreateDigestNow,
}: {
  account: Account;
  onCompleted: (updated: Account) => void;
  onCreateDigestNow: () => Promise<void>;
}) {
  const [cityKey, setCityKey] = useState<keyof typeof familyCities>(() => {
    const match = Object.entries(familyCities).find(
      ([, v]) => v.name === account.settings.weather.location,
    );
    return (match?.[0] as keyof typeof familyCities | undefined) ?? "hanoi";
  });
  const [selectedPacks, setSelectedPacks] = useState<Set<InterestPackKey>>(
    () => new Set<InterestPackKey>(["news_biz", "markets", "air_uv", "lunar_tasks"]),
  );
  const [sendTime, setSendTime] = useState(
    account.settings.newsletter.sendTime || "07:00",
  );
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushHint, setPushHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function togglePack(key: InterestPackKey) {
    setSelectedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleEnableBrowserPush() {
    setPushBusy(true);
    setPushHint("");
    try {
      const { device } = await subscribeThisBrowser();
      setPushSubscribed(true);
      setPushHint(
        `Đã kết nối nhận thông báo trực tiếp trên ${device.userAgent || "trình duyệt này"}.`,
      );
    } catch (err) {
      setPushHint(
        err instanceof Error
          ? err.message
          : "Không thể bật thông báo trình duyệt lúc này.",
      );
    } finally {
      setPushBusy(false);
    }
  }

  async function handleFinishAndCreate() {
    setSaving(true);
    setError("");
    try {
      const city = familyCities[cityKey];
      const rssList = [...account.settings.rss];
      const ensureFeed = (name: string, feedSlug: string) => {
        const url = `https://vnexpress.net/rss/${feedSlug}.rss`;
        if (!rssList.some((f) => f.url === url)) {
          rssList.push({
            id: crypto.randomUUID(),
            name,
            url,
            enabled: true,
          });
        } else {
          for (let i = 0; i < rssList.length; i++) {
            if (rssList[i]!.url === url) {
              rssList[i] = { ...rssList[i]!, enabled: true };
            }
          }
        }
      };

      if (selectedPacks.has("news_biz")) {
        ensureFeed("VnExpress · Tin mới nhất", familyTopics.news.feed);
        ensureFeed("VnExpress · Kinh doanh", familyTopics.business.feed);
      }
      if (selectedPacks.has("tech_github")) {
        ensureFeed("VnExpress · Khoa học công nghệ", familyTopics.technology.feed);
      }
      if (rssList.length === 0) {
        ensureFeed("VnExpress · Tin mới nhất", familyTopics.news.feed);
      }

      const nextSettings: Settings = settingsSchema.parse({
        ...account.settings,
        newsletter: {
          ...account.settings.newsletter,
          enabled: true,
          sendTime: sendTime || "07:00",
        },
        weather: {
          enabled: true,
          location: city.name,
          latitude: city.latitude,
          longitude: city.longitude,
        },
        airQuality: {
          enabled: selectedPacks.has("air_uv"),
          location: city.name,
          latitude: city.latitude,
          longitude: city.longitude,
        },
        uv: {
          enabled: selectedPacks.has("air_uv"),
        },
        gold: {
          enabled: selectedPacks.has("markets"),
        },
        usd: {
          enabled: selectedPacks.has("markets"),
        },
        fuel: {
          enabled: selectedPacks.has("markets"),
        },
        github: {
          ...account.settings.github,
          enabled: selectedPacks.has("tech_github"),
          topics: account.settings.github.topics.length
            ? account.settings.github.topics
            : ["ai", "automation"],
          languages: account.settings.github.languages.length
            ? account.settings.github.languages
            : ["TypeScript", "Python"],
          repositoryCount: account.settings.github.repositoryCount || 5,
        },
        holidays: {
          ...account.settings.holidays,
          enabled: selectedPacks.has("lunar_tasks"),
        },
        tasks: {
          enabled: selectedPacks.has("lunar_tasks"),
          items: account.settings.tasks?.items ?? [],
        },
        rss: rssList.slice(0, 16),
      });

      const days = account.days.length ? account.days : [1, 2, 3, 4, 5, 6, 7];
      const saved = await apiRequest<{
        revision: number;
        nextRunAt: string | null;
      }>("/api/account/preferences", {
        method: "PUT",
        body: {
          settings: nextSettings,
          days,
          theme: account.theme,
          revision: account.revision,
        },
      });

      const updatedAccount: Account = {
        ...account,
        settings: nextSettings,
        days,
        revision: saved.revision,
        nextRunAt: saved.nextRunAt,
      };
      onCompleted(updatedAccount);
      await onCreateDigestNow();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không thể lưu thiết lập ban đầu. Vui lòng thử lại.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="onboarding-wizard-card"
      aria-labelledby="onboarding-wizard-heading"
    >
      <div className="onboarding-wizard-header">
        <span className="section-kicker">Thiết lập nhanh 30 giây</span>
        <h3 id="onboarding-wizard-heading">
          Cá nhân hóa tờ báo buổi sáng đầu tiên của bạn
        </h3>
        <p className="muted">
          Chọn khu vực, nội dung bạn quan tâm và bật thông báo trình duyệt để nhận
          bản tin tự động mỗi sáng.
        </p>
      </div>

      <div className="onboarding-step-block">
        <span className="onboarding-step-label">1. Chọn thành phố của bạn</span>
        <div
          className="onboarding-chip-grid"
          role="group"
          aria-label="Chọn thành phố"
        >
          {(
            Object.entries(familyCities) as Array<
              [keyof typeof familyCities, (typeof familyCities)[keyof typeof familyCities]]
            >
          ).map(([key, city]) => (
            <button
              key={key}
              type="button"
              aria-pressed={cityKey === key}
              className={
                cityKey === key
                  ? "onboarding-choice-chip active"
                  : "onboarding-choice-chip"
              }
              onClick={() => setCityKey(key)}
            >
              <Icon name="sun" size={15} />
              <span>{city.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="onboarding-step-block">
        <span className="onboarding-step-label">
          2. Chọn chuyên mục muốn đọc mỗi sáng
        </span>
        <div
          className="onboarding-pack-grid"
          role="group"
          aria-label="Chọn chuyên mục bản tin"
        >
          {INTEREST_PACKS.map((pack) => {
            const active = selectedPacks.has(pack.key);
            return (
              <button
                key={pack.key}
                type="button"
                aria-pressed={active}
                className={
                  active
                    ? "onboarding-pack-card active"
                    : "onboarding-pack-card"
                }
                onClick={() => togglePack(pack.key)}
              >
                <div className="onboarding-pack-top">
                  <strong>{pack.label}</strong>
                  <span className="onboarding-pack-check">
                    {active && <Icon name="check" size={14} />}
                  </span>
                </div>
                <small>{pack.desc}</small>
              </button>
            );
          })}
        </div>
      </div>

      <div className="onboarding-step-block onboarding-delivery-row">
        <div className="onboarding-time-col">
          <label htmlFor="onboarding-send-time" className="onboarding-step-label">
            3. Giờ nhận bản tin hàng ngày
          </label>
          <input
            id="onboarding-send-time"
            type="time"
            value={sendTime}
            onChange={(e) => setSendTime(e.target.value)}
          />
        </div>

        {isWebPushSupported() && (
          <div className="onboarding-push-col">
            <span className="onboarding-step-label">
              Thông báo trực tiếp trên trình duyệt (Khuyên dùng)
            </span>
            <button
              type="button"
              className={
                pushSubscribed
                  ? "secondary-button push-enabled-btn"
                  : "secondary-button"
              }
              disabled={pushBusy || pushSubscribed}
              onClick={() => void handleEnableBrowserPush()}
            >
              <Icon name={pushSubscribed ? "check" : "bell"} size={16} />
              {pushSubscribed
                ? "Đã bật thông báo trình duyệt"
                : pushBusy
                  ? "Đang xin quyền thông báo…"
                  : "Bật thông báo trực tiếp (1 chạm)"}
            </button>
            {pushHint && <small className="account-input-hint">{pushHint}</small>}
          </div>
        )}
      </div>

      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}

      <div className="onboarding-wizard-footer">
        <button
          type="button"
          className="primary-button"
          disabled={saving}
          onClick={() => void handleFinishAndCreate()}
        >
          <Icon name="sparkle" size={17} />
          {saving
            ? "Đang lưu & khởi tạo bản tin…"
            : "Lưu thiết lập & Tạo bản tin đầu tiên"}
        </button>
        <a href="#/preferences" className="text-link">
          Tùy chỉnh nâng cao <Icon name="arrow" size={15} />
        </a>
      </div>
    </section>
  );
}
