// Isolated UI fixture. Never run against the normal DATABASE_URL.
import { createPool } from "../../apps/api/src/db.js";
import { migrate } from "../../apps/api/src/migrate.js";
import { buildApp } from "../../apps/api/src/app.js";
import { fixtureClient } from "../../apps/api/src/operations/fixtures.js";
import {
  safeHttp,
  type HttpClient,
} from "../../apps/api/src/connectors/http.js";
import { goldSourceUrl } from "../../apps/api/src/connectors/markets.js";
import {
  WorkflowQueue,
  WorkerRunner,
} from "../../apps/api/src/workflows/runtime.js";
import { tickCustom } from "../../apps/api/src/premium/runtime.js";
import { fakeAi } from "../../apps/api/src/premium/ai.js";
import { fakeSearch } from "../../apps/api/src/premium/search.js";
import { registerLocalWebPreview } from "../../apps/api/src/premium/local-preview.js";
import { hashPassword } from "../../apps/api/src/accounts/password.js";
import { initialSettings } from "../../apps/api/src/accounts/preferences.js";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== "/accounts_test" ||
  process.env.PREMIUM_BROWSER_FIXTURE !== "1"
)
  throw new Error("Requires isolated accounts_test fixture database");
const root = createPool(url),
  schema =
    process.env.PREMIUM_BROWSER_SCHEMA ??
    "premium_browser_" + crypto.randomUUID().replaceAll("-", "");
if (!/^premium_browser_[a-f0-9]{32}$/.test(schema))
  throw new Error("Invalid fixture schema");
await root.query("CREATE SCHEMA IF NOT EXISTS " + schema);
const scoped = new URL(url);
scoped.searchParams.set("options", "-c search_path=" + schema);
const pool = createPool(scoped.toString());
await migrate(pool);
const livePreview = process.env.PREMIUM_BROWSER_LIVE === "1";
const fixture = fixtureClient(5);
// The live preview must read actual quotes. Keep this narrow so it cannot
// accidentally send test notifications or fetch arbitrary fixture URLs.
const http: HttpClient = (value, options) =>
  livePreview &&
  value === goldSourceUrl &&
  (!options?.method || options.method === "GET")
    ? safeHttp(value, options)
    : fixture.http(value, options);
if (process.env.PREMIUM_SEARCH_FIXTURE === "1")
  await pool.query("UPDATE news_ai_control SET config=$1::jsonb", [
    JSON.stringify({
      enabled: true,
      searchEnabled: true,
      searchStorageAllowed: true,
      searchProvider: "brave",
      searchUnitMicros: 5000,
      searchPricingVersion: "fake-search.v1",
      dailySearchUnits: 10,
      monthlySearchUnits: 20,
      dailyMicros: 1000000,
      monthlyMicros: 10000000,
      dailyCalls: 100,
      monthlyTokens: 1000000,
      concurrency: 1,
      provider: "gemini",
      model: "fixture-model",
      pricingVersion: "fake.v1",
      inputMicrosPerMillion: 300000,
      outputMicrosPerMillion: 2500000,
      timeoutMs: 1000,
    }),
  ]);
for (const role of ["admin", "member"]) {
  if (
    (
      await pool.query("SELECT id FROM hub_users WHERE email=$1", [
        `${role}@fixture.invalid`,
      ])
    ).rowCount
  )
    continue;
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO hub_users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
    [
      id,
      `${role}@fixture.invalid`,
      role === "admin" ? "Quản trị thử nghiệm" : "Thành viên thử nghiệm",
      await hashPassword("premium-fixture-password"),
      role,
    ],
  );
  await pool.query(
    "INSERT INTO user_settings(user_id,config) VALUES($1,$2::jsonb)",
    [id, JSON.stringify(initialSettings("https://ntfy.fixture.invalid/"))],
  );
  if (role === "admin")
    await pool.query(
      "UPDATE news_entitlements SET plan_id='premium',expires_at=now()+interval '30 days' WHERE user_id=$1",
      [id],
    );
}
if (!livePreview) {
  await pool.query(
    "INSERT INTO news_sources(id,name,url,status) VALUES($1,'RSS thử nghiệm công khai','https://rss.fixture.invalid/feed','approved') ON CONFLICT(url) DO NOTHING",
    [crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO news_sources(id,name,url,status) VALUES($1,'RSS mô phỏng thực tập IT','https://rss.fixture.invalid/demo-summary','approved') ON CONFLICT(url) DO NOTHING",
    [crypto.randomUUID()],
  );
}
const app = buildApp(
  pool,
  { http, aiAdapter: fakeAi, searchAdapter: fakeSearch },
  {},
  undefined,
  { origin: "http://127.0.0.1:5186", registrationOpen: true },
);
await registerLocalWebPreview(app, pool);
const queue = new WorkflowQueue(pool),
  controller = new AbortController();
const work = new WorkerRunner(
  queue,
  { pollMs: 100 },
  {
    http,
    premiumFeedHttp: livePreview
      ? (value, options) =>
          new URL(value).hostname.endsWith(".fixture.invalid")
            ? fixture.http(value, options)
            : safeHttp(value, options)
      : undefined,
    aiAdapter: fakeAi,
    searchAdapter: fakeSearch,
  },
).run(controller.signal);
const timer = setInterval(() => void tickCustom(queue).catch(() => {}), 500);
app.addHook("onClose", async () => {
  clearInterval(timer);
  controller.abort();
  await work;
  await pool.end();
  if (!process.env.PREMIUM_BROWSER_SCHEMA)
    await root.query("DROP SCHEMA " + schema + " CASCADE");
  await root.end();
});
process.once("SIGINT", () => void app.close());
process.once("SIGTERM", () => void app.close());
await app.listen({ host: "127.0.0.1", port: 3016 });
console.log(
  livePreview
    ? "Premium preview ready on 3016 with live web search and SJC quote."
    : "Premium fixture API ready on 3016; AI fake, no external HTTP.",
);
