import { setTimeout as delay } from "node:timers/promises";
import { defaultSettings, type Settings } from "@hub/contracts";
import type { HttpClient } from "../connectors/http.js";
import { petrolimexHome } from "../connectors/fuel.js";
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
        : url.hostname === "www.vietcombank.com.vn"
          ? "usd"
          : url.hostname.endsWith(".petrolimex.com.vn")
            ? "fuel"
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
    if (source === "fuel") {
      const link =
        "/ndi/thong-cao-bao-chi/petrolimex-dieu-chinh-gia-xang-dau-fixture.html";
      const effectiveAt = new Date(Date.now() - 3600000);
      const local = new Date(effectiveAt.getTime() + 7 * 3600000);
      if (url.hostname === "portals.petrolimex.com.vn") {
        body = JSON.stringify({
          Objects: [
            {
              ID: "fixture-e10",
              Title: "Xăng E10 RON 95-III",
              Zone1Price: 19840,
              LastModified: effectiveAt.toISOString(),
            },
          ],
        });
      } else if (url.href === petrolimexHome) {
        body = `<a href="${link}">[DEMO FIXTURE] Giá xăng</a>`;
      } else {
        body = `<p>Mức giá mới có hiệu lực từ thời điểm ${local.getUTCHours()} giờ ${local.getUTCMinutes()} phút ngày ${local.getUTCDate()} tháng ${local.getUTCMonth() + 1} năm ${local.getUTCFullYear()}</p>`;
      }
    }
    if (source === "usd") {
      const date = url.searchParams
        .get("date")
        ?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      body = JSON.stringify({
        UpdatedDate: date
          ? `${date}T00:00:00+07:00`
          : new Date(Date.now() - 60000).toISOString(),
        Data: [
          {
            currencyCode: "USD",
            cash: "25460.00",
            transfer: "25490.00",
            sell: "25870.00",
          },
        ],
      });
    }
    if (source === "rss")
      body =
        '<?xml version="1.0"?><rss version="2.0"><channel><title>DEMO FIXTURE</title><link>https://rss.fixture.invalid</link><description>Fixture only</description><item><guid>demo-1</guid><title>[DEMO FIXTURE] Bản tin tự động</title><link>https://rss.fixture.invalid/article?utm_source=demo</link><pubDate>' +
        new Date().toUTCString() +
        "</pubDate><description>Dữ liệu mô phỏng, không phải tin thật.</description></item></channel></rss>";
    if (
      url.hostname === "rss.fixture.invalid" &&
      url.pathname === "/demo-summary"
    ) {
      const publishedAt = new Date().toUTCString();
      body = `<?xml version="1.0"?><rss version="2.0"><channel><title>Thực tập IT mô phỏng</title><link>https://rss.fixture.invalid/demo-summary</link><description>Dữ liệu mô phỏng</description>
      <item><guid>demo-it-web</guid><title>[MÔ PHỎNG] Thực tập IT web tại Hà Nội</title><link>https://rss.fixture.invalid/demo-it-web</link><pubDate>${publishedAt}</pubDate><description>Vị trí thực tập phát triển web cho sinh viên. Đây là dữ liệu giả lập.</description></item>
      <item><guid>demo-it-qa</guid><title>[MÔ PHỎNG] Thực tập IT kiểm thử tại Hà Nội</title><link>https://rss.fixture.invalid/demo-it-qa</link><pubDate>${publishedAt}</pubDate><description>Vị trí thực tập kiểm thử phần mềm. Đây là dữ liệu giả lập.</description></item>
      </channel></rss>`;
    }
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
          uv_index_max: [6.4],
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
