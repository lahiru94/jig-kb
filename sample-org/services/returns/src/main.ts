import { PORTS, call, createService, db, DAY_MS, HttpError, migrate, newId, requireString, type Json } from "@sample/shared";

await migrate(
  "returns",
  `CREATE TABLE IF NOT EXISTS returns.refunds (
     refund_id TEXT PRIMARY KEY,
     order_id TEXT NOT NULL,
     customer_id TEXT NOT NULL,
     type TEXT NOT NULL,
     amount_cents INTEGER NOT NULL,
     reason TEXT,
     status TEXT NOT NULL,
     requested_at TIMESTAMPTZ NOT NULL,
     completed_at TIMESTAMPTZ,
     approved_by TEXT
   );`,
);

// Refunds above this amount wait for a supervisor.
const APPROVAL_LIMIT_CENTS = 50000;

function windowDays(tier: string): number {
  return tier === "gold" ? 45 : 30;
}

async function getRefund(refundId: string): Promise<Json> {
  const { rows } = await db().query("SELECT * FROM returns.refunds WHERE refund_id = $1", [refundId]);
  if (rows.length === 0) throw new HttpError(404, `refund ${refundId} not found`);
  return rows[0] as Json;
}

async function complete(refund: Json): Promise<Json> {
  const orderId = refund.order_id as string;
  const amount = refund.amount_cents as number;
  await call("payments", "POST", `/payments/${orderId}/refunds`, { amount_cents: amount, refund_id: refund.refund_id });
  await call("loyalty", "POST", "/clawback", { order_id: orderId });
  await call("legacy-erp", "POST", "/postings", { order_id: orderId, kind: "refund", amount_cents: amount, at: new Date().toISOString() });
  await call("notifications", "POST", "/notify", {
    customer_id: refund.customer_id,
    template: "refund_completed",
    vars: { order_id: orderId, amount: `$${(amount / 100).toFixed(2)}` },
  });
  await db().query("UPDATE returns.refunds SET status = 'completed', completed_at = now() WHERE refund_id = $1", [refund.refund_id]);
  return getRefund(refund.refund_id as string);
}

await createService("returns", {
  "POST /refunds": async ({ body }) => {
    const orderId = requireString(body, "order_id");
    const order = await call<Json>("orders", "GET", `/orders/${orderId}`);
    if (order.status !== "delivered" || typeof order.delivered_at !== "string") throw new HttpError(409, `order ${orderId} has not been delivered`);
    const acct = await call<Json>("loyalty", "GET", `/accounts/${String(order.customer_id)}`);
    const requestedAt = typeof body.requested_at === "string" ? new Date(body.requested_at) : new Date();
    const ageDays = Math.floor((requestedAt.getTime() - new Date(order.delivered_at).getTime()) / DAY_MS);
    if (ageDays > windowDays(String(acct.tier))) throw new HttpError(409, `order ${orderId} is outside the refund window`);
    const total = order.total_cents as number;
    const amount = typeof body.amount_cents === "number" ? body.amount_cents : total;
    const refundId = newId("rfd");
    await db().query(
      `INSERT INTO returns.refunds (refund_id, order_id, customer_id, type, amount_cents, reason, status, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'requested', $7)`,
      [refundId, orderId, order.customer_id, amount < total ? "partial" : "full", amount, body.reason ?? null, requestedAt.toISOString()],
    );
    const refund = await getRefund(refundId);
    if (amount > APPROVAL_LIMIT_CENTS) {
      await db().query("UPDATE returns.refunds SET status = 'pending_approval' WHERE refund_id = $1", [refundId]);
      return getRefund(refundId);
    }
    return complete(refund);
  },
  "POST /refunds/:refund_id/approve": async ({ params, body }) => {
    const refund = await getRefund(params.refund_id ?? "");
    if (refund.status !== "pending_approval") throw new HttpError(409, `refund ${params.refund_id} is ${String(refund.status)}`);
    await db().query("UPDATE returns.refunds SET approved_by = $2 WHERE refund_id = $1", [refund.refund_id, requireString(body, "approved_by")]);
    return complete(refund);
  },
  "GET /refunds/:refund_id": ({ params }) => getRefund(params.refund_id ?? ""),
  "GET /refunds": async ({ query }) => {
    const { rows } = await db().query("SELECT * FROM returns.refunds WHERE order_id = $1 ORDER BY requested_at", [query.get("order_id")]);
    return rows;
  },
}).listen(PORTS.returns);
console.log(`returns listening on ${PORTS.returns}`);
