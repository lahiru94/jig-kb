import { PORTS, call, createService, db, HttpError, migrate, requireString } from "@sample/shared";

await migrate(
  "warehouse",
  `CREATE TABLE IF NOT EXISTS warehouse.shipments (
     order_id TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     delivered_at TIMESTAMPTZ
   );`,
);

await createService("warehouse", {
  "POST /shipments": async ({ body }) => {
    const orderId = requireString(body, "order_id");
    await db().query("INSERT INTO warehouse.shipments (order_id, status) VALUES ($1, 'pending') ON CONFLICT DO NOTHING", [orderId]);
    return { order_id: orderId, status: "pending" };
  },
  "GET /shipments/:order_id": async ({ params }) => {
    const { rows } = await db().query("SELECT * FROM warehouse.shipments WHERE order_id = $1", [params.order_id]);
    if (rows.length === 0) throw new HttpError(404, `no shipment for ${params.order_id}`);
    return rows[0];
  },
  "POST /shipments/:order_id/deliver": async ({ params, body }) => {
    const deliveredAt = typeof body.delivered_at === "string" ? body.delivered_at : new Date().toISOString();
    const { rowCount } = await db().query("UPDATE warehouse.shipments SET status = 'delivered', delivered_at = $2 WHERE order_id = $1", [
      params.order_id,
      deliveredAt,
    ]);
    if (rowCount === 0) throw new HttpError(404, `no shipment for ${params.order_id}`);
    await call("orders", "POST", `/orders/${params.order_id}/delivered`, { delivered_at: deliveredAt });
    return { order_id: params.order_id, status: "delivered", delivered_at: deliveredAt };
  },
  // Cancelling an order stops its shipment if it has not been delivered.
  "POST /shipments/:order_id/cancel": async ({ params }) => {
    await db().query("UPDATE warehouse.shipments SET status = 'cancelled' WHERE order_id = $1 AND status = 'pending'", [params.order_id]);
    return { order_id: params.order_id, status: "cancelled" };
  },
}).listen(PORTS.warehouse);
console.log(`warehouse listening on ${PORTS.warehouse}`);
