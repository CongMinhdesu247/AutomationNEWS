import { runProxySmoke } from "../shared/proxy-smoke.mjs";

await runProxySmoke(process.env.TELEMETRY_BASE_URL ?? "http://127.0.0.1:8098");
