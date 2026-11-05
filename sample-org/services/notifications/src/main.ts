import { PORTS, createService, db, HttpError, migrate, requireString, type Json } from "@sample/shared";

await migrate(
  "notifications",
  `CREATE TABLE IF NOT EXISTS notifications.sent (
     id SERIAL PRIMARY KEY,
     customer_id TEXT NOT NULL,
     template TEXT NOT NULL,
     body TEXT NOT NULL,
     at TIMESTAMPTZ NOT NULL DEFAULT now()
   );`,
);

const TEMPLATES: Record<string, string> = {
  order_confirmed: "Thanks! Your order {order_id} is confirmed.",
  order_cancelled: "Your order {order_id} has been cancelled.",
  refund_completed: "Your order {order_id} has been fully refunded. {amount} is on its way back to you.",
};

function render(template: string, vars: Json): string {
  return template.replace(/\{([a-z_]+)\}/g, (_m, key: string) => String(vars[key] ?? ""));
}

await createService("notifications", {
  "POST /notify": async ({ body }) => {
    const name = requireString(body, "template");
    const template = TEMPLATES[name];
    if (!template) throw new HttpError(400, `unknown template '${name}'`);
    const text = render(template, (body.vars as Json | undefined) ?? {});
    const { rows } = await db().query("INSERT INTO notifications.sent (customer_id, template, body) VALUES ($1, $2, $3) RETURNING id", [
      requireString(body, "customer_id"),
      name,
      text,
    ]);
    return { id: (rows[0] as { id: number }).id, body: text };
  },
  "GET /sent": async ({ query }) => {
    const { rows } = await db().query("SELECT * FROM notifications.sent WHERE customer_id = $1 ORDER BY id", [query.get("customer_id")]);
    return rows;
  },
}).listen(PORTS.notifications);
console.log(`notifications listening on ${PORTS.notifications}`);
