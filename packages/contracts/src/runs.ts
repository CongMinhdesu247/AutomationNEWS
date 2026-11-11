import type { RunEvent } from "./telemetry.js";
import { z } from "zod";
import type { SourceError } from "./digests.js";
export const createRunSchema = z
  .object({ workflowVersion: z.literal("digest.v1").default("digest.v1") })
  .strict();
export type RunSummary = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  workflowVersion: string;
  digestId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: SourceError | null;
};
export type RunNode = {
  nodeId: string;
  type: string;
  status: "pending" | "queued" | "running" | "succeeded" | "failed" | "skipped";
  startedAt: string | null;
  completedAt: string | null;
  error: SourceError | null;
  attempts: number;
  recoveries: number;
  retryCount: number;
  availableAt: string | null;
  workerId: string | null;
  leaseUntil: string | null;
};
export type WorkflowRun = RunSummary & {
  nodes: RunNode[];
  eventCursor: string;
  recentEvents: RunEvent[];
  eventsTruncated: boolean;
};
export type RunAccepted = {
  runId: string;
  status: RunSummary["status"];
  statusUrl: string;
};
