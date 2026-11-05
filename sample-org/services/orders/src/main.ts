import { PORTS, call, createService, db, HttpError, migrate, newId, requireInt, requireString, type Json } from "@sample/shared";

await migrate(
  "orders",
  `CREATE TABLE IF NOT EXISTS orders.customers (
     customer_id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     region TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_login_at TIMESTAMPTZ
   );
   CREATE TABLE IF NOT EXISTS orders.orders (
     order_id TEXT PRIMARY KEY,
     customer_id TEXT NOT NULL REFERENCES orders.customers(customer_id),
     channel TEXT NOT NULL,
     region TEXT NOT NULL,
     status TEXT NOT NULL,
     subtotal_cents INTEGER NOT NULL,
     tax_cents INTEGER NOT NULL,
     total_cents INTEGER NOT NULL,
     placed_at TIMESTAMPTZ NOT NULL,
     delivered_at TIMESTAMPTZ,
     cancelled_at TIMESTAMPTZ
   );
   CREATE TABLE IF NOT EXISTS orders.order_lines (
     order_id TEXT NOT NULL REFERENCES orders.orders(order_id),
     sku TEXT NOT NULL,
     qty INTEGER NOT NULL,
     price_cents INTEGER NOT NULL
   );`,
);

async function getOrder(orderId: string): Promise<Json> {
  const { rows } = await db().query("SELECT * FROM orders.orders WHERE order_id = $1", [orderId]);
  if (rows.length === 0) throw new HttpError(404, `order ${orderId} not found`);
  const lines = await db().query("SELECT sku, qty, price_cents FROM orders.order_lines WHERE order_id = $1", [orderId]);
  return { ...(rows[0] as Json), lines: lines.rows };
}

await createService("orders", {
  "POST /customers": async ({ body }) => {
    const customerId = typeof body.customer_id === "string" ? body.customer_id : newId("cus");
    await db().query(
      `INSERT INTO orders.customers (customer_id, name, email, region, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (customer_id) DO NOTHING`,
      [customerId, requireString(body, "name"), requireString(body, "email"), requireString(body, "region"), body.created_at ?? null],
    );
    return { customer_id: customerId };
  },
  "GET /customers/:customer_id": async ({ params }) => {
    const { rows } = await db().query("SELECT * FROM orders.customers WHERE customer_id = $1", [params.customer_id]);
    if (rows.length === 0) throw new HttpError(404, `customer ${params.customer_id} not found`);
    return rows[0];
  },
  "POST /customers/:customer_id/login": async ({ params, body }) => {
    await db().query("UPDATE orders.customers SET last_login_at = COALESCE($2::timestamptz, now()) WHERE customer_id = $1", [
      params.customer_id,
      body.at ?? null,
    ]);
    return { ok: true };
  },
  "POST /orders": async ({ body }) => {
    const customerId = requireString(body, "customer_id");
    const customer = await db().query("SELECT region FROM orders.customers WHERE customer_id = $1", [customerId]);
    if (customer.rows.length === 0) throw new HttpError(404, `customer ${customerId} not found`);
    const region = (customer.rows[0] as { region: string }).region;
    const lines = Array.isArray(body.lines) ? (body.lines as Json[]) : [];
    if (lines.length === 0) throw new HttpError(400, "an order needs at least one line");
    const subtotal = lines.reduce((sum, l) => sum + requireInt(l, "qty") * requireInt(l, "price_cents"), 0);
    const { tax_cents } = await call<{ tax_cents: number }>("tax", "POST", "/tax/quote", { region, subtotal_cents: subtotal });
    const orderId = typeof body.order_id === "string" ? body.order_id : newId("ord");
    const placedAt = typeof body.placed_at === "string" ? body.placed_at : new Date().toISOString();
    await db().query(
      `INSERT INTO orders.orders (order_id, customer_id, channel, region, status, subtotal_cents, tax_cents, total_cents, placed_at)
       VALUES ($1, $2, $3, $4, 'placed', $5, $6, $7, $8)`,
      [orderId, customerId, typeof body.channel === "string" ? body.channel : "online", region, subtotal, tax_cents, subtotal + tax_cents, placedAt],
    );
    for (const l of lines) {
      await db().query("INSERT INTO orders.order_lines (order_id, sku, qty, price_cents) VALUES ($1, $2, $3, $4)", [
        orderId,
        requireString(l, "sku"),
        requireInt(l, "qty"),
        requireInt(l, "price_cents"),
      ]);
    }
    return getOrder(orderId);
  },
  "GET /orders/:order_id": ({ params }) => getOrder(params.order_id ?? ""),
  "POST /orders/:order_id/delivered": async ({ params, body }) => {
    await getOrder(params.order_id ?? "");
    await db().query("UPDATE orders.orders SET status = 'delivered', delivered_at = COALESCE($2::timestamptz, now()) WHERE order_id = $1", [
      params.order_id,
      body.delivered_at ?? null,
    ]);
    return getOrder(params.order_id ?? "");
  },
  // Only orders that have not been delivered can be cancelled.
  "POST /orders/:order_id/cancel": async ({ params }) => {
    const order = await getOrder(params.order_id ?? "");
    if (order.status !== "placed") throw new HttpError(409, `order ${params.order_id} is ${String(order.status)} and cannot be cancelled`);
    await db().query("UPDATE orders.orders SET status = 'cancelled', cancelled_at = now() WHERE order_id = $1", [params.order_id]);
    return getOrder(params.order_id ?? "");
  },
  "POST /orders/:order_id/uncancel": async ({ params }) => {
    await db().query("UPDATE orders.orders SET status = 'placed', cancelled_at = NULL WHERE order_id = $1 AND status = 'cancelled'", [
      params.order_id,
    ]);
    return getOrder(params.order_id ?? "");
  },
}).listen(PORTS.orders);
console.log(`orders listening on ${PORTS.orders}`);
