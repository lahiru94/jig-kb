import { describe, expect, it } from "vitest";
import pg from "pg";
import { GitKbRepo } from "../../platform/governance/src/index";
import { AuditLog } from "../../platform/kb-ops/src/index";
import { AUDIT_FILE, KB_DIR, SEEDED_TABLES, START_TAG, reset, runtimeService, seed } from "../../scripts/demo";
import { DATABASE_URL } from "../services/shared/src/index";
import { api, deliveredOrder, stackIsUp } from "./stack";

/*
 * Every test that needs the live stack is in this one file, so they run in order: the reset tests
 * truncate the databases, which would break tests running at the same time in other files.
 */
const up = await stackIsUp();
const casey = { user: "actor.casey", viaAgent: true };
const alex = { user: "actor.alex", viaAgent: false };
const morgan = { user: "actor.morgan", viaAgent: false };

async function counts(): Promise<Record<string, number>> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const out: Record<string, number> = {};
    for (const t of SEEDED_TABLES) out[t] = Number((await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]?.n);
    return out;
  } finally {
    await client.end();
  }
}

async function auditCount(): Promise<number> {
  return (await AuditLog.open(AUDIT_FILE)).calls().length;
}

describe.skipIf(!up)("demo operations against the running stack (requires `npm run demo -- up`)", () => {
  it("reset returns the systems, data, audit log and KB to the start state", async () => {
    await seed();
    const startCounts = await counts();
    const startAudit = await auditCount();
    const repo = GitKbRepo.open(KB_DIR);
    const startHead = repo.head(START_TAG);

    // Change state everywhere: a refund through the services, a KB change, and audited calls.
    const service = await runtimeService();
    await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-00010", amount_cents: 100 } });
    const delta = await service.draftEdit(casey, "rule.refund-window", "title", "Refund request window");
    await service.propose_delta(casey, { delta_id: delta.delta_id, propose: true });
    expect(GitKbRepo.open(KB_DIR).head()).not.toBe(startHead);
    expect(await auditCount()).toBeGreaterThan(startAudit);

    await reset();
    expect(await counts()).toEqual(startCounts);
    expect(await auditCount()).toBe(startAudit);
    expect(GitKbRepo.open(KB_DIR).head()).toBe(startHead);
  }, 180_000);

  it("act gathers facts from the live payments and orders services and records the raw responses", async () => {
    await reset();
    const service = await runtimeService();
    const result = await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-00010", amount_cents: 100 } });
    const audit = await AuditLog.open(AUDIT_FILE);
    const call = audit.calls({ requestId: result.request_id })[0];
    const bindings = ((call?.raw_facts as { calls: Array<{ binding: string; response: Record<string, unknown> }> }).calls ?? []).map((c) => c.binding);
    expect(bindings).toEqual(["binding.get-order", "binding.get-loyalty-account", "binding.get-order-points", "binding.count-order-refunds"]);
    expect(result.facts.order_status).toBe("delivered");
  }, 120_000);

  it("the full demo cycle on refunds, from a fresh reset", async () => {
    await reset();
    const service = await runtimeService();
    // A recent, delivered order for a partial refund.
    const customer = "cus-demo";
    await api("storefront", "POST", "/signup", { customer_id: customer, name: "Demo Customer", email: "demo@example.com", region: "us", tier: "standard" });
    const order = await api("storefront", "POST", "/checkout", { customer_id: customer, order_id: "ord-demo", lines: [{ sku: "KAYAK-1P", qty: 1, price_cents: 89900 }] });
    await api("warehouse", "POST", "/shipments/ord-demo/deliver", {});

    // 1. The agent asks for a partial refund; the clawback and approval-limit rules hold it.
    const held = await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-demo", amount_cents: 60000 } });
    expect(held.status).toBe("queued");
    expect(held.decision.reasons.map((r) => r.source).sort()).toEqual(["rule.loyalty-clawback", "rule.refund-approval-limit"]);

    // 2. A supervisor approves the exception from the approval card.
    const approved = await service.approve(morgan, { request_id: held.request_id, approve: true });
    expect(approved.status).toBe("executed");

    // 3. The evidence evaluator proposes reviewing the approval limit.
    const { drafted } = service.evaluateEvidence();
    const proposal = drafted.find((d) => d.evidence?.rule === "rule.refund-approval-limit");
    expect(proposal?.assigned_to).toBe("role.head-of-cs");

    // 4. The agent drafts the change; impact and replay show what it would do.
    const file = service.nodeFile("rule.refund-approval-limit") ?? "";
    await service.propose_delta(casey, {
      delta_id: proposal?.id,
      changes: [{ op: "modify", id: "rule.refund-approval-limit", content: file.replace("context.amount_cents > 50000", "context.amount_cents > 80000") }],
    });
    const impact = await service.analyze_impact(casey, { delta_id: proposal?.id ?? "" });
    expect(impact.impacted.map((i) => i.id)).toContain("action.issue-refund");
    const replay = await service.simulate(casey, { delta_id: proposal?.id ?? "", window_days: 120 });
    expect(replay.by_outcome["2->1"]).toBeGreaterThan(0);

    // 5. The Head of Customer Service approves the change.
    await service.propose_delta(casey, { delta_id: proposal?.id ?? "", propose: true });
    expect((await service.approve(alex, { request_id: proposal?.id ?? "", approve: true })).status).toBe("applied");

    // 6. A full refund between $500 and $800 now goes through without approval.
    const second = await api("storefront", "POST", "/checkout", { customer_id: customer, order_id: "ord-demo-2", lines: [{ sku: "PADDLEBOARD", qty: 1, price_cents: 69900 }] });
    await api("warehouse", "POST", "/shipments/ord-demo-2/deliver", {});
    const retry = await service.act(casey, { action: "action.issue-refund", inputs: { order_id: "ord-demo-2", amount_cents: Number(second.total_cents) } });
    expect(retry.status).toBe("executed");
    expect(Number(order.total_cents)).toBeGreaterThan(0);
  }, 240_000);
});

