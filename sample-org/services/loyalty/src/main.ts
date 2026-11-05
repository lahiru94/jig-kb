import { PORTS, createService, db, HttpError, migrate, requireInt, requireString, type Json } from "@sample/shared";

await migrate(
  "loyalty",
  `CREATE TABLE IF NOT EXISTS loyalty.accounts (
     customer_id TEXT PRIMARY KEY,
     tier TEXT NOT NULL DEFAULT 'standard',
     points INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS loyalty.point_events (
     id SERIAL PRIMARY KEY,
     customer_id TEXT NOT NULL,
     order_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     points INTEGER NOT NULL,
     placed_at TIMESTAMPTZ NOT NULL,
     at TIMESTAMPTZ NOT NULL DEFAULT now()
   );`,
);

// Points earned before this date were awarded under the old programme and are never clawed back.
const CLAWBACK_CUTOFF = new Date("2025-01-01T00:00:00Z");

async function account(customerId: string): Promise<Json> {
  const { rows } = await db().query("SELECT * FROM loyalty.accounts WHERE customer_id = $1", [customerId]);
  if (rows.length === 0) throw new HttpError(404, `no loyalty account for ${customerId}`);
  return rows[0] as Json;
}

async function orderPoints(orderId: string): Promise<{ customer_id: string; earned: number; clawed: number; placed_at: Date } | undefined> {
  const { rows } = await db().query(
    `SELECT customer_id, MIN(placed_at) AS placed_at,
            COALESCE(SUM(points) FILTER (WHERE kind = 'earn'), 0)::int AS earned,
            COALESCE(SUM(-points) FILTER (WHERE kind = 'clawback'), 0)::int AS clawed
     FROM loyalty.point_events WHERE order_id = $1 GROUP BY customer_id`,
    [orderId],
  );
  return rows[0] as { customer_id: string; earned: number; clawed: number; placed_at: Date } | undefined;
}

await createService("loyalty", {
  "POST /accounts": async ({ body }) => {
    await db().query("INSERT INTO loyalty.accounts (customer_id, tier) VALUES ($1, $2) ON CONFLICT (customer_id) DO UPDATE SET tier = $2", [
      requireString(body, "customer_id"),
      typeof body.tier === "string" ? body.tier : "standard",
    ]);
    return account(requireString(body, "customer_id"));
  },
  "GET /accounts/:customer_id": ({ params }) => account(params.customer_id ?? ""),
  "POST /earn": async ({ body }) => {
    const customerId = requireString(body, "customer_id");
    const acct = await account(customerId);
    const multiplier = acct.tier === "gold" ? 2 : 1;
    const points = Math.floor(requireInt(body, "amount_cents") / 100) * multiplier;
    const placedAt = typeof body.placed_at === "string" ? body.placed_at : new Date().toISOString();
    await db().query("INSERT INTO loyalty.point_events (customer_id, order_id, kind, points, placed_at) VALUES ($1, $2, 'earn', $3, $4)", [
      customerId,
      requireString(body, "order_id"),
      points,
      placedAt,
    ]);
    await db().query("UPDATE loyalty.accounts SET points = points + $2 WHERE customer_id = $1", [customerId, points]);
    return { points };
  },
  "GET /orders/:order_id/points": async ({ params }) => {
    const info = await orderPoints(params.order_id ?? "");
    if (!info) return { order_id: params.order_id, earned: 0, clawed: 0, clawback_applies: false };
    return { order_id: params.order_id, ...info, clawback_applies: info.placed_at >= CLAWBACK_CUTOFF };
  },
  // Removes the points an order earned. Applies only to orders placed on or after the cut-off.
  // Note: always claws back every point the order earned, whatever the refund amount.
  "POST /clawback": async ({ body }) => {
    const orderId = requireString(body, "order_id");
    const info = await orderPoints(orderId);
    if (!info || info.placed_at < CLAWBACK_CUTOFF) return { order_id: orderId, clawed_back: 0 };
    const points = info.earned - info.clawed;
    if (points <= 0) return { order_id: orderId, clawed_back: 0 };
    await db().query("INSERT INTO loyalty.point_events (customer_id, order_id, kind, points, placed_at) VALUES ($1, $2, 'clawback', $3, $4)", [
      info.customer_id,
      orderId,
      -points,
      info.placed_at,
    ]);
    await db().query("UPDATE loyalty.accounts SET points = points - $2 WHERE customer_id = $1", [info.customer_id, points]);
    return { order_id: orderId, clawed_back: points };
  },
  // Compensation: restores points removed by a clawback.
  "POST /clawback/reverse": async ({ body }) => {
    const orderId = requireString(body, "order_id");
    const { rows } = await db().query(
      "DELETE FROM loyalty.point_events WHERE id = (SELECT MAX(id) FROM loyalty.point_events WHERE order_id = $1 AND kind = 'clawback') RETURNING customer_id, points",
      [orderId],
    );
    const row = rows[0] as { customer_id: string; points: number } | undefined;
    if (row) await db().query("UPDATE loyalty.accounts SET points = points - $2 WHERE customer_id = $1", [row.customer_id, row.points]);
    return { order_id: orderId, restored: row ? -row.points : 0 };
  },
}).listen(PORTS.loyalty);
console.log(`loyalty listening on ${PORTS.loyalty}`);
