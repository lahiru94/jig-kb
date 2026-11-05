import { describe, expect, it } from "vitest";
import { OperationError, validateActionInputs } from "../src/index";
import { agent, makeService } from "./helpers";

async function errorOf(promise: Promise<unknown>): Promise<OperationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OperationError) return error;
    throw error;
  }
  throw new Error("expected an OperationError");
}

describe("input validation before execution", () => {
  it("rejects analyze_impact on a delta that references a non-existent node, naming it, with no side effects", async () => {
    const { service, audit, deltas, kb } = await makeService();
    deltas.add("delta-1", [
      {
        op: "add",
        id: "rule.new-limit",
        content: "---\nid: rule.new-limit\nkind: BusinessRule\ntitle: New limit\nstatement: X.\nenforcement: {kb-layer: false}\nimplemented-by: [component.ghost]\n---\n",
      },
    ]);
    const before = kb.current().nodes.length;
    const error = await errorOf(service.analyze_impact(agent, { delta_id: "delta-1" }));
    expect(error.code).toBe("unknown_node");
    expect(error.message).toContain("component.ghost");
    expect(error.details.id).toBe("component.ghost");
    expect(kb.current().nodes.length).toBe(before);
    expect(audit.calls().map((c) => [c.operation, c.outcome])).toEqual([["analyze_impact", "invalid"]]);
  });

  it("rejects a delta that modifies a node that does not exist", async () => {
    const { service, deltas } = await makeService();
    deltas.add("delta-2", [{ op: "remove", id: "rule.never-existed" }]);
    const error = await errorOf(service.simulate(agent, { delta_id: "delta-2" }));
    expect(error.code).toBe("unknown_node");
    expect(error.details.id).toBe("rule.never-existed");
  });

  it("rejects unknown deltas, focus nodes and actions", async () => {
    const { service } = await makeService();
    expect((await errorOf(service.analyze_impact(agent, { delta_id: "delta-404" }))).code).toBe("not_found");
    expect((await errorOf(service.query(agent, { focus: "rule.ghost" }))).details).toEqual({ id: "rule.ghost", field: "focus" });
    expect((await errorOf(service.act(agent, { action: "action.ghost", inputs: {} }))).code).toBe("unknown_node");
  });

  it("validates action inputs against the action's typed inputs", async () => {
    const { kb } = await makeService();
    const action = kb.current().index.get("action.place-order");
    if (!action) throw new Error("fixture missing action");
    expect(() => validateActionInputs(action, {})).toThrow("requires input 'order_id'");
    expect(() => validateActionInputs(action, { order_id: 5 })).toThrow("must be string");
    expect(() => validateActionInputs(action, { order_id: "o1", extra: true })).toThrow("has no input 'extra'");
    expect(() => validateActionInputs(action, { order_id: "o1" })).not.toThrow();
  });
});
