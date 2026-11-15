// Browser verification only: same real auth/API/queue, injected HTTP fixtures.
import { createPool } from "../../apps/api/src/db.js";
import { migrate } from "../../apps/api/src/migrate.js";
import { buildApp } from "../../apps/api/src/app.js";
import { fixtureClient } from "../../apps/api/src/operations/fixtures.js";
import {
  WorkflowQueue,
  WorkerRunner,
} from "../../apps/api/src/workflows/runtime.js";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== "/accounts_test" ||
  process.env.ACCOUNT_BROWSER_FIXTURE !== "1"
)
  throw new Error("Requires isolated accounts_test fixture database");
const admin = createPool(url);
const schema = "account_browser_" + crypto.randomUUID().replaceAll("-", "");
await admin.query("CREATE SCHEMA " + schema);
const scoped = new URL(url);
scoped.searchParams.set("options", "-c search_path=" + schema);
const pool = createPool(scoped.toString());
await migrate(pool);
const fixture = fixtureClient(50);
const app = buildApp(pool, { http: fixture.http }, {}, undefined, {
  origin: "http://127.0.0.1:5178",
  registrationOpen: true,
});
const controller = new AbortController();
const work = new WorkerRunner(
  new WorkflowQueue(pool),
  { pollMs: 50 },
  { http: fixture.http },
).run(controller.signal);
app.addHook("onClose", async () => {
  controller.abort();
  await work;
  await pool.end();
  await admin.query("DROP SCHEMA " + schema + " CASCADE");
  await admin.end();
});
process.once("SIGINT", () => void app.close());
process.once("SIGTERM", () => void app.close());
await app.listen({ host: "127.0.0.1", port: 3007 });
console.log("Account browser fixture API ready on 3007; no external HTTP.");
