import {
  settingsSchema,
  goldBarItems,
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
  aiAdapter?: import("../premium/ai.js").AiAdapter;
  searchAdapter?: import("../premium/search.js").SearchAdapter;
  http?: HttpClient;
  premiumFeedHttp?: HttpClient;
  now?: () => Date;
  totalTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxConcurrent?: number;
  githubToken?: string;
  ntfyToken?: string;
  publicBaseUrl?: string;
  ntfyAllowedOrigins?: string[];
  ntfyDestinationOrigins?: string[];
  ntfyTokenOrigins?: string[];
};

export function aggregateStatus(sources: DigestSources) {
  const active = Object.values(sources).filter(
    (source) => source && source.status !== "disabled",
  );
  if (!active.length) return "partial";
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
      client(url, { timeoutMs: options.requestTimeoutMs ?? 6000, ...request });
    this.summarize = createVietnameseSummarizer({
      http: this.http,
      now: this.now,
    });
  }

  async localize(
    digest: Digest,
    { allowExternalFetch = true }: { allowExternalFetch?: boolean } = {},
  ): Promise<Digest> {
    if (!digest.sources) return digest;
    const githubData = allowExternalFetch
      ? await this.summarize(digest.sources.github.data)
      : {
          ...digest.sources.github.data,
          rising: digest.sources.github.data.rising.map((repo) =>
            repo.summaryVi
              ? repo
              : {
                  ...repo,
                  summaryVi: repo.description
                    ? repo.description.slice(0, 320)
                    : "Tác giả chưa cung cấp mô tả cho dự án này.",
                  summaryViStatus: repo.description ? "unavailable" as const : "missing" as const,
                },
          ),
          newNotable: digest.sources.github.data.newNotable.map((repo) =>
            repo.summaryVi
              ? repo
              : {
                  ...repo,
                  summaryVi: repo.description
                    ? repo.description.slice(0, 320)
                    : "Tác giả chưa cung cấp mô tả cho dự án này.",
                  summaryViStatus: repo.description ? "unavailable" as const : "missing" as const,
                },
          ),
        };
    return {
      ...digest,
      sources: {
        ...digest.sources,
        ...(digest.sources.gold
          ? {
              gold: {
                ...digest.sources.gold,
                data:
                  digest.sources.gold.data &&
                  goldBarItems(digest.sources.gold.data).length
                    ? {
                        ...digest.sources.gold.data,
                        items: goldBarItems(digest.sources.gold.data),
                      }
                    : null,
                ...(digest.sources.gold.priceHistory
                  ? {
                      priceHistory: Object.fromEntries(
                        Object.entries(digest.sources.gold.priceHistory).filter(
                          ([key]) => key === "sjc_bar",
                        ),
                      ),
                    }
                  : {}),
              },
            }
          : {}),
        github: {
          ...digest.sources.github,
          data: githubData,
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
    const digest = await this.store.get(id, !destination);
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
          tokenOrigins: this.options.ntfyTokenOrigins,
          publicBaseUrl: this.options.publicBaseUrl,
          allowedOrigins: this.options.ntfyAllowedOrigins,
          destinationOrigins: this.options.ntfyDestinationOrigins,
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
