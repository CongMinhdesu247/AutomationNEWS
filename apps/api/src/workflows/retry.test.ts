import { describe, expect, it } from "vitest";
import { isRetryable, retryDelay } from "./retry.js";
import { nextDaily, localDay } from "./schedule.js";
import { ensureOk, cleanError, retryAfterAt } from "../connectors/http.js";

describe("durable retry policy", () => {
  it("classifies transient versus permanent failures", () => {
    for (const code of ["HTTP_429", "HTTP_503", "TIMEOUT", "GITHUB_RATE_LIMIT"])
      expect(isRetryable({ code, message: "fixture" })).toBe(true);
    for (const code of [
      "HTTP_400",
      "HTTP_401",
      "HTTP_403",
      "BLOCKED_ADDRESS",
      "UNSAFE_XML",
    ])
      expect(isRetryable({ code, message: "fixture" })).toBe(false);
  });
  it("caps exponential jitter but never shortens Retry-After", () => {
    expect(retryDelay(0, null, { random: () => 0.5 })).toBe(500);
    expect(retryDelay(2, null, { random: () => 0.5 })).toBe(2000);
    expect(retryDelay(10, null, { random: () => 1 })).toBe(60000);
    expect(
      retryDelay(
        0,
        {
          code: "HTTP_429",
          message: "fixture",
          retryAt: new Date(180000).toISOString(),
        },
        { now: 0, random: () => 0 },
      ),
    ).toBe(180000);
  });
  it("preserves both Retry-After formats without leaking response body", () => {
    expect(retryAfterAt("120", 0)).toBe("1970-01-01T00:02:00.000Z");
    expect(retryAfterAt("Wed, 11 Nov 2026 00:00:00 GMT")).toBe(
      "2026-11-11T00:00:00.000Z",
    );
    expect(retryAfterAt("invalid")).toBeUndefined();
    try {
      ensureOk({
        status: 503,
        headers: { "retry-after": "120" },
        body: "secret",
      });
    } catch (error) {
      expect(cleanError(error)).toMatchObject({
        code: "HTTP_503",
        retryAt: expect.any(String),
      });
      expect(cleanError(error).message).not.toContain("secret");
    }
  });
});
describe("daily wall-clock schedule", () => {
  it("resolves 07:00 Vietnam without using host timezone", () => {
    expect(
      nextDaily(
        new Date("2026-11-10T23:59:00Z"),
        "07:00",
        "Asia/Ho_Chi_Minh",
      ).toISOString(),
    ).toBe("2026-11-11T00:00:00.000Z");
    expect(localDay(new Date("2026-11-10T18:00:00Z"), "Asia/Ho_Chi_Minh")).toBe(
      "2026-11-11",
    );
    expect(
      nextDaily(
        new Date("2026-11-11T00:00:00Z"),
        "07:00",
        "Asia/Ho_Chi_Minh",
      ).toISOString(),
    ).toBe("2026-11-12T00:00:00.000Z");
  });
  it("skips nonexistent spring DST time", () => {
    expect(
      nextDaily(
        new Date("2026-03-08T00:00:00Z"),
        "02:30",
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-03-09T06:30:00.000Z");
  });
});
