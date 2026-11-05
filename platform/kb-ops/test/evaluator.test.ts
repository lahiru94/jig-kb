import { describe, expect, it } from "vitest";
import { CedarEngine, DirectoryKbSource, decide, resourceFor, type EvaluationRequest } from "../src/index";
import { MemoryDeltas, SAMPLE_KB } from "./helpers";

const view = new DirectoryKbSource(SAMPLE_KB, new MemoryDeltas()).current();
const engine = new CedarEngine();

const facts = {
  via_agent: true,
  order_id: "ord-1",
  amount_cents: 20000,
  order_status: "delivered",
  order_total_cents: 20000,
  customer_id: "cus-1",
  delivered_at: "2026-10-01T10:00:00Z",
  customer_tier: "standard",
  clawback_applies: true,
  prior_refund_count: 0,
  days_since_delivery: 10,
  refund_window_days: 30,
  is_partial: false,
};

function refund(context: Partial<typeof facts>, principal = "actor.casey"): EvaluationRequest {
  const merged = { ...facts, ...context };
  return { principal, action: "action.issue-refund", resource: resourceFor(view, "action.issue-refund", merged), context: merged };
}

describe("decision evaluation (Cedar adapter + decision assembly)", () => {
  it("level 1: a permitted user, with no rule holding the request", () => {
    expect(decide(engine, view, refund({}))).toEqual({ level: 1, reasons: [] });
  });

  it("level 2: a rule needs a human, with its plain-language reason and statement", () => {
    const decision = decide(engine, view, refund({ amount_cents: 80000, order_total_cents: 80000 }));
    expect(decision.level).toBe(2);
    expect(decision.reasons).toEqual([
      {
        source: "rule.refund-approval-limit",
        kind: "rule",
        level: 2,
        reason: "Refunds over $500 need a supervisor's approval.",
        statement: "Refunds over $500 need a supervisor's approval.",
      },
    ]);
  });

  it("level 3: a forbidding rule wins over a level 2 rule", () => {
    const decision = decide(engine, view, refund({ amount_cents: 80000, order_total_cents: 80000, days_since_delivery: 50 }));
    expect(decision.level).toBe(3);
    expect(decision.reasons.map((r) => [r.source, r.level])).toEqual([
      ["rule.refund-approval-limit", 2],
      ["rule.refund-window", 3],
    ]);
  });

  it("level 2 from two rules at once: a partial refund on a recent order that already had a refund", () => {
    const decision = decide(engine, view, refund({ amount_cents: 5000, is_partial: true, prior_refund_count: 1 }));
    expect(decision.level).toBe(2);
    expect(decision.reasons.map((r) => r.source).sort()).toEqual(["rule.loyalty-clawback", "rule.single-refund-per-order"]);
  });

  it("level 3 by default when no permission declaration applies to the user", () => {
    const decision = decide(engine, view, refund({}, "actor.sam"));
    expect(decision).toEqual({
      level: 3,
      reasons: [{ source: "action.issue-refund", kind: "default", level: 3, reason: "No permission declaration lets actor.sam do action.issue-refund." }],
    });
    expect(decide(engine, view, refund({}, "actor.nobody")).level).toBe(3);
  });

  it("fails closed at level 3 when a rule cannot be evaluated because a fact is missing", () => {
    const request = refund({});
    delete (request.context as Record<string, unknown>).days_since_delivery;
    const decision = decide(engine, view, request);
    expect(decision.level).toBe(3);
    expect(decision.reasons.some((r) => r.source === "rule.refund-window" && r.reason.startsWith("Could not evaluate"))).toBe(true);
  });

  it("evaluates KB operation permissions, taking the most permissive matching declaration", () => {
    const op = (principal: string, context: Record<string, unknown>): EvaluationRequest => ({
      principal,
      action: "kb.apply-delta",
      resource: { type: "KbObject", id: "delta-1" },
      context: { via_agent: false, ...context },
    });
    expect(decide(engine, view, op("actor.alex", { change_scope: "structure" })).level).toBe(2);
    expect(decide(engine, view, op("actor.alex", { change_scope: "wording" })).level).toBe(1);
    expect(decide(engine, view, op("actor.sam", { change_scope: "wording" })).level).toBe(1);
    expect(decide(engine, view, op("actor.sam", { change_scope: "structure" })).level).toBe(3);
    const guardrail = decide(engine, view, op("actor.sam", { change_scope: "wording", changes_guardrails: true }));
    expect(guardrail.level).toBe(2);
    expect(guardrail.reasons[0]?.source).toBe("policy.agents-cannot-change-permissions");
  });

  it("identifies the resource by the action's resource entity identity", () => {
    expect(resourceFor(view, "action.issue-refund", { order_id: "ord-9" })).toEqual({ type: "Order", id: "ord-9" });
  });
});
