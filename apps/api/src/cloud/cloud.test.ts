import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings, type Digest } from "@hub/contracts";
import { cloudMessage, parseCloudSettings, runCloudDigest } from "./digest.js";
import {
  baselineLoader,
  GithubStateStore,
  initialState,
  type CloudState,
  type CloudStateStore,
} from "./state.js";
import type { HttpClient } from "../connectors/http.js";
import { fuelPriceUrl, petrolimexHome } from "../connectors/fuel.js";
import { airQualityUrl } from "../connectors/air-quality.js";

const at = new Date("2026-11-12T00:00:00Z");
const settings: Settings = {
  ...structuredClone(defaultSettings),
  rss: [
    {
      id: "aa805329-cc37-4c86-bd8b-e7e9c9d3d714",
      name: "Fixture",
      url: "https://rss.example/feed",
      enabled: true,
    },
  ],
  weather: {
    enabled: true,
    location: "Fixture Hà Nội",
    latitude: 21,
    longitude: 105,
  },
  github: { ...defaultSettings.github, enabled: true },
  notifications: {
    enabled: true,
    serverUrl: "https://ntfy.example/",
    topic: "private-topic",
  },
};
class MemoryState implements CloudStateStore {
  value = initialState();
  revision = 0;
  saves = 0;
  failWrites = false;
  async load() {
    return { state: structuredClone(this.value), sha: String(this.revision) };
  }
  async save(value: CloudState, sha?: string) {
    if (this.failWrites || sha !== String(this.revision))
      throw new Error("CAS failure");
    this.value = structuredClone(value);
    this.saves++;
    return String(++this.revision);
  }
}
function fixture({
  weatherStatus = 200,
  ambiguous = false,
  assertReserved = () => {},
} = {}) {
  const sends: Record<string, unknown>[] = [];
  let gets = 0;
  const http: HttpClient = async (url, options = {}) => {
    if (options.method === "POST") {
      assertReserved();
      sends.push(JSON.parse(options.body!));
      if (ambiguous) throw new Error("transport details including secret");
      return { status: 200, headers: {}, body: "{}" };
    }
    gets++;
    if (url.includes("rss.example"))
      return {
        status: 200,
        headers: {},
        body: '<rss version="2.0"><channel><title>Fixture</title><item><title>Tin lập trình</title><link>https://news.example/item</link><pubDate>Wed, 11 Nov 2026 23:00:00 GMT</pubDate></item></channel></rss>',
      };
    if (url.includes("open-meteo"))
      return {
        status: weatherStatus,
        headers: {},
        body: JSON.stringify({
          daily: {
            time: ["2026-11-12"],
            temperature_2m_min: [20],
            temperature_2m_max: [26],
            precipitation_probability_max: [80],
            weather_code: [61],
          },
        }),
      };
    if (url.includes("api.github.com"))
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          items: [
            {
              id: 11,
              full_name: "fixture/repo",
              description: "Fixture",
              language: "TypeScript",
              html_url: "https://github.com/fixture/repo",
              stargazers_count: 90,
              created_at: "2026-11-01T00:00:00Z",
              archived: false,
              fork: false,
            },
          ],
        }),
      };
    throw new Error("Unexpected network access");
  };
  return { http, sends, gets: () => gets };
}

