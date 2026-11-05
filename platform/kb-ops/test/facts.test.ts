import { describe, expect, it } from "vitest";
import { resolveTemplate } from "@jig/kb-core";
import { DirectoryKbSource, InsufficientFacts, evaluateDerivation, recordedSource, resolveFacts, type RawCall } from "../src/index";
import { MemoryDeltas, SAMPLE_KB } from "./helpers";

const view = new DirectoryKbSource(SAMPLE_KB, new MemoryDeltas()).current();
const action = view.index.get("action.issue-refund");
if (!action) throw new Error("sample KB is missing action.issue-refund");

const recorded: RawCall[] = [
  {
    binding: "binding.get-order",
    params: { order_id: "ord-1" },
    response: { order_id: "ord-1", status: "delivered", total_cents: 64900, customer_id: "cus-7", delivered_at: "2026-09-01T10:00:00.000Z" },
  },
  { binding: "binding.get-loyalty-account", params: { customer_id: "cus-7" }, response: { customer_id: "cus-7", tier: "gold", points: 1200 } },
  { binding: "binding.get-order-points", params: { order_id: "ord-1" }, response: { order_id: "ord-1", earned: 1298, clawed: 0, clawback_applies: true } },
  { binding: "binding.count-order-refunds", params: { order_id: "ord-1" }, response: { refund_count: 0 } },
];
const input = { order_id: "ord-1", amount_cents: 20000 };
const context = { evaluated_at: "2026-10-09T10:00:00.000Z" };

describe("CEL derivation layer", () => {
  it("derives days_since_delivery and the other facts from recorded raw facts", async () => {
    const { facts, raw } = await resolveFacts(view, action, input, context, recordedSource(recorded));
    expect(facts).toEqual({
      order_status: "delivered",
      order_total_cents: 64900,
      customer_id: "cus-7",
      delivered_at: "2026-09-01T10:00:00.000Z",
      customer_tier: "gold",
      clawback_applies: true,
      prior_refund_count: 0,
      days_since_delivery: 38,
      refund_window_days: 45,
      is_partial: true,
    });
    // Each distinct binding call is made once, even when several facts read from it.
    expect(raw.map((r) => r.binding)).toEqual(recorded.map((r) => r.binding));
  });

  it("is deterministic: the same recorded facts always give the same derived facts", async () => {
    const runs = await Promise.all([1, 2, 3].map(() => resolveFacts(view, action, input, context, recordedSource(recorded))));
    for (const run of runs) expect(run.facts.days_since_delivery).toBe(38);
    expect(new Set(runs.map((r) => JSON.stringify(r.facts))).size).toBe(1);
  });

  it("reports insufficient facts when a recorded call is missing", async () => {
    await expect(resolveFacts(view, action, input, context, recordedSource(recorded.slice(0, 1)))).rejects.toBeInstanceOf(InsufficientFacts);
  });

  it("evaluates a derivation on its own and refuses missing inputs", () => {
    const days = view.index.get("derivation.days-since-delivery");
    if (!days) throw new Error("missing derivation");
    expect(evaluateDerivation(days, { delivered_at: "2026-10-01T00:00:00Z", evaluated_at: "2026-10-03T23:00:00Z" })).toBe(2);
    expect(() => evaluateDerivation(days, { delivered_at: "2026-10-01T00:00:00Z" })).toThrow(InsufficientFacts);
  });

  it("resolves placeholders in nested parameter maps", () => {
    const scope = { input: { order_id: "o1" }, fact: { customer_id: "c1" }, context: {}, step: { pay: { refund_id: "r1" } } };
    expect(resolveTemplate({ a: "$input.order_id", b: { c: "$fact.customer_id" }, d: ["$step.pay.refund_id", "plain"] }, scope)).toEqual({
      a: "o1",
      b: { c: "c1" },
      d: ["r1", "plain"],
    });
  });
});
