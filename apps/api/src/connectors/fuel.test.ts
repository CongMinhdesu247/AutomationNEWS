import { expect, it } from "vitest";
import { fetchFuel, fuelBaseline, fuelPriceUrl, petrolimexHome } from "./fuel.js";
import type { HttpClient } from "./http.js";

const at = new Date("2026-11-12T09:00:00Z");
const link = "/ndi/thong-cao-bao-chi/petrolimex-dieu-chinh-gia-xang-dau-tu-15-gio-00-phut-ngay-12-11-2026.html";
const rows = [
  { ID: "95iii", Title: "Xăng E10 RON 95-III", Zone1Price: 19840, LastModified: "2026-11-12T07:50:29.630Z" },
  { ID: "95v", Title: "Xăng E10 RON 95-V", Zone1Price: 21840, LastModified: "2026-11-12T07:50:07.598Z" },
  { ID: "92", Title: "Xăng E5 RON 92-II", Zone1Price: 19390, LastModified: "2026-11-12T07:50:56.849Z" },
];
function fixture({ products = rows, article = "Mức giá mới có hiệu lực từ thời điểm 15 giờ 00 phút ngày 12 tháng 11 năm 2026", home = `<a href="${link}">Giá</a>`, status = 200 } = {}): HttpClient {
  return async (url, options) => {
    expect(options?.headers?.Authorization).toBeUndefined();
    if (url === fuelPriceUrl()) return { status, headers: {}, body: JSON.stringify({ Objects: products }) };
    if (url === petrolimexHome) return { status: 200, headers: {}, body: home };
    if (url === new URL(link, petrolimexHome).toString()) return { status: 200, headers: {}, body: `<p>${article}</p>` };
    throw new Error("Unexpected request");
  };
}
const context = { now: () => at, signal: AbortSignal.timeout(10000) };
it("selects only RON 95, preserves E10/product grades, reads zone 1, and compares the same products", async () => {
  const result = await fetchFuel({ enabled: true }, { ...context, http: fixture(), baseline: { at: "2026-11-11T00:00:00Z", prices: { "95iii": 20000, "95v": 21840, "92": 18000 } } });
  expect(result.status).toBe("success");
  expect(result.data?.effectiveAt).toBe("2026-11-12T08:00:00.000Z");
  expect(result.data?.items).toEqual([
    { code: "95iii", name: "Xăng E10 RON 95-III", price: 19840, change: -160 },
    { code: "95v", name: "Xăng E10 RON 95-V", price: 21840, change: 0 },
  ]);
  expect(fuelBaseline(result)?.prices).toEqual({ "95iii": 19840, "95v": 21840 });
});
it("does not claim a change on first collection or compare an expired baseline", async () => {
  for (const baseline of [undefined, { at: "2026-10-01T00:00:00Z", prices: { "95iii": 10000 } }]) {
    const result = await fetchFuel({ enabled: true }, { ...context, http: fixture(), baseline });
    expect(result.data?.items.every((item) => item.change === null)).toBe(true);
    expect(result.data?.comparedAt).toBeNull();
  }
});
it("rejects prices not yet effective and an out-of-date/mismatched widget", async () => {
  const future = await fetchFuel({ enabled: true }, { ...context, now: () => new Date("2026-11-12T07:55:00Z"), http: fixture() });
  expect(future.errors[0]?.code).toBe("FUEL_NOT_EFFECTIVE");
  const stale = await fetchFuel({ enabled: true }, { ...context, http: fixture({ products: rows.map((row) => ({ ...row, LastModified: "2026-11-05T08:00:00Z" })) }) });
  expect(stale.errors[0]?.code).toBe("FUEL_DATE_MISMATCH");
  expect(stale.data).toBeNull();
});
it("fails honestly on layout, invalid price, no product, or HTTP errors without visiting foreign links", async () => {
  for (const [http, code] of [
    [fixture({ home: '<a href="https://evil.example/ndi/thong-cao-bao-chi/petrolimex-dieu-chinh-gia-xang-dau-foo.html">Giá</a>' }), "FUEL_LAYOUT_CHANGED"],
    [fixture({ article: "Không có ngày" }), "FUEL_MISSING_DATE"],
    [fixture({ products: [rows[2]!] }), "FUEL_MISSING_PRODUCT"],
    [fixture({ products: [{ ...rows[0]!, Zone1Price: -1 }] }), "SOURCE_UNAVAILABLE"],
    [fixture({ status: 503 }), "HTTP_503"],
  ] as const) {
    const result = await fetchFuel({ enabled: true }, { ...context, http });
    expect(result.status).toBe("failed"); expect(result.data).toBeNull();
    expect(result.errors[0]?.code).toBe(code);
  }
});
it("makes no requests when disabled or missing from older settings", async () => {
  for (const config of [undefined, { enabled: false }]) {
    const result = await fetchFuel(config, { ...context, http: async () => { throw new Error("Must not fetch"); } });
    expect(result.status).toBe("disabled");
  }
});
