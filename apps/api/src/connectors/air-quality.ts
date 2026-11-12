import { z } from "zod";
import type { AirQualityData, Settings, SourceResult } from "@hub/contracts";
import { safeHttp, ensureOk, cleanError, ConnectorError, type HttpClient } from "./http.js";

// Fixed Hanoi city-centre location, independent of the user's weather setting.
export const airQualityUrl = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=21.0285&longitude=105.8542&current=us_aqi,pm2_5&domains=cams_global&timezone=Asia%2FHo_Chi_Minh&timeformat=unixtime&forecast_days=1";
export function airQualityRequestUrl(config: Settings["airQuality"]) {
  const url = new URL(airQualityUrl);
  if (config?.latitude !== undefined) url.searchParams.set("latitude", String(config.latitude));
  if (config?.longitude !== undefined) url.searchParams.set("longitude", String(config.longitude));
  return url.toString();
}
const schema = z.object({
  current: z.object({
    time: z.number().int().positive(),
    us_aqi: z.number().nonnegative().nullable().optional(),
    pm2_5: z.number().nonnegative().nullable().optional(),
  }),
  current_units: z.object({ pm2_5: z.enum(["μg/m³", "µg/m³"]) }),
});
export function usAqiCategory(value: number): string {
  const aqi = Math.round(value);
  if (aqi <= 50) return "Tốt";
  if (aqi <= 100) return "Trung bình";
  if (aqi <= 150) return "Không tốt cho nhóm nhạy cảm";
  if (aqi <= 200) return "Không tốt";
  if (aqi <= 300) return "Rất không tốt";
  return "Nguy hại";
}
export async function fetchAirQuality(config: Settings["airQuality"], {
  http = safeHttp, now = () => new Date(), signal,
}: { http?: HttpClient; now?: () => Date; signal: AbortSignal }): Promise<SourceResult<AirQualityData | null>> {
  const fetchedAt = now().toISOString();
  if (!config?.enabled) return { status: "disabled", fetchedAt, data: null, errors: [] };
  try {
    const response = await http(airQualityRequestUrl(config), { signal, maxBytes: 100000 });
    ensureOk(response);
    const current = schema.parse(JSON.parse(response.body)).current;
    const timestamp = current.time * 1000;
    if (timestamp > +now() + 10*60000 || +now() - timestamp > 3*3600000)
      throw new ConnectorError("AIR_QUALITY_STALE", "Nguồn chưa có dự báo không khí đủ mới cho Hà Nội.");
    const usAqi = current.us_aqi === null || current.us_aqi === undefined ? null : Math.round(current.us_aqi);
    const pm25 = current.pm2_5 ?? null;
    if (usAqi === null && pm25 === null)
      throw new ConnectorError("AIR_QUALITY_MISSING", "Nguồn thiếu cả AQI và PM2.5 cho Hà Nội.");
    const missing = usAqi === null || pm25 === null;
    return {
      status: missing ? "partial" : "success", fetchedAt,
      data: {
        location: config.location ?? "Hà Nội", forecastAt: new Date(timestamp).toISOString(), usAqi, pm25,
        category: usAqi === null ? null : usAqiCategory(usAqi),
        sourceUrl: "https://open-meteo.com/en/docs/air-quality-api",
        attribution: "Dự báo Open-Meteo / CAMS Global (Copernicus), CC BY 4.0; không phải số đo tại trạm.",
      },
      errors: missing ? [{ code: "AIR_QUALITY_MISSING_FIELDS", message: "Nguồn thiếu một chỉ số; không tự suy ra giá trị còn thiếu." }] : [],
    };
  } catch (error) {
    return { status: "failed", fetchedAt, data: null, errors: [cleanError(error)] };
  }
}
