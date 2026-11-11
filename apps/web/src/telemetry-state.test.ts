import { it, expect } from "vitest";
import { applyRunEvent, TIMELINE_LIMIT } from "./telemetry-state";
import { cursor, type WorkflowRun, type RunEvent } from "@hub/contracts";
const id = "11111111-1111-4111-8111-111111111111";
const fresh = (): WorkflowRun => ({
  id,
  status: "queued",
  workflowVersion: "digest.v1",
  digestId: null,
  createdAt: "2026-11-12T00:00:00Z",
  startedAt: null,
  completedAt: null,
  error: null,
  nodes: [],
  eventCursor: cursor(id, "0"),
  recentEvents: [],
  eventsTruncated: false,
});
const event = (sequence: number): RunEvent => ({
  id: cursor(id, String(sequence)),
  sequence: String(sequence),
  runId: id,
  type: "run.started",
  timestamp: "2026-11-12T00:00:00Z",
  nodeId: null,
  payload: { run: { ...fresh(), status: "running" } },
});
it("ignores replay duplicates and cannot move state backwards", () => {
  const original = fresh();
  const next = applyRunEvent(original, event(1));
  expect(next.status).toBe("running");
  expect(applyRunEvent(next, event(1))).toBe(next);
  expect(next.recentEvents).toHaveLength(1);
});
it("requires consecutive same-run events and requests reset on gaps", () => {
  expect(() => applyRunEvent(fresh(), event(2))).toThrow("gap");
  expect(() =>
    applyRunEvent(fresh(), { ...event(1), runId: crypto.randomUUID() }),
  ).toThrow();
});
it("bounds timeline memory and rendering history", () => {
  let run = fresh();
  for (let index = 1; index <= 180; index++)
    run = applyRunEvent(run, event(index));
  expect(run.recentEvents).toHaveLength(TIMELINE_LIMIT);
  expect(run.recentEvents[0]?.sequence).toBe("81");
  expect(run.eventCursor).toBe(cursor(id, "180"));
  expect(run.eventsTruncated).toBe(true);
});
