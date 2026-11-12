import { expect, it } from "vitest";
import {
  familyConfigSchema,
  familyProfileSchema,
  profileSettings,
  type FamilyProfile,
} from "@hub/contracts";
import { profileDue, runCloudFamily } from "./family.js";
import {
  initialState,
  type CloudState,
  type CloudStateStore,
} from "./state.js";
import type { HttpClient } from "../connectors/http.js";

const at = new Date("2026-11-12T00:00:00Z"); // Thursday, 07:00 Vietnam
const profile = (
  id = "personal",
  patch: Partial<FamilyProfile> = {},
): FamilyProfile => ({
  id,
  name: "Private " + id,
  enabled: true,
  city: "hanoi",
  newsTopics: [],
  sendTime: "07:00",
  days: [4],
  weather: true,
  airQuality: false,
  fuel: false,
  github: false,
  topic: "private_topic_" + id,
  ...patch,
});
class Memory implements CloudStateStore {
  value = initialState();
  revision = 0;
  async load() {
    return { state: structuredClone(this.value), sha: String(this.revision) };
  }
  async save(value: CloudState, sha?: string) {
    if (sha !== String(this.revision)) throw Error("conflict");
    this.value = structuredClone(value);
    return String(++this.revision);
  }
}
function fixture(failTopic?: string) {
  const sends: { topic: string; message: string }[] = [];
  let gets = 0;
  const http: HttpClient = async (_url, options = {}) => {
    if (options.method === "POST") {
      const message = JSON.parse(options.body!);
      sends.push(message);
      if (message.topic === failTopic) throw Error("ambiguous");
      return { status: 200, headers: {}, body: "{}" };
    }
    gets++;
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        daily: {
          time: ["2026-11-12"],
          temperature_2m_min: [20],
          temperature_2m_max: [25],
          precipitation_probability_max: [30],
          weather_code: [1],
        },
      }),
    };
  };
  return { http, sends, gets: () => gets };
}
it("validates separate topics, at least one content, half-hour times and distinct IDs", () => {
  expect(
    familyConfigSchema.safeParse({
      version: 1,
      profiles: [profile(), profile("dad", { topic: profile().topic })],
    }).success,
  ).toBe(false);
  expect(
    familyProfileSchema.safeParse(profile("x", { sendTime: "07:15" })).success,
  ).toBe(false);
  expect(
    familyProfileSchema.safeParse(profile("x", { days: [] })).success,
  ).toBe(false);
  expect(
    familyProfileSchema.safeParse(profile("x", { weather: false })).success,
  ).toBe(false);
  expect(
    familyProfileSchema.safeParse(profile("x", { topic: "", enabled: false }))
      .success,
  ).toBe(true);
});
it("uses local weekday boundaries, never sends early, catches late starts and respects pause", () => {
  expect(profileDue(profile(), at)).toBe(true);
  expect(profileDue(profile(), new Date(+at - 60000))).toBe(false);
  expect(profileDue(profile(), new Date(+at + 3 * 3600000))).toBe(true);
  expect(profileDue(profile("x", { enabled: false }), at)).toBe(false);
  expect(profileDue(profile("x", { days: [5] }), at)).toBe(false);
  expect(
    profileDue(
      profile("x", { days: [4], sendTime: "00:00" }),
      new Date("2026-11-11T17:00:00Z"),
    ),
  ).toBe(true);
});
it("builds separate source settings and city coordinates without exposing destinations to another profile", () => {
  const p = profile("mom", {
    city: "danang",
    newsTopics: ["sports", "education"],
    airQuality: true,
  });
  const s = profileSettings(p);
  expect(s.weather.location).toBe("Đà Nẵng");
  expect(s.airQuality?.latitude).toBe(16.0544);
  expect(s.rss.map((f) => f.url)).toEqual([
    "https://vnexpress.net/rss/the-thao.rss",
    "https://vnexpress.net/rss/giao-duc.rss",
  ]);
  expect(s.notifications.topic).toBe(p.topic);
});
it("deduplicates per profile/day, inherits legacy personal delivery and caches shared GETs", async () => {
  const state = new Memory();
  const f = fixture();
  const config = { version: 1, profiles: [profile(), profile("dad")] };
  await runCloudFamily(config, { state, http: f.http, now: () => at });
  expect(f.sends.map((s) => s.topic)).toEqual([
    "private_topic_personal",
    "private_topic_dad",
  ]);
  expect(f.gets()).toBe(1);
  await runCloudFamily(config, { state, http: f.http, now: () => at });
  expect(f.sends).toHaveLength(2);
  const publicState = JSON.stringify(state.value);
  expect(publicState).not.toContain("Private");
  expect(publicState).not.toContain("private_topic");
  expect(publicState).not.toContain("dad");
  const old = new Memory();
  old.value.deliveries["2026-11-12"] = { status: "sent", at: at.toISOString() };
  const other = fixture();
  await runCloudFamily(config, { state: old, http: other.http, now: () => at });
  expect(other.sends.map((s) => s.topic)).toEqual(["private_topic_dad"]);
});
it("does not fetch profiles not due, forces only the chosen test recipient and leaves dry runs unpersisted", async () => {
  const state = new Memory();
  const f = fixture();
  const config = {
    version: 1,
    profiles: [profile(), profile("mom", { sendTime: "07:30" })],
  };
  await runCloudFamily(config, {
    state,
    http: f.http,
    now: () => at,
    dryRun: true,
  });
  expect(f.sends).toHaveLength(0);
  expect(state.revision).toBe(0);
  await runCloudFamily(config, {
    state,
    http: f.http,
    now: () => at,
    profileId: "mom",
    forceSend: true,
  });
  expect(f.sends.map((s) => s.topic)).toEqual(["private_topic_mom"]);
  await expect(
    runCloudFamily(config, {
      state,
      http: f.http,
      now: () => at,
      profileId: "missing",
    }),
  ).rejects.toThrow();
});
it("continues other recipients after an ambiguous delivery, then preserves all reservations on rerun", async () => {
  const state = new Memory();
  const f = fixture("private_topic_personal");
  const config = { version: 1, profiles: [profile(), profile("dad")] };
  await expect(
    runCloudFamily(config, { state, http: f.http, now: () => at }),
  ).rejects.toThrow();
  expect(f.sends).toHaveLength(2);
  await runCloudFamily(config, { state, http: f.http, now: () => at });
  expect(f.sends).toHaveLength(2);
});