describe("cloud execution without local PostgreSQL", () => {
  it("supports Hanoi air-quality-only digests and still sends weather when the air source fails", async () => {
    const f = fixture();
    const airSettings: Settings = { ...structuredClone(defaultSettings), airQuality: { enabled: true }, notifications: settings.notifications };
    let fail = false;
    const http: HttpClient = (url, options) => url === airQualityUrl ? Promise.resolve({ status: fail ? 401 : 200, headers: {}, body: JSON.stringify({ current: { time: +at/1000, us_aqi: 125, pm2_5: 41.4 }, current_units: { pm2_5: "μg/m³" } }) }) : f.http(url,options);
    const result = await runCloudDigest({ state: new MemoryState(), settings: airSettings, http, now: () => at });
    expect(result).toEqual({ status: "sent", sourceStatus: "success" });
    expect(f.sends[0]?.message).toContain("AQI Mỹ: 125");
    fail = true;
    const partial = await runCloudDigest({ state: new MemoryState(), settings: { ...settings, airQuality: { enabled: true } }, http, now: () => at });
    expect(partial).toMatchObject({ status: "sent", sourceStatus: "partial" });
    expect(f.sends[1]?.message).toContain("Chưa lấy được dự báo chất lượng không khí");
    expect(f.sends[1]?.message).toContain("20–26");
  });
  it("sends fuel-only digests and advances the public price baseline only after successful delivery", async () => {
    const state = new MemoryState();
    const onlyFuel: Settings = { ...structuredClone(defaultSettings), fuel: { enabled: true }, notifications: settings.notifications };
    const f = fixture();
    let price = 20000;
    let fail = false;
    const http: HttpClient = async (url, options) => {
      if (options?.method === "POST") {
        if (fail) throw new Error("Unknown delivery");
        return f.http(url, options);
      }
      const body = url === fuelPriceUrl() ? JSON.stringify({ Objects: [{ ID: "ron95", Title: "Xăng E10 RON 95-III", Zone1Price: price, LastModified: "2026-11-11T07:50:00Z" }] })
        : url === petrolimexHome ? '<a href="/ndi/thong-cao-bao-chi/petrolimex-dieu-chinh-gia-xang-dau-test.html">Giá</a>'
        : "Mức giá mới có hiệu lực từ thời điểm 15 giờ 00 phút ngày 11 tháng 11 năm 2026";
      return { status: 200, headers: {}, body };
    };
    await runCloudDigest({ state, settings: onlyFuel, http, now: () => at, dryRun: true });
    expect(state.value.fuelBaseline).toBeUndefined();
    await runCloudDigest({ state, settings: onlyFuel, http, now: () => at });
    expect(state.value.fuelBaseline?.prices.ron95).toBe(20000);
    expect(f.sends[0]?.message).toContain("Lần đầu theo dõi");
    price = 19840;
    await runCloudDigest({ state, settings: onlyFuel, http, now: () => new Date(+at + 60000), forceSend: true });
    expect(f.sends[1]?.message).toContain("Giảm 160 đ");
    expect(state.value.fuelBaseline?.prices.ron95).toBe(19840);
    fail = true; price = 22000;
    await expect(runCloudDigest({ state, settings: onlyFuel, http, now: () => new Date(+at + 120000), forceSend: true })).rejects.toThrow();
    expect(state.value.fuelBaseline?.prices.ron95).toBe(19840);
  });
  it("collects three sources, reserves before POST and persists only nonprivate state", async () => {
    const state = new MemoryState();
    const { http, sends } = fixture({
      assertReserved: () =>
        expect(state.value.deliveries["2026-11-12"]?.status).toBe("reserved"),
    });
    const result = await runCloudDigest({
      state,
      settings,
      http,
      now: () => at,
    });
    expect(result).toEqual({ status: "sent", sourceStatus: "success" });
    expect(sends).toHaveLength(1);
    expect(sends[0]!.message).toContain("Tin lập trình");
    expect(sends[0]!.message).toContain("fixture/repo");
    expect(sends[0]!.message).toContain("20–26");
    expect(sends[0]!.click).toBeUndefined();
    expect(state.value.deliveries["2026-11-12"]?.status).toBe("sent");
    const saved = JSON.stringify(state.value);
    for (const privateValue of [
      "private-topic",
      "Fixture Hà Nội",
      "ntfy.example",
      "Tin lập trình",
    ])
      expect(saved).not.toContain(privateValue);
    expect(state.value.snapshots).toEqual([
      { id: 11, stars: 90, fetchedAt: at.toISOString() },
    ]);
  });
  it("deduplicates same-day reruns before fetching data", async () => {
    const state = new MemoryState();
    const f = fixture();
    await runCloudDigest({ state, settings, http: f.http, now: () => at });
    const gets = f.gets();
    expect(
      await runCloudDigest({ state, settings, http: f.http, now: () => at }),
    ).toEqual({ status: "already_attempted" });
    expect(f.sends).toHaveLength(1);
    expect(f.gets()).toBe(gets);
  });
  it("requires an explicit force for a deliberate second send", async () => {
    const state = new MemoryState();
    const f = fixture();
    await runCloudDigest({ state, settings, http: f.http, now: () => at });
    await runCloudDigest({
      state,
      settings,
      http: f.http,
      now: () => at,
      forceSend: true,
    });
    expect(f.sends).toHaveLength(2);
  });
  it("does not send if durable reservation fails", async () => {
    const state = new MemoryState();
    state.failWrites = true;
    const f = fixture();
    await expect(
      runCloudDigest({ state, settings, http: f.http, now: () => at }),
    ).rejects.toThrow();
    expect(f.sends).toHaveLength(0);
  });
  it("does not automatically resend after ambiguous POST or failed completion persistence", async () => {
    const state = new MemoryState();
    const f = fixture({ ambiguous: true });
    await expect(
      runCloudDigest({ state, settings, http: f.http, now: () => at }),
    ).rejects.toThrow("unknown");
    expect(state.value.deliveries["2026-11-12"]?.status).toBe("unknown");
    expect(
      await runCloudDigest({ state, settings, http: f.http, now: () => at }),
    ).toEqual({ status: "already_attempted" });
    expect(f.sends).toHaveLength(1);
    state.value.deliveries["2026-11-12"] = {
      status: "reserved",
      at: at.toISOString(),
    };
    expect(
      await runCloudDigest({ state, settings, http: f.http, now: () => at }),
    ).toEqual({ status: "already_attempted" });
  });
  it("dry run does not write state or POST", async () => {
    const state = new MemoryState();
    const f = fixture();
    expect(
      await runCloudDigest({
        state,
        settings,
        http: f.http,
        now: () => at,
        dryRun: true,
      }),
    ).toMatchObject({ status: "dry_run" });
    expect(f.sends).toHaveLength(0);
    expect(state.saves).toBe(0);
  });
  it("still sends a partial digest when one source fails permanently", async () => {
    const state = new MemoryState();
    const f = fixture({ weatherStatus: 401 });
    expect(
      await runCloudDigest({ state, settings, http: f.http, now: () => at }),
    ).toMatchObject({ status: "sent", sourceStatus: "partial" });
    expect(f.sends[0]!.message).toContain("Chưa lấy được dự báo");
  });
  it("retries transient reads but does not violate a long Retry-After", async () => {
    const state = new MemoryState();
    const f = fixture();
    let weatherCalls = 0;
    const delays: number[] = [];
    const http: HttpClient = (url, options) => {
      if (url.includes("open-meteo") && weatherCalls++ < 1)
        return Promise.resolve({ status: 503, headers: {}, body: "" });
      return f.http(url, options);
    };
    await runCloudDigest({
      state,
      settings,
      http,
      now: () => at,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(weatherCalls).toBe(2);
    expect(delays).toHaveLength(1);
    const other = new MemoryState();
    let attempts = 0;
    await runCloudDigest({
      state: other,
      settings,
      now: () => at,
      http: (url, options) => {
        if (url.includes("open-meteo")) {
          attempts++;
          return Promise.resolve({
            status: 429,
            headers: { "retry-after": "120" },
            body: "",
          });
        }
        return f.http(url, options);
      },
      sleep: async () => {
        throw new Error("Must not retry early");
      },
    });
    expect(attempts).toBe(1);
  });
  it("preserves nearest 24h GitHub baseline and never invents star growth", async () => {
    const state = new MemoryState();
    state.value.snapshots = [
      { id: 11, stars: 50, fetchedAt: "2026-11-11T00:00:00.000Z" },
      { id: 11, stars: 89, fetchedAt: "2026-11-11T23:00:00.000Z" },
    ];
    const f = fixture();
    await runCloudDigest({ state, settings, http: f.http, now: () => at });
    expect(f.sends[0]!.message).toContain("+40 sao / 24.0h");
    expect((await baselineLoader(state.value)([11], at)).get(11)?.stars).toBe(
      50,
    );
  });
  it("rejects invalid config and disables sends when newsletter is off", async () => {
    expect(() => parseCloudSettings("{}")).toThrow();
    expect(() =>
      parseCloudSettings(
        JSON.stringify({
          ...settings,
          notifications: {
            ...settings.notifications,
            serverUrl: "http://ntfy.example",
          },
        }),
      ),
    ).toThrow();
    const state = new MemoryState();
    const f = fixture();
    expect(
      await runCloudDigest({
        state,
        settings: {
          ...settings,
          newsletter: { ...settings.newsletter, enabled: false },
        },
        http: f.http,
      }),
    ).toEqual({ status: "disabled" });
    expect(f.gets()).toBe(0);
  });
  it("bounds UTF-8 push size", () => {
    const state = new MemoryState();
    void state;
    // Use a generated digest through the ordinary path with overlong source titles below.
    const minimal = {
      createdAt: at.toISOString(),
      settings,
      status: "success",
      sources: {
        weather: { data: null, status: "disabled" },
        rss: {
          status: "success",
          data: {
            items: [{ title: "🔥".repeat(3000), url: "https://news.example" }],
          },
        },
        github: { status: "disabled" },
      },
    } as unknown as Digest;
    const text = cloudMessage(minimal);
    expect(Buffer.byteLength(text)).toBeLessThan(4096);
    expect(text).not.toContain("�");
  });
});

describe("GitHub persistence failure handling", () => {
  it("treats an absent branch as first run but fails closed on inaccessible/corrupt state", async () => {
    const absent = new GithubStateStore(
      "fixture/repo",
      "token",
      async () => new Response("", { status: 404 }),
    );
    expect((await absent.load()).state).toEqual(initialState());
    const forbidden = new GithubStateStore(
      "fixture/repo",
      "token",
      async () => new Response("", { status: 403 }),
    );
    await expect(forbidden.load()).rejects.toThrow("403");
    let calls = 0;
    const corrupt = new GithubStateStore(
      "fixture/repo",
      "token",
      async () =>
        new Response(
          JSON.stringify(
            ++calls === 1
              ? { object: {} }
              : {
                  sha: "abc",
                  size: 2,
                  encoding: "base64",
                  content: Buffer.from("{}").toString("base64"),
                },
          ),
        ),
    );
    await expect(corrupt.load()).rejects.toThrow();
  });
  it("CAS conflicts fail rather than overwriting newer state", async () => {
    const store = new GithubStateStore(
      "fixture/repo",
      "token",
      async () => new Response("", { status: 409 }),
    );
    await expect(store.save(initialState(), "old-sha")).rejects.toThrow("409");
  });
});
