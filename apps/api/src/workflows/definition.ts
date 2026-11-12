import { json, topologicalOrder, type Workflow } from "@hub/engine";
export function digestWorkflow(timeoutMs = 25000, fuelEnabled = false, airQualityEnabled = false, goldEnabled = false, usdEnabled = false): Workflow {
  const sources = ["rss", "weather", "github", ...(fuelEnabled ? ["fuel"] : []), ...(airQualityEnabled ? ["air_quality"] : []), ...(goldEnabled ? ["gold"] : []), ...(usdEnabled ? ["usd"] : [])];
  const workflow: Workflow = {
    version: "digest.v1",
    concurrency: 3,
    nodes: [
      { id: "start", type: "start", config: {}, policy: "all_success" },
      ...sources.map((source) => ({
        id: "fetch_" + source,
        type: "fetch_" + source,
        config: json({ timeoutMs }),
        policy: "all_success" as const,
      })),
      {
        id: "compose_digest",
        type: "compose_digest",
        config: {},
        policy: "all_settled",
      },
      {
        id: "persist_digest",
        type: "persist_digest",
        config: {},
        policy: "all_success",
      },
    ],
    edges: [
      ...sources.flatMap((source) => [
        { from: "start", to: "fetch_" + source },
        { from: "fetch_" + source, to: "compose_digest" },
      ]),
      { from: "compose_digest", to: "persist_digest" },
    ],
  };
  topologicalOrder(workflow);
  return workflow;
}
