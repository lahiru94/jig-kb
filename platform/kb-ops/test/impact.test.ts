import { afterEach, describe, expect, it } from "vitest";
import { casey, edited, governedService } from "./governed";

let env: Awaited<ReturnType<typeof governedService>>;
afterEach(() => env?.cleanup());

const partialRefunds = () => [
  {
    op: "modify" as const,
    id: "action.issue-refund",
    content: edited(
      "actions/issue-refund.md",
      "description: Refund all or part of a delivered order to the original payment method.",
      "description: Refund all or part of a delivered order to the original payment method. Agents may give partial refunds for damaged items.",
    ),
  },
  {
    op: "add" as const,
    id: "rule.partial-refunds",
    content:
      "---\nid: rule.partial-refunds\nkind: BusinessRule\ntitle: Partial refunds for damaged items\nstatement: Agents may refund part of an order when some items are damaged.\npart-of: [capability.returns]\nenforced-on: [action.issue-refund]\nenforcement: {kb-layer: false}\n---\n",
  },
];

describe("impact analysis", () => {
  it("a partial-refunds delta reports the clawback rule, the nightly finance job and the refund email, each with its path", async () => {
    env = await governedService();
    const { delta_id } = await env.service.propose_delta(casey, { title: "Allow partial refunds", rationale: "Damaged items", changes: partialRefunds() });
    const report = await env.service.analyze_impact(casey, { delta_id });
    expect(report.changed).toEqual(["action.issue-refund", "rule.partial-refunds"]);
    const byId = new Map(report.impacted.map((i) => [i.id, i]));
    expect(byId.get("rule.loyalty-clawback")?.path).toEqual(["action.issue-refund", "<- enforced-on", "rule.loyalty-clawback"]);
    expect(byId.get("job.nightly-finance")?.path).toEqual([
      "action.issue-refund",
      "<- enforced-on",
      "rule.single-refund-per-order",
      "<- depends-on",
      "job.nightly-finance",
    ]);
    expect(byId.get("interface.refund-email")?.path).toEqual(["action.issue-refund", "-> notifies", "interface.refund-email"]);
    // The described legacy ERP is in the impact even though the platform does not operate it.
    expect(byId.get("component.legacy-erp")?.mode).toBe("described");
    // Ranked by risk, highest first, and every risk is in 0..1.
    const risks = report.impacted.map((i) => i.risk);
    expect([...risks].sort((a, b) => b - a)).toEqual(risks);
    expect(risks.every((r) => r > 0 && r <= 1)).toBe(true);
    expect(report.impacted.some((i) => report.changed.includes(i.id))).toBe(false);
  });

  it("is deterministic", async () => {
    env = await governedService();
    const { delta_id } = await env.service.propose_delta(casey, { title: "Allow partial refunds", rationale: "x", changes: partialRefunds() });
    const first = await env.service.analyze_impact(casey, { delta_id });
    const second = await env.service.analyze_impact(casey, { delta_id });
    expect(second).toEqual(first);
  });

  it("counts links that a delta removes", async () => {
    env = await governedService();
    const { delta_id } = await env.service.propose_delta(casey, {
      title: "Stop notifying",
      rationale: "x",
      changes: [{ op: "modify", id: "action.issue-refund", content: edited("actions/issue-refund.md", "notifies: [interface.refund-email]\n", "") }],
    });
    const report = await env.service.analyze_impact(casey, { delta_id });
    expect(report.impacted.map((i) => i.id)).toContain("interface.refund-email");
  });
});
