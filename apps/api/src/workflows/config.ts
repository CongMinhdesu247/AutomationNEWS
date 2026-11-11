export function numberEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error("Invalid " + name);
  return value;
}
export function workerConfig() {
  const leaseMs = numberEnv("WORKER_LEASE_MS", 15000, 1000, 120000);
  const heartbeatMs = numberEnv("WORKER_HEARTBEAT_MS", 4000, 100, 30000);
  if (heartbeatMs * 2 >= leaseMs)
    throw new Error("Heartbeat must be less than half the lease.");
  return {
    leaseMs,
    heartbeatMs,
    maxRecoveries: numberEnv("WORKER_MAX_RECOVERIES", 3, 0, 10),
    concurrency: numberEnv("WORKER_CONCURRENCY", 3, 1, 16),
    pollMs: numberEnv("WORKER_POLL_MS", 1000, 100, 10000),
    shutdownMs: numberEnv("WORKER_SHUTDOWN_MS", 10000, 100, 60000),
    maxRetries: numberEnv("WORKER_MAX_RETRIES", 3, 0, 10),
    retryBaseMs: numberEnv("WORKER_RETRY_BASE_MS", 1000, 1, 60000),
    retryMaxMs: numberEnv("WORKER_RETRY_MAX_MS", 60000, 1, 3600000),
  };
}
