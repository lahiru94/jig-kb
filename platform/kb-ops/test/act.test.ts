import { loadKb } from "@jig/kb-core";
import { describe, expect, it } from "vitest";
import { AuditLog, KbService, OperationError, buildView, type KbSource } from "../src/index";
import { FakeSystems } from "./fake-systems";
import { SAMPLE_KB } from "./helpers";

const AT = "2026-10-15T12:00:00.000Z";
const agentCasey = { user: "actor.casey", viaAgent: true };
const morgan = { user: "actor.morgan", viaAgent: false };

async function setup(options: { mode?: string } = {}) {
  let nodes = loadKb(SAMPLE_KB).nodes;
  if (options.mode) {
    nodes = nodes.map((n) => (n.id === "action.issue-refund" ? { ...n, data: { ...n.data, mode: options.mode } } : n));
  }
  const view = buildView("v1", nodes);
  const kb: KbSource = { current: () => view, asOf: () => undefined };
  const systems = new FakeSystems();
  const audit = await AuditLog.open();
  let seq = 0;
  const service = new KbService({ kb, audit, executor: systems.executor(), now: () => new Date(AT), newId: (p) => `${p}-${++seq}` });
  return { service, systems, audit };
}

describe("act: fact gathering and decisions", () => {
  it("gathers facts through registered bindings and records the raw responses", async () => {
    const { service, systems, audit } = await setup();
    systems.addOrder({ order_id: "ord-1", total_cents: 20000 });
    const result = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-1", amount_cents: 20000 } });
    expect(result.status).toBe("executed");
    expect(result.facts).toMatchObject({ order_status: "delivered", days_since_delivery: 14, refund_window_days: 30, is_partial: false, prior_refund_count: 0 });
    const [call] = audit.calls({ operation: "act" });
    const raw = (call?.raw_facts as { calls: Array<{ binding: string }> }).calls.map((c) => c.binding);
    expect(raw).toEqual(["binding.get-order", "binding.get-loyalty-account", "binding.get-order-points", "binding.count-order-refunds"]);
    expect(call?.context).toEqual({ evaluated_at: AT });
    expect(call?.outcome).toBe("executed");
  });

  it("rejects act on an action in described mode", async () => {
    const { service, systems } = await setup({ mode: "described" });
    systems.addOrder({ order_id: "ord-1" });
    const error = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-1", amount_cents: 100 } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OperationError);
    expect((error as OperationError).code).toBe("not_operable");
    expect((error as OperationError).message).toContain("is not operable");
    expect(systems.calls).toEqual([]);
  });

  it("refuses an action whose inputs do not match the declaration, before calling any system", async () => {
    const { service, systems } = await setup();
    await expect(service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-1" } })).rejects.toThrow("requires input 'amount_cents'");
    expect(systems.calls).toEqual([]);
  });
});

describe("act: the pipeline end to end", () => {
  it("the loyalty clawback rule holds a partial refund, and no system is changed", async () => {
    const { service, systems } = await setup();
    systems.addOrder({ order_id: "ord-2", total_cents: 64900 });
    const result = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-2", amount_cents: 20000 } });
    expect(result.status).toBe("queued");
    expect(result.decision.level).toBe(2);
    expect(result.decision.reasons).toEqual([
      expect.objectContaining({
        source: "rule.loyalty-clawback",
        kind: "rule",
        statement: expect.stringContaining("claws back all the loyalty points"),
      }),
    ]);
    expect(systems.mutatingCalls()).toEqual([]);
    expect(systems.refunds).toEqual([]);
  });

  it("a forbidding rule stops the request outright, and no system is changed", async () => {
    const { service, systems } = await setup();
    systems.addOrder({ order_id: "ord-3", delivered_at: "2026-08-01T10:00:00.000Z" });
    const result = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-3", amount_cents: 20000 } });
    expect(result.status).toBe("denied");
    expect(result.decision.reasons.map((r) => r.source)).toEqual(["rule.refund-window"]);
    expect(systems.mutatingCalls()).toEqual([]);
  });
});

describe("level 2 approval queue", () => {
  it("the logged-in approver's approval from a view executes the queued action and records an override", async () => {
    const { service, systems, audit } = await setup();
    systems.addOrder({ order_id: "ord-4", total_cents: 80000 });
    const queued = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-4", amount_cents: 80000 } });
    expect(queued.status).toBe("queued");
    expect(service.actions.pending().map((p) => p.requestId)).toEqual([queued.request_id]);

    const approved = await service.approve(morgan, { request_id: queued.request_id, approve: true });
    expect(approved.status).toBe("executed");
    expect(systems.refunds).toEqual([{ refund_id: queued.request_id, order_id: "ord-4", amount_cents: 80000 }]);
    expect(audit.approvals(queued.request_id)).toEqual([expect.objectContaining({ approver: "actor.morgan", approved: true, override: true })]);
    expect(audit.outcomes(queued.request_id)[0]?.status).toBe("executed");
    expect(service.actions.pending()).toEqual([]);
  });

  it("denies the agent's own approve call and keeps the request queued", async () => {
    const { service, systems } = await setup();
    systems.addOrder({ order_id: "ord-5", total_cents: 80000 });
    const queued = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-5", amount_cents: 80000 } });
    for (const principal of [agentCasey, { user: "actor.morgan", viaAgent: true }]) {
      const error = await service.approve(principal, { request_id: queued.request_id, approve: true }).catch((e: unknown) => e);
      expect((error as OperationError).code).toBe("denied");
    }
    expect(service.actions.pending()).toHaveLength(1);
    expect(systems.mutatingCalls()).toEqual([]);
  });

  it("records a rejection and does not execute", async () => {
    const { service, systems, audit } = await setup();
    systems.addOrder({ order_id: "ord-6", total_cents: 80000 });
    const queued = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-6", amount_cents: 80000 } });
    const rejected = await service.approve(morgan, { request_id: queued.request_id, approve: false, comment: "suspicious" });
    expect(rejected.status).toBe("rejected");
    expect(audit.approvals(queued.request_id)[0]).toMatchObject({ approved: false, comment: "suspicious" });
    expect(systems.mutatingCalls()).toEqual([]);
  });

  it("refuses approval from a person without permission", async () => {
    const { service, systems } = await setup();
    systems.addOrder({ order_id: "ord-7", total_cents: 80000 });
    const queued = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-7", amount_cents: 80000 } });
    const error = await service.approve({ user: "actor.casey", viaAgent: false }, { request_id: queued.request_id, approve: true }).catch((e: unknown) => e);
    expect((error as OperationError).code).toBe("denied");
  });
});

describe("multi-step execution with compensation", () => {
  it("a failed loyalty step triggers payment compensation and records each step's outcome", async () => {
    const { service, systems, audit } = await setup();
    systems.addOrder({ order_id: "ord-8", total_cents: 20000 });
    systems.failing.add("POST /clawback");
    const result = await service.act(agentCasey, { action: "action.issue-refund", inputs: { order_id: "ord-8", amount_cents: 20000 } });
    expect(result.status).toBe("failed");
    expect(result.steps.map((s) => [s.name, s.status])).toEqual([
      ["refund-payment", "compensated"],
      ["clawback-points", "failed"],
      ["post-to-erp", "skipped"],
      ["notify-customer", "skipped"],
    ]);
    expect(systems.refunds).toEqual([]);
    const posts = systems.mutatingCalls().map((c) => c.path);
    expect(posts).toEqual(["/payments/ord-8/refunds", "/clawback", `/payments/ord-8/refunds/${result.request_id}/reverse`]);
    expect(audit.outcomes(result.request_id)[0]?.status).toBe("failed");
  });
});
