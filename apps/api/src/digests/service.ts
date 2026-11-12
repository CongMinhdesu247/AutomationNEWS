import {
  settingsSchema,
  type FieldIssue,
  type DigestSources,
  type Settings,
  type Digest,
} from "@hub/contracts";
import { DigestStore } from "./store.js";
import { safeHttp, type HttpClient } from "../connectors/http.js";
import { sendNtfy } from "../connectors/ntfy.js";
import { createVietnameseSummarizer } from "../connectors/vietnamese.js";
export class RequestError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public issues: FieldIssue[] = [],
  ) {
    super(message);
  }
}
export type ServiceOptions = {
  http?: HttpClient;
  now?: () => Date;
  totalTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxConcurrent?: number;
  githubToken?: string;
  ntfyToken?: string;
  publicBaseUrl?: string;
  ntfyAllowedOrigins?: string[];
};
export function aggregateStatus(sources: DigestSources) {
  const active = Object.values(sources).filter(
    (source) => source.status !== "disabled",
  );
  return active.every((source) => source.status === "failed")
    ? "failed"
    : active.every((source) => source.status === "success")
      ? "success"
      : "partial";
}
export class DigestService {
  private active = 0;
  private http: HttpClient;
  private now: () => Date;
  private summarize: ReturnType<typeof createVietnameseSummarizer>;

  constructor(
    private store: DigestStore,
    private options: ServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    const client = options.http ?? safeHttp;
    this.http = (url, request = {}) =>
      client(url, { ...request, timeoutMs: options.requestTimeoutMs ?? 6000 });
    this.summarize = createVietnameseSummarizer({
      http: this.http,
      now: this.now,
    });
  }
  async localize(digest: Digest): Promise<Digest> {
    if (!digest.sources) return digest;
    return {
      ...digest,
      sources: {
        ...digest.sources,
        github: {
          ...digest.sources.github,
          data: await this.summarize(digest.sources.github.data),
        },
      },
    };
  }
  private enter() {
    if (this.active >= (this.options.maxConcurrent ?? 2))
      throw new RequestError(
        429,
        "CONCURRENCY_LIMIT",
        "Hệ thống đang xử lý yêu cầu khác. Vui lòng thử lại sau.",
      );
    this.active++;
  }
  async notify(
    id: string,
    key: string,
    destination?: Settings["notifications"],
  ) {
    const existing = await this.store.notificationByKey(id, key);
    if (existing) return existing;
    const digest = await this.store.get(id);
    if (!digest)
      throw new RequestError(
        404,
        "DIGEST_NOT_FOUND",
        "Không tìm thấy bản tin.",
      );
    if (digest.status === "running")
      throw new RequestError(409, "DIGEST_RUNNING", "Bản tin chưa hoàn tất.");
    const notifications =
      destination ??
      settingsSchema.parse(await this.store.settings()).notifications;
    if (!notifications.enabled || !notifications.topic)
      throw new RequestError(
        400,
        "NTFY_DISABLED",
        "Bật ntfy, nhập server và topic rồi lưu cấu hình trước khi gửi.",
      );
    this.enter();
    try {
      const attemptId = crypto.randomUUID();
      if (
        !(await this.store.reserveNotification(
          attemptId,
          id,
          key,
          notifications,
          this.now(),
        ))
      )
        return (await this.store.notificationByKey(id, key))!;
      const result = await sendNtfy(
        await this.localize(digest),
        notifications,
        {
          http: this.http,
          now: this.now,
          token: this.options.ntfyToken,
          publicBaseUrl: this.options.publicBaseUrl,
          allowedOrigins: this.options.ntfyAllowedOrigins,
          signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 6000),
        },
      );
      const error = result.errors[0] ?? null;
      const status =
        result.status === "success"
          ? "success"
          : error && /^HTTP_/.test(error.code)
            ? "failed"
            : "unknown";
      await this.store.finishNotification(attemptId, status, error, this.now());
      return (await this.store.notificationByKey(id, key))!;
    } finally {
      this.active--;
    }
  }
}
