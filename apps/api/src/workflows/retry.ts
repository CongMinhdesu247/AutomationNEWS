import type { SourceError } from "@hub/contracts";

export function isRetryable(error: SourceError | null): boolean {
  return (
    !!error &&
    /^(HTTP_(408|425|429|500|502|503|504)|TIMEOUT|TOTAL_TIMEOUT|SOURCE_UNAVAILABLE|GITHUB_RATE_LIMIT|NODE_PERSIST_FAILED)$/.test(
      error.code,
    )
  );
}

export function retryDelay(
  retryIndex: number,
  error: SourceError | null,
  { baseMs = 1000, maxMs = 60000, random = Math.random, now = Date.now() } = {},
) {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.min(retryIndex, 20));
  const jitter = Math.max(
    1,
    Math.floor(Math.max(0, Math.min(1, random())) * cap),
  );
  const hint = error?.retryAt ? Date.parse(error.retryAt) - now : 0;
  return Math.max(jitter, Number.isFinite(hint) ? hint : 0);
}
