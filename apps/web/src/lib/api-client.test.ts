import { afterEach, describe, expect, it, vi } from "vitest";
import { safeExternalHref } from "@hub/contracts";
import { apiRequest, HttpClientError } from "./api-client";

describe("safeExternalHref", () => {
  it("allows clean http and https URLs", () => {
    expect(safeExternalHref("https://vnexpress.net/tin-moi")).toBe(
      "https://vnexpress.net/tin-moi",
    );
    expect(safeExternalHref("http://example.com/feed.xml")).toBe(
      "http://example.com/feed.xml",
    );
  });

  it("blocks javascript:, data:, vbscript:, and embedded credentials", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("  JaVaScRiPt:alert(document.cookie) ")).toBeUndefined();
    expect(safeExternalHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalHref("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeExternalHref("https://user:pass@example.com/rss")).toBeUndefined();
    expect(safeExternalHref("")).toBeUndefined();
    expect(safeExternalHref(null)).toBeUndefined();
  });
});

describe("apiRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("handles HTML 502 gateway errors gracefully without SyntaxError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    await expect(apiRequest("/api/digests")).rejects.toMatchObject({
      name: "HttpClientError",
      status: 502,
      message: "Máy chủ đang bận hoặc tạm gián đoạn kết nối. Vui lòng thử lại sau ít giây.",
    });
  });

  it("extracts structured API error messages and codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "RATE_LIMIT", message: "Thử lại sau ít phút." },
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    try {
      await apiRequest("/api/auth/login", { body: { email: "a@b.c" } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpClientError);
      expect((err as HttpClientError).status).toBe(429);
      expect((err as HttpClientError).code).toBe("RATE_LIMIT");
      expect((err as HttpClientError).message).toBe("Thử lại sau ít phút.");
    }
  });
});
