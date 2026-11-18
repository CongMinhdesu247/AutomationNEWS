import { z } from "zod";
import type {
  AirQualityData,
  FuelData,
  GoldData,
  NewsItem,
  UsdData,
  WeatherData,
} from "./digests.js";

// Astronomical Vietnamese Lunar Calendar (UTC+7 meridian) adapted from Ho Ngoc Duc's standard algorithm.
const CAN = [
  "Giáp",
  "Ất",
  "Bính",
  "Đinh",
  "Mậu",
  "Kỷ",
  "Canh",
  "Tân",
  "Nhâm",
  "Quý",
] as const;

const CHI = [
  "Tý",
  "Sửu",
  "Dần",
  "Mão",
  "Thìn",
  "Tỵ",
  "Ngọ",
  "Mùi",
  "Thân",
  "Dậu",
  "Tuất",
  "Hợi",
] as const;

const LUNAR_FESTIVALS: ReadonlyArray<readonly [number, number, string]> = [
  [1, 1, "Tết Nguyên Đán"],
  [1, 15, "Rằm tháng Giêng (Tết Nguyên Tiêu)"],
  [3, 10, "Giỗ Tổ Hùng Vương"],
  [4, 15, "Lễ Phật Đản"],
  [5, 5, "Tết Đoan Ngọ"],
  [7, 15, "Lễ Vu Lan (Rằm tháng Bảy)"],
  [8, 15, "Tết Trung Thu"],
  [12, 23, "Ông Công Ông Táo"],
];

function int(n: number): number {
  return Math.floor(n);
}

function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = int((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd =
    dd +
    int((153 * m + 2) / 5) +
    365 * y +
    int(y / 4) -
    int(y / 100) +
    int(y / 400) -
    32045;
  if (jd < 2299161) {
    jd = dd + int((153 * m + 2) / 5) + 365 * y + int(y / 4) - 32083;
  }
  return jd;
}

function newMoonDay(k: number, timeZone = 7): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = Math.PI / 180;
  let Jd1 =
    2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 =
    (0.1734 - 0.000393 * T) * Math.sin(M * dr) +
    0.0021 * Math.sin(2 * dr * M) -
    0.4068 * Math.sin(Mpr * dr) +
    0.0161 * Math.sin(dr * 2 * Mpr) -
    0.0004 * Math.sin(dr * 3 * Mpr) +
    0.0104 * Math.sin(dr * 2 * F) -
    0.0051 * Math.sin(dr * (M + Mpr)) -
    0.0074 * Math.sin(dr * (M - Mpr)) +
    0.0004 * Math.sin(dr * (2 * F + M)) -
    0.0004 * Math.sin(dr * (2 * F - M)) -
    0.0006 * Math.sin(dr * (2 * F + Mpr)) +
    0.001 * Math.sin(dr * (2 * F - Mpr)) +
    0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat: number;
  if (T < -11) {
    deltat =
      0.001 +
      0.000839 * T +
      0.0002261 * T2 -
      0.00000845 * T3 -
      0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  const JdNew = Jd1 + C1 - deltat;
  return int(JdNew + 0.5 + timeZone / 24);
}

function sunLongitudeSector(jdn: number, timeZone = 7): number {
  const T = (jdn - 2451545.5 - timeZone / 24) / 36525;
  const T2 = T * T;
  const dr = Math.PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL +=
    (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) +
    0.00029 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L -= Math.PI * 2 * int(L / (Math.PI * 2));
  return int((L / Math.PI) * 6);
}

function lunarMonth11(yy: number, timeZone = 7): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = int(off / 29.530588853);
  let nm = newMoonDay(k, timeZone);
  if (sunLongitudeSector(nm, timeZone) >= 9) {
    nm = newMoonDay(k - 1, timeZone);
  }
  return nm;
}

