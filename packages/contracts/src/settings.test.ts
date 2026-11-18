import { describe, expect, it } from "vitest";
import {
  bookmarkInputSchema,
  defaultSettings,
  foldVi,
  isValidMonthDay,
  settingsSchema,
} from "./index.js";
const fresh = () => structuredClone(defaultSettings);
describe("settings validation", () => {
  it("accepts defaults and coordinate boundaries", () => {
    expect(settingsSchema.parse(fresh())).toEqual(defaultSettings);
    const value = fresh();
    value.weather = {
      enabled: true,
      location: "Hà Nội",
      latitude: -90,
      longitude: 180,
    };
    expect(settingsSchema.safeParse(value).success).toBe(true);
  });
  it("normalizes HTTP URLs and rejects duplicates after normalization", () => {
    const value = fresh();
    value.rss = [
      {
        id: crypto.randomUUID(),
        name: "Nguồn",
        enabled: true,
        url: "HTTPS://EXAMPLE.COM:443/feed/?b=2&a=1#section",
      },
    ];
    expect(settingsSchema.parse(value).rss[0]?.url).toBe(
      "https://example.com/feed?a=1&b=2",
    );
    value.rss.push({
      ...value.rss[0]!,
      id: crypto.randomUUID(),
      url: "https://example.com/feed?a=1&b=2",
    });
    const result = settingsSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["rss", 1, "url"]);
  });
  it("deduplicates trimmed tags case-insensitively and removes empty tags", () => {
    const value = fresh();
    value.github.topics = [" automation ", "", "AUTOMATION", "self-hosted"];
    value.github.languages = ["TypeScript", " typescript ", ""];
    expect(settingsSchema.parse(value).github).toMatchObject({
      topics: ["automation", "self-hosted"],
      languages: ["TypeScript"],
    });
  });
  it.each([
    [
      "invalid latitude",
      (s: typeof defaultSettings) => {
        s.weather.latitude = 91;
      },
    ],
    [
      "invalid longitude",
      (s: typeof defaultSettings) => {
        s.weather.longitude = -181;
      },
    ],
    [
      "nonfinite coordinate",
      (s: typeof defaultSettings) => {
        s.weather.latitude = NaN;
      },
    ],
    [
      "invalid clock",
      (s: typeof defaultSettings) => {
        s.newsletter.sendTime = "24:00";
      },
    ],
    [
      "invalid timezone",
      (s: typeof defaultSettings) => {
        s.newsletter.timezone = "Unknown/Zone";
      },
    ],
    [
      "too many repositories",
      (s: typeof defaultSettings) => {
        s.github.repositoryCount = 21;
      },
    ],
    [
      "fractional repository count",
      (s: typeof defaultSettings) => {
        s.github.repositoryCount = 2.5;
      },
    ],
    [
      "missing weather location",
      (s: typeof defaultSettings) => {
        s.weather.enabled = true;
      },
    ],
    [
      "missing ntfy topic",
      (s: typeof defaultSettings) => {
        s.notifications.enabled = true;
      },
    ],
    [
      "invalid ntfy URL",
      (s: typeof defaultSettings) => {
        s.notifications.serverUrl = "file:///tmp/rss";
      },
    ],
    [
      "embedded credentials",
      (s: typeof defaultSettings) => {
        s.notifications.serverUrl = "https://user:secret@example.com";
      },
    ],
    [
      "invalid RSS URL",
      (s: typeof defaultSettings) => {
        s.rss = [
          {
            id: crypto.randomUUID(),
            name: "RSS",
            enabled: true,
            url: "ftp://example.com/feed",
          },
        ];
      },
    ],
  ])("rejects %s", (_name, modify) => {
    const value = fresh();
    modify(value);
    expect(settingsSchema.safeParse(value).success).toBe(false);
  });
  it("does not accept tokens in the settings payload", () => {
    expect(
      settingsSchema.safeParse({
        ...fresh(),
        notifications: { ...defaultSettings.notifications, token: "secret" },
      }).success,
    ).toBe(false);
  });
  it("normalizes Vietnamese diacritics including đ/Đ via foldVi", () => {
    expect(foldVi("Đà Nẵng — Bản tin buổi sáng")).toBe(
      "da nang — ban tin buoi sang",
    );
    expect(foldVi("Đường Độc Lập")).toBe("duong doc lap");
  });
  it("validates calendar month-day dates and rejects impossible dates like 02-31", () => {
    expect(isValidMonthDay("02-29")).toBe(true);
    expect(isValidMonthDay("10-20")).toBe(true);
    expect(isValidMonthDay("02-30")).toBe(false);
    expect(isValidMonthDay("02-31")).toBe(false);
    expect(isValidMonthDay("04-31")).toBe(false);

    const bad = fresh();
    bad.holidays = {
      enabled: true,
      items: [{ id: crypto.randomUUID(), title: "Test", monthDay: "02-31" }],
    };
    expect(settingsSchema.safeParse(bad).success).toBe(false);

    const good = fresh();
    good.holidays = {
      enabled: true,
      items: [{ id: crypto.randomUUID(), title: "Leap", monthDay: "02-29" }],
    };
    expect(settingsSchema.safeParse(good).success).toBe(true);
  });
  it("validates bookmarkInputSchema and blocks unsafe bookmark URLs", () => {
    expect(
      bookmarkInputSchema.safeParse({
        url: "https://vnexpress.net/bai-viet-123.html",
        title: "Bài viết thử nghiệm",
        source: "VnExpress",
        summary: "Tóm tắt ngắn",
        kind: "rss",
        digestId: null,
      }).success,
    ).toBe(true);
    expect(
      bookmarkInputSchema.safeParse({
        url: "javascript:alert(1)",
        title: "XSS",
        kind: "rss",
      }).success,
    ).toBe(false);
  });
});
