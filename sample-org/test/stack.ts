import { PORTS, type ServiceName } from "@sample/shared";

/** Helpers for tests that run against the live sample retailer stack (`npm run up`). */
export const base = (service: ServiceName): string => `http://localhost:${PORTS[service]}`;

export async function stackIsUp(): Promise<boolean> {
  try {
    const checks = await Promise.all(
      (Object.keys(PORTS) as ServiceName[]).map((s) => fetch(`${base(s)}/health`, { signal: AbortSignal.timeout(1000) })),
    );
    return checks.every((r) => r.ok);
  } catch {
    return false;
  }
}

export async function api<T = Record<string, unknown>>(service: ServiceName, method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`${base(service)}${path}`, init);
  const payload = (await response.json()) as T;
  if (!response.ok) throw new Error(`${service} ${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

export const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Signs up a customer, checks out one order and marks it delivered. */
export async function deliveredOrder(options: { tier?: string; region?: string; priceCents?: number; placedAt?: string; deliveredAt?: string } = {}) {
  const customerId = uid("cus");
  await api("storefront", "POST", "/signup", { customer_id: customerId, name: "Test Customer", email: `${customerId}@example.com`, region: options.region ?? "us", tier: options.tier ?? "standard" });
  const order = await api("storefront", "POST", "/checkout", {
    customer_id: customerId,
    order_id: uid("ord"),
    lines: [{ sku: "SKU-1", qty: 1, price_cents: options.priceCents ?? 10000 }],
    ...(options.placedAt ? { placed_at: options.placedAt } : {}),
  });
  await api("warehouse", "POST", `/shipments/${String(order.order_id)}/deliver`, options.deliveredAt ? { delivered_at: options.deliveredAt } : {});
  return { customerId, orderId: String(order.order_id), totalCents: Number(order.total_cents) };
}
