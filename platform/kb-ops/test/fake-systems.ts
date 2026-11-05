import { Executor, defaultRegistries, type BindingType } from "@jig/executor";

export interface FakeOrder {
  order_id: string;
  customer_id: string;
  status: string;
  total_cents: number;
  placed_at: string;
  delivered_at: string | null;
}

export interface SystemCall {
  method: string;
  path: string;
  body: unknown;
}

/**
 * In-memory stand-ins for the sample retailer's services, answering the REST bindings in the sample KB.
 * Every call is recorded, so tests can check that nothing changed when a request is refused.
 */
export class FakeSystems {
  readonly calls: SystemCall[] = [];
  readonly orders = new Map<string, FakeOrder>();
  readonly tiers = new Map<string, string>();
  readonly refunds: Array<{ refund_id: string; order_id: string; amount_cents: number }> = [];
  clawbackApplies = true;
  /** Paths (method + path prefix) that fail with HTTP 500, to test compensation. */
  readonly failing = new Set<string>();

  addOrder(order: Partial<FakeOrder> & { order_id: string }, tier = "standard"): void {
    const full: FakeOrder = {
      customer_id: `cus-${order.order_id}`,
      status: "delivered",
      total_cents: 20000,
      placed_at: "2026-09-20T10:00:00.000Z",
      delivered_at: "2026-10-01T10:00:00.000Z",
      ...order,
    };
    this.orders.set(full.order_id, full);
    this.tiers.set(full.customer_id, tier);
  }

  mutatingCalls(): SystemCall[] {
    return this.calls.filter((c) => c.method !== "GET");
  }

  private handle(method: string, path: string, body: Record<string, unknown>): { status: number; payload: unknown } {
    for (const prefix of this.failing) if (`${method} ${path}`.startsWith(prefix)) return { status: 500, payload: { error: "simulated failure" } };
    let m: RegExpExecArray | null;
    if (method === "GET" && (m = /^\/orders\/([^/]+)$/.exec(path))) {
      const order = this.orders.get(decodeURIComponent(m[1] ?? ""));
      return order ? { status: 200, payload: order } : { status: 404, payload: { error: "order not found" } };
    }
    if (method === "GET" && (m = /^\/accounts\/([^/]+)$/.exec(path))) {
      const id = decodeURIComponent(m[1] ?? "");
      return { status: 200, payload: { customer_id: id, tier: this.tiers.get(id) ?? "standard", points: 100 } };
    }
    if (method === "GET" && (m = /^\/orders\/([^/]+)\/points$/.exec(path))) {
      return { status: 200, payload: { order_id: m[1], earned: 200, clawed: 0, clawback_applies: this.clawbackApplies } };
    }
    if (method === "POST" && (m = /^\/payments\/([^/]+)\/refunds$/.exec(path))) {
      const refund = { refund_id: String(body.refund_id ?? `rfp-${this.refunds.length + 1}`), order_id: m[1] ?? "", amount_cents: Number(body.amount_cents) };
      this.refunds.push(refund);
      return { status: 201, payload: refund };
    }
    if (method === "POST" && (m = /^\/payments\/([^/]+)\/refunds\/([^/]+)\/reverse$/.exec(path))) {
      const index = this.refunds.findIndex((r) => r.refund_id === decodeURIComponent(m?.[2] ?? ""));
      if (index >= 0) this.refunds.splice(index, 1);
      return { status: 201, payload: { reversed: index >= 0 } };
    }
    if (method === "POST" && (m = /^\/orders\/([^/]+)\/(cancel|uncancel)$/.exec(path))) {
      const order = this.orders.get(decodeURIComponent(m[1] ?? ""));
      if (!order) return { status: 404, payload: { error: "order not found" } };
      if (m[2] === "cancel" && order.status !== "placed") return { status: 409, payload: { error: `order is ${order.status}` } };
      order.status = m[2] === "cancel" ? "cancelled" : "placed";
      return { status: 201, payload: order };
    }
    if (method === "POST" && /^\/shipments\/[^/]+\/cancel$/.test(path)) return { status: 201, payload: { status: "cancelled" } };
    if (method === "POST" && ["/clawback", "/clawback/reverse", "/postings", "/notify"].includes(path)) return { status: 201, payload: { ok: true } };
    return { status: 404, payload: { error: `no fake route for ${method} ${path}` } };
  }

  readonly fetch = (async (url: string | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    this.calls.push({ method, path: parsed.pathname, body });
    const { status, payload } = this.handle(method, parsed.pathname, body);
    return new Response(JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;

  /** A fake SQL binding type answering the refund-count query from the fake payments data. */
  readonly sql: BindingType = {
    name: "sql",
    call: async (_binding, params) => {
      this.calls.push({ method: "GET", path: "sql", body: params });
      const count = this.refunds.filter((r) => r.order_id === params.order_id).length;
      return { refund_count: count, rows: [{ refund_count: count }] };
    },
  };

  executor(): Executor {
    const registries = defaultRegistries();
    registries.bindings.register(this.sql);
    const services = Object.fromEntries(["orders", "payments", "loyalty", "notifications", "legacy-erp", "warehouse"].map((s) => [s, `http://${s}.fake`]));
    return new Executor({ services, databases: { retail: "postgres://fake" }, fetch: this.fetch }, registries);
  }
}
