import { expect, it } from "vitest";
import {
  familyProfileSchema,
  familyTopics,
  profileSettings,
  type FamilyProfile,
} from "./family.js";
import { settingsSchema } from "./index.js";
it("supports all catalog topics together and maps them to distinct RSS sources", () => {
  const newsTopics = Object.keys(familyTopics) as FamilyProfile["newsTopics"];
  const profile = familyProfileSchema.parse({
    id: "reader",
    name: "Bạn đọc",
    enabled: false,
    city: "hanoi",
    newsTopics,
    sendTime: "07:00",
    days: [1, 2, 3, 4, 5, 6, 7],
    weather: false,
    airQuality: false,
    fuel: false,
    github: false,
    topic: "fixture_reader_only",
  });
  const settings = settingsSchema.parse(profileSettings(profile));
  expect(settings.rss).toHaveLength(13);
  expect(new Set(settings.rss.map((feed) => feed.url)).size).toBe(13);
  expect(settings.rss.map((feed) => feed.url)).toContain(
    "https://vnexpress.net/rss/suc-khoe.rss",
  );
  expect(settings.rss.map((feed) => feed.url)).toContain(
    "https://vnexpress.net/rss/bat-dong-san.rss",
  );
  expect(
    familyProfileSchema.safeParse({
      ...profile,
      newsTopics: [...newsTopics, "health"],
    }).success,
  ).toBe(false);
  expect(
    familyProfileSchema.safeParse({ ...profile, newsTopics: ["unknown"] })
      .success,
  ).toBe(false);
});
