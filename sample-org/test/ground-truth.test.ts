import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KbIndex, KbValidator, loadKb, loadSchemaMeta, type KbNode } from "@jig/kb-core";

const kbRoot = fileURLToPath(new URL("../kb", import.meta.url));
const { nodes, issues } = loadKb(kbRoot);
const index = new KbIndex(nodes, loadSchemaMeta());
const get = (id: string): KbNode => {
  const node = index.get(id);
  if (!node) throw new Error(`missing ${id}`);
  return node;
};
type Claim = { says: string; source: string; confidence: string };
type Conflict = { claims: number[]; status: string };
const claims = (id: string): Claim[] => (get(id).data.claims as Claim[] | undefined) ?? [];
const conflicts = (id: string): Conflict[] => (get(id).data.conflicts as Conflict[] | undefined) ?? [];

describe("ground-truth KB", () => {
  it("passes the validator", () => {
    const report = new KbValidator().validate(nodes, issues);
    expect(report.errors).toEqual([]);
  });

  it("models the refund action with its rules, facts and steps", () => {
    const enforced = index.incoming("action.issue-refund").filter((l) => l.type === "enforced-on").map((l) => l.from);
    expect(enforced.sort()).toEqual([
      "rule.loyalty-clawback",
      "rule.refund-approval-limit",
      "rule.refund-window",
      "rule.refunds-need-delivery",
      "rule.single-refund-per-order",
    ]);
    expect(get("action.issue-refund").data.mode).toBe("connected");
  });

  it("1: represents the policy/code contradiction as an open conflict", () => {
    const c = claims("rule.refund-window");
    expect(c.map((x) => x.confidence)).toEqual(["stated", "inferred"]);
    expect(conflicts("rule.refund-window")).toEqual([{ about: "refund window for Gold members", claims: [0, 1], status: "open" }]);
  });

  it("2: represents the undocumented clawback as a code-only rule enforced in the loyalty service", () => {
    expect(claims("rule.loyalty-clawback").every((x) => x.confidence === "inferred" && x.source.startsWith("code:"))).toBe(true);
    expect(get("rule.loyalty-clawback").data.enforcement).toEqual({ kb_layer: true, components: ["component.loyalty-service"] });
  });

  it("3: represents the one-refund-per-order assumption as a dependency of the finance job", () => {
    expect(get("job.nightly-finance").data.depends_on).toContain("rule.single-refund-per-order");
    expect(get("system.legacy-erp").data.mode).toBe("described");
  });

  it("4: represents the two definitions of active customer as an open conflict", () => {
    expect(claims("term.active-customer")).toHaveLength(2);
    expect(conflicts("term.active-customer")[0]?.status).toBe("open");
  });

  it("5: represents the EU withdrawal right as a governing constraint with an unenforced rule (a gap)", () => {
    const governed = index.incoming("constraint.eu-withdrawal-right").filter((l) => l.type === "governed-by").map((l) => l.from);
    expect(governed).toEqual(expect.arrayContaining(["rule.refund-window", "rule.refund-approval-limit", "rule.eu-withdrawal-refund"]));
    expect(get("rule.eu-withdrawal-refund").data.enforcement).toEqual({ kb_layer: false });
    expect(get("rule.eu-withdrawal-refund").data.check).toBeUndefined();
  });

  it("6: represents manual gift-card reconciliation as a staff-only process with no system (a gap)", () => {
    const process = get("process.gift-card-reconciliation");
    expect(process.data.owned_by).toEqual(["actor.priya"]);
    expect(process.data.implemented_by).toBeUndefined();
    expect(claims("process.gift-card-reconciliation")[0]?.source).toContain("customer-service-handbook.md");
  });

  it("supporting: the refund email that assumes full refunds is notified by the refund action", () => {
    expect(get("action.issue-refund").data.notifies).toContain("interface.refund-email");
  });
});

describe("order cancellation capability (platform acceptance test content)", () => {
  it("is modelled entirely in KB files and validates", () => {
    const action = get("action.cancel-order");
    expect(action.data.mode).toBe("connected");
    expect(index.incoming("action.cancel-order").filter((l) => l.type === "enforced-on").map((l) => l.from).sort()).toEqual([
      "rule.cancel-before-delivery",
      "rule.cancellation-window",
    ]);
    expect(get("capability.ordering").data.realized_by).toEqual(["action.cancel-order"]);
    expect(new KbValidator().validate(nodes, issues).valid).toBe(true);
  });

  it("cites the orders service line that only cancels placed orders", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(fileURLToPath(new URL("../services/orders/src/main.ts", import.meta.url)), "utf8").split("\n");
    expect(claims("rule.cancel-before-delivery")[1]?.source).toBe("code:sample-org/services/orders/src/main.ts#L102");
    expect(source[101]).toContain("cannot be cancelled");
  });
});
