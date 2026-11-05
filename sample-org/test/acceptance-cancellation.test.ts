import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { casey, governedService } from "../../platform/kb-ops/test/governed";
import { SAMPLE_KB } from "../../platform/kb-ops/test/helpers";
import { findViolations } from "../../scripts/check-capability-agnostic";

/**
 * Platform acceptance test (task 10.2): order cancellation is a second capability defined only in KB files
 * and bindings. The platform runs act, query, propose_delta, analyze_impact and simulate for it with no
 * platform code that knows about it.
 */
let env: Awaited<ReturnType<typeof governedService>>;
afterEach(() => env?.cleanup());

const NOW = "2026-10-20T12:00:00.000Z";

describe("order cancellation runs on the platform from KB data alone", () => {
  it("the platform source does not mention cancellation", () => {
    const root = new URL("../..", import.meta.url).pathname;
    expect(findViolations(root, ["cancellation", "cancel-order", "cancel_order", "ordercancel"])).toEqual([]);
  });

  it("act: cancels a recent order, holds an old one for a supervisor, refuses a delivered one", async () => {
    env = await governedService(NOW);
    env.systems.addOrder({ order_id: "ord-new", status: "placed", placed_at: "2026-10-20T08:00:00.000Z", delivered_at: null });
    env.systems.addOrder({ order_id: "ord-old", status: "placed", placed_at: "2026-10-18T08:00:00.000Z", delivered_at: null });
    env.systems.addOrder({ order_id: "ord-done", status: "delivered" });

    const recent = await env.service.act(casey, { action: "action.cancel-order", inputs: { order_id: "ord-new" } });
    expect(recent.status).toBe("executed");
    expect(recent.facts).toMatchObject({ order_status: "placed", hours_since_placed: 4 });
    expect(recent.steps.map((s) => [s.name, s.status])).toEqual([
      ["cancel-order", "ok"],
      ["stop-shipment", "ok"],
      ["notify-customer", "ok"],
    ]);
    expect(env.systems.orders.get("ord-new")?.status).toBe("cancelled");

    const old = await env.service.act(casey, { action: "action.cancel-order", inputs: { order_id: "ord-old" } });
    expect(old.status).toBe("queued");
    expect(old.decision.reasons.map((r) => r.source)).toEqual(["rule.cancellation-window"]);
    const approved = await env.service.approve({ user: "actor.morgan", viaAgent: false }, { request_id: old.request_id, approve: true });
    expect(approved.status).toBe("executed");

    const delivered = await env.service.act(casey, { action: "action.cancel-order", inputs: { order_id: "ord-done" } });
    expect(delivered.status).toBe("denied");
    // Delivered weeks ago, so the 24-hour rule also applies; the forbidding rule wins.
    expect(delivered.decision.level).toBe(3);
    expect(delivered.decision.reasons.map((r) => [r.source, r.level])).toEqual([
      ["rule.cancel-before-delivery", 3],
      ["rule.cancellation-window", 2],
    ]);
    expect(env.systems.orders.get("ord-done")?.status).toBe("delivered");
  });

  it("query: the ordering capability, its action and its rules", async () => {
    env = await governedService(NOW);
    const result = await env.service.query(casey, { focus: "action.cancel-order", direction: "in", link_types: ["enforced-on"], kind: "BusinessRule" });
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["rule.cancel-before-delivery", "rule.cancellation-window"]);
  });

  it("propose_delta, analyze_impact and simulate: widening the cancellation window", async () => {
    env = await governedService(NOW);
    for (const [id, placed] of [
      ["ord-a", "2026-10-15T08:00:00.000Z"],
      ["ord-b", "2026-10-16T08:00:00.000Z"],
    ] as const) {
      env.setNow(new Date(Date.parse(placed) + 30 * 3_600_000).toISOString());
      env.systems.addOrder({ order_id: id, status: "placed", placed_at: placed, delivered_at: null });
      await env.service.act(casey, { action: "action.cancel-order", inputs: { order_id: id } });
    }
    env.setNow(NOW);
    const content = readFileSync(`${SAMPLE_KB}/rules/cancellation-window.md`, "utf8").replace("context.hours_since_placed > 24", "context.hours_since_placed > 48");
    const { delta_id } = await env.service.propose_delta(casey, {
      title: "Let agents cancel orders up to 48 hours old",
      rationale: "Warehouse picks after 48 hours",
      changes: [{ op: "modify", id: "rule.cancellation-window", content }],
    });
    const impact = await env.service.analyze_impact(casey, { delta_id });
    expect(impact.impacted.map((i) => i.id)).toContain("action.cancel-order");
    const report = await env.service.simulate(casey, { delta_id, window_days: 30 });
    expect(report).toMatchObject({ replayed: 2, changed: 2, by_outcome: { "2->1": 2 } });
    const proposed = await env.service.propose_delta(casey, { delta_id, propose: true });
    expect(proposed.status).toBe("proposed");
  });
});
