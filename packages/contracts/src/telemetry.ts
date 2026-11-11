import { z } from "zod";
import type { RunSummary, RunNode } from "./runs.js";
export const runEventTypes = [
  "run.created",
  "run.started",
  "run.completed",
  "run.failed",
  "node.queued",
  "node.started",
  "node.succeeded",
  "node.failed",
  "node.skipped",
  "node.retry_scheduled",
  "job.recovered",
] as const;
export type RunEventType = (typeof runEventTypes)[number];
export type RunEvent = {
  id: string;
  runId: string;
  sequence: string;
  type: RunEventType;
  timestamp: string;
  nodeId: string | null;
  payload: { run?: RunSummary; node?: RunNode };
};
export type StreamSync = { cursor: string; terminal: boolean };
export const cursorSchema = z
  .string()
  .max(80)
  .regex(/^[0-9a-f-]{36}:(0|[1-9][0-9]{0,18})$/, "Cursor không hợp lệ.");
export function cursor(runId: string, sequence: string) {
  return runId + ":" + sequence;
}
export function cursorSequence(value: string, runId: string): bigint {
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success || value.split(":")[0] !== runId)
    throw new Error("Invalid event cursor.");
  const sequence = BigInt(value.split(":")[1]!);
  if (sequence > 9223372036854775807n) throw new Error("Invalid event cursor.");
  return sequence;
}
