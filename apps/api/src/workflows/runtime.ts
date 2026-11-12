import { json, type Json, type DependencyInput } from "@hub/engine";
import type {
  DigestSources,
  SourceResult,
  Repository,
  SourceError,
} from "@hub/contracts";
import { DigestStore } from "../digests/store.js";
import type { ServiceOptions } from "../digests/service.js";
import { fetchRss } from "../connectors/rss.js";
import { fetchAirQuality } from "../connectors/air-quality.js";
import { fetchFuel, fuelBaseline } from "../connectors/fuel.js";
import { fetchWeather } from "../connectors/weather.js";
import { createGithubConnector, emptyGithub } from "../connectors/github.js";
import { safeHttp } from "../connectors/http.js";
import {
  WorkflowQueue,
  LeaseLost,
  type ClaimedJob,
  type NodeResult,
} from "./queue.js";
export { WorkflowQueue, LeaseLost } from "./queue.js";
const emptyRss = () => ({
  items: [],
  skippedInvalidDate: 0,
  skippedInvalidItem: 0,
  feedsSucceeded: 0,
  feedsTotal: 0,
});
function missing<T>(
  empty: T,
  error: SourceError | null,
  at: string,
): SourceResult<T> {
  return {
    status: "failed",
    fetchedAt: at,
    data: empty,
    errors: [
      error ?? {
        code: "MISSING_SOURCE_OUTPUT",
        message: "Nhánh đã kết thúc nhưng không có dữ liệu nguồn.",
      },
    ],
  };
}
export function composeDigest(input: DependencyInput, at: string) {
  const value = <T>(id: string, empty: T): SourceResult<T> => {
    const dependency = input.dependencies[id];
    if (!dependency) throw new Error("Missing dependency state.");
    if (dependency.output) {
      const payload = dependency.output as unknown as {
        result: SourceResult<T>;
      };
      if (payload.result) return payload.result;
    }
    return missing(empty, dependency.error as SourceError | null, at);
  };
  const sources: DigestSources = {
    rss: value("fetch_rss", emptyRss()),
    weather: value("fetch_weather", null),
    github: value("fetch_github", emptyGithub()),
    ...(input.dependencies.fetch_fuel ? { fuel: value("fetch_fuel", null) } : {}),
    ...(input.dependencies.fetch_air_quality ? { airQuality: value("fetch_air_quality", null) } : {}),
  };
  const snapshots =
    (
      input.dependencies.fetch_github?.output as unknown as {
        snapshots?: Repository[];
      } | null
    )?.snapshots ?? [];
  return { sources, snapshots };
}
export class DigestNodeExecutor {
  private store: DigestStore;
  private github: ReturnType<typeof createGithubConnector>;
  private http: typeof safeHttp;
  private now: () => Date;
  constructor(
    queue: WorkflowQueue,
    private options: ServiceOptions = {},
  ) {
    this.store = new DigestStore(queue.pool);
    this.now = options.now ?? (() => new Date());
    const http = options.http ?? safeHttp;
    this.http = (url, opts = {}) =>
      http(url, { ...opts, timeoutMs: options.requestTimeoutMs ?? 6000 });
    this.github = createGithubConnector({
      http: this.http,
      now: this.now,
      token: options.githubToken,
    });
  }
  async execute(job: ClaimedJob, signal: AbortSignal): Promise<NodeResult> {
    if (job.workflow.version !== "digest.v1")
      throw new Error("Unsupported workflow version.");
    if (job.type === "start")
      return {
        status: "succeeded",
        output: { workflowVersion: job.workflow.version },
        error: null,
      };
    if (job.type === "compose_digest")
      return {
        status: "succeeded",
        output: json(composeDigest(job.input, this.now().toISOString())),
        error: null,
      };
    if (job.type === "persist_digest")
      return { status: "succeeded", output: null, error: null };
    const config = job.settings;
    const fetchedAt = this.now().toISOString();
    let enabled: boolean;
    let empty: unknown;
    if (job.type === "fetch_rss") {
      enabled = config.rss.some((feed) => feed.enabled);
      empty = emptyRss();
    } else if (job.type === "fetch_weather") {
      enabled = config.weather.enabled;
      empty = null;
    } else if (job.type === "fetch_github") {
      enabled = config.github.enabled;
      empty = emptyGithub();
    } else if (job.type === "fetch_fuel") {
      enabled = config.fuel?.enabled ?? false;
      empty = null;
    } else if (job.type === "fetch_air_quality") {
      enabled = config.airQuality?.enabled ?? false;
      empty = null;
    } else throw new Error("Unsupported node type.");
    if (!enabled)
      return {
        status: "skipped",
        output: json({
          result: { status: "disabled", fetchedAt, data: empty, errors: [] },
          snapshots: [],
        }),
        error: {
          code: "SOURCE_DISABLED",
          message: "Nguồn đã tắt trong cấu hình snapshot.",
        },
      };
    const timeoutMs = (job.config as { timeoutMs: number }).timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    let snapshots: Repository[] = [];
    const context = { http: this.http, now: this.now, signal: combined };
    const collectFuel = async () => {
      const recent = await this.store.list(1, 5);
      const previousId = recent.items.find((item) => item.status !== "running")?.id;
      const previous = previousId ? await this.store.get(previousId) : undefined;
      return fetchFuel(config.fuel, { ...context, baseline: previous?.sources?.fuel ? fuelBaseline(previous.sources.fuel) : undefined });
    };
    const operation =
      job.type === "fetch_rss"
        ? fetchRss(config.rss, context)
        : job.type === "fetch_air_quality"
          ? fetchAirQuality(config.airQuality, context)
        : job.type === "fetch_fuel"
          ? collectFuel()
        : job.type === "fetch_weather"
          ? fetchWeather(config.weather, config.newsletter.timezone, context)
          : this.github(config.github, {
              signal: combined,
              baselines: this.store.baselines,
              recordSnapshots: (values) => {
                if (!combined.aborted) snapshots = values;
              },
            });
    let abort: () => void = () => {};
    try {
      const result = await Promise.race([
        operation,
        new Promise<SourceResult<unknown>>((resolve) => {
          abort = () =>
            resolve(
              missing(
                empty,
                {
                  code: "TOTAL_TIMEOUT",
                  message: "Nhánh vượt giới hạn thời gian thu thập.",
                },
                this.now().toISOString(),
              ),
            );
          if (combined.aborted) abort();
          else combined.addEventListener("abort", abort, { once: true });
        }),
      ]);
      return {
        status: result.status === "failed" ? "failed" : "succeeded",
        output: json({ result, snapshots }),
        error:
          result.status === "failed"
            ? (result.errors[0] ?? {
                code: "SOURCE_FAILED",
                message: "Nguồn dữ liệu thất bại.",
              })
            : null,
      };
    } finally {
      combined.removeEventListener("abort", abort);
    }
  }
}
export type WorkerOptions = {
  concurrency?: number;
  heartbeatMs?: number;
  pollMs?: number;
  shutdownMs?: number;
  workerId?: string;
};
export class WorkerRunner {
  readonly workerId: string;
  private executor: DigestNodeExecutor;
  private controllers = new Set<AbortController>();
  private tasks = new Set<Promise<void>>();
  private stopping = false;
  constructor(
    public queue: WorkflowQueue,
    private options: WorkerOptions = {},
    serviceOptions: ServiceOptions = {},
  ) {
    this.workerId = options.workerId ?? crypto.randomUUID();
    this.executor = new DigestNodeExecutor(queue, serviceOptions);
  }
  async process(job: ClaimedJob): Promise<boolean> {
    const controller = new AbortController();
    this.controllers.add(controller);
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const beat = async () => {
      if (done || controller.signal.aborted) return;
      try {
        if (!(await this.queue.heartbeat(job)))
          controller.abort(new LeaseLost());
      } catch {
        controller.abort(new LeaseLost());
      }
      if (!done && !controller.signal.aborted)
        heartbeatTimer = setTimeout(
          () => void beat(),
          this.options.heartbeatMs ?? 4000,
        );
    };
    heartbeatTimer = setTimeout(
      () => void beat(),
      this.options.heartbeatMs ?? 4000,
    );
    let abort: () => void = () => {};
    try {
      let result: NodeResult;
      try {
        result = await Promise.race([
          this.executor.execute(job, controller.signal),
          new Promise<never>((_resolve, reject) => {
            abort = () => reject(new LeaseLost());
            controller.signal.addEventListener("abort", abort, { once: true });
            if (controller.signal.aborted) abort();
          }),
        ]);
      } catch (error) {
        if (controller.signal.aborted || error instanceof LeaseLost)
          return false;
        result = {
          status: "failed",
          output: null,
          error: {
            code: "NODE_EXECUTION_FAILED",
            message: "Lỗi nội bộ khi thực thi node.",
          },
        };
      }
      if (controller.signal.aborted) return false;
      try {
        return await this.queue.finish(job, result);
      } catch (error) {
        if (error instanceof LeaseLost) return false;
        return await this.queue.finish(job, {
          status: "failed",
          output: null,
          error: {
            code: "NODE_PERSIST_FAILED",
            message: "Không thể ghi kết quả node hoặc bản tin.",
          },
        });
      }
    } finally {
      done = true;
      clearTimeout(heartbeatTimer);
      controller.signal.removeEventListener("abort", abort);
      controller.abort();
      this.controllers.delete(controller);
    }
  }
  async tick() {
    await this.queue.recover();
    const job = await this.queue.claim(this.workerId);
    if (!job) return false;
    await this.process(job);
    return true;
  }
  async run(signal: AbortSignal) {
    const concurrency = this.options.concurrency ?? 3;
    const stop = () => {
      this.stopping = true;
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    try {
      while (!this.stopping) {
        try {
          await this.queue.recover();
          while (!this.stopping && this.tasks.size < concurrency) {
            const job = await this.queue.claim(this.workerId);
            if (!job) break;
            if (this.stopping) break;
            let task: Promise<void>;
            task = this.process(job)
              .then(
                () => {},
                () => {
                  console.error(
                    "Worker không thể ghi kết quả; job sẽ được phục hồi qua lease.",
                  );
                },
              )
              .finally(() => this.tasks.delete(task));
            this.tasks.add(task);
          }
        } catch {
          console.error("Worker chưa kết nối được queue; sẽ kiểm tra lại.");
        }
        if (!this.stopping)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(finish, this.options.pollMs ?? 1000);
            function finish() {
              clearTimeout(timer);
              signal.removeEventListener("abort", finish);
              resolve();
            }
            signal.addEventListener("abort", finish, { once: true });
            if (signal.aborted) finish();
          });
      }
    } finally {
      signal.removeEventListener("abort", stop);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled(this.tasks),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.options.shutdownMs ?? 10000);
        }),
      ]);
      clearTimeout(timer);
      for (const controller of this.controllers)
        controller.abort(new LeaseLost());
      await Promise.allSettled(this.tasks);
    }
  }
}
