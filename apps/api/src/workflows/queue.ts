import { appendEvent, eventDto } from "../telemetry/store.js";
import { cursor } from "@hub/contracts";
import type { Pool, PoolClient } from "pg";
import {
  plan,
  json,
  isTerminal,
  type Workflow,
  type NodeState,
  type DependencyInput,
  type Json,
} from "@hub/engine";
import {
  settingsSchema,
  createRunSchema,
  type Settings,
  type WorkflowRun,
  type RunSummary,
  type SourceError,
  type DigestSources,
  type Repository,
} from "@hub/contracts";
import { RequestError, aggregateStatus } from "../digests/service.js";
import { digestWorkflow } from "./definition.js";
import { isRetryable, retryDelay } from "./retry.js";
export type ClaimedJob = {
  id: string;
  runId: string;
  nodeId: string;
  type: string;
  token: string;
  workerId: string;
  workflow: Workflow;
  settings: Settings;
  input: DependencyInput;
  config: Json;
};
export type NodeResult = {
  status: "succeeded" | "failed" | "skipped";
  output: Json;
  error: SourceError | null;
};
type RunRow = {
  id: string;
  workflow: Workflow;
  settings_snapshot: Settings;
  status: RunSummary["status"];
  digest_id: string | null;
};
const released = "worker_id=NULL,claim_token=NULL,lease_until=NULL";
export class WorkflowQueue {
  constructor(
    public pool: Pool,
    public options: {
      leaseMs?: number;
      maxRecoveries?: number;
      sourceTimeoutMs?: number;
      maxRetries?: number;
      retryBaseMs?: number;
      retryMaxMs?: number;
    } = {},
  ) {}
  async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async submit(key: string, body: unknown) {
    const id = await this.transaction((client) =>
      this.enqueue(client, key, body),
    );
    const run = (await this.get(id))!;
    return {
      runId: run.id,
      status: run.status,
      statusUrl: "/api/runs/" + run.id,
    };
  }
  async enqueue(
    client: PoolClient,
    key: string,
    body: unknown,
    scheduled?: { at: Date; day: string },
    snapshot?: Settings,
  ): Promise<string> {
    const parsed = createRunSchema.safeParse(body ?? {});
    const payload = parsed.success ? parsed.data : body;
    // Serializes this key across API processes, without blocking unrelated keys.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      key,
    ]);
    const previous = await client.query<{
      id: string;
      request_payload: unknown;
    }>(
      "SELECT id,request_payload FROM workflow_runs WHERE idempotency_key=$1",
      [key],
    );
    if (previous.rows[0]) {
      if (
        JSON.stringify(previous.rows[0].request_payload) !==
        JSON.stringify(payload)
      )
        throw new RequestError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key đã được dùng cho payload khác.",
        );
      return previous.rows[0].id;
    }
    const legacy = await client.query(
      "SELECT id FROM digests WHERE idempotency_key=$1 AND workflow_run_id IS NULL",
      [key],
    );
    if (legacy.rowCount)
      throw new RequestError(
        409,
        "LEGACY_IDEMPOTENCY_KEY",
        "Key này thuộc bản tin tạo ở bước 2. Mở bản tin cũ hoặc dùng key mới để chủ động tạo workflow.",
      );
    if (!parsed.success)
      throw new RequestError(
        400,
        "VALIDATION_ERROR",
        "Payload chỉ hỗ trợ workflowVersion digest.v1.",
      );
    const settings =
      snapshot ??
      settingsSchema.parse(
        (await client.query("SELECT config FROM settings WHERE id=$1", [1]))
          .rows[0]?.config,
      );
    if (
      !settings.rss.some((source) => source.enabled) &&
      !settings.weather.enabled &&
      !settings.github.enabled
    )
      throw new RequestError(
        400,
        "NO_ENABLED_SOURCE",
        "Bật ít nhất một nguồn và lưu cấu hình trước khi tạo bản tin.",
      );
    const id = crypto.randomUUID();
    const workflow = digestWorkflow(this.options.sourceTimeoutMs ?? 25000);
    await client.query(
      "INSERT INTO workflow_runs(id,idempotency_key,request_payload,workflow,settings_snapshot,status,scheduled_at,schedule_day) VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8)",
      [
        id,
        key,
        JSON.stringify(payload),
        JSON.stringify(workflow),
        JSON.stringify(settings),
        "queued",
        scheduled?.at ?? null,
        scheduled?.day ?? null,
      ],
    );
    for (const node of workflow.nodes)
      await client.query(
        "INSERT INTO node_runs(run_id,node_id,type,status) VALUES($1,$2,$3,$4)",
        [id, node.id, node.type, "pending"],
      );
    await appendEvent(client, id, "run.created");
    await this.advance(client, {
      id,
      workflow,
      settings_snapshot: settings,
      status: "queued",
      digest_id: null,
    });
    return id;
  }
  private async advance(client: PoolClient, run: RunRow) {
    const rows = await client.query<{
      node_id: string;
      status: NodeState["status"];
      output: Json;
      error: Json;
    }>("SELECT node_id,status,output,error FROM node_runs WHERE run_id=$1", [
      run.id,
    ]);
    const states = Object.fromEntries(
      rows.rows.map((node) => [
        node.node_id,
        { status: node.status, output: node.output, error: node.error },
      ]),
    );
    const decision = plan(run.workflow, states);
    for (const skipped of decision.skipped) {
      await client.query(
        "UPDATE node_runs SET status=$3,input=$4::jsonb,error=$5::jsonb,completed_at=clock_timestamp() WHERE run_id=$1 AND node_id=$2",
        [
          run.id,
          skipped.id,
          "skipped",
          JSON.stringify(skipped.input),
          JSON.stringify({
            code: "DEPENDENCY_NOT_SUCCEEDED",
            message: "Dependency không thành công.",
          }),
        ],
      );
      await appendEvent(client, run.id, "node.skipped", skipped.id);
      states[skipped.id] = {
        status: "skipped",
        output: null,
        error: { code: "DEPENDENCY_NOT_SUCCEEDED", message: skipped.reason },
      };
    }
    for (const ready of decision.ready) {
      await client.query(
        "UPDATE node_runs SET status=$3,input=$4::jsonb WHERE run_id=$1 AND node_id=$2",
        [run.id, ready.id, "queued", JSON.stringify(ready.input)],
      );
      await client.query(
        "INSERT INTO workflow_jobs(id,run_id,node_id,status) VALUES($1,$2,$3,$4) ON CONFLICT(run_id,node_id) DO NOTHING",
        [crypto.randomUUID(), run.id, ready.id, "queued"],
      );
      await appendEvent(client, run.id, "node.queued", ready.id);
      states[ready.id] = { status: "queued", output: null, error: null };
    }
    if (Object.values(states).every((state) => isTerminal(state.status))) {
      const success = states.persist_digest?.status === "succeeded";
      await client.query(
        "UPDATE workflow_runs SET status=$2,completed_at=clock_timestamp(),error=$3::jsonb WHERE id=$1",
        [
          run.id,
          success ? "completed" : "failed",
          success
            ? null
            : JSON.stringify({
                code: "WORKFLOW_FAILED",
                message:
                  "Workflow không thể lưu bản tin. Xem trạng thái từng node.",
              }),
        ],
      );
      await appendEvent(
        client,
        run.id,
        success ? "run.completed" : "run.failed",
      );
    }
  }
  async claim(workerId: string): Promise<ClaimedJob | undefined> {
    return this.transaction(async (client) => {
      // All multi-row transitions lock run -> job -> node, in the same order.
      const runs = await client.query<RunRow>(
        "SELECT r.* FROM workflow_runs r WHERE r.status IN ('queued','running') AND EXISTS(SELECT 1 FROM workflow_jobs j WHERE j.run_id=r.id AND j.status='queued' AND j.available_at<=clock_timestamp()) ORDER BY r.created_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1",
      );
      const run = runs.rows[0];
      if (!run) return;
      const jobs = await client.query<{ id: string; node_id: string }>(
        "SELECT id,node_id FROM workflow_jobs WHERE run_id=$1 AND status='queued' AND available_at<=clock_timestamp() ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
        [run.id],
      );
      const job = jobs.rows[0];
      if (!job) return;
      const token = crypto.randomUUID();
      await client.query(
        "UPDATE workflow_jobs SET status='leased',worker_id=$2,claim_token=$3,lease_until=clock_timestamp()+$4*interval '1 millisecond' WHERE id=$1",
        [job.id, workerId, token, this.options.leaseMs ?? 15000],
      );
      await client.query(
        "INSERT INTO execution_attempts(id,job_id,claim_token,worker_id,status) VALUES($1,$2,$3,$4,'running')",
        [crypto.randomUUID(), job.id, token, workerId],
      );
      const node = (
        await client.query<{ input: DependencyInput }>(
          "UPDATE node_runs SET status='running',started_at=coalesce(started_at,clock_timestamp()) WHERE run_id=$1 AND node_id=$2 RETURNING input",
          [run.id, job.node_id],
        )
      ).rows[0]!;
      await client.query(
        "UPDATE workflow_runs SET status='running',started_at=coalesce(started_at,clock_timestamp()) WHERE id=$1",
        [run.id],
      );
      if (run.status === "queued")
        await appendEvent(client, run.id, "run.started");
      await appendEvent(client, run.id, "node.started", job.node_id);
      const definition = run.workflow.nodes.find(
        (node) => node.id === job.node_id,
      )!;
      return {
        id: job.id,
        runId: run.id,
        nodeId: job.node_id,
        type: definition.type,
        token,
        workerId,
        workflow: run.workflow,
        settings: run.settings_snapshot,
        input: node.input,
        config: definition.config,
      };
    });
  }
  async heartbeat(job: ClaimedJob) {
    const result = await this.pool.query(
      "UPDATE workflow_jobs SET lease_until=clock_timestamp()+$4*interval '1 millisecond' WHERE id=$1 AND claim_token=$2 AND worker_id=$3 AND status='leased' AND lease_until>clock_timestamp() RETURNING id",
      [job.id, job.token, job.workerId, this.options.leaseMs ?? 15000],
    );
    return result.rowCount === 1;
  }
  async finish(job: ClaimedJob, result: NodeResult): Promise<boolean> {
    return this.transaction(async (client) => {
      const run = (
        await client.query<RunRow>(
          "SELECT * FROM workflow_runs WHERE id=$1 FOR UPDATE",
          [job.runId],
        )
      ).rows[0];
      if (!run) return false;
      const owned = await client.query<{ id: string; retry_count: number }>(
        "SELECT id,retry_count FROM workflow_jobs WHERE id=$1 AND claim_token=$2 AND worker_id=$3 AND status='leased' AND lease_until>clock_timestamp() FOR UPDATE",
        [job.id, job.token, job.workerId],
      );
      if (!owned.rowCount) return false;
      if (
        result.status === "failed" &&
        isRetryable(result.error) &&
        owned.rows[0]!.retry_count < (this.options.maxRetries ?? 3)
      ) {
        const delay = retryDelay(owned.rows[0]!.retry_count, result.error, {
          baseMs: this.options.retryBaseMs ?? 1000,
          maxMs: this.options.retryMaxMs ?? 60000,
        });
        await client.query(
          "UPDATE execution_attempts SET status='failed',completed_at=clock_timestamp(),error=$2::jsonb WHERE claim_token=$1",
          [job.token, JSON.stringify(result.error)],
        );
        await client.query(
          "UPDATE node_runs SET status='queued',error=$3::jsonb,output=NULL,completed_at=NULL WHERE run_id=$1 AND node_id=$2",
          [run.id, job.nodeId, JSON.stringify(result.error)],
        );
        const retried = await client.query(
          "UPDATE workflow_jobs SET status='queued',retry_count=retry_count+1,available_at=clock_timestamp()+$4*interval '1 millisecond'," +
            released +
            " WHERE id=$1 AND claim_token=$2 AND worker_id=$3 AND lease_until>clock_timestamp() RETURNING id",
          [job.id, job.token, job.workerId, delay],
        );
        if (!retried.rowCount) throw new LeaseLost();
        await appendEvent(client, run.id, "node.retry_scheduled", job.nodeId);
        return true;
      }
      let output = result.output;
      if (job.type === "persist_digest" && result.status === "succeeded") {
        const composed = job.input.dependencies.compose_digest;
        if (composed?.status !== "succeeded" || !composed.output)
          throw new Error("Missing composed digest.");
        const data = composed.output as unknown as {
          sources: DigestSources;
          snapshots: Repository[];
        };
        const digestId = run.id;
        await client.query(
          "INSERT INTO digests(id,idempotency_key,settings_snapshot,status,sources,created_at,completed_at,workflow_run_id) VALUES($1,$1,$2::jsonb,$3,$4::jsonb,clock_timestamp(),clock_timestamp(),$1) ON CONFLICT(workflow_run_id) DO NOTHING",
          [
            digestId,
            JSON.stringify(run.settings_snapshot),
            aggregateStatus(data.sources),
            JSON.stringify(data.sources),
          ],
        );
        if (data.snapshots.length)
          await client.query(
            'INSERT INTO github_snapshots(repository_id,digest_id,stars,fetched_at) SELECT x.id,$1,x.stars,x."fetchedAt" FROM jsonb_to_recordset($2::jsonb) AS x(id bigint,stars bigint,"fetchedAt" timestamptz) ON CONFLICT(repository_id,digest_id) DO NOTHING',
            [digestId, JSON.stringify(data.snapshots)],
          );
        await client.query(
          "UPDATE workflow_runs SET digest_id=$2 WHERE id=$1",
          [run.id, digestId],
        );
        output = { digestId };
        await client.query(
          "INSERT INTO scheduled_deliveries(id,digest_id) SELECT $1,$2 FROM workflow_runs WHERE id=$2 AND scheduled_at IS NOT NULL AND settings_snapshot->'notifications'->>'enabled'='true' ON CONFLICT(digest_id) DO NOTHING",
          [crypto.randomUUID(), digestId],
        );
      }
      await client.query(
        "UPDATE node_runs SET status=$3,output=$4::jsonb,error=$5::jsonb,completed_at=clock_timestamp() WHERE run_id=$1 AND node_id=$2",
        [
          run.id,
          job.nodeId,
          result.status,
          JSON.stringify(output),
          result.error ? JSON.stringify(result.error) : null,
        ],
      );
      await client.query(
        "UPDATE execution_attempts SET status=$2,completed_at=clock_timestamp(),error=$3::jsonb WHERE claim_token=$1",
        [
          job.token,
          result.status,
          result.error ? JSON.stringify(result.error) : null,
        ],
      );
      // Final fence also rolls back digest/snapshots if the lease elapsed during SQL work.
      const ended = await client.query(
        "UPDATE workflow_jobs SET status=$4," +
          released +
          " WHERE id=$1 AND claim_token=$2 AND worker_id=$3 AND status='leased' AND lease_until>clock_timestamp() RETURNING id",
        [
          job.id,
          job.token,
          job.workerId,
          result.status === "failed" ? "failed" : "done",
        ],
      );
      if (!ended.rowCount) throw new LeaseLost();
      await appendEvent(
        client,
        run.id,
        ("node." + result.status) as
          | "node.succeeded"
          | "node.failed"
          | "node.skipped",
        job.nodeId,
      );
      if (result.status === "failed")
        await this.deadLetter(client, job.id, result.error);
      await this.advance(client, run);
      return true;
    });
  }
  async recover(): Promise<number> {
    return this.transaction(async (client) => {
      const run = (
        await client.query<RunRow>(
          "SELECT r.* FROM workflow_runs r WHERE r.status IN ('queued','running') AND EXISTS(SELECT 1 FROM workflow_jobs j WHERE j.run_id=r.id AND j.status='leased' AND j.lease_until<=clock_timestamp()) ORDER BY r.created_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!run) return 0;
      const jobs = await client.query<{
        id: string;
        node_id: string;
        claim_token: string;
        recoveries: number;
      }>(
        "SELECT id,node_id,claim_token,recoveries FROM workflow_jobs WHERE run_id=$1 AND status='leased' AND lease_until<=clock_timestamp() FOR UPDATE SKIP LOCKED",
        [run.id],
      );
      for (const job of jobs.rows) {
        const exhausted = job.recoveries >= (this.options.maxRecoveries ?? 3);
        const error = {
          code: exhausted ? "RECOVERY_LIMIT" : "LEASE_EXPIRED",
          message: exhausted
            ? "Đã vượt giới hạn phục hồi do worker gián đoạn."
            : "Worker mất lease; attempt bị gián đoạn.",
        };
        await client.query(
          "UPDATE execution_attempts SET status='interrupted',completed_at=clock_timestamp(),error=$2::jsonb WHERE claim_token=$1 AND status='running'",
          [job.claim_token, JSON.stringify(error)],
        );
        await client.query(
          "UPDATE workflow_jobs SET status=$2," +
            released +
            ",recoveries=recoveries+$3 WHERE id=$1",
          [job.id, exhausted ? "failed" : "queued", exhausted ? 0 : 1],
        );
        await client.query(
          "UPDATE node_runs SET status=$3,error=$4::jsonb,completed_at=CASE WHEN $5 THEN clock_timestamp() ELSE NULL END WHERE run_id=$1 AND node_id=$2",
          [
            run.id,
            job.node_id,
            exhausted ? "failed" : "queued",
            exhausted ? JSON.stringify(error) : null,
            exhausted,
          ],
        );
        await appendEvent(client, run.id, "job.recovered", job.node_id);
        if (exhausted)
          await appendEvent(client, run.id, "node.failed", job.node_id);
        if (exhausted) await this.deadLetter(client, job.id, error);
      }
      await this.advance(client, run);
      return jobs.rows.length;
    });
  }
  private async deadLetter(
    client: PoolClient,
    jobId: string,
    error: SourceError | null,
  ) {
    await client.query(
      "INSERT INTO dead_letters(id,job_id,error) VALUES($1,$2,$3::jsonb) ON CONFLICT(job_id) DO NOTHING",
      [
        crypto.randomUUID(),
        jobId,
        JSON.stringify(
          error ?? { code: "NODE_FAILED", message: "Node thất bại." },
        ),
      ],
    );
  }
  async deadLetters(page: number, pageSize: number) {
    const result = await this.pool.query(
      'SELECT d.id,j.run_id AS "runId",j.node_id AS "nodeId",d.error,d.created_at AS "createdAt",d.replay_run_id AS "replayRunId" FROM dead_letters d JOIN workflow_jobs j ON j.id=d.job_id ORDER BY d.created_at DESC,d.id DESC LIMIT $1 OFFSET $2',
      [pageSize + 1, (page - 1) * pageSize],
    );
    return {
      items: result.rows
        .slice(0, pageSize)
        .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      page,
      pageSize,
      hasMore: result.rows.length > pageSize,
    };
  }
  async replay(id: string) {
    return this.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT d.*,r.settings_snapshot FROM dead_letters d JOIN workflow_jobs j ON j.id=d.job_id JOIN workflow_runs r ON r.id=j.run_id WHERE d.id=$1 FOR UPDATE OF d",
          [id],
        )
      ).rows[0];
      if (!row)
        throw new RequestError(
          404,
          "DEAD_LETTER_NOT_FOUND",
          "Không tìm thấy tác vụ lỗi.",
        );
      if (row.replay_run_id) return { runId: row.replay_run_id as string };
      // Replay creates a new manual run; never edits already consumed outputs or sends automatically.
      const runId = await this.enqueue(
        client,
        crypto.randomUUID(),
        {},
        undefined,
        settingsSchema.parse(row.settings_snapshot),
      );
      await client.query(
        "UPDATE dead_letters SET replay_run_id=$2 WHERE id=$1",
        [id, runId],
      );
      return { runId };
    });
  }
  async get(id: string): Promise<WorkflowRun | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await this.readSnapshot(client, id);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async readSnapshot(
    client: PoolClient,
    id: string,
  ): Promise<WorkflowRun | undefined> {
    const result = await client.query(
      'SELECT event_sequence,id,status,workflow->>\'version\' AS "workflowVersion",digest_id AS "digestId",created_at AS "createdAt",started_at AS "startedAt",completed_at AS "completedAt",error FROM workflow_runs WHERE id=$1',
      [id],
    );
    const row = result.rows[0];
    if (!row) return;
    const nodes = await client.query(
      'SELECT n.node_id AS "nodeId",n.type,n.status,n.started_at AS "startedAt",n.completed_at AS "completedAt",n.error,j.recoveries,j.retry_count AS "retryCount",j.available_at AS "availableAt",j.worker_id AS "workerId",j.lease_until AS "leaseUntil",(SELECT count(*)::int FROM execution_attempts a WHERE a.job_id=j.id) AS attempts FROM node_runs n LEFT JOIN workflow_jobs j ON j.run_id=n.run_id AND j.node_id=n.node_id WHERE n.run_id=$1 ORDER BY n.node_id',
      [id],
    );
    const history = await client.query(
      "SELECT * FROM (SELECT * FROM run_events WHERE run_id=$1 ORDER BY sequence DESC LIMIT 100) recent ORDER BY sequence",
      [id],
    );
    const { event_sequence, ...summary } = row;
    const iso = (value: unknown) =>
      value ? new Date(value as string).toISOString() : null;
    return {
      ...summary,
      eventCursor: cursor(summary.id, String(event_sequence)),
      recentEvents: history.rows.map(eventDto),
      eventsTruncated: BigInt(event_sequence) > BigInt(history.rows.length),
      createdAt: iso(row.createdAt)!,
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      nodes: nodes.rows.map((node) => ({
        ...node,
        startedAt: iso(node.startedAt),
        completedAt: iso(node.completedAt),
        leaseUntil: iso(node.leaseUntil),
        recoveries: node.recoveries ?? 0,
        attempts: node.attempts ?? 0,
        retryCount: node.retryCount ?? 0,
        availableAt: iso(node.availableAt),
      })),
    };
  }
  async list(page: number, pageSize: number) {
    const result = await this.pool.query(
      'SELECT id,status,workflow->>\'version\' AS "workflowVersion",digest_id AS "digestId",created_at AS "createdAt",started_at AS "startedAt",completed_at AS "completedAt",error FROM workflow_runs ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2',
      [pageSize + 1, (page - 1) * pageSize],
    );
    return {
      items: result.rows.slice(0, pageSize).map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
      page,
      pageSize,
      hasMore: result.rows.length > pageSize,
    };
  }
}
export class LeaseLost extends Error {
  constructor() {
    super("Lease no longer owned.");
  }
}
