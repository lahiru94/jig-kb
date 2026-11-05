import { PORTS, call, createService, db, requireString, type Json } from "@sample/shared";

// Marketing's definition: a customer is active if they logged in during the last 90 days.
const ACTIVE_LOGIN_DAYS = 90;

await createService("storefront", {
  "POST /signup": async ({ body }) => {
    const customer = await call<Json>("orders", "POST", "/customers", body);
    await call("loyalty", "POST", "/accounts", { customer_id: customer.customer_id, tier: body.tier ?? "standard" });
    return customer;
  },
  "POST /checkout": async ({ body }) => {
    const customerId = requireString(body, "customer_id");
    const order = await call<Json>("orders", "POST", "/orders", body);
    const placedAt = new Date(order.placed_at as string).toISOString();
    await call("payments", "POST", "/payments", { order_id: order.order_id, amount_cents: order.total_cents, captured_at: placedAt });
    await call("loyalty", "POST", "/earn", { customer_id: customerId, order_id: order.order_id, amount_cents: order.subtotal_cents, placed_at: placedAt });
    // Sales are posted to the legacy ERP for finance reporting.
    await call("legacy-erp", "POST", "/postings", { order_id: order.order_id, customer_id: customerId, kind: "sale", amount_cents: order.total_cents, at: placedAt });
    await call("warehouse", "POST", "/shipments", { order_id: order.order_id });
    await call("notifications", "POST", "/notify", { customer_id: customerId, template: "order_confirmed", vars: { order_id: order.order_id } });
    return order;
  },
  "GET /marketing/active-customers": async ({ query }) => {
    const asOf = query.get("as_of") ?? new Date().toISOString();
    const { rows } = await db().query(
      "SELECT customer_id FROM orders.customers WHERE last_login_at >= $1::timestamptz - make_interval(days => $2) ORDER BY customer_id",
      [asOf, ACTIVE_LOGIN_DAYS],
    );
    return rows.map((r: { customer_id: string }) => r.customer_id);
  },
}).listen(PORTS.storefront);
console.log(`storefront listening on ${PORTS.storefront}`);
