import { lazy, type ComponentType } from "react";
import { formatDateTime } from "@hub/contracts";
import type { IconName } from "../Icons";

export function when(
  value: string | null | undefined,
  timezone?: string,
  fallback = "Chưa ghi nhận",
): string {
  return formatDateTime(value, timezone, fallback);
}

export function relativeVi(value: string | null | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const diffMin = Math.round((Date.now() - ms) / 60000);
  if (diffMin < 1) return "Vừa xong";
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} giờ trước`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "Hôm qua";
  if (diffDays < 30) return `${diffDays} ngày trước`;
  return formatDateTime(value);
}

export function weatherVisual(code: number | null | undefined): {
  icon: IconName;
  tone: "sunny" | "cloudy" | "rainy" | "storm";
} {
  if (code == null) return { icon: "sun", tone: "sunny" };
  if (code >= 95) return { icon: "cloudRain", tone: "storm" };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return { icon: "cloudRain", tone: "rainy" };
  }
  if (code >= 2 && code <= 48) return { icon: "wind", tone: "cloudy" };
  return { icon: "sun", tone: "sunny" };
}

export const WORKFLOW_NODE_TITLES: Record<string, string> = {
  premium_task: "Cập nhật theo dõi tùy chỉnh",
  start: "Khởi tạo quy trình",
  fetch_rss: "Lấy tin RSS chọn lọc",
  fetch_weather: "Lấy dự báo thời tiết",
  fetch_github: "Lấy dự án GitHub nổi bật",
  fetch_fuel: "Lấy giá xăng Petrolimex",
  fetch_air_quality: "Lấy chất lượng không khí",
  fetch_gold: "Lấy giá vàng miếng SJC",
  fetch_usd: "Lấy tỷ giá USD/VND",
  fetch_uv: "Lấy dự báo chỉ số UV",
  fetch_holidays: "Tính ngày lễ & kỷ niệm",
  fetch_tasks: "Tổng hợp việc cần làm",
  compose_digest: "Biên tập & gộp bản tin",
  persist_digest: "Lưu trữ bản tin hoàn chỉnh",
};

export const WORKFLOW_NODE_ORDER = [
  "start",
  "premium_task",
  "fetch_weather",
  "fetch_air_quality",
  "fetch_uv",
  "fetch_gold",
  "fetch_usd",
  "fetch_fuel",
  "fetch_tasks",
  "fetch_holidays",
  "fetch_rss",
  "fetch_github",
  "compose_digest",
  "persist_digest",
];

/** Retry a dynamic chunk import once before surfacing error boundary on flaky mobile connections. */
export function lazyWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await loader();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return loader();
    }
  });
}
