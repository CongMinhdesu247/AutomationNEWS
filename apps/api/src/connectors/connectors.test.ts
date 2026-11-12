import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import { defaultSettings, type Repository } from "@hub/contracts";
import { fetchRss, articleUrl } from "./rss.js";
import { fetchWeather, dateInZone } from "./weather.js";
import { createGithubConnector, rankRepositories } from "./github.js";
import { sendNtfy, dashboardLink } from "./ntfy.js";
import {
  isPublicAddress,
  resolveTarget,
  safeHttp,
  type HttpClient,
} from "./http.js";
const at = new Date("2026-11-11T18:00:00Z");
const now = () => at;
const context = { now, signal: AbortSignal.timeout(10000) };
const ok = (value: unknown) => ({
  status: 200,
  headers: {},
  body: JSON.stringify(value),
});
const repo = (
  id = 1,
  stars = 50,
  created = "2026-11-01T00:00:00Z",
): Repository => ({
  id,
  name: "org/repo" + id,
  description: "Original description",
  language: "TypeScript",
  url: "https://github.com/org/repo" + id,
  stars,
  createdAt: created,
  fetchedAt: at.toISOString(),
});
const githubItem = (id: number) => ({
  id,
  full_name: "org/repo" + id,
  description: "original",
  language: "TypeScript",
  html_url: "https://github.com/org/repo" + id,
  stargazers_count: 50,
  created_at: "2026-11-01T00:00:00Z",
  archived: false,
  fork: false,
});
describe("RSS", () => {
  it("explains a homepage URL without weakening the XML declaration guard", async () => {
    const feed = [
      {
        id: crypto.randomUUID(),
        name: "Homepage",
        enabled: true,
        url: "https://example.com/",
      },
    ];
    const result = await fetchRss(feed, {
      ...context,
      http: async () => ({
        status: 200,
        headers: {},
        body: "<!DOCTYPE html><html><head><title>News</title></head></html>",
      }),
    });
    expect(result.status).toBe("failed");
    expect(result.errors[0]).toMatchObject({
      code: "NOT_RSS_FEED",
      message: expect.stringContaining("thay vì trang chủ"),
    });
    const unsafe = await fetchRss(feed, {
      ...context,
      http: async () => ({
        status: 200,
        headers: {},
        body: '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss />',
      }),
    });
    expect(unsafe.errors[0]?.code).toBe("UNSAFE_XML");
  });
  it("deduplicates IDs and tracking URLs, skips missing dates, keeps results when a feed fails", async () => {
    const xml =
      '<rss version="2.0"><channel><title>Feed</title>' +
      [
        "<item><guid>a</guid><title>Tiêu đề</title><link>https://example.com/a?utm_source=x&amp;id=1#frag</link><pubDate>Wed, 11 Nov 2026 17:00:00 GMT</pubDate><description><![CDATA[<b>Plain text</b><script>alert(1)</script>]]></description></item>",
        "<item><guid>b</guid><title>Duplicate URL</title><link>https://example.com/a?id=1</link><pubDate>Wed, 11 Nov 2026 16:00:00 GMT</pubDate></item>",
        "<item><guid>a</guid><title>Duplicate guid</title><link>https://example.com/other</link><pubDate>Wed, 11 Nov 2026 15:00:00 GMT</pubDate></item>",
        "<item><title>No date</title><link>https://example.com/no-date</link></item>",
        "<item><title>Old</title><link>https://example.com/old</link><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate></item>",
      ].join("") +
      "</channel></rss>";
    const client: HttpClient = async (url) => {
      if (url.includes("bad")) throw new Error("token=secret");
      return { status: 200, headers: {}, body: xml };
    };
    const result = await fetchRss(
      [
        {
          id: crypto.randomUUID(),
          name: "Good",
          enabled: true,
          url: "https://example.com/rss",
        },
        {
          id: crypto.randomUUID(),
          name: "Bad",
          enabled: true,
          url: "https://bad.example/rss",
        },
      ],
      { ...context, http: client },
    );
    expect(result.status).toBe("partial");
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0]?.url).toBe("https://example.com/a?id=1");
    expect(result.data.items[0]?.description).toBe("Plain text");
    expect(result.data.skippedInvalidDate).toBe(1);
    expect(JSON.stringify(result.errors)).not.toContain("secret");
    expect(
      articleUrl("https://x.example/a?article=4&fbclid=abc&utm_medium=y#f"),
    ).toBe("https://x.example/a?article=4");
  });
  it("limits feed concurrency and takes only ten newest articles", async () => {
    let active = 0,
      max = 0;
    const client: HttpClient = async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return {
        status: 200,
        headers: {},
        body:
          '<rss version="2.0"><channel><title>x</title>' +
          Array.from(
            { length: 15 },
            (_, i) =>
              "<item><guid>" +
              i +
              "</guid><title>Item " +
              i +
              "</title><link>https://example.com/" +
              i +
              "</link><pubDate>Wed, 11 Nov 2026 " +
              String(i + 1).padStart(2, "0") +
              ":00:00 GMT</pubDate></item>",
          ).join("") +
          "</channel></rss>",
      };
    };
    const result = await fetchRss(
      Array.from({ length: 8 }, () => ({
        id: crypto.randomUUID(),
        name: "Feed",
        enabled: true,
        url: "https://example.com/feed",
      })),
      { ...context, http: client },
    );
    expect(max).toBe(3);
    expect(result.data.items).toHaveLength(10);
    expect(result.data.items[0]?.title).toBe("Item 14");
  });
});
describe("weather", () => {
  it("requests today in newsletter timezone and preserves missing values as null", async () => {
    expect(dateInZone(at, "Asia/Ho_Chi_Minh")).toBe("2026-11-12");
    let called = "";
    const client: HttpClient = async (url) => {
      called = url;
      return ok({
        daily: {
          time: ["2026-11-12"],
          temperature_2m_min: [null],
          temperature_2m_max: [30],
          precipitation_probability_max: [60],
          weather_code: [61],
        },
      });
    };
    const result = await fetchWeather(
      { ...defaultSettings.weather, enabled: true, location: "Hà Nội" },
      "Asia/Ho_Chi_Minh",
      { ...context, http: client },
    );
    expect(new URL(called).searchParams.get("start_date")).toBe("2026-11-12");
    expect(new URL(called).searchParams.get("timezone")).toBe(
      "Asia/Ho_Chi_Minh",
    );
    expect(result.status).toBe("partial");
    expect(result.data?.minTemperature).toBeNull();
    expect(result.data?.umbrella).toBe(true);
    expect(result.data?.description).toBe("Mưa nhẹ");
    expect(result.data?.attribution.license).toBe("CC BY 4.0");
  });
  it("does not silently use a different day", async () => {
    const result = await fetchWeather(
      { ...defaultSettings.weather, enabled: true },
      "Asia/Ho_Chi_Minh",
      { ...context, http: async () => ok({ daily: { time: ["2026-11-11"] } }) },
    );
    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
  });
});
describe("GitHub", () => {
  it("shows only genuinely new repositories when there is no baseline", () => {
    const result = rankRepositories(
      [repo(), repo(2, 100, "2025-01-01T00:00:00Z")],
      new Map(),
      5,
      at,
    );
    expect(result.rising).toEqual([]);
    expect(result.newNotable.map((item) => item.id)).toEqual([1]);
    expect(result.newNotable[0]).not.toHaveProperty("starChange");
  });
  it("uses a valid 20–28h baseline, preserves negative changes and rejects same-day baselines", () => {
    const yesterday = new Date(at.getTime() - 24.5 * 3600000).toISOString();
    const result = rankRepositories(
      [repo(1, 40), repo(2), repo(3)],
      new Map([
        [1, { stars: 50, fetchedAt: yesterday }],
        [
          2,
          {
            stars: 10,
            fetchedAt: new Date(at.getTime() - 3600000).toISOString(),
          },
        ],
        [
          3,
          {
            stars: 1,
            fetchedAt: new Date(at.getTime() - 29 * 3600000).toISOString(),
          },
        ],
      ]),
      5,
      at,
    );
    expect(result.rising).toHaveLength(1);
    expect(result.rising[0]).toMatchObject({
      starChange: -10,
      intervalHours: 24.5,
      baselineAt: yesterday,
    });
  });
  it("deduplicates IDs, removes forks/archives and observes Search rate limits across runs", async () => {
    let calls = 0;
    const client: HttpClient = async () => {
      calls++;
      return {
        ...ok({
          items: [
            githubItem(1),
            githubItem(1),
            { ...githubItem(2), fork: true },
            { ...githubItem(3), archived: true },
          ],
        }),
        headers: {
          "x-ratelimit-resource": "search",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(at.getTime() / 1000 + 90),
        },
      };
    };
    const connector = createGithubConnector({
      http: client,
      now,
      token: "never-log-this",
      translateSummaries: false, // This test isolates GitHub quota, not translation requests.
    });
    const snapshots: Repository[] = [];
    const deps = {
      signal: context.signal,
      baselines: async () => new Map(),
      recordSnapshots: (values: Repository[]) => snapshots.push(...values),
    };
    const first = await connector(
      { ...defaultSettings.github, enabled: true },
      deps,
    );
    expect(first.status).toBe("partial");
    expect(first.data.candidates).toBe(1);
    expect(snapshots).toHaveLength(1);
    expect(first.data.rateLimits[0]?.resource).toBe("search");
    const second = await connector(
      { ...defaultSettings.github, enabled: true },
      deps,
    );
    expect(second.status).toBe("failed");
    expect(calls).toBe(1);
    expect(JSON.stringify(second)).not.toContain("never-log-this");
  });
  it("honors secondary limits without retrying", async () => {
    let calls = 0;
    const connector = createGithubConnector({
      now,
      http: async () => {
        calls++;
        return {
          status: 429,
          headers: { "retry-after": "120" },
          body: "sensitive",
        };
      },
    });
    const result = await connector(
      { ...defaultSettings.github, enabled: true },
      { signal: context.signal, baselines: async () => new Map() },
    );
    expect(result.status).toBe("failed");
    expect(calls).toBe(1);
  });
});
describe("HTTP policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "100.100.100.200",
    "168.63.129.16",
    "0.0.0.0",
  ])("blocks private/metadata address %s", (address) =>
    expect(isPublicAddress(address)).toBe(false),
  );
  it("rejects DNS with any private result, but permits an explicit LAN ntfy origin", async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      resolveTarget(new URL("https://rss.example/feed"), [], resolver as never),
    ).rejects.toThrow("Đích truy cập");
    await expect(
      resolveTarget(new URL("http://192.168.1.5:8080"), [
        "http://192.168.1.5:8080",
      ]),
    ).resolves.toMatchObject({ address: "192.168.1.5" });
  });
  it("enforces response size, timeout, redirect policy and rechecks redirect destinations using local HTTP only", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/big") {
        res.end("x".repeat(100));
      } else if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://127.0.0.2/blocked" });
        res.end();
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 80);
      } else res.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const origin = "http://127.0.0.1:" + address.port;
    const opts = { allowedOrigins: [origin] };
    try {
      await expect(safeHttp(origin, { ...opts })).resolves.toMatchObject({
        body: "ok",
      });
      await expect(
        safeHttp(origin + "/big", { ...opts, maxBytes: 10 }),
      ).rejects.toThrow();
      await expect(
        safeHttp(origin + "/slow", { ...opts, timeoutMs: 10 }),
      ).rejects.toThrow();
      await expect(
        safeHttp(origin + "/redirect", { ...opts, maxRedirects: 1 }),
      ).rejects.toThrow("Đích truy cập");
      await expect(
        safeHttp(origin + "/redirect", {
          ...opts,
          method: "POST",
          body: "secret",
        }),
      ).rejects.toThrow("Redirect");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
it("ntfy sends only a short Vietnamese summary, credentials stay in headers and localhost links are omitted", async () => {
  let sent: any;
  const client: HttpClient = async (url, options) => {
    sent = { url, options };
    return ok({ id: "ntfy-id" });
  };
  const digest = {
    id: crypto.randomUUID(),
    createdAt: at.toISOString(),
    settings: defaultSettings,
    status: "partial",
    sources: {
      rss: {
        status: "success",
        data: {
          items: [{ title: "Tin mới", url: "https://news.example/item" }],
        },
      },
      weather: { status: "disabled", data: null },
      github: { status: "disabled", data: { rising: [], newNotable: [] } },
    },
  } as never;
  const result = await sendNtfy(
    digest,
    { enabled: true, serverUrl: "https://ntfy.sh/", topic: "private-topic" },
    {
      ...context,
      http: client,
      token: "secret-token",
      publicBaseUrl: "http://localhost:8088",
    },
  );
  expect(result.status).toBe("success");
  const body = JSON.parse(sent.options.body);
  expect(body.message).toContain("1 tin");
  expect(body).not.toHaveProperty("click");
  expect(sent.options.headers.Authorization).toBe("Bearer secret-token");
  expect(JSON.stringify(result)).not.toContain("secret-token");
  expect(dashboardLink("https://hub.example", "abc")).toBe(
    "https://hub.example/#/digests/abc",
  );
});

it("keeps GitHub core and Search quota buckets separate", async () => {
  let calls = 0;
  const connector = createGithubConnector({
    now,
    http: async () => {
      calls++;
      return {
        ...ok({ items: [] }),
        headers: {
          "x-ratelimit-resource": "core",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(at.getTime() / 1000 + 120),
        },
      };
    },
  });
  const result = await connector(
    { ...defaultSettings.github, enabled: true },
    { signal: context.signal, baselines: async () => new Map() },
  );
  expect(result.status).toBe("success");
  expect(calls).toBe(2);
});
it.each([
  "http://127.0.0.2:8088",
  "http://[::1]:8088",
  "http://0.0.0.0:8088",
  "http://localhost.:8088",
])("does not attach phone-unreachable dashboard link %s", (base) =>
  expect(dashboardLink(base, "test")).toBeUndefined(),
);
