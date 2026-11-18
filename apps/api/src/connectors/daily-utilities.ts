import { z } from "zod";
import {
  calendarDate,
  type Settings,
  type SourceResult,
  type UvData,
  type HolidayData,
  type TaskData,
} from "@hub/contracts";
import {
  safeHttp,
  ensureOk,
  cleanError,
  ConnectorError,
  type HttpClient,
} from "./http.js";
type Context = { now?: () => Date; signal: AbortSignal; http?: HttpClient };
export function uvLevel(value: number) {
  return value < 3
    ? "Thấp"
    : value < 6
      ? "Trung bình"
      : value < 8
        ? "Cao"
        : value < 11
          ? "Rất cao"
          : "Cực cao";
}
export async function fetchUv(
  settings: Settings,
  { now = () => new Date(), signal, http = safeHttp }: Context,
): Promise<SourceResult<UvData | null>> {
  const fetchedAt = now().toISOString();
  if (!settings.uv?.enabled)
    return { status: "disabled", fetchedAt, data: null, errors: [] };
  try {
    if (!settings.weather.location)
      throw new ConnectorError(
        "UV_LOCATION",
        "Chọn địa điểm để lấy chỉ số UV.",
      );
    const date = calendarDate(now(), settings.newsletter.timezone);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(settings.weather.latitude),
      longitude: String(settings.weather.longitude),
      daily: "uv_index_max",
      timezone: settings.newsletter.timezone,
      start_date: date,
      end_date: date,
    }).toString();
    const response = await http(url.toString(), { signal, maxBytes: 100000 });
    ensureOk(response);
    const daily = z
      .object({
        daily: z.object({
          time: z.array(z.string()),
          uv_index_max: z.array(z.number().nonnegative().nullable()),
        }),
      })
      .parse(JSON.parse(response.body)).daily;
    const index = daily.time.indexOf(date);
    const maximum = index < 0 ? undefined : daily.uv_index_max[index];
    if (maximum === null || maximum === undefined)
      throw new ConnectorError(
        "MISSING_UV",
        "Nguồn chưa có chỉ số UV cho hôm nay.",
      );
    return {
      status: "success",
      fetchedAt,
      errors: [],
      data: {
        date,
        location: settings.weather.location,
        timezone: settings.newsletter.timezone,
        maximum,
        level: uvLevel(maximum),
        sourceUrl: "https://open-meteo.com/",
      },
    };
  } catch (error) {
    return {
      status: "failed",
      fetchedAt,
      data: null,
      errors: [cleanError(error)],
    };
  }
}
// Fixed solar observances only; this is not an official working-day/leave calendar.
const observances = [
  ["01-01", "Tết Dương lịch"],
  ["03-08", "Ngày Quốc tế Phụ nữ"],
  ["04-30", "Ngày Giải phóng miền Nam"],
  ["05-01", "Ngày Quốc tế Lao động"],
  ["06-01", "Ngày Quốc tế Thiếu nhi"],
  ["09-02", "Quốc khánh Việt Nam"],
  ["10-20", "Ngày Phụ nữ Việt Nam"],
  ["11-20", "Ngày Nhà giáo Việt Nam"],
] as const;
export function collectHolidays(
  settings: Settings,
  now = new Date(),
): SourceResult<HolidayData | null> {
  const fetchedAt = now.toISOString();
  if (!settings.holidays?.enabled)
    return { status: "disabled", fetchedAt, data: null, errors: [] };
  const date = calendarDate(now, settings.newsletter.timezone);
  const year = Number(date.slice(0, 4));
  const customObservances = (settings.holidays.items ?? []).map(
    (item) => [item.monthDay, item.title] as const,
  );
  const allObservances = [...observances, ...customObservances];
  const limit = customObservances.length > 0 ? 5 : 3;
  const events = [year, year + 1, year + 2, year + 3, year + 4]
    .flatMap((y) =>
      allObservances.flatMap(([day, name]) => {
        const eventDate = `${y}-${day}`;
        const parsedMs = Date.parse(eventDate + "T00:00:00Z");
        if (
          !Number.isFinite(parsedMs) ||
          new Date(parsedMs).toISOString().slice(0, 10) !== eventDate
        ) {
          return [];
        }
        return [
          {
            name,
            date: eventDate,
            daysAway:
              (parsedMs - Date.parse(date + "T00:00:00Z")) / 86400000,
          },
        ];
      }),
    )
    .filter((event) => Number.isFinite(event.daysAway) && event.daysAway >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
  return { status: "success", fetchedAt, errors: [], data: { date, events } };
}
export function collectTasks(
  settings: Settings,
  now = new Date(),
): SourceResult<TaskData | null> {
  const fetchedAt = now.toISOString();
  if (!settings.tasks?.enabled)
    return { status: "disabled", fetchedAt, data: null, errors: [] };
  const date = calendarDate(now, settings.newsletter.timezone);
  const items = settings.tasks.items
    .filter((item) => !item.done && item.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ id, title, date: due }) => ({
      id,
      title,
      date: due,
      overdue: due < date,
    }));
  return { status: "success", fetchedAt, errors: [], data: { date, items } };
}
