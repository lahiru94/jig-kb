import { afterEach, describe, expect, it } from "vitest";
import { alex, casey, edited, governedService } from "./governed";

let env: Awaited<ReturnType<typeof governedService>>;
afterEach(() => env?.cleanup());

describe("applying a delta", () => {
  it("is a merge commit recording approvers and the simulation, and earlier versions stay readable", async () => {
    env = await governedService();
    const before = env.repo.head();
    const content = edited("rules/refund-approval-limit.md", "statement: Refunds over $500 need a supervisor's approval.", "statement: Refunds over $800 need a supervisor's approval.").replace(
      "context.amount_cents > 50000",
      "context.amount_cents > 80000",
    );
    const { delta_id } = await env.service.propose_delta(casey, {
      title: "Raise the approval limit to $800",
      rationale: "Supervisors approve 96% of refunds over $500",
      changes: [{ op: "modify", id: "rule.refund-approval-limit", content }],
    });
    await env.service.simulate(casey, { delta_id });
    await env.service.propose_delta(casey, { delta_id, propose: true });
    await env.service.approve(alex, { request_id: delta_id, approve: true });

    const [merge] = env.repo.log();
    const record = env.store.record(delta_id);
    expect(merge?.commit).toBe(record?.applied_commit);
    expect(merge?.parents).toEqual([before, record?.head]);
    expect(merge?.message).toContain("Approved-by: actor.alex");
    expect(merge?.message).toContain(`Simulation: sim-${delta_id}-1`);
    expect(merge?.message).toContain("Proposed-by: actor.casey");
    expect(env.repo.isDirty()).toBe(false);

    const now = await env.service.query(casey, { focus: "rule.refund-approval-limit", depth: 0 });
    expect(now.nodes[0]?.data.statement).toBe("Refunds over $800 need a supervisor's approval.");
    const then = await env.service.query(casey, { focus: "rule.refund-approval-limit", depth: 0, as_of: before });
    expect(then.nodes[0]?.data.statement).toBe("Refunds over $500 need a supervisor's approval.");
    const rules = await env.service.query(casey, { kind: "BusinessRule", focus: "capability.returns", direction: "in", link_types: ["part-of"], as_of: before });
    expect(rules.nodes.map((n) => n.id)).toContain("rule.refund-approval-limit");
  });

  it("refuses to apply a delta that became invalid after main moved on", async () => {
    env = await governedService();
    const { delta_id } = await env.service.propose_delta(casey, {
      title: "Link the job to the email",
      rationale: "x",
      changes: [{ op: "modify", id: "job.nightly-finance", content: edited("jobs/nightly-finance.md", "depends-on: [rule.single-refund-per-order, interface.erp-postings]", "depends-on: [rule.single-refund-per-order, interface.erp-postings, interface.refund-email]") }],
      propose: true,
    });
    // Main moves on: another change removes the interface this delta links to.
    const head = env.repo.head();
    const moved = env.repo.commitChanges(head, [head], [
      { op: "remove", id: "interface.refund-email" },
      { op: "modify", id: "action.issue-refund", content: edited("actions/issue-refund.md", "notifies: [interface.refund-email]\n", "") },
      { op: "modify", id: "component.notifications-service", content: edited("components/notifications-service.md", "notifies: [interface.refund-email]\n", "") },
    ], "Remove the refund email");
    env.repo.advanceMain(moved);
    await expect(env.service.approve(alex, { request_id: delta_id, approve: true })).rejects.toThrow("would make the KB invalid");
    expect(env.store.record(delta_id)?.status).toBe("proposed");
  });
});
