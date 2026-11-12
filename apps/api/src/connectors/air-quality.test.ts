import { expect, it } from "vitest";
import { airQualityUrl, fetchAirQuality, usAqiCategory } from "./air-quality.js";
import type { HttpClient } from "./http.js";
const at = new Date("2026-11-12T00:00:00Z");
const context = { now: () => at, signal: AbortSignal.timeout(10000) };
const fixture = (current: Record<string, unknown> = {}, status = 200): HttpClient => async (url, options) => {
  expect(url).toBe(airQualityUrl);
  expect(new URL(url).searchParams.get("latitude")).toBe("21.0285");
  expect(new URL(url).searchParams.get("domains")).toBe("cams_global");
  expect(options?.headers?.Authorization).toBeUndefined();
  return { status, headers: {}, body: JSON.stringify({ current: { time: +at/1000, us_aqi: 125, pm2_5: 41.4, ...current }, current_units: { pm2_5: "μg/m³" } }) };
};
it("reads the Hanoi forecast with an explicit US AQI scale, units and attribution", async () => {
  const result = await fetchAirQuality({ enabled: true }, { ...context, http: fixture() });
  expect(result.status).toBe("success");
  expect(result.data).toMatchObject({ location: "Hà Nội", forecastAt: at.toISOString(), usAqi: 125, pm25: 41.4, category: "Không tốt cho nhóm nhạy cảm" });
  expect(result.data?.attribution).toContain("không phải số đo tại trạm");
});
it("uses the documented US AQI boundaries including zero and values above 500", () => {
  expect([0,50,51,100,101,150,151,200,201,300,301,501].map(usAqiCategory)).toEqual([
    "Tốt","Tốt","Trung bình","Trung bình","Không tốt cho nhóm nhạy cảm","Không tốt cho nhóm nhạy cảm","Không tốt","Không tốt","Rất không tốt","Rất không tốt","Nguy hại","Nguy hại",
  ]);
});
it("keeps missing values null and does not infer AQI from PM2.5", async () => {
  const result = await fetchAirQuality({ enabled: true }, { ...context, http: fixture({ us_aqi: null, pm2_5: 0 }) });
  expect(result.status).toBe("partial");
  expect(result.data).toMatchObject({ usAqi: null, category: null, pm25: 0 });
  expect((await fetchAirQuality({ enabled: true }, { ...context, http: fixture({ us_aqi: null, pm2_5: null }) })).status).toBe("failed");
});
it("rejects stale, future or malformed data and exposes sanitized HTTP failures", async () => {
  for (const [current, status, code] of [
    [{ time: +at/1000-4*3600 },200,"AIR_QUALITY_STALE"],
    [{ time: +at/1000+3600 },200,"AIR_QUALITY_STALE"],
    [{ pm2_5: -2 },200,"SOURCE_UNAVAILABLE"],
    [{},503,"HTTP_503"],
  ] as const) {
    const result = await fetchAirQuality({ enabled: true }, { ...context, http: fixture(current,status) });
    expect(result.data).toBeNull(); expect(result.errors[0]?.code).toBe(code);
  }
});
it("does not fetch for disabled or older configurations", async () => {
  for (const config of [undefined, { enabled: false }]) expect((await fetchAirQuality(config, { ...context, http: async () => { throw new Error("Must not fetch"); } })).status).toBe("disabled");
});
