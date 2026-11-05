import { loadKb } from "@jig/kb-core";
import { describe, expect, it } from "vitest";
import { AuditLog, CedarEngine, KbService, buildView, reevaluate, type KbSource } from "../src/index";
import { FakeSystems } from "./fake-systems";
import { SAMPLE_KB } from "./helpers";

const AT = "2026-10-15T12:00:00.000Z";

describe("deterministic decisions", () => {
  it("re-evaluating every recorded act call against the same KB version gives the same decision", async () => {
    const view = buildView("v1", loadKb(SAMPLE_KB).nodes);
    const kb: KbSource = { current: () => view, asOf: () => undefined };
    const systems = new FakeSystems();
    const audit = await AuditLog.open();
    let seq = 0;
    const service = new KbService({ kb, audit, executor: systems.executor(), now: () => new Date(AT), newId: (p) => `${p}-${++seq}` });
    const casey = { user: "actor.casey", viaAgent: true };

    // The scenarios of tasks 5.3 to 5.5: executed, held by the clawback rule, denied by the window,
    // held by the approval limit then approved, and failed with compensation.
    systems.addOrder({ order_id: "ord-1", total_cents: 20000 });
    systems.addOrder({ order_id: "ord-2", total_cents: 64900 });
    systems.addOrder({ order_id: "ord-3", delivered_at: "2026-08-01T10:00:00.000Z" });
    systems.addOrder({ order_id: "ord-4", total_cents: 80000 }, "gold");
    systems.addOrder({ order_id: "ord-5", total_cents: 30000 });
    await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-1", amount_cents: 20000 } });
    await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-2", amount_cents: 20000 } });
    await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-3", amount_cents: 20000 } });
    const held = await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-4", amount_cents: 80000 } });
    await service.approve({ user: "actor.morgan", viaAgent: false }, { request_id: held.request_id, approve: true });
    systems.failing.add("POST /clawback");
    await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-5", amount_cents: 30000 } });

    const calls = audit.calls({ operation: "act" });
    expect(calls.map((c) => c.outcome)).toEqual(["executed", "queued", "denied", "queued", "failed"]);
    const systemCallsBefore = systems.calls.length;
    const engine = new CedarEngine();
    for (const call of calls) {
      const again = await reevaluate(engine, view, call);
      expect(again.status).toBe("ok");
      if (again.status === "ok") expect(again.decision).toEqual(call.decision);
    }
    // Replay used only recorded facts.
    expect(systems.calls.length).toBe(systemCallsBefore);
  });
});
