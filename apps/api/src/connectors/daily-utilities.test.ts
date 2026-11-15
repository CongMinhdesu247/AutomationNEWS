import { expect, it } from "vitest";
import {
  defaultSettings,
  settingsSchema,
  hasEnabledSources,
  calendarDate,
} from "@hub/contracts";
import {
  collectHolidays,
  collectTasks,
  fetchUv,
  uvLevel,
} from "./daily-utilities.js";
const at = new Date("2026-11-15T17:05:00Z");
it("uses the newsletter's calendar day and includes only due, unfinished personal tasks", () => {
  const make = (date: string, done = false) => ({
    id: crypto.randomUUID(),
    title: date,
    date,
    done,
  });
  const settings = settingsSchema.parse({
    ...structuredClone(defaultSettings),
    tasks: {
      enabled: true,
      items: [
        make("2026-11-15"),
        make("2026-11-16"),
        make("2026-11-17"),
        make("2026-11-16", true),
      ],
    },
  });
  const result = collectTasks(settings, at);
  expect(calendarDate(at, "Asia/Ho_Chi_Minh")).toBe("2026-11-16");
  expect(result.data?.items.map((item) => [item.date, item.overdue])).toEqual([
    ["2026-11-15", true],
    ["2026-11-16", false],
  ]);
  expect(hasEnabledSources(settings)).toBe(true);
  expect(
    settingsSchema.safeParse({
      ...settings,
      tasks: { enabled: true, items: [make("2026-02-30")] },
    }).success,
  ).toBe(false);
  expect(collectTasks(defaultSettings, at).status).toBe("disabled");
});
it("calculates fixed solar observances across year boundaries and marks today without inventing leave days", () => {
  const settings = { ...defaultSettings, holidays: { enabled: true } };
  expect(
    collectHolidays(settings, new Date("2026-12-31T01:00:00Z")).data?.events[0],
  ).toEqual({ name: "Tết Dương lịch", date: "2027-01-01", daysAway: 1 });
  expect(
    collectHolidays(settings, new Date("2026-11-20T01:00:00Z")).data?.events[0]
      ?.daysAway,
  ).toBe(0);
  expect(collectHolidays(defaultSettings, at).status).toBe("disabled");
});
it("loads UV independently of weather, distinguishes zero from missing data and uses the requested location/day", async () => {
  const settings = {
    ...structuredClone(defaultSettings),
    uv: { enabled: true },
    weather: {
      enabled: false,
      location: "Hà Nội",
      latitude: 21,
      longitude: 105,
    },
  };
  let value: number | null = 0;
  const http = async (input: string) => {
    const url = new URL(input);
    expect(url.searchParams.get("latitude")).toBe("21");
    expect(url.searchParams.get("daily")).toBe("uv_index_max");
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        daily: { time: ["2026-11-16"], uv_index_max: [value] },
      }),
    };
  };
  const context = { http, signal: AbortSignal.timeout(1000), now: () => at };
  expect((await fetchUv(settings, context)).data?.maximum).toBe(0);
  value = null;
  const missing = await fetchUv(settings, context);
  expect(missing.status).toBe("failed");
  expect(missing.data).toBeNull();
  expect(missing.errors[0]?.code).toBe("MISSING_UV");
  expect((await fetchUv(defaultSettings, context)).status).toBe("disabled");
  expect(
    settingsSchema.safeParse({ ...defaultSettings, uv: { enabled: true } })
      .success,
  ).toBe(false);
  expect([0, 3, 6, 8, 11].map(uvLevel)).toEqual([
    "Thấp",
    "Trung bình",
    "Cao",
    "Rất cao",
    "Cực cao",
  ]);
});
