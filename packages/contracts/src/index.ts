import { z } from "zod";

export function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = "";
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
const httpUrl = z
  .string()
  .trim()
  .max(2048, "URL tối đa 2048 ký tự.")
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Nhập URL HTTP/HTTPS hợp lệ, không chứa thông tin đăng nhập.")
  .transform(normalizeUrl);
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
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
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

export * from "./runs.js";

export * from "./telemetry.js";
