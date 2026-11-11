import { it, expect } from "vitest";
import {
  plan,
  topologicalOrder,
  type Workflow,
  type NodeState,
} from "./index.js";
const node = (
  id: string,
  policy: "all_success" | "all_settled" = "all_success",
) => ({ id, type: id, config: null, policy });
const workflow: Workflow = {
  version: "test.v1",
  concurrency: 3,
  nodes: [
    node("start"),
    node("a"),
    node("b"),
    node("join", "all_settled"),
    node("end"),
  ],
  edges: [
    { from: "start", to: "a" },
    { from: "start", to: "b" },
    { from: "a", to: "join" },
    { from: "b", to: "join" },
    { from: "join", to: "end" },
  ],
};
const pending = () =>
  Object.fromEntries(
    workflow.nodes.map((node) => [
      node.id,
      { status: "pending", output: null, error: null },
    ]),
  ) as Record<string, NodeState>;
it("topologically validates DAG, duplicate IDs, invalid edges, self-loops and cycles", () => {
  expect(topologicalOrder(workflow)).toEqual([
    "start",
    "a",
    "b",
    "join",
    "end",
  ]);
  for (const invalid of [
    { ...workflow, nodes: [...workflow.nodes, node("a")] },
    { ...workflow, edges: [{ from: "missing", to: "a" }] },
    { ...workflow, edges: [{ from: "a", to: "a" }] },
    { ...workflow, edges: [...workflow.edges, { from: "end", to: "start" }] },
  ])
    expect(() => topologicalOrder(invalid)).toThrow();
});
it("admits independent branches together and observes concurrency", () => {
  const states = pending();
  states.start = { status: "succeeded", output: { value: 1 }, error: null };
  expect(plan(workflow, states).ready.map((node) => node.id)).toEqual([
    "a",
    "b",
  ]);
  expect(
    plan({ ...workflow, concurrency: 1 }, states).ready.map((node) => node.id),
  ).toEqual(["a"]);
});
it("all_settled includes failed/skipped dependencies and explicitly missing outputs", () => {
  const states = pending();
  states.start = { status: "succeeded", output: null, error: null };
  states.a = { status: "failed", output: null, error: { code: "FAILED" } };
  states.b = { status: "skipped", output: null, error: { code: "DISABLED" } };
  expect(plan(workflow, states).ready).toEqual([
    { id: "join", input: { dependencies: { a: states.a, b: states.b } } },
  ]);
});
it("all_success waits and propagates skipped through a chain", () => {
  const states = pending();
  states.start = { status: "failed", output: null, error: { code: "FAILED" } };
  const result = plan(
    {
      ...workflow,
      nodes: workflow.nodes.map((n) => ({ ...n, policy: "all_success" })),
    },
    states,
  );
  expect(result.ready).toEqual([]);
  expect(result.skipped.map((node) => node.id)).toEqual([
    "a",
    "b",
    "join",
    "end",
  ]);
});
