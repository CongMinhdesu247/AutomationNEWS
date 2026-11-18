import { databaseUrl } from "./env.js";
import { createPool } from "./db.js";
import { buildApp } from "./app.js";
import { logEvent } from "./logger.js";

const pool = createPool(databaseUrl());

function positiveEnv(name: string, fallback: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error("Invalid " + name);
  return value;
}

export function parseOriginList(raw: string | undefined, base?: string): string[] {
  const list = [
    ...(base ? [base] : []),
    ...(raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  return [...new Set(list.map((value) => new URL(value).origin))];
}

const primaryNtfyUrl = process.env.ACCOUNT_NTFY_URL ?? "https://ntfy.sh/";
const allowedOrigins = parseOriginList(process.env.NTFY_ALLOWED_ORIGINS);
const destinationOrigins = parseOriginList(
  process.env.NTFY_ALLOWED_ORIGINS,
  primaryNtfyUrl,
);
const tokenOrigins = process.env.NTFY_AUTH_ORIGIN
  ? parseOriginList(process.env.NTFY_AUTH_ORIGIN)
  : [new URL(primaryNtfyUrl).origin];

const extraProxyCidrs = (process.env.TRUSTED_PROXY_CIDRS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const trustProxy =
  process.env.TRUST_PROXY === "true"
    ? ["127.0.0.1", "::1", "172.16.0.0/12", ...extraProxyCidrs]
    : false;

const app = buildApp(
  pool,
  {
    githubToken: process.env.GITHUB_TOKEN,
    ntfyToken: process.env.NTFY_TOKEN,
    ntfyDestinationOrigins: destinationOrigins,
    ntfyTokenOrigins: tokenOrigins,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    ntfyAllowedOrigins: allowedOrigins,
    totalTimeoutMs: positiveEnv("DIGEST_TIMEOUT_MS", 25000, 45000),
    requestTimeoutMs: positiveEnv("HTTP_TIMEOUT_MS", 6000, 15000),
    maxConcurrent: positiveEnv("MAX_CONCURRENT_OPERATIONS", 2, 8),
  },
  {},
  undefined,
  {
    origin: process.env.APP_ORIGIN ?? "http://127.0.0.1:8088",
    memberOrigin: process.env.MEMBER_PUBLIC_URL,
    registrationOpen: process.env.REGISTRATION_OPEN === "true",
    maxUsers: positiveEnv("MAX_USERS", 100, 10000),
    ntfyUrl: process.env.ACCOUNT_NTFY_URL ?? "https://ntfy.sh/",
    trustProxy,
  },
);

app.addHook("onClose", async () => {
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });

try {
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen({ port, host });
  logEvent("info", "api.started", { host, port });
} catch (error) {
  logEvent("error", "api.startup_failed", { error });
  await app.close();
  process.exitCode = 1;
}
