import type { PoolClient } from "pg";
import {
  cursor,
  type RunSummary,
  type RunNode,
  type SourceError,
  type RunEvent,
  type RunEventType,
} from "@hub/contracts";
const iso = (value: unknown) =>
  value ? new Date(value as string).toISOString() : null;
const knownErrors = new Set([
  "SOURCE_DISABLED",
  "DEPENDENCY_NOT_SUCCEEDED",
  "RECOVERY_LIMIT",
  "LEASE_EXPIRED",
  "TOTAL_TIMEOUT",
  "SOURCE_UNAVAILABLE",
  "TIMEOUT",
  "GITHUB_RATE_LIMIT",
  "RATE_LIMIT",
  "NETWORK_ERROR",
  "RESPONSE_LIMIT",
  "BLOCKED_ADDRESS",
  "INVALID_URL",
  "NODE_EXECUTION_FAILED",
  "NODE_PERSIST_FAILED",
  "WORKFLOW_FAILED",
  "MISSING_SOURCE_OUTPUT",
  "SOURCE_FAILED",
]);
export function telemetryError(value: unknown): SourceError | null {
  if (!value) return null;
  const original = (value as { code?: unknown }).code;
  const code =
    typeof original === "string" &&
    (knownErrors.has(original) || /^HTTP_[1-5][0-9]{2}$/.test(original))
      ? original
      : "NODE_ERROR";
  const messages: Record<string, string> = {
    SOURCE_DISABLED: "Nguồn đã tắt trong cấu hình.",
    DEPENDENCY_NOT_SUCCEEDED: "Dependency không thành công.",
    RECOVERY_LIMIT: "Đã hết lượt phục hồi worker.",
    LEASE_EXPIRED: "Job mất lease và bị gián đoạn.",
    TOTAL_TIMEOUT: "Nguồn vượt thời gian cho phép.",
    GITHUB_RATE_LIMIT: "GitHub giới hạn quota.",
    BLOCKED_ADDRESS: "Đích truy cập không được phép.",
    WORKFLOW_FAILED: "Workflow không thể lưu bản tin.",
  };
  return {
    code,
    message:
      messages[code] ??
      "Tác vụ không thành công; thông tin chi tiết đã được làm sạch.",
  };
}
export async function runProjection(
  client: PoolClient,
  id: string,
): Promise<RunSummary> {
  const row = (
    await client.query(
      'SELECT id,status,jsonb_extract_path_text(workflow,$2) AS "workflowVersion",digest_id AS "digestId",created_at AS "createdAt",started_at AS "startedAt",completed_at AS "completedAt",error FROM workflow_runs WHERE id=$1',
      [id, "version"],
    )
  ).rows[0];
  if (!row) throw new Error("Missing run.");
  return {
    ...row,
    createdAt: iso(row.createdAt)!,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    error: telemetryError(row.error),
  };
}
export async function nodeProjections(
  client: PoolClient,
  id: string,
): Promise<RunNode[]> {
  const rows = await client.query(
    'SELECT n.node_id AS "nodeId",n.type,n.status,n.started_at AS "startedAt",n.completed_at AS "completedAt",n.error,j.recoveries,j.retry_count AS "retryCount",j.available_at AS "availableAt",(SELECT count(*)::int FROM execution_attempts a WHERE a.job_id=j.id) AS attempts FROM node_runs n LEFT JOIN workflow_jobs j ON j.run_id=n.run_id AND j.node_id=n.node_id WHERE n.run_id=$1 ORDER BY n.node_id',
    [id],
  );
  return rows.rows.map((row) => ({
    ...row,
    error: telemetryError(row.error),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    availableAt: iso(row.availableAt),
    recoveries: row.recoveries ?? 0,
    retryCount: row.retryCount ?? 0,
    workerId: null,
    leaseUntil: null,
  }));
}
export type EventRow = {
  run_id: string;
  sequence: string;
  type: RunEventType;
  occurred_at: Date | string;
  node_id: string | null;
  payload: RunEvent["payload"];
};
export function eventDto(row: EventRow): RunEvent {
  return {
    id: cursor(row.run_id, String(row.sequence)),
    runId: row.run_id,
    sequence: String(row.sequence),
    type: row.type,
    timestamp: iso(row.occurred_at)!,
    nodeId: row.node_id,
    payload: row.payload,
  };
}
// Caller already owns the run lock, including a newly inserted run in enqueue().
export async function appendEvent(
  client: PoolClient,
  runId: string,
  type: RunEventType,
  nodeId: string | null = null,
) {
  const payload: RunEvent["payload"] = {
    run: await runProjection(client, runId),
  };
  if (nodeId) {
    const node = (await nodeProjections(client, runId)).find(
      (node) => node.nodeId === nodeId,
    );
    if (!node) throw new Error("Missing event node.");
    payload.node = node;
  }
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded) > 4096)
    throw new Error("Event payload exceeds limit.");
  const row = (
    await client.query<{ event_sequence: string }>(
      "UPDATE workflow_runs SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence",
      [runId],
    )
  ).rows[0]!;
  await client.query(
    "INSERT INTO run_events(run_id,sequence,type,node_id,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
    [runId, row.event_sequence, type, nodeId, encoded],
  );
}
