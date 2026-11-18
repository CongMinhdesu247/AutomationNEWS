import type { AiControl, PaymentConfig, WatchInput } from "@hub/contracts";
import { apiRequest } from "../lib/api-client";

export type Plan = {
  id: string;
  premium: boolean;
  expires_at: string | null;
  active_watches: number;
  discovery_month: number;
  ai_calls_month: number;
  min_interval_minutes: number;
};

export type Subscription = {
  plan: Plan;
  counts: { active: string; total: string };
  usage: { kind: string; status: string; calls: number }[];
  aiEnabled: boolean;
  searchEnabled: boolean;
  includeDigest: boolean;
  signup: {
    status: "pending" | "approved" | "declined";
    requested_at: string;
    review_note: string | null;
  } | null;
  premiumOffer: {
    active_watches: number;
    discovery_month: number;
    ai_calls_month: number;
  };
  paymentConfig?: PaymentConfig;
};

export type Source = {
  id: string;
  name: string;
  url: string;
  status?: string;
  last_error?: string | null;
  catalog_rank?: number | null;
};

export type Watch = {
  id: string;
  name: string;
  description: string;
  conditions: WatchInput["conditions"];
  source_ids: string[];
  interval_minutes: number;
  lookback_days: number;
  enabled: boolean;
  version: number;
  last_run_at: string | null;
  last_error: string | null;
};

export type Match = {
  watch_id: string;
  article_id: string;
  watch_name: string;
  title: string;
  url: string;
  description: string;
  reason: string;
  source_name: string;
  published_at: string;
  fetched_at: string;
  saved: boolean;
  hidden: boolean;
};

export type TopicBrief = {
  summary: string;
  summaryNotice?: string;
  articles: { title: string; url: string }[];
};

export type DiscoveryResult = {
  candidates: { name: string; url: string; evidence: string }[];
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  plan_id: string | null;
  expires_at: string | null;
};

export type AdminData = {
  requests: {
    user_id: string;
    name: string;
    email: string;
    note: string;
    requested_at: string;
  }[];
  users: AdminUser[];
  audits: {
    id: string;
    action: string;
    created_at: string;
    subject_id: string | null;
  }[];
  plans: {
    id: string;
    active_watches: number;
    discovery_month: number;
    ai_calls_month: number;
    min_interval_minutes: number;
  }[];
};

export type SourceStatus = "pending" | "approved" | "rejected";
export type AdminSource = Source & {
  status: SourceStatus;
  canReplaceFeed: boolean;
};

export type AiData = {
  config: AiControl;
  sources: AdminSource[];
  usage: {
    id: string;
    provider: string;
    model: string;
    kind: string;
    status: string;
    reserved_micros: string;
    estimated_micros: string | null;
    error_code: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    search_units: number | null;
    pricing_version: string;
  }[];
  jobs: { run_id: string; kind: string; error: { message: string } | null }[];
};

export const sourceStatusLabels: Record<SourceStatus, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
};

export const auditActionLabels: Record<string, string> = {
  "entitlement.change": "Cấp / điều chỉnh gói thành viên",
  "plan.assign": "Cập nhật gói thành viên",
  "plan.change": "Điều chỉnh hạn mức gói",
  "plan.limits": "Điều chỉnh hạn mức gói",
  "premium.request": "Gửi yêu cầu đăng ký Premium",
  "premium.decline": "Từ chối yêu cầu Premium",
  "ai.control": "Cập nhật cấu hình AI & tìm kiếm",
  "ai.config": "Cập nhật cấu hình AI & tìm kiếm",
  "source.review": "Duyệt / cập nhật trạng thái nguồn RSS",
  "source.add": "Quản trị viên thêm nguồn RSS",
  "source.propose": "Thành viên đề xuất nguồn RSS",
  "source.approved": "Duyệt nguồn RSS",
  "source.rejected": "Từ chối / ngừng lấy nguồn RSS",
  "watch.create": "Tạo theo dõi tùy chỉnh",
  "watch.update": "Cập nhật theo dõi tùy chỉnh",
};

export const usageKindLabels: Record<string, string> = {
  interpret: "Gợi ý điều kiện",
  summarize: "Tổng hợp chủ đề",
  enrich: "Trích xuất chi tiết",
  discover: "Tìm kiếm web",
};

export const usualIntervals = [60, 120, 360, 720, 1440, 2880, 10080];

export const frequency = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Tự chọn thời gian";
  return minutes % 1440 === 0
    ? `Mỗi ${minutes / 1440} ngày`
    : minutes % 60 === 0
      ? `Mỗi ${minutes / 60} giờ`
      : `Mỗi ${minutes} phút`;
};

export const when = (s: string | null) =>
  s ? new Date(s).toLocaleString("vi-VN") : "Chưa có";

export function friendlyAiError(
  error: unknown,
  fallback = "Chưa hoàn tất yêu cầu lúc này. Bạn có thể bấm Thử lại.",
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const msg = raw.trim();
  if (!msg) return fallback;
  if (/AbortError|aborted|canceled|cancelled/i.test(msg)) {
    return "Đã dừng chờ theo thao tác của bạn.";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Kết nối mạng bị gián đoạn. Kiểm tra đường truyền rồi bấm Thử lại.";
  }
  if (/Unexpected token|JSON\.parse|ZodError/i.test(msg)) {
    return "Phản hồi từ trợ lý chưa đúng định dạng chuẩn. Hãy bấm Thử lại.";
  }
  return msg;
}

export async function premiumApi<T>(
  path: string,
  body?: unknown,
  method = "POST",
  key?: string,
  signal?: AbortSignal,
): Promise<T> {
  return apiRequest<T>(path, {
    method: body === undefined ? "GET" : method,
    body,
    timeoutMs: 30000,
    signal,
    headers: key ? { "Idempotency-Key": key } : undefined,
  });
}

export async function cancelCustomJob(runId: string): Promise<void> {
  try {
    await apiRequest(
      `/api/account/custom-jobs/${encodeURIComponent(runId)}/cancel`,
      {
        method: "POST",
        body: {},
        timeoutMs: 6000,
      },
    );
  } catch {
    // Best-effort cancellation; UI stops waiting immediately regardless.
  }
}
