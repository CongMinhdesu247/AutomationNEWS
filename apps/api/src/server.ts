import { databaseUrl } from "./env.js";
import { createPool } from "./db.js";
import { buildApp } from "./app.js";
const pool = createPool(databaseUrl());
function positiveEnv(name: string, fallback: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error("Invalid " + name);
  return value;
}
const app = buildApp(pool, {
  githubToken: process.env.GITHUB_TOKEN,
  ntfyToken: process.env.NTFY_TOKEN,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  ntfyAllowedOrigins: (process.env.NTFY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin),
  totalTimeoutMs: positiveEnv("DIGEST_TIMEOUT_MS", 25000, 45000),
  requestTimeoutMs: positiveEnv("HTTP_TIMEOUT_MS", 6000, 15000),
  maxConcurrent: positiveEnv("MAX_CONCURRENT_OPERATIONS", 2, 4),
});
app.addHook("onClose", async () => {
  await pool.end();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
try {
  await app.listen({
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? "127.0.0.1",
  });
  console.log("API đang chạy.");
} catch {
  console.error("Không thể khởi động API.");
  await app.close();
  process.exitCode = 1;
}