describe.skipIf(!up)("sample retailer services (requires `npm run demo -- up`)", () => {
  it("places, delivers and fully refunds an order end to end", async () => {
    const { customerId, orderId, totalCents } = await deliveredOrder({ priceCents: 10000 });
    const order = await api("orders", "GET", `/orders/${orderId}`);
    expect(order.status).toBe("delivered");

    const refund = await api("returns", "POST", "/refunds", { order_id: orderId, reason: "damaged" });
    expect(refund.status).toBe("completed");
    expect(refund.type).toBe("full");
    expect(refund.amount_cents).toBe(totalCents);

    const payment = await api("payments", "GET", `/payments/${orderId}`);
    expect(payment.status).toBe("refunded");
    const points = await api("loyalty", "GET", `/orders/${orderId}/points`);
    expect(points.clawed).toBe(points.earned);
    const sent = await api<Array<{ template: string }>>("notifications", "GET", `/sent?customer_id=${customerId}`);
    expect(sent.map((s) => s.template)).toEqual(["order_confirmed", "refund_completed"]);
  }, 60_000);

  it("produces a correct nightly finance report after a single full refund", async () => {
    const { orderId, totalCents } = await deliveredOrder({ priceCents: 4000 });
    await api("returns", "POST", "/refunds", { order_id: orderId });
    const today = new Date().toISOString().slice(0, 10);
    const report = await api<{ lines: Array<{ order_id: string; sales_cents: number; refunds_cents: number; net_cents: number }> }>(
      "legacy-erp",
      "POST",
      "/jobs/nightly-finance/run",
      { date: today },
    );
    const line = report.lines.find((l) => l.order_id === orderId);
    expect(line).toEqual({ order_id: orderId, sales_cents: totalCents, refunds_cents: totalCents, net_cents: 0 });
  }, 60_000);

  it("planted: two partial refunds without the KB make the nightly finance report wrong", async () => {
    const { orderId, totalCents } = await deliveredOrder({ priceCents: 20000 });
    await api("returns", "POST", "/refunds", { order_id: orderId, amount_cents: 3000 });
    await api("returns", "POST", "/refunds", { order_id: orderId, amount_cents: 2000 });
    const payment = await api("payments", "GET", `/payments/${orderId}`);
    expect(payment.refunded_cents).toBe(5000);
    const today = new Date().toISOString().slice(0, 10);
    const report = await api<{ lines: Array<{ order_id: string; refunds_cents: number; net_cents: number }> }>("legacy-erp", "POST", "/jobs/nightly-finance/run", {
      date: today,
    });
    const line = report.lines.find((l) => l.order_id === orderId);
    // The ERP keeps one refund per order, so the second partial refund overwrites the first.
    expect(line?.refunds_cents).toBe(2000);
    expect(line?.net_cents).not.toBe(totalCents - 5000);
  }, 60_000);

  it("planted: gold members get 45 days in code, although the policy says 30", async () => {
    const delivered = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    const gold = await deliveredOrder({ tier: "gold", deliveredAt: delivered });
    const refund = await api("returns", "POST", "/refunds", { order_id: gold.orderId });
    expect(refund.status).toBe("completed");
    const standard = await deliveredOrder({ tier: "standard", deliveredAt: delivered });
    await expect(api("returns", "POST", "/refunds", { order_id: standard.orderId })).rejects.toThrow(/outside the refund window/);
  }, 60_000);

  it("planted: loyalty claws back every point on a partial refund, but only for orders after the 2025 cut-off", async () => {
    const recent = await deliveredOrder({ priceCents: 10000 });
    await api("returns", "POST", "/refunds", { order_id: recent.orderId, amount_cents: 1000 });
    const recentPoints = await api("loyalty", "GET", `/orders/${recent.orderId}/points`);
    expect(recentPoints.clawed).toBe(recentPoints.earned);

    const old = await deliveredOrder({ priceCents: 10000, placedAt: "2024-11-20T10:00:00Z", deliveredAt: new Date().toISOString() });
    await api("returns", "POST", "/refunds", { order_id: old.orderId, amount_cents: 1000 });
    const oldPoints = await api("loyalty", "GET", `/orders/${old.orderId}/points`);
    expect(oldPoints.clawed).toBe(0);
  }, 60_000);

  it("planted: marketing and finance disagree on who is an active customer", async () => {
    const { customerId } = await deliveredOrder({ priceCents: 1000 });
    const marketing = await api<string[]>("storefront", "GET", "/marketing/active-customers");
    const finance = await api<string[]>("legacy-erp", "GET", "/finance/active-customers");
    expect(finance).toContain(customerId);
    expect(marketing).not.toContain(customerId);
  }, 60_000);
});