function leapMonthOffset(a11: number, timeZone = 7): number {
  const k = int((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = sunLongitudeSector(newMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = sunLongitudeSector(newMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

export type LunarDateInfo = {
  day: number;
  month: number;
  year: number;
  leap: boolean;
  canChiYear: string;
  canChiDay: string;
  labelShort: string;
  labelFull: string;
  specialBadge: string | null;
};

export function solarToLunarVi(isoDate: string): LunarDateInfo {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const yy = match ? Number(match[1]) : 2026;
  const mm = match ? Number(match[2]) : 1;
  const dd = match ? Number(match[3]) : 1;
  const timeZone = 7;

  const dayNumber = jdFromDate(dd, mm, yy);
  const k = int((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = newMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = newMoonDay(k, timeZone);
  }
  let a11 = lunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = lunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = lunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = int((monthStart - a11) / 29);
  let lunarLeap = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = leapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) {
        lunarLeap = true;
      }
    }
  }
  if (lunarMonth > 12) {
    lunarMonth -= 12;
  }
  if (lunarMonth >= 11 && diff < 4) {
    lunarYear -= 1;
  }

  const canChiYear = `${CAN[(lunarYear + 6) % 10]} ${CHI[(lunarYear + 8) % 12]}`;
  const canChiDay = `${CAN[(dayNumber + 9) % 10]} ${CHI[(dayNumber + 1) % 12]}`;
  const festival = !lunarLeap
    ? LUNAR_FESTIVALS.find(([m, d]) => m === lunarMonth && d === lunarDay)?.[2] ??
      null
    : null;
  const specialBadge =
    festival ??
    (lunarDay === 1
      ? `Mùng 1 tháng ${lunarMonth}${lunarLeap ? " nhuận" : ""}`
      : lunarDay === 15
        ? `Rằm tháng ${lunarMonth}${lunarLeap ? " nhuận" : ""}`
        : null);

  const dayText = lunarDay <= 10 ? `Mùng ${lunarDay}` : `Ngày ${lunarDay}`;
  const monthText = `${lunarMonth}${lunarLeap ? " nhuận" : ""}`;

  return {
    day: lunarDay,
    month: lunarMonth,
    year: lunarYear,
    leap: lunarLeap,
    canChiYear,
    canChiDay,
    labelShort: `${lunarDay}/${monthText} ÂL`,
    labelFull: `${dayText} tháng ${monthText} năm ${canChiYear}`,
    specialBadge,
  };
}

export type LunarObservanceEvent = {
  name: string;
  date: string;
  lunarLabel: string;
  daysAway: number;
  kind: "cycle" | "festival";
};

export function upcomingLunarEvents(
  fromIsoDate: string,
  maxDays = 30,
  limit = 4,
): LunarObservanceEvent[] {
  const baseMs = Date.parse(fromIsoDate + "T00:00:00Z");
  if (!Number.isFinite(baseMs)) return [];
  const results: LunarObservanceEvent[] = [];
  for (let offset = 0; offset <= maxDays; offset++) {
    const iso = new Date(baseMs + offset * 86400000).toISOString().slice(0, 10);
    const lunar = solarToLunarVi(iso);
    const festival = !lunar.leap
      ? LUNAR_FESTIVALS.find(
          ([m, d]) => m === lunar.month && d === lunar.day,
        )?.[2]
      : undefined;
    if (festival) {
      results.push({
        name: festival,
        date: iso,
        lunarLabel: lunar.labelShort,
        daysAway: offset,
        kind: "festival",
      });
    } else if (lunar.day === 1) {
      results.push({
        name: `Mùng 1 tháng ${lunar.month}${lunar.leap ? " nhuận" : ""} Âm lịch`,
        date: iso,
        lunarLabel: lunar.labelShort,
        daysAway: offset,
        kind: "cycle",
      });
    } else if (lunar.day === 15) {
      results.push({
        name: `Ngày Rằm tháng ${lunar.month}${lunar.leap ? " nhuận" : ""}`,
        date: iso,
        lunarLabel: lunar.labelShort,
        daysAway: offset,
        kind: "cycle",
      });
    }
    if (results.length >= limit) break;
  }
  return results;
}

export const webPushSubscriptionInputSchema = z
  .object({
    endpoint: z
      .string()
      .trim()
      .min(16)
      .max(2048)
      .refine((v) => {
        try {
          const u = new URL(v);
          return u.protocol === "https:" && !u.username && !u.password;
        } catch {
          return false;
        }
      }, "Endpoint Web Push phải là HTTPS hợp lệ."),
    keys: z
      .object({
        p256dh: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{60,140}=*$/, "Khóa p256dh không hợp lệ."),
        auth: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{16,64}=*$/, "Khóa auth không hợp lệ."),
      })
      .strict(),
    userAgent: z.string().trim().max(240).default(""),
  })
  .strict();

export type WebPushSubscriptionInput = z.infer<
  typeof webPushSubscriptionInputSchema
>;

export type WebPushDevice = {
  id: string;
  endpointHost: string;
  userAgent: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PublicTodayCity = {
  key: "hanoi" | "hcmc";
  name: string;
  weather: WeatherData | null;
  airQuality: AirQualityData | null;
};

export type PublicTodayEdition = {
  generatedAt: string;
  solarDate: string;
  lunar: LunarDateInfo;
  upcomingLunar: LunarObservanceEvent[];
  cities: PublicTodayCity[];
  markets: {
    gold: GoldData | null;
    usd: UsdData | null;
    fuel: FuelData | null;
    sparklines: {
      sjc: number[];
      usd: number[];
    };
  };
  articles: NewsItem[];
};
