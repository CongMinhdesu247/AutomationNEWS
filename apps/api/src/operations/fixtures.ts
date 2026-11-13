import { setTimeout as delay } from "node:timers/promises";
import { defaultSettings, type Settings } from "@hub/contracts";
import type { HttpClient } from "../connectors/http.js";
export const fixtureSettings: Settings = {
  ...structuredClone(defaultSettings),
  newsletter: { ...defaultSettings.newsletter, enabled: false },
  rss: [
    {
      id: crypto.randomUUID(),
      name: "[DEMO FIXTURE] RSS",
      url: "https://rss.fixture.invalid/feed",
      enabled: true,
    },
  ],
  weather: {
    enabled: true,
    location: "[DEMO FIXTURE] Hà Nội",
    latitude: 21.03,
    longitude: 105.85,
  },
  github: {
    enabled: true,
    topics: ["automation"],
    languages: ["TypeScript"],
    repositoryCount: 5,
  },
  notifications: {
    enabled: false,
    serverUrl: "https://ntfy.fixture.invalid",
    topic: "demo-fixture",
  },
};
export function fixtureClient(
  latencyMs = 200,
  mode: "success" | "retry" | "dlq" = "success",
) {
  let weatherCalls = 0,
    postCalls = 0;
  const calls: { source: string; at: string }[] = [];
  const http: HttpClient = async (value, options = {}) => {
    const url = new URL(value);
    const source =
      options.method === "POST"
        ? "ntfy"
        : url.hostname === "api.github.com"
          ? "github"
          : url.hostname.includes("open-meteo")
            ? "weather"
            : "rss";
    calls.push({ source, at: new Date().toISOString() });
    if (source === "ntfy") postCalls++;
    await delay(latencyMs, undefined, { signal: options.signal });
    if (
      source === "weather" &&
      (mode === "dlq" || (mode === "retry" && weatherCalls++ === 0))
    )
      return { status: mode === "dlq" ? 400 : 503, headers: {}, body: "{}" };
    let body = "{}";
    if (source === "rss")
      body =
        '<?xml version="1.0"?><rss version="2.0"><channel><title>DEMO FIXTURE</title><link>https://rss.fixture.invalid</link><description>Fixture only</description><item><guid>demo-1</guid><title>[DEMO FIXTURE] Bản tin tự động</title><link>https://rss.fixture.invalid/article?utm_source=demo</link><pubDate>' +
        new Date().toUTCString() +
        "</pubDate><description>Dữ liệu mô phỏng, không phải tin thật.</description></item></channel></rss>";
    if (source === "weather")
      body = JSON.stringify({
        daily: {
          time: [
            new Intl.DateTimeFormat("en-CA", {
              timeZone: url.searchParams.get("timezone") ?? "Asia/Ho_Chi_Minh",
            }).format(new Date()),
          ],
          temperature_2m_min: [23],
          temperature_2m_max: [31],
          precipitation_probability_max: [65],
          weather_code: [61],
        },
      });
    if (source === "github")
      body = JSON.stringify({
        items: [
          {
            id: 60601,
            full_name: "demo-fixture/automation-hub",
            description: "[DEMO FIXTURE] Synthetic repository",
            language: "TypeScript",
            html_url: "https://github.com/demo-fixture/automation-hub",
            stargazers_count: 123,
            created_at: new Date(Date.now() - 86400000).toISOString(),
            archived: false,
            fork: false,
          },
        ],
        incomplete_results: false,
      });
    return { status: 200, headers: {}, body };
  };
  return {
    http,
    calls,
    get postCalls() {
      return postCalls;
    },
  };
}
