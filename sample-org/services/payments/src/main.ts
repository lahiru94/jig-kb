import { PORTS, createService, db, HttpError, migrate, newId, requireInt, requireString, type Json } from "@sample/shared";

await migrate(
  "payments",
  `CREATE TABLE IF NOT EXISTS payments.payments (
     order_id TEXT PRIMARY KEY,
     payment_id TEXT NOT NULL,
     amount_cents INTEGER NOT NULL,
     refunded_cents INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL,
     captured_at TIMESTAMPTZ NOT NULL
   );
   CREATE TABLE IF NOT EXISTS payments.refunds (
     refund_id TEXT PRIMARY KEY,
     order_id TEXT NOT NULL REFERENCES payments.payments(order_id),
     amount_cents INTEGER NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );`,
);

async function getPayment(orderId: string): Promise<Json> {
  const { rows } = await db().query("SELECT * FROM payments.payments WHERE order_id = $1", [orderId]);
  if (rows.length === 0) throw new HttpError(404, `no payment for order ${orderId}`);
  const refunds = await db().query("SELECT refund_id, amount_cents, created_at FROM payments.refunds WHERE order_id = $1 ORDER BY created_at", [orderId]);
  return { ...(rows[0] as Json), refunds: refunds.rows };
}

function statusFor(amount: number, refunded: number): string {
  if (refunded === 0) return "captured";
  return refunded >= amount ? "refunded" : "partially_refunded";
}

await createService("payments", {
  "POST /payments": async ({ body }) => {
    const orderId = requireString(body, "order_id");
    const amount = requireInt(body, "amount_cents");
    const capturedAt = typeof body.captured_at === "string" ? body.captured_at : new Date().toISOString();
    await db().query(
      "INSERT INTO payments.payments (order_id, payment_id, amount_cents, status, captured_at) VALUES ($1, $2, $3, 'captured', $4)",
      [orderId, newId("pay"), amount, capturedAt],
    );
    return getPayment(orderId);
  },
  "GET /payments/:order_id": ({ params }) => getPayment(params.order_id ?? ""),
  "POST /payments/:order_id/refunds": async ({ params, body }) => {
    const orderId = params.order_id ?? "";
    const payment = await getPayment(orderId);
    const amount = requireInt(body, "amount_cents");
    const remaining = (payment.amount_cents as number) - (payment.refunded_cents as number);
    if (amount <= 0 || amount > remaining) throw new HttpError(409, `refund of ${amount} exceeds the refundable ${remaining}`);
    const refundId = typeof body.refund_id === "string" ? body.refund_id : newId("rfp");
    await db().query("INSERT INTO payments.refunds (refund_id, order_id, amount_cents) VALUES ($1, $2, $3)", [refundId, orderId, amount]);
    const refunded = (payment.refunded_cents as number) + amount;
    await db().query("UPDATE payments.payments SET refunded_cents = $2, status = $3 WHERE order_id = $1", [
      orderId,
      refunded,
      statusFor(payment.amount_cents as number, refunded),
    ]);
    return { refund_id: refundId, ...(await getPayment(orderId)) };
  },
  // Compensation: reverses a refund that was part of a failed multi-step operation.
  "POST /payments/:order_id/refunds/:refund_id/reverse": async ({ params }) => {
    const orderId = params.order_id ?? "";
    const { rows } = await db().query("DELETE FROM payments.refunds WHERE refund_id = $1 AND order_id = $2 RETURNING amount_cents", [
      params.refund_id,
      orderId,
    ]);
    if (rows.length === 0) throw new HttpError(404, `refund ${params.refund_id} not found`);
    const payment = await getPayment(orderId);
    const refunded = (payment.refunded_cents as number) - (rows[0] as { amount_cents: number }).amount_cents;
    await db().query("UPDATE payments.payments SET refunded_cents = $2, status = $3 WHERE order_id = $1", [
      orderId,
      refunded,
      statusFor(payment.amount_cents as number, refunded),
    ]);
    return getPayment(orderId);
  },
}).listen(PORTS.payments);
console.log(`payments listening on ${PORTS.payments}`);
