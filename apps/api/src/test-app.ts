import { buildApp } from "./app.js";
// Explicit escape hatch only for pre-existing isolated fixture/integration suites.
// Production server.ts always enables authentication.
export const buildTestApp: typeof buildApp = (pool, options, sse, cloud) =>
  buildApp(pool, options, sse, cloud, { enabled: false });
