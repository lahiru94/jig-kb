import { describe, expect, it } from "vitest";
import { SAMPLE_KB, agent, makeService } from "./helpers";

describe("query operation (ground-truth KB)", () => {
  it("returns the rules of capability.returns with statements, claims, conflicts and confidence", async () => {
    const { service } = await makeService(SAMPLE_KB);
    const result = await service.query(agent, {
      focus: "capability.returns",
      direction: "in",
      link_types: ["part-of"],
      kind: "BusinessRule",
    });
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([
      "rule.eu-withdrawal-refund",
      "rule.gift-card-refunds",
      "rule.refund-approval-limit",
      "rule.refund-window",
      "rule.refunds-need-delivery",
      "rule.single-refund-per-order",
    ]);
    const window = result.nodes.find((n) => n.id === "rule.refund-window");
    expect(window?.data.statement).toBe("Customers may request a refund within 30 days of delivery.");
    expect(window?.claims.map((c) => c.confidence)).toEqual(["stated", "inferred"]);
    expect(window?.conflicts[0]).toMatchObject({ status: "open", claims: [0, 1] });
    expect(window?.confidence).toBe("inferred");
    expect(result.links.every((l) => l.type === "part-of" && l.to === "capability.returns")).toBe(true);
  });

  it("filters by kind and attribute, and searches text", async () => {
    const { service } = await makeService(SAMPLE_KB);
    const described = await service.query(agent, { kind: "System", attrs: { mode: "described" } });
    expect(described.nodes.map((n) => n.id)).toEqual(["system.legacy-erp"]);
    const search = await service.query(agent, { text: "spreadsheet" });
    expect(search.nodes.map((n) => n.id)).toContain("process.gift-card-reconciliation");
    const none = await service.query(agent, { kind: "Goal", text: "spreadsheet" });
    expect(none.nodes).toEqual([]);
  });

  it("reports nodes without claims as confidence none, and audits the call", async () => {
    const { service, audit } = await makeService(SAMPLE_KB);
    const result = await service.query(agent, { focus: "role.finance", depth: 0 });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.confidence).toBe("none");
    expect(audit.calls()).toHaveLength(1);
    expect(audit.calls()[0]).toMatchObject({ operation: "query", target: "role.finance", outcome: "ok" });
  });

  it("rejects an unknown as-of version", async () => {
    const { service } = await makeService(SAMPLE_KB);
    await expect(service.query(agent, { as_of: "v-missing" })).rejects.toThrow("unknown KB version or delta 'v-missing'");
  });
});
