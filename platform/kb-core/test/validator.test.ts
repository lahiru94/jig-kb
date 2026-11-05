import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { KbValidator, isEnforceableByKb, loadKb, parseNodeFile, type KbNode, type ValidationReport } from "../src/index";

const fixture = fileURLToPath(new URL("./fixtures/kb", import.meta.url));
const base = loadKb(fixture).nodes;
let validator: KbValidator;

beforeAll(() => {
  validator = new KbValidator();
});

function node(text: string, file = "extra/node.md"): KbNode {
  const parsed = parseNodeFile(text, file);
  if ("message" in parsed) throw new Error(parsed.message);
  return parsed;
}

/** Validates the fixture KB with some nodes added or replaced (matched by id). */
function validateWith(...extra: KbNode[]): ValidationReport {
  const ids = new Set(extra.map((n) => n.id));
  return validator.validate([...base.filter((n) => !ids.has(n.id)), ...extra]);
}

const messages = (r: ValidationReport): string[] => r.errors.map((e) => e.message);

describe("KB validator (kb-model scenarios)", () => {
  it("accepts a node of a known kind with a unique id and title", () => {
    const report = validateWith(
      node(`---\nid: rule.new-rule\nkind: BusinessRule\ntitle: New rule\nstatement: Something holds.\nenforcement: {kb-layer: false}\n---\n`),
    );
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("rejects an unknown kind, naming the file and the kind", () => {
    const report = validateWith(node(`---\nid: widget.x\nkind: Widget\ntitle: X\n---\n`, "widgets/x.md"));
    expect(report.errors).toEqual([
      { file: "widgets/x.md", node: "widget.x", field: "kind", message: "unknown kind 'Widget'", schemaVersion: "0.1.0" },
    ]);
  });

  it("accepts a valid link from a BusinessRule to a Component", () => {
    expect(validateWith().errors).toEqual([]);
    const rule = base.find((n) => n.id === "rule.order-limit");
    expect(rule?.data.implemented_by).toEqual(["component.order-service"]);
  });

  it("rejects a dangling link, naming the source node and the missing target", () => {
    const report = validateWith(
      node(`---\nid: capability.billing\nkind: Capability\ntitle: Billing\nimplemented-by: [component.missing]\n---\n`),
    );
    expect(messages(report)).toEqual(["capability.billing links to missing node 'component.missing' via 'implemented-by'"]);
    expect(report.errors[0]?.field).toBe("implemented-by[0]");
  });

  it("rejects a link between disallowed kinds, naming the link type and the kinds", () => {
    const report = validateWith(
      node(`---\nid: term.customer\nkind: Term\ntitle: Customer\ndefinition: Someone who buys.\nimplemented-by: [role.ops-lead]\n---\n`),
    );
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toContain("link 'implemented-by' cannot connect Term to Role");
  });

  it("rejects a link whose target kind is not allowed for that link type", () => {
    const report = validateWith(
      node(`---\nid: capability.billing\nkind: Capability\ntitle: Billing\nimplemented-by: [role.ops-lead]\n---\n`),
    );
    expect(messages(report)).toEqual([
      "link 'implemented-by' cannot connect Capability to Role ('role.ops-lead'); allowed targets: Component, System, Job, Interface, Action",
    ]);
  });

  it("checks links nested inside objects, such as action step bindings", () => {
    const action = base.find((n) => n.id === "action.place-order") as KbNode;
    const broken: KbNode = {
      ...action,
      data: { ...action.data, steps: [{ name: "submit", kind: "binding-call", binding: "binding.nope" }] },
    };
    expect(messages(validateWith(broken))).toEqual(["action.place-order links to missing node 'binding.nope' via 'binding'"]);
  });

  it("accepts a claim inferred from code with its source and confidence", () => {
    const rule = base.find((n) => n.id === "rule.order-limit");
    const claims = rule?.data.claims as Array<Record<string, unknown>>;
    expect(claims[1]).toEqual({
      says: "Orders above 1500 need approval",
      source: "code:order-service/src/limits.ts#L10-L14",
      confidence: "inferred",
    });
  });

  it("rejects a claim without a source", () => {
    const report = validateWith(
      node(
        `---\nid: rule.unsourced\nkind: BusinessRule\ntitle: Unsourced\nstatement: X.\nenforcement: {kb-layer: false}\nclaims:\n  - says: Something\n    confidence: stated\n---\n`,
      ),
    );
    expect(messages(report)).toEqual(["claim 0 has no source"]);
    expect(report.errors[0]?.field).toBe("claims[0].source");
  });

  it("accepts an open conflict between a policy claim and a code claim", () => {
    const rule = base.find((n) => n.id === "rule.order-limit");
    expect(rule?.data.conflicts).toEqual([{ about: "approval threshold", claims: [0, 1], status: "open" }]);
    expect(validateWith().valid).toBe(true);
  });

  it("requires a resolved conflict to record the chosen claim and the resolver", () => {
    const rule = base.find((n) => n.id === "rule.order-limit") as KbNode;
    const unresolved: KbNode = {
      ...rule,
      data: { ...rule.data, conflicts: [{ about: "threshold", claims: [0, 1], status: "resolved" }] },
    };
    expect(messages(validateWith(unresolved))).toEqual([
      "resolved conflict 0 must name a chosen claim from its claims",
      "resolved conflict 0 must record who resolved it",
    ]);
    const resolved: KbNode = {
      ...rule,
      data: {
        ...rule.data,
        conflicts: [{ about: "threshold", claims: [0, 1], status: "resolved", chosen: 0, resolved_by: "actor.sam", resolved_at: "2026-10-01" }],
      },
    };
    expect(validateWith(resolved).errors).toEqual([]);
  });

  it("rejects conflicts that refer to claims that do not exist", () => {
    const rule = base.find((n) => n.id === "rule.order-limit") as KbNode;
    const bad: KbNode = { ...rule, data: { ...rule.data, conflicts: [{ about: "x", claims: [0, 5], status: "open" }] } };
    expect(messages(validateWith(bad))).toEqual(["conflict 0 refers to claim 5, which does not exist"]);
  });

  it("records a rule enforced in two places", () => {
    const rule = node(
      `---\nid: rule.two-places\nkind: BusinessRule\ntitle: Two places\nstatement: X.\nenforcement:\n  kb-layer: true\n  components: [component.order-service]\n---\n`,
    );
    expect(validateWith(rule).valid).toBe(true);
    expect(rule.data.enforcement).toEqual({ kb_layer: true, components: ["component.order-service"] });
  });

  it("reports a rule with a statement but no check as not enforceable by the KB layer", () => {
    const rule = node(`---\nid: rule.no-check\nkind: BusinessRule\ntitle: No check\nstatement: X.\nenforcement: {kb-layer: false}\n---\n`);
    expect(validateWith(rule).valid).toBe(true);
    expect(isEnforceableByKb(rule)).toBe(false);
    expect(isEnforceableByKb(base.find((n) => n.id === "rule.order-limit") as KbNode)).toBe(true);
  });

  it("reports the file, field and schema version for a missing required field", () => {
    const report = validateWith(node(`---\nid: rule.no-statement\nkind: BusinessRule\ntitle: No statement\nenforcement: {kb-layer: false}\n---\n`, "rules/no-statement.md"));
    expect(report.errors).toEqual([
      {
        file: "rules/no-statement.md",
        node: "rule.no-statement",
        field: "statement",
        message: "missing required field 'statement'",
        schemaVersion: "0.1.0",
      },
    ]);
  });

  it("rejects an untyped data entity field, naming the entity and the field", () => {
    const report = validateWith(
      node(`---\nid: entity.invoice\nkind: DataEntity\ntitle: Invoice\nidentity: [invoice_id]\nfields:\n  - name: invoice_id\n    type: string\n  - name: amount\n---\n`),
    );
    expect(messages(report)).toEqual(["field 'amount' of entity.invoice has no type"]);
  });

  it("requires identity fields to be declared fields", () => {
    const report = validateWith(
      node(`---\nid: entity.invoice\nkind: DataEntity\ntitle: Invoice\nidentity: [invoice_no]\nfields:\n  - name: invoice_id\n    type: string\n---\n`),
    );
    expect(messages(report)).toEqual(["identity field 'invoice_no' is not one of the fields of entity.invoice"]);
  });

  it("validates conditional permission declarations as Cedar against the KB", () => {
    expect(validateWith().valid).toBe(true);
    const bad = node(
      `---\nid: permission.bad\nkind: Permission\ntitle: Bad\noperation: action.place-order\nroles: [role.ops-lead]\nlevel: 2\ncondition: context.no_such_fact > 5\n---\n`,
    );
    const report = validateWith(bad);
    expect(report.valid).toBe(false);
    expect(report.errors[0]?.message).toContain("Cedar policy does not validate against the KB");
    expect(report.errors[0]?.field).toBe("condition");
  });

  it("type-checks CEL derivations", () => {
    const bad = node(
      `---\nid: derivation.bad\nkind: Derivation\ntitle: Bad\noutput-type: int\ninputs:\n  - name: count\n    type: int\n---\n\`\`\`cel\ncount + "x"\n\`\`\`\n`,
    );
    const report = validateWith(bad);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toContain("CEL expression does not type-check");
  });

  it("rejects an id whose prefix does not match its kind, and duplicate ids", () => {
    const report = validateWith(node(`---\nid: role.wrong\nkind: Goal\ntitle: Wrong\n---\n`));
    expect(messages(report)).toEqual(["id 'role.wrong' must start with 'goal.' for kind Goal"]);
    const dup = node(`---\nid: role.ops-lead\nkind: Role\ntitle: Duplicate\n---\n`, "roles/dup.md");
    const dupReport = validator.validate([...base, dup]);
    expect(messages(dupReport)).toEqual(["duplicate id 'role.ops-lead' (also defined in roles/ops-lead.md)"]);
  });
});
