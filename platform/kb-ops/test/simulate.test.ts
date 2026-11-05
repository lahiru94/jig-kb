import { afterEach, describe, expect, it } from "vitest";
import { casey, edited, governedService } from "./governed";

let env: Awaited<ReturnType<typeof governedService>>;
afterEach(() => env?.cleanup());

const raiseLimit = () => [
  {
    op: "modify" as const,
    id: "rule.refund-approval-limit",
    content: edited("rules/refund-approval-limit.md", "when { context.amount_cents > 50000 };", "when { context.amount_cents > 80000 };")
      .replace("statement: Refunds over $500 need a supervisor's approval.", "statement: Refunds over $800 need a supervisor's approval.")
      .replace('@reason("Refunds over $500 need a supervisor\'s approval.")', '@reason("Refunds over $800 need a supervisor\'s approval.")'),
  },
];

async function seedRequests() {
  const amounts = [30000, 60000, 70000, 75000, 90000];
  for (const [i, amount] of amounts.entries()) {
    env.setNow(`2026-10-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`);
    env.systems.addOrder({ order_id: `ord-${i}`, total_cents: amount, delivered_at: "2026-10-05T10:00:00.000Z" });
    await env.service.act(casey, { action: "action.issue-refund", inputs: { order_id: `ord-${i}`, amount_cents: amount } });
  }
  // A request recorded without its raw facts (for example from before facts were recorded).
  env.audit.recordCall({
    request_id: "req-legacy",
    at: "2026-10-16T10:00:00.000Z",
    principal: "actor.casey",
    via_agent: false,
    operation: "act",
    target: "action.issue-refund",
    inputs: { action: "action.issue-refund", inputs: { order_id: "ord-legacy", amount_cents: 65000 } },
    kb_version: null,
    raw_facts: null,
    context: { evaluated_at: "2026-10-16T10:00:00.000Z" },
    decision: { level: 2, reasons: [] },
    outcome: "queued",
    error: null,
  });
}

describe("replay simulation", () => {
  it("replays past refund requests against a raised approval limit and reports the changed decisions", async () => {
    env = await governedService();
    await seedRequests();
    env.setNow("2026-10-20T09:00:00.000Z");
    const { delta_id } = await env.service.propose_delta(casey, { title: "Raise the approval limit to $800", rationale: "Overrides", changes: raiseLimit() });
    const report = await env.service.simulate(casey, { delta_id, window_days: 30 });
    expect(report).toMatchObject({
      delta_id,
      window: { from: "2026-09-20T09:00:00.000Z", to: "2026-10-20T09:00:00.000Z" },
      replayed: 5,
      changed: 3,
      insufficient_facts: 1,
      by_outcome: { "1->1": 1, "2->1": 3, "2->2": 1 },
    });
    expect(report.examples.map((e) => [e.before, e.after])).toEqual([
      [2, 1],
      [2, 1],
      [2, 1],
    ]);
    expect(env.store.record(delta_id)?.simulation_id).toBe(`sim-${delta_id}-1`);
    expect(env.store.simulation(`sim-${delta_id}-1`)).toMatchObject({ changed: 3 });
  });

  it("gives identical reports for identical runs, and calls no system", async () => {
    env = await governedService();
    await seedRequests();
    env.setNow("2026-10-20T09:00:00.000Z");
    const { delta_id } = await env.service.propose_delta(casey, { title: "Raise the limit", rationale: "x", changes: raiseLimit() });
    const callsBefore = env.systems.calls.length;
    const first = await env.service.simulate(casey, { delta_id });
    const second = await env.service.simulate(casey, { delta_id });
    expect(second).toEqual(first);
    expect(env.systems.calls.length).toBe(callsBefore);
  });

  it("only replays requests inside the window", async () => {
    env = await governedService();
    await seedRequests();
    env.setNow("2026-10-20T09:00:00.000Z");
    const { delta_id } = await env.service.propose_delta(casey, { title: "Raise the limit", rationale: "x", changes: raiseLimit() });
    const report = await env.service.simulate(casey, { delta_id, window_days: 7 });
    // From 2026-10-13T09:00: the requests on the 13th and 14th, and the legacy one on the 16th.
    expect(report.replayed + report.insufficient_facts).toBe(3);
  });
});
