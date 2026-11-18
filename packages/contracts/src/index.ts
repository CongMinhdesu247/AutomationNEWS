import { z } from "zod";

export function foldVi(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}
export function isValidMonthDay(value: string): boolean {
  const match = value.match(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const maxDays = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month] ?? 0;
  return day >= 1 && day <= maxDays;
}
export function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = "";
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
export function safeExternalHref(value: string | null | undefined): string | undefined {
  if (!value || typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}
export const safeHttpUrlSchema = z
  .string()
  .trim()
  .min(1, "URL không được để trống.")
  .max(2048, "URL tối đa 2048 ký tự.")
  .refine((value) => safeExternalHref(value) !== undefined, "Nhập URL HTTP/HTTPS hợp lệ, không chứa thông tin đăng nhập.");
const httpUrl = safeHttpUrlSchema.transform(normalizeUrl);
const text = z
  .string()
  .trim()
  .min(1, "Không được để trống.")
  .max(160, "Tối đa 160 ký tự.");
const tags = z
  .array(z.string().trim().max(80, "Mỗi giá trị tối đa 80 ký tự."))
  .max(100, "Tối đa 100 giá trị.")
  .transform((values) => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = value.toLocaleLowerCase("en");
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
export const settingsSchema = z
  .object({
    uv: z.object({ enabled: z.boolean() }).strict().optional(),
    holidays: z
      .object({
        enabled: z.boolean(),
        items: z
          .array(
            z
              .object({
                id: z.uuid(),
                title: z.string().trim().min(1).max(120),
                monthDay: z
                  .string()
                  .regex(
                    /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
                    "Ngày kỷ niệm cần định dạng MM-DD.",
                  )
                  .refine(
                    isValidMonthDay,
                    "Ngày kỷ niệm không hợp lệ theo lịch dương.",
                  ),
              })
              .strict(),
          )
          .max(30)
          .optional(),
      })
      .strict()
      .optional(),
    tasks: z.object({
      enabled: z.boolean(),
      items: z.array(z.object({ id: z.uuid(), title: z.string().trim().min(1).max(120), date: z.iso.date(), done: z.boolean() }).strict()).max(20)
        .refine(items => new Set(items.map(item => item.id)).size === items.length, "Việc cần làm bị trùng ID."),
    }).strict().optional(),
    gold: z.object({ enabled: z.boolean() }).strict().optional(),
    usd: z.object({ enabled: z.boolean() }).strict().optional(),
    airQuality: z.object({ enabled: z.boolean(), location: z.string().trim().min(1).max(80).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).strict().optional(),
    fuel: z.object({ enabled: z.boolean() }).strict().optional(),
    newsletter: z
      .object({
        enabled: z.boolean(),
        sendTime: z
          .string()
          .regex(
            /^([01]\d|2[0-3]):[0-5]\d$/,
            "Giờ phải có dạng HH:mm, từ 00:00 đến 23:59.",
          ),
        timezone: text.refine((value) => {
          try {
            new Intl.DateTimeFormat("vi", { timeZone: value });
            return true;
          } catch {
            return false;
          }
        }, "Múi giờ IANA không hợp lệ."),
      })
      .strict(),
    rss: z
      .array(
        z
          .object({
            id: z.uuid("ID nguồn phải là UUID."),
            name: text,
            url: httpUrl,
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(100, "Tối đa 100 nguồn RSS.")
      .superRefine((sources, ctx) => {
        const urls = new Set<string>();
        const ids = new Set<string>();
        sources.forEach((source, index) => {
          if (urls.has(source.url))
            ctx.addIssue({
              code: "custom",
              path: [index, "url"],
              message: "URL đã tồn tại sau khi chuẩn hóa.",
            });
          if (ids.has(source.id))
            ctx.addIssue({
              code: "custom",
              path: [index, "id"],
              message: "ID nguồn bị trùng.",
            });
          urls.add(source.url);
          ids.add(source.id);
        });
      }),
    weather: z
      .object({
        enabled: z.boolean(),
        location: z.string().trim().max(160),
        latitude: z
          .number()
          .min(-90, "Vĩ độ phải từ -90 đến 90.")
          .max(90, "Vĩ độ phải từ -90 đến 90."),
        longitude: z
          .number()
          .min(-180, "Kinh độ phải từ -180 đến 180.")
          .max(180, "Kinh độ phải từ -180 đến 180."),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.enabled && !value.location)
          ctx.addIssue({
            code: "custom",
            path: ["location"],
            message: "Nhập tên địa điểm khi bật thời tiết.",
          });
      }),
    github: z
      .object({
        enabled: z.boolean(),
        topics: tags,
        languages: tags,
        repositoryCount: z
          .number()
          .int("Nhập số nguyên.")
          .min(1, "Chọn từ 1 đến 20 repository.")
          .max(20, "Chọn từ 1 đến 20 repository."),
      })
      .strict(),
    notifications: z
      .object({
        enabled: z.boolean(),
        serverUrl: httpUrl,
        topic: z
          .string()
          .trim()
          .max(128)
          .regex(
            /^[a-zA-Z0-9_-]*$/,
            "Topic chỉ gồm chữ, số, dấu gạch ngang và gạch dưới.",
          ),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.enabled && !value.topic)
          ctx.addIssue({
            code: "custom",
            path: ["topic"],
            message: "Nhập topic khi bật ntfy.",
          });
      }),
  })
  .strict()
  .superRefine((settings, ctx) => {
    if (settings.uv?.enabled && !settings.weather.location) ctx.addIssue({ code: "custom", path: ["weather", "location"], message: "Chọn địa điểm khi bật chỉ số UV." });
  });
export type Settings = z.infer<typeof settingsSchema>;
export function hasEnabledSources(settings: Settings): boolean {
  return settings.rss.some(feed => feed.enabled) || [settings.weather, settings.github, settings.fuel, settings.airQuality, settings.gold, settings.usd, settings.uv, settings.holidays, settings.tasks].some(source => source?.enabled);
}
export function calendarDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function formatDateTime(
  value: string | null | undefined,
  timezone?: string,
  fallback = "Chưa ghi nhận",
): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(+date)) return fallback;
  try {
    return date.toLocaleString("vi-VN", {
      ...(timezone ? { timeZone: timezone } : {}),
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return date.toLocaleString("vi-VN");
  }
}
export type FieldIssue = { path: (string | number)[]; message: string };
export type ApiError = {
  error: { code: string; message: string; issues: FieldIssue[] };
};
export function validationIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((part) =>
      typeof part === "number" ? part : String(part),
    ),
    message:
      issue.code === "invalid_type"
        ? "Nhập giá trị đúng định dạng; trường số không được để trống."
        : issue.message,
  }));
}
export const defaultSettings: Settings = {
  gold: { enabled: false },
  usd: { enabled: false },
  airQuality: { enabled: false },
  fuel: { enabled: false },
  newsletter: {
    enabled: true,
    sendTime: "07:00",
    timezone: "Asia/Ho_Chi_Minh",
  },
  rss: [],
  weather: { enabled: false, location: "", latitude: 0, longitude: 0 },
  github: { enabled: false, topics: [], languages: [], repositoryCount: 5 },
  notifications: { enabled: false, serverUrl: "https://ntfy.sh/", topic: "" },
};

export * from "./digests.js";
export * from "./family.js";
export * from "./family-tools.js";

export * from "./runs.js";

export * from "./telemetry.js";
export * from "./premium.js";
export * from "./lunar.js";
