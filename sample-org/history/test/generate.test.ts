import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, generateHistory, overrideRate } from "../src/generate";

describe("history seed generator", () => {
  it("produces identical data for the same seed", () => {
    expect(JSON.stringify(generateHistory())).toBe(JSON.stringify(generateHistory()));
  });

  it("produces different data for a different seed", () => {
    expect(JSON.stringify(generateHistory({ ...DEFAULT_OPTIONS, seed: 7 }))).not.toBe(JSON.stringify(generateHistory()));
  });

  it("shows humans overriding the refund approval limit more than 80 percent of the time", () => {
    const history = generateHistory();
    const { held, rate } = overrideRate(history, "rule.refund-approval-limit");
    expect(held).toBeGreaterThanOrEqual(20);
    expect(rate).toBeGreaterThan(0.8);
  });

  it("keeps every event inside the history window and consistent", () => {
    const history = generateHistory();
    const end = new Date(DEFAULT_OPTIONS.now).getTime();
    const orders = new Map(history.orders.map((o) => [o.order_id, o]));
    for (const refund of history.refunds) {
      const order = orders.get(refund.order_id);
      expect(order).toBeDefined();
      expect(new Date(refund.requested_at).getTime()).toBeLessThan(end);
      expect(new Date(refund.requested_at).getTime()).toBeGreaterThanOrEqual(new Date(order?.delivered_at ?? 0).getTime());
    }
    expect(history.requests).toHaveLength(history.refunds.length);
    expect(history.requests.filter((r) => r.held_by === null).every((r) => r.decision.level === 1)).toBe(true);
  });
});
