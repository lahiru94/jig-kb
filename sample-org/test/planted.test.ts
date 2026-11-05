import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, "utf8");
const line = (path: string, n: number): string => read(path).split("\n")[n - 1] ?? "";

describe("planted problems are traceable", () => {
  const planted = read("docs/PLANTED.md");

  it("lists all six planted problems", () => {
    for (let n = 1; n <= 6; n++) expect(planted).toMatch(new RegExp(`^\\| ${n} \\| \\*\\*`, "m"));
  });

  it("1: policy says 30 days, code gives Gold members 45", () => {
    expect(read("docs/policies/refund-policy.md")).toContain("within **30 days of delivery**");
    expect(line("services/returns/src/main.ts", 23)).toContain('tier === "gold" ? 45 : 30');
    expect(line("services/returns/src/main.ts", 55)).toContain("windowDays");
  });

  it("2: loyalty clawback after a cut-off, undocumented in the terms", () => {
    expect(line("services/loyalty/src/main.ts", 22)).toContain('CLAWBACK_CUTOFF = new Date("2025-01-01');
    expect(line("services/loyalty/src/main.ts", 71)).toContain("always claws back every point");
    expect(read("docs/loyalty/loyalty-terms.md").toLowerCase()).not.toContain("claw");
  });

  it("3: the ERP keeps one refund per order", () => {
    expect(line("legacy-erp/src/erp.ts", 17)).toContain("One refund row per order");
    expect(line("legacy-erp/src/erp.ts", 39)).toContain("INSERT OR REPLACE INTO REFUNDS");
  });

  it("4: marketing and finance define active customer differently", () => {
    expect(line("services/storefront/src/main.ts", 3)).toContain("logged in during the last 90 days");
    expect(line("legacy-erp/src/erp.ts", 69)).toContain("bought something in the last 12 months");
  });

  it("5: the EU withdrawal right is only in the policy", () => {
    expect(read("docs/policies/refund-policy.md")).toContain("within 14 days");
    for (const service of ["returns", "orders", "payments", "storefront"]) {
      expect(read(`services/${service}/src/main.ts`)).not.toMatch(/14|withdraw/i);
    }
  });

  it("6: gift-card reconciliation is manual and only in staff notes", () => {
    expect(read("docs/process-notes/customer-service-handbook.md")).toContain('"GC refunds" spreadsheet');
    expect(read("services/returns/src/main.ts").toLowerCase()).not.toContain("gift");
  });

  it("supporting: the refund email assumes a full refund", () => {
    expect(line("services/notifications/src/main.ts", 17)).toContain("fully refunded");
  });
});
