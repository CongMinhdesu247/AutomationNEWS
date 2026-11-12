import { z } from "zod";
import { defaultSettings, type Settings } from "./index.js";

export const familyCities = {
  hanoi: { name: "Hà Nội", latitude: 21.0285, longitude: 105.8542 },
  hcm: { name: "TP Hồ Chí Minh", latitude: 10.8231, longitude: 106.6297 },
  danang: { name: "Đà Nẵng", latitude: 16.0544, longitude: 108.2022 },
  haiphong: { name: "Hải Phòng", latitude: 20.8449, longitude: 106.6881 },
  cantho: { name: "Cần Thơ", latitude: 10.0452, longitude: 105.7469 },
  hue: { name: "Huế", latitude: 16.4637, longitude: 107.5909 },
} as const;
export const familyTopics = {
  technology: { name: "Khoa học công nghệ", feed: "khoa-hoc-cong-nghe" },
  business: { name: "Kinh doanh", feed: "kinh-doanh" },
  sports: { name: "Thể thao", feed: "the-thao" },
  life: { name: "Đời sống", feed: "gia-dinh" },
  education: { name: "Giáo dục", feed: "giao-duc" },
  news: { name: "Thời sự", feed: "thoi-su" },
} as const;
export const familyProfileSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
    name: z.string().trim().min(1).max(60),
    enabled: z.boolean(),
    city: z.enum(["hanoi", "hcm", "danang", "haiphong", "cantho", "hue"]),
    newsTopics: z
      .array(
        z.enum([
          "technology",
          "business",
          "sports",
          "life",
          "education",
          "news",
        ]),
      )
      .max(6)
      .refine((v) => new Set(v).size === v.length, "Chủ đề bị trùng."),
    sendTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):(?:00|30)$/, "Chọn giờ cách nhau 30 phút."),
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length, "Ngày bị trùng."),
    weather: z.boolean(),
    airQuality: z.boolean(),
    fuel: z.boolean(),
    github: z.boolean(),
    topic: z
      .string()
      .trim()
      .max(128)
      .regex(/^[a-zA-Z0-9_-]*$/, "Topic chỉ gồm chữ, số, _ và -."),
    githubTopics: z.array(z.string().max(80)).max(100).optional(),
    githubLanguages: z.array(z.string().max(80)).max(100).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.enabled && !v.topic)
      ctx.addIssue({
        code: "custom",
        path: ["topic"],
        message: "Nhập topic riêng trước khi bật hồ sơ.",
      });
    if (
      !v.newsTopics.length &&
      !v.weather &&
      !v.airQuality &&
      !v.fuel &&
      !v.github
    )
      ctx.addIssue({
        code: "custom",
        path: ["newsTopics"],
        message: "Chọn ít nhất một nội dung.",
      });
  });
export const familyConfigSchema = z
  .object({
    version: z.literal(1),
    profiles: z.array(familyProfileSchema).min(1).max(8),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    const topics = new Set<string>();
    v.profiles.forEach((p, i) => {
      if (ids.has(p.id))
        ctx.addIssue({
          code: "custom",
          path: ["profiles", i, "id"],
          message: "ID hồ sơ bị trùng.",
        });
      if (p.topic && topics.has(p.topic))
        ctx.addIssue({
          code: "custom",
          path: ["profiles", i, "topic"],
          message: "Mỗi người cần một topic riêng.",
        });
      ids.add(p.id);
      if (p.topic) topics.add(p.topic);
    });
  });
export type FamilyProfile = z.infer<typeof familyProfileSchema>;
export type FamilyConfig = z.infer<typeof familyConfigSchema>;
export type FamilyDocument = {
  config: FamilyConfig;
  revision: number;
  syncedRevision: number | null;
  syncedAt: string | null;
  cloudConfigured: boolean;
};
export function profileSettings(profile: FamilyProfile): Settings {
  const city = familyCities[profile.city];
  return {
    ...structuredClone(defaultSettings),
    newsletter: {
      enabled: profile.enabled,
      sendTime: profile.sendTime,
      timezone: "Asia/Ho_Chi_Minh",
    },
    weather: {
      enabled: profile.weather,
      location: city.name,
      latitude: city.latitude,
      longitude: city.longitude,
    },
    airQuality: {
      enabled: profile.airQuality,
      location: city.name,
      latitude: city.latitude,
      longitude: city.longitude,
    },
    fuel: { enabled: profile.fuel },
    github: {
      enabled: profile.github,
      repositoryCount: 5,
      topics: profile.githubTopics ?? [],
      languages: profile.githubLanguages ?? [],
    },
    rss: profile.newsTopics.map((key, i) => ({
      id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      name: "VnExpress · " + familyTopics[key].name,
      url: `https://vnexpress.net/rss/${familyTopics[key].feed}.rss`,
      enabled: true,
    })),
    notifications: {
      enabled: true,
      serverUrl: "https://ntfy.sh/",
      topic: profile.topic,
    },
  };
}
