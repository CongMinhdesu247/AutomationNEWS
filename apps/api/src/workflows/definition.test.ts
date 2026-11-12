import { expect, it } from "vitest";
import { digestWorkflow } from "./definition.js";
it("keeps legacy DAGs unchanged and connects the enabled fuel branch before composition", () => {
  expect(digestWorkflow().nodes).toHaveLength(6);
  const workflow = digestWorkflow(25000, true);
  expect(workflow.nodes).toHaveLength(7);
  expect(workflow.nodes.find(node => node.id === "fetch_fuel")?.type).toBe("fetch_fuel");
  expect(workflow.edges).toContainEqual({from:"start",to:"fetch_fuel"});
  expect(workflow.edges).toContainEqual({from:"fetch_fuel",to:"compose_digest"});
  const air = digestWorkflow(25000, false, true);
  expect(air.nodes).toHaveLength(7);
  expect(air.edges).toContainEqual({ from: "fetch_air_quality", to: "compose_digest" });
  expect(digestWorkflow(25000, true, true).nodes).toHaveLength(8);
  expect(digestWorkflow(25000,false,false,true,true).nodes).toHaveLength(8);
  expect(digestWorkflow(25000,false,false,true,true).edges).toContainEqual({from:"fetch_usd",to:"compose_digest"});
});
