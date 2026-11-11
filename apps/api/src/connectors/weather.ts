import { z } from "zod";
import type { Settings, SourceResult, WeatherData } from "@hub/contracts";
import {
  safeHttp,
  ensureOk,
  cleanError,
  ConnectorError,
  type HttpClient,
} from "./http.js";
export function dateInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return part("year") + "-" + part("month") + "-" + part("day");
}
const descriptions: Record<number, string> = {
  0: "Trời quang",
  1: "Chủ yếu quang đãng",
  2: "Có mây rải rác",
  3: "Nhiều mây",
  45: "Sương mù",
  48: "Sương mù đóng băng",
  51: "Mưa phùn nhẹ",
  53: "Mưa phùn vừa",
  55: "Mưa phùn dày",
  56: "Mưa phùn đóng băng nhẹ",
  57: "Mưa phùn đóng băng dày",
  61: "Mưa nhẹ",
  63: "Mưa vừa",
  65: "Mưa lớn",
  66: "Mưa đóng băng nhẹ",
  67: "Mưa đóng băng lớn",
  71: "Tuyết nhẹ",
  73: "Tuyết vừa",
  75: "Tuyết dày",
  77: "Hạt tuyết",
  80: "Mưa rào nhẹ",
  81: "Mưa rào vừa",
  82: "Mưa rào mạnh",
  85: "Tuyết rào nhẹ",
  86: "Tuyết rào mạnh",
  95: "Dông",
  96: "Dông kèm mưa đá nhẹ",
  99: "Dông kèm mưa đá mạnh",
};
const dailySchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_min: z.array(z.number().nullable()).optional(),
    temperature_2m_max: z.array(z.number().nullable()).optional(),
    precipitation_probability_max: z
      .array(z.number().min(0).max(100).nullable())
      .optional(),
    weather_code: z.array(z.number().int().nullable()).optional(),
  }),
});
export async function fetchWeather(
  config: Settings["weather"],
  timezone: string,
  {
    http = safeHttp,
    now = () => new Date(),
    signal,
  }: { http?: HttpClient; now?: () => Date; signal: AbortSignal },
): Promise<SourceResult<WeatherData | null>> {
  if (!config.enabled)
    return {
      status: "disabled",
      fetchedAt: now().toISOString(),
      data: null,
      errors: [],
    };
  try {
    const date = dateInZone(now(), timezone);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(config.latitude),
      longitude: String(config.longitude),
      daily:
        "temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code",
      timezone,
      start_date: date,
      end_date: date,
      temperature_unit: "celsius",
    }).toString();
    const response = await http(url.toString(), { signal });
    ensureOk(response);
    const daily = dailySchema.parse(JSON.parse(response.body)).daily;
    const index = daily.time.indexOf(date);
    if (index < 0)
      throw new ConnectorError(
        "MISSING_DATE",
        "Nguồn không trả dự báo cho hôm nay theo múi giờ bản tin.",
      );
    const minTemperature = daily.temperature_2m_min?.[index] ?? null;
    const maxTemperature = daily.temperature_2m_max?.[index] ?? null;
    const rainProbability =
      daily.precipitation_probability_max?.[index] ?? null;
    const weatherCode = daily.weather_code?.[index] ?? null;
    const missing = [
      minTemperature,
      maxTemperature,
      rainProbability,
      weatherCode,
    ].some((value) => value === null);
    return {
      status: missing ? "partial" : "success",
      fetchedAt: now().toISOString(),
      data: {
        date,
        location: config.location,
        timezone,
        minTemperature,
        maxTemperature,
        rainProbability,
        weatherCode,
        description:
          weatherCode === null
            ? "Chưa có dữ liệu thời tiết"
            : (descriptions[weatherCode] ?? "Mã thời tiết chưa được hỗ trợ"),
        umbrella: rainProbability === null ? null : rainProbability >= 60,
        attribution: {
          name: "Dữ liệu thời tiết: Open-Meteo, CC BY 4.0; mô tả tiếng Việt được chuyển đổi từ WMO code.",
          url: "https://open-meteo.com/",
          license: "CC BY 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        },
      },
      errors: missing
        ? [
            {
              code: "MISSING_FIELDS",
              message:
                "Nguồn thiếu một số chỉ số; giá trị thiếu được giữ là null.",
            },
          ]
        : [],
    };
  } catch (error) {
    return {
      status: "failed",
      fetchedAt: now().toISOString(),
      data: null,
      errors: [cleanError(error)],
    };
  }
}
