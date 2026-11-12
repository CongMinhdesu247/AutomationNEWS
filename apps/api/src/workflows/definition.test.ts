import { expect, it } from "vitest";
import { digestWorkflow } from "./definition.js";
it("keeps legacy DAGs unchanged and connects the enabled fuel branch before composition", () => {
  expect(digestWorkflow().nodes).toHaveLength(6);
  const workflow = digestWorkflow(25000, true);
  expect(workflow.nodes).toHaveLength(7);
  expect(workflow.nodes.find(node => node.id === "fetch_fuel")?.type).toBe("fetch_fuel");
  expect(workflow.edges).toContainEqual({from:"start",to:"fetch_fuel"});
  expect(workflow.edges).toContainEqual({from:"fetch_fuel",to:"compose_digest"});
});
