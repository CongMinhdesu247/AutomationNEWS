export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type NodeStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";
export type Policy = "all_success" | "all_settled";
export type WorkflowNode = {
  id: string;
  type: string;
  config: Json;
  policy: Policy;
};
export type Workflow = {
  version: string;
  concurrency: number;
  nodes: WorkflowNode[];
  edges: { from: string; to: string }[];
};
export type NodeState = { status: NodeStatus; output: Json; error: Json };
export type DependencyInput = { dependencies: Record<string, NodeState> };
export const isTerminal = (status: NodeStatus) =>
  ["succeeded", "failed", "skipped"].includes(status);
export function json(value: unknown): Json {
  const encoded = JSON.stringify(value, (_key, item: unknown) => {
    if (
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol" ||
      typeof item === "bigint" ||
      (typeof item === "number" && !Number.isFinite(item))
    )
      throw new Error("Output must be finite JSON.");
    return item;
  });
  if (encoded === undefined) throw new Error("Output must be JSON.");
  return JSON.parse(encoded) as Json;
}
export function topologicalOrder(workflow: Workflow): string[] {
  if (
    !workflow.version ||
    !Number.isInteger(workflow.concurrency) ||
    workflow.concurrency < 1
  )
    throw new Error("Invalid workflow metadata.");
  const ids = new Set<string>();
  for (const node of workflow.nodes) {
    if (!/^[a-z][a-z0-9_]{0,99}$/.test(node.id) || ids.has(node.id))
      throw new Error("Duplicate or invalid node ID.");
    if (!node.type || !["all_success", "all_settled"].includes(node.policy))
      throw new Error("Invalid node.");
    ids.add(node.id);
  }
  if (!ids.size) throw new Error("Empty workflow.");
  const degree = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, [] as string[]]));
  const edges = new Set<string>();
  for (const edge of workflow.edges) {
    const key = edge.from + ">" + edge.to;
    if (
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      edge.from === edge.to ||
      edges.has(key)
    )
      throw new Error("Invalid edge or self-loop.");
    edges.add(key);
    degree.set(edge.to, degree.get(edge.to)! + 1);
    outgoing.get(edge.from)!.push(edge.to);
  }
  const queue = [...ids].filter((id) => degree.get(id) === 0);
  const sorted: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    sorted.push(id);
    for (const to of outgoing.get(id)!) {
      degree.set(to, degree.get(to)! - 1);
      if (degree.get(to) === 0) queue.push(to);
    }
  }
  if (sorted.length !== ids.size) throw new Error("Workflow contains a cycle.");
  return sorted;
}
export function plan(workflow: Workflow, states: Record<string, NodeState>) {
  const sorted = topologicalOrder(workflow);
  const local = { ...states };
  let slots = Math.max(
    0,
    workflow.concurrency -
      Object.values(states).filter((state) =>
        ["queued", "running"].includes(state.status),
      ).length,
  );
  const ready: { id: string; input: DependencyInput }[] = [];
  const skipped: { id: string; input: DependencyInput; reason: string }[] = [];
  for (const id of sorted) {
    if (!local[id] || local[id]!.status !== "pending") continue;
    const node = workflow.nodes.find((node) => node.id === id)!;
    const dependencies = workflow.edges
      .filter((edge) => edge.to === id)
      .map((edge) => edge.from);
    if (dependencies.some((id) => !local[id] || !isTerminal(local[id]!.status)))
      continue;
    const input: DependencyInput = {
      dependencies: Object.fromEntries(
        dependencies.map((id) => [id, { ...local[id]! }]),
      ),
    };
    if (
      node.policy === "all_success" &&
      dependencies.some((id) => local[id]!.status !== "succeeded")
    ) {
      const reason = "Dependency did not succeed.";
      skipped.push({ id, input, reason });
      local[id] = {
        status: "skipped",
        output: null,
        error: { code: "DEPENDENCY_NOT_SUCCEEDED", message: reason },
      };
    } else if (slots > 0) {
      ready.push({ id, input });
      slots--;
      local[id] = { status: "queued", output: null, error: null };
    }
  }
  return { ready, skipped };
}
