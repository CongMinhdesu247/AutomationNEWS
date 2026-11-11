import {
  cursorSequence,
  runEventTypes,
  type WorkflowRun,
  type RunEvent,
} from "@hub/contracts";
export const TIMELINE_LIMIT = 100;
export function applyRunEvent(run: WorkflowRun, event: RunEvent): WorkflowRun {
  if (event.runId !== run.id || !runEventTypes.includes(event.type))
    throw new Error("Invalid run event.");
  const next = cursorSequence(event.id, run.id);
  if (String(next) !== event.sequence) throw new Error("Invalid sequence.");
  const previous = cursorSequence(run.eventCursor, run.id);
  if (next <= previous) return run;
  if (next !== previous + 1n) throw new Error("Event gap.");
  if (event.payload.run && event.payload.run.id !== run.id)
    throw new Error("Invalid event projection.");
  const node = event.payload.node;
  if (
    node &&
    (!run.nodes.some((value) => value.nodeId === node.nodeId) ||
      node.nodeId !== event.nodeId)
  )
    throw new Error("Invalid node event.");
  return {
    ...run,
    ...event.payload.run,
    nodes: node
      ? run.nodes.map((value) => (value.nodeId === node.nodeId ? node : value))
      : run.nodes,
    eventCursor: event.id,
    recentEvents: [...run.recentEvents, event].slice(-TIMELINE_LIMIT),
    eventsTruncated:
      run.eventsTruncated || run.recentEvents.length >= TIMELINE_LIMIT,
  };
}
export const eventLabels: Record<RunEvent["type"], string> = {
  "run.created": "Đã tạo workflow",
  "run.started": "Workflow bắt đầu",
  "run.completed": "Workflow hoàn tất",
  "run.failed": "Workflow thất bại",
  "node.queued": "Node được đưa vào hàng đợi",
  "node.started": "Node bắt đầu",
  "node.succeeded": "Node thành công",
  "node.failed": "Node thất bại",
  "node.skipped": "Node được bỏ qua",
  "node.retry_scheduled": "Đã lên lịch thử lại node",
  "job.recovered": "Job được thu hồi sau khi mất lease",
};
