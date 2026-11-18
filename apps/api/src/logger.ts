const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/(postgresql:\/\/[^:\s/]+:)[^@\s]+(@)/gi, "$1[REDACTED]$2"],
  [/(github_pat_[A-Za-z0-9_]+)/g, "[REDACTED_GH_PAT]"],
  [/(gh[pousr]_[A-Za-z0-9_]+)/g, "[REDACTED_GH_TOKEN]"],
  [/(AIza[0-9A-Za-z_-]{20,})/g, "[REDACTED_API_KEY]"],
  [/(BSA[A-Za-z0-9_-]{20,})/g, "[REDACTED_BRAVE_KEY]"],
  [/([?&](?:key|token|api_key|password)=)[^&\s]+/gi, "$1[REDACTED]"],
];

const SENSITIVE_KEY_RE =
  /password|token|secret|cookie|authorization|api[-_]?key|private[-_]?key/i;

export function sanitizeLogText(value: string): string {
  let clean = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    clean = clean.replace(pattern, replacement);
  }
  return clean.slice(0, 1000);
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    const errCode =
      "code" in value && typeof value.code === "string" ? value.code : undefined;
    return {
      name: value.name,
      message: sanitizeLogText(value.message),
      ...(errCode ? { code: errCode } : {}),
    };
  }
  if (typeof value === "string") return sanitizeLogText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key) && key !== "errorCode" && key !== "idempotencyKey") {
        out[key] = "[REDACTED]";
      } else {
        out[key] = sanitizeValue(entry, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  meta: Record<string, unknown> = {},
) {
  if (process.env.VITEST && level !== "error") return;
  const safeMeta = sanitizeValue(meta, 0) as Record<string, unknown>;
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    event,
    ...safeMeta,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
