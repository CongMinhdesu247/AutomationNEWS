import { describe, expect, it } from "vitest";
import {
  solarToLunarVi,
  upcomingLunarEvents,
  webPushSubscriptionInputSchema,
} from "./lunar.js";

describe("Vietnamese Lunar Calendar (UTC+7)", () => {
  it("computes Tet Nguyen Dan Binh Ngo (2026-02-17) accurately", () => {
    const tet = solarToLunarVi("2026-02-17");
    expect(tet.day).toBe(1);
    expect(tet.month).toBe(1);
    expect(tet.year).toBe(2026);
    expect(tet.leap).toBe(false);
    expect(tet.canChiYear).toBe("Bính Ngọ");
    expect(tet.labelShort).toBe("1/1 ÂL");
    expect(tet.specialBadge).toBe("Tết Nguyên Đán");
  });

  it("computes Mid-Autumn Festival 2026-09-25 (15/8 AL)", () => {
    const midAutumn = solarToLunarVi("2026-09-25");
    expect(midAutumn.day).toBe(15);
    expect(midAutumn.month).toBe(8);
    expect(midAutumn.leap).toBe(false);
    expect(midAutumn.specialBadge).toBe("Tết Trung Thu");
  });

  it("handles Vietnamese leap lunar months accurately (2025 leap month 6)", () => {
    const leapDay = solarToLunarVi("2025-07-25");
    expect(leapDay.day).toBe(1);
    expect(leapDay.month).toBe(6);
    expect(leapDay.leap).toBe(true);
    expect(leapDay.labelShort).toBe("1/6 nhuận ÂL");
  });

  it("lists upcoming Mung 1, Ngay Ram and festivals in chronological order", () => {
    const events = upcomingLunarEvents("2026-02-15", 30, 4);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.name).toBe("Tết Nguyên Đán");
    expect(events[0]?.daysAway).toBe(2);
    expect(events[1]?.lunarLabel).toBe("15/1 ÂL");
  });
});

describe("webPushSubscriptionInputSchema", () => {
  it("accepts valid HTTPS push subscription input", () => {
    const parsed = webPushSubscriptionInputSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/example-token-12345",
      keys: {
        p256dh:
          "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
      userAgent: "Chrome trên Windows",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-HTTPS or credentialed endpoints", () => {
    expect(
      webPushSubscriptionInputSchema.safeParse({
        endpoint: "http://fcm.googleapis.com/fcm/send/example",
        keys: {
          p256dh:
            "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
          auth: "tBHItJI5svbpez7KI4CCXg",
        },
      }).success,
    ).toBe(false);
  });
});
