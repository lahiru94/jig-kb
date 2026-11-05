import { Environment } from "@marcbachmann/cel-js";
import { describe, expect, it } from "vitest";

// Spike for task 1.3: confirms @marcbachmann/cel-js meets the D7 derivation criteria.
function derivationEnv(): Environment {
  return new Environment()
    .registerVariable("delivered_at", "google.protobuf.Timestamp")
    .registerVariable("evaluated_at", "google.protobuf.Timestamp")
    .registerVariable("refund_count", "int")
    .registerVariable("customer_tier", "string")
    .registerVariable("order_total", "double");
}

describe("CEL spike (@marcbachmann/cel-js)", () => {
  const facts = {
    delivered_at: new Date("2026-09-01T10:00:00Z"),
    evaluated_at: new Date("2026-10-09T10:00:00Z"),
    refund_count: 2n,
    customer_tier: "gold",
    order_total: 120.5,
  };

  it("derives days_since_delivery from timestamps as an integer", () => {
    const expr = "(evaluated_at - delivered_at).getHours() / 24";
    const env = derivationEnv();
    expect(env.check(expr).valid).toBe(true);
    expect(env.evaluate(expr, facts)).toBe(38n);
  });

  it("derives integer and string facts", () => {
    const env = derivationEnv();
    expect(env.evaluate("refund_count + 1", facts)).toBe(3n);
    expect(env.evaluate('customer_tier in ["gold", "platinum"]', facts)).toBe(true);
    expect(env.evaluate("order_total > 100.0", facts)).toBe(true);
  });

  it("type-checks expressions before evaluation", () => {
    const env = derivationEnv();
    const bad = env.check("refund_count + customer_tier");
    expect(bad.valid).toBe(false);
    expect(env.check("undeclared_fact > 1").valid).toBe(false);
  });

  it("is deterministic: same facts give the same result, and there is no ambient clock", () => {
    const env = derivationEnv();
    const expr = "evaluated_at - delivered_at";
    expect(String(env.evaluate(expr, facts))).toBe(String(env.evaluate(expr, facts)));
    expect(env.check("now()").valid).toBe(false);
  });
});
