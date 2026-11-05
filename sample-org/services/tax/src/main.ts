import { PORTS, createService, HttpError, requireInt, requireString } from "@sample/shared";

// Tax rates by region, in basis points.
const RATES_BP: Record<string, number> = { eu: 2000, us: 800 };

export function quote(region: string, subtotalCents: number): { region: string; rate_bp: number; tax_cents: number } {
  const rate = RATES_BP[region];
  if (rate === undefined) throw new HttpError(400, `unknown region '${region}'`);
  return { region, rate_bp: rate, tax_cents: Math.round((subtotalCents * rate) / 10000) };
}

await createService("tax", {
  "POST /tax/quote": ({ body }) => quote(requireString(body, "region"), requireInt(body, "subtotal_cents")),
}).listen(PORTS.tax);
console.log(`tax listening on ${PORTS.tax}`);
