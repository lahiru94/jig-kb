/**
 * Deterministic operational history for the sample retailer (task 3.5).
 *
 * Produces customers, orders, refunds and the refund requests that went through approval, including
 * the raw facts each decision was made on. The same seed and options always give identical output.
 * `seed` loads this into the services and into the jig audit log, so replay simulation and
 * evidence-based proposals have real history to work with.
 */

export interface HistoryOptions {
  seed: number;
  /** End of the history window (exclusive), ISO timestamp. */
  now: string;
  days: number;
  customers: number;
  orders: number;
}

export const DEFAULT_OPTIONS: HistoryOptions = {
  seed: 20261101,
  now: "2026-11-01T00:00:00.000Z",
  days: 90,
  customers: 120,
  orders: 800,
};

export interface Customer {
  customer_id: string;
  name: string;
  email: string;
  region: "us" | "eu";
  tier: "standard" | "gold";
  created_at: string;
  last_login_at: string;
}

export interface Order {
  order_id: string;
  customer_id: string;
  channel: "online" | "store";
  sku: string;
  qty: number;
  price_cents: number;
  placed_at: string;
  delivered_at: string;
}

export interface Refund {
  refund_id: string;
  order_id: string;
  amount_cents: number;
  type: "full" | "partial";
  requested_at: string;
  /** Final outcome: completed, or rejected by the approver. */
  status: "completed" | "rejected";
  approved_by: string | null;
}

/** A refund request as it went through approval, with the raw facts the decision used. */
export interface RefundRequest {
  request_id: string;
  refund_id: string;
  action: "action.issue-refund";
  principal: string;
  via_agent: boolean;
  evaluated_at: string;
  inputs: { order_id: string; amount_cents: number };
  /** Raw binding responses, as the KB layer records them (design D7). */
  raw_facts: {
    order: { order_id: string; customer_id: string; total_cents: number; placed_at: string; delivered_at: string; region: string };
    account: { customer_id: string; tier: string };
  };
  /** Rule the request was held by, and whether a human let it through. */
  held_by: "rule.refund-approval-limit" | null;
  decision: { level: 1 | 2 };
  approval: { approved: boolean; approved_by: string; at: string } | null;
}

export interface History {
  options: HistoryOptions;
  customers: Customer[];
  orders: Order[];
  refunds: Refund[];
  requests: RefundRequest[];
}

const DAY = 24 * 60 * 60 * 1000;
const APPROVAL_LIMIT_CENTS = 50000;
const FIRST_NAMES = ["Ava", "Ben", "Chloe", "Dev", "Ema", "Finn", "Gia", "Hugo", "Isla", "Jon", "Kai", "Lena", "Milo", "Nora", "Omar", "Pia"];
const LAST_NAMES = ["Abara", "Brook", "Costa", "Dahl", "Evans", "Fujita", "Grant", "Haddad", "Ito", "Jensen", "Kova", "Lund"];
const SKUS: Array<[sku: string, priceCents: number]> = [
  ["TENT-2P", 32900],
  ["JACKET-RAIN", 18900],
  ["BOOTS-HIKE", 21500],
  ["PACK-45L", 24900],
  ["STOVE-CAMP", 8900],
  ["LAMP-HEAD", 3900],
  ["BOTTLE-1L", 2400],
  ["KAYAK-1P", 89900],
  ["BIKE-GRAVEL", 129900],
  ["PADDLEBOARD", 69900],
];
const APPROVERS = ["actor.morgan", "actor.riley"];

/** mulberry32: a small, fast, deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

export function generateHistory(options: HistoryOptions = DEFAULT_OPTIONS): History {
  const rand = prng(options.seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  const end = new Date(options.now).getTime();
  const start = end - options.days * DAY;
  const at = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString();

  const customers: Customer[] = [];
  for (let i = 1; i <= options.customers; i++) {
    const created = start - Math.floor(rand() * 400) * DAY;
    customers.push({
      customer_id: `cus-${pad(i, 4)}`,
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: `customer${pad(i, 4)}@example.com`,
      region: rand() < 0.35 ? "eu" : "us",
      tier: rand() < 0.25 ? "gold" : "standard",
      created_at: at(created),
      last_login_at: at(end - Math.floor(rand() * 200) * DAY - Math.floor(rand() * DAY)),
    });
  }

  const orders: Order[] = [];
  for (let i = 1; i <= options.orders; i++) {
    const customer = pick(customers);
    const [sku, price] = pick(SKUS);
    const placed = start + Math.floor(rand() * (options.days - 5) * DAY);
    orders.push({
      order_id: `ord-${pad(i, 5)}`,
      customer_id: customer.customer_id,
      channel: rand() < 0.8 ? "online" : "store",
      sku,
      qty: rand() < 0.15 ? 2 : 1,
      price_cents: price,
      placed_at: at(placed),
      delivered_at: at(placed + (2 + Math.floor(rand() * 4)) * DAY),
    });
  }

  const refunds: Refund[] = [];
  const requests: RefundRequest[] = [];
  const customerById = new Map(customers.map((c) => [c.customer_id, c]));
  let refundSeq = 0;
  for (const order of orders) {
    if (rand() >= 0.18) continue;
    const customer = customerById.get(order.customer_id) as Customer;
    const subtotal = order.price_cents * order.qty;
    const taxRate = customer.region === "eu" ? 0.2 : 0.08;
    const total = subtotal + Math.round(subtotal * taxRate);
    const partial = rand() < 0.4;
    const amount = partial ? Math.round(total * (0.2 + rand() * 0.5)) : total;
    const requested = new Date(order.delivered_at).getTime() + Math.floor(rand() * 25) * DAY + Math.floor(rand() * DAY);
    if (requested >= end) continue;
    refundSeq++;
    const refundId = `rfd-${pad(refundSeq, 5)}`;
    const held = amount > APPROVAL_LIMIT_CENTS;
    // Supervisors let almost every held refund through.
    const approved = !held || rand() < 0.95;
    const approver = held ? pick(APPROVERS) : null;
    const decidedAt = at(requested + (held ? Math.floor(rand() * 6 * 60 * 60 * 1000) : 0));
    refunds.push({
      refund_id: refundId,
      order_id: order.order_id,
      amount_cents: amount,
      type: partial ? "partial" : "full",
      requested_at: at(requested),
      status: approved ? "completed" : "rejected",
      approved_by: approver,
    });
    requests.push({
      request_id: `req-${pad(refundSeq, 5)}`,
      refund_id: refundId,
      action: "action.issue-refund",
      principal: "actor.casey",
      via_agent: rand() < 0.5,
      evaluated_at: at(requested),
      inputs: { order_id: order.order_id, amount_cents: amount },
      raw_facts: {
        order: {
          order_id: order.order_id,
          customer_id: order.customer_id,
          total_cents: total,
          placed_at: order.placed_at,
          delivered_at: order.delivered_at,
          region: customer.region,
        },
        account: { customer_id: customer.customer_id, tier: customer.tier },
      },
      held_by: held ? "rule.refund-approval-limit" : null,
      decision: { level: held ? 2 : 1 },
      approval: held ? { approved, approved_by: approver as string, at: decidedAt } : null,
    });
  }

  return { options, customers, orders, refunds, requests };
}

/** Share of requests held by a rule that a human approved anyway. */
export function overrideRate(history: History, ruleId: string): { held: number; approved: number; rate: number } {
  const held = history.requests.filter((r) => r.held_by === ruleId);
  const approved = held.filter((r) => r.approval?.approved === true).length;
  return { held: held.length, approved, rate: held.length === 0 ? 0 : approved / held.length };
}
