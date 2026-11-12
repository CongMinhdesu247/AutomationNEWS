import { expect, it } from "vitest";
import { defaultSettings, type Digest, type Repository } from "@hub/contracts";
import { formatDigestNotification, notificationTitle } from "./format.js";

function digest(): Digest {
  return {
    id: crypto.randomUUID(),
    createdAt: "2026-11-12T00:00:00Z",
    completedAt: "2026-11-12T00:01:00Z",
    status: "success",
    settings: structuredClone(defaultSettings),
    notifications: [],
    sources: {
      rss: {
        status: "success",
        fetchedAt: "2026-11-12T00:00:00Z",
        errors: [],
        data: {
          items: Array.from({ length: 5 }, (_, index) => ({
            id: String(index),
            title: "🔥 Tin lập trình ".repeat(50),
            url: "https://news.example/" + "x".repeat(200),
            source: "Fixture",
            publishedAt: "2026-11-12T00:00:00Z",
            description: "fixture",
          })),
          feedsSucceeded: 1,
          feedsTotal: 1,
          skippedInvalidDate: 0,
          skippedInvalidItem: 0,
        },
      },
      weather: {
        status: "success",
        fetchedAt: "2026-11-12T00:00:00Z",
        errors: [],
        data: {
          date: "2026-11-12",
          location: "Hà Nội",
          timezone: "Asia/Ho_Chi_Minh",
          minTemperature: 13.5,
          maxTemperature: 20.9,
          rainProbability: 80,
          weatherCode: 61,
          description: "Mưa nhẹ",
          umbrella: true,
          attribution: {
            name: "Open-Meteo",
            url: "https://open-meteo.com",
            license: "CC BY 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          },
        },
      },
      github: {
        status: "success",
        fetchedAt: "2026-11-12T00:00:00Z",
        errors: [],
        data: {
          rising: [],
          newNotable: Array.from(
            { length: 5 },
            (_, index): Repository => ({
              id: index + 1,
              name: "owner/repo-" + (index + 1),
              description:
                "Công cụ mã nguồn mở giúp tự động hóa tác vụ. ".repeat(30),
              language: "TypeScript",
              url: "https://github.com/owner/repo-" + (index + 1),
              stars: 100,
              createdAt: "2026-11-01T00:00:00Z",
              fetchedAt: "2026-11-12T00:00:00Z",
            }),
          ),
          candidates: 5,
          withoutBaseline: 5,
          comparisonWindowHours: [20, 28],
          rateLimits: [],
        },
      },
    },
  };
}
it("keeps sections separate and all five repo summaries within the UTF-8 push limit", () => {
  const value = digest();
  value.sources!.airQuality = { status: "success", fetchedAt: value.createdAt, errors: [], data: {
    location: "Hà Nội", forecastAt: value.createdAt, usAqi: 125, pm25: 41.4,
    category: "Không tốt cho nhóm nhạy cảm", sourceUrl: "https://open-meteo.com/en/docs/air-quality-api", attribution: "Dự báo Open-Meteo/CAMS",
  } };
  value.sources!.fuel = { status: "success", fetchedAt: value.createdAt, errors: [], data: {
    region: "Petrolimex vùng 1", sourceUrl: "https://www.petrolimex.com.vn/", updatedAt: value.createdAt,
    effectiveAt: "2026-11-11T08:00:00Z", comparedAt: "2026-11-11T00:00:00Z",
    items: [ { code: "iii", name: "Xăng E10 RON 95-III", price: 19840, change: -160 }, { code: "v", name: "Xăng E10 RON 95-V", price: 21840, change: 0 } ],
  } };
  const message = formatDigestNotification(value);
  expect(notificationTitle(value)).toBe("Bản tin sáng · 12/11");
  expect(message).toContain("🌤 Hà Nội: 13.5–20.9 °C\nMưa nhẹ\n☔");
  expect(message).toContain("\n\n📰 Tin tức");
  expect(message).toContain("Xăng E10 RON 95-III: 19.840 đ/lít · Giảm 160 đ");
  expect(message).not.toContain("Xăng E10 RON 95-V");
  expect(message).toContain("📰 Tin tức · 3 tin");
  expect(message).toContain("💨 Hà Nội · AQI Mỹ: 125");
  expect(message).toContain("PM2.5: 41,4 µg/m³");
  expect(message).toContain("Dự báo Open-Meteo/CAMS");
  expect((message.match(/^• /gm) ?? [])).toHaveLength(3);
  expect(message).toContain("\n\n🚀 GitHub · 5 dự án");
  for (let index = 1; index <= 5; index++)
    expect(message).toContain(
      index + ". owner/repo-" + index + " — Công cụ mã nguồn mở",
    );
  expect(Buffer.byteLength(message)).toBeLessThanOrEqual(1600);
  expect(message).not.toContain("�");
});
it("normalizes multiline descriptions, keeps authors' content and has an honest missing-description fallback", () => {
  const value = digest();
  value.sources!.github.data.newNotable[0]!.description =
    "A tool\nfor\tdevelopers";
  value.sources!.github.data.newNotable[1]!.description = null;
  const text = formatDigestNotification(value);
  expect(text).toContain("owner/repo-1 — A tool for developers");
  expect(text).toContain("owner/repo-2 — Chưa có mô tả từ tác giả.");
  expect(text).not.toContain("undefined");
});

it("uses the Vietnamese summary in pushes while the original stays available in stored data", () => {
  const value = digest();
  value.sources!.github.data.newNotable[0]!.description =
    "An English description that should not be the push summary";
  value.sources!.github.data.newNotable[0]!.summaryVi =
    "Công cụ giúp trích xuất văn bản từ hình ảnh.";
  value.sources!.github.data.newNotable[0]!.summaryViStatus = "translated";
  const text = formatDigestNotification(value);
  expect(text).toContain("owner/repo-1 — Công cụ giúp trích xuất văn bản");
  expect(text).not.toContain("An English description");
  expect(value.sources!.github.data.newNotable[0]!.description).toContain(
    "An English",
  );
});
it("leaves push-gateway headroom with long names without dropping the fifth repo or source attribution", () => {
  const value = digest();
  for (const repo of value.sources!.github.data.newNotable) repo.name = "owner/" + "long-repository-name-".repeat(12) + repo.id;
  const text = formatDigestNotification(value);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1600);
  expect((text.match(/^\d\. /gm) ?? [])).toHaveLength(5);
  expect((text.match(/^• /gm) ?? [])).toHaveLength(3);
  expect(text).toContain("Open-Meteo");
  expect(text).toContain("CC BY 4.0");
  expect(text).not.toContain("�");
});
