import { loadKb, loadSchemaMeta, KbIndex, parseNodeFile, buildView, type KbNode } from "@jig/kb-core";
import { afterEach, describe, expect, it } from "vitest";
import { VIEW_SIZE_LIMIT, buildViewSpec, type ViewElement } from "../src/index";
import { casey, edited, governedService } from "./governed";
import { SAMPLE_KB } from "./helpers";

let env: Awaited<ReturnType<typeof governedService>> | undefined;
afterEach(() => {
  env?.cleanup();
  env = undefined;
});

const els = (spec: { elements: Array<Record<string, unknown>> }) => spec.elements as unknown as ViewElement[];

describe("visualize: scoped view specs", () => {
  it("a depth-2 explorer scope on capability.returns returns the nodes within two links", async () => {
    env = await governedService();
    const spec = await env.service.visualize(casey, { scope: { focus: "capability.returns", depth: 2 }, view: "explorer" });
    const expected = new KbIndex(loadKb(SAMPLE_KB).nodes, loadSchemaMeta()).traverse("capability.returns", { depth: 2 }).nodes.map((n) => n.id);
    // 57 nodes is above the size limit, so large groups are collapsed; their members still count.
    const shown = els(spec).flatMap((e) => (e.type === "group" ? (e.members ?? []) : [e.id]));
    expect(shown.sort()).toEqual([...expected].sort());
    expect(els(spec).some((e) => e.type === "group")).toBe(true);
    expect(spec).toMatchObject({ view: "explorer", title: "Around Returns and refunds", overlays: [] });
    expect(els(spec).find((e) => e.id === "capability.returns")?.depth).toBe(0);
    // Links only connect elements in the view.
    const ids = new Set(els(spec).filter((e) => e.type === "node").map((e) => e.id));
    expect(spec.links.every((l) => ids.has(String(l.from)) && ids.has(String(l.to)))).toBe(true);
  });

  it("every element carries its KB id and provenance", async () => {
    env = await governedService();
    const spec = await env.service.visualize(casey, { scope: { capability: "capability.returns" }, view: "explorer" });
    for (const el of els(spec)) {
      expect(el.provenance?.node).toBe(el.id);
      expect(el.provenance?.file).toMatch(/\.md$/);
    }
  });

  it("rule card: statement, claims with sources and confidence, conflicts, owner and enforcement", async () => {
    env = await governedService();
    const spec = await env.service.visualize(casey, { scope: { focus: "rule.refund-window" }, view: "rule-card" });
    const card = els(spec).find((e) => e.role === "rule");
    expect(card?.fields).toMatchObject({
      statement: "Customers may request a refund within 30 days of delivery.",
      owner: ["role.head-of-cs"],
      enforcement: { kb_layer: true, components: ["component.returns-service"] },
      has_check: true,
    });
    expect((card?.fields.claims as Array<{ confidence: string }>).map((c) => c.confidence)).toEqual(["stated", "inferred"]);
    expect((card?.fields.conflicts as Array<{ status: string }>)[0]?.status).toBe("open");
    expect(els(spec).filter((e) => e.role === "related").map((e) => e.id).sort()).toEqual([
      "action.issue-refund",
      "component.returns-service",
      "constraint.eu-withdrawal-right",
      "decision.2024-refund-policy",
      "role.head-of-cs",
    ]);
  });

  it("before/after: each changed node side by side with its change marked", async () => {
    env = await governedService();
    const { delta_id } = await env.service.propose_delta(casey, {
      title: "Raise the limit",
      rationale: "x",
      changes: [
        {
          op: "modify",
          id: "rule.refund-approval-limit",
          content: edited("rules/refund-approval-limit.md", "statement: Refunds over $500 need a supervisor's approval.", "statement: Refunds over $800 need a supervisor's approval."),
        },
        { op: "add", id: "goal.fast-refunds", content: "---\nid: goal.fast-refunds\nkind: Goal\ntitle: Refund within a day\n---\n" },
      ],
    });
    const spec = await env.service.visualize(casey, { scope: { delta: delta_id }, view: "before-after" });
    const [modified, added] = els(spec);
    expect(modified).toMatchObject({ id: "rule.refund-approval-limit", op: "modify", marks: { pending: "modified" } });
    expect(modified?.before?.statement).toBe("Refunds over $500 need a supervisor's approval.");
    expect(modified?.after?.statement).toBe("Refunds over $800 need a supervisor's approval.");
    expect(added).toMatchObject({ id: "goal.fast-refunds", op: "add", before: null, marks: { pending: "added" } });
  });

  it("impact: changed nodes and impacted nodes with their paths and risk", async () => {
    env = await governedService();
    const { delta_id } = await env.service.propose_delta(casey, {
      title: "Touch the refund action",
      rationale: "x",
      changes: [{ op: "modify", id: "action.issue-refund", content: edited("actions/issue-refund.md", "title: Issue a refund", "title: Issue a refund (full or partial)") }],
    });
    const spec = await env.service.visualize(casey, { scope: { delta: delta_id }, view: "impact" });
    expect(els(spec).filter((e) => e.role === "changed").map((e) => e.id)).toEqual(["action.issue-refund"]);
    const job = els(spec).find((e) => e.id === "job.nightly-finance");
    expect(job?.path).toEqual(["action.issue-refund", "<- enforced-on", "rule.single-refund-per-order", "<- depends-on", "job.nightly-finance"]);
    expect(job?.risk).toBeGreaterThan(0);
  });

  it("process: steps in order, with lanes, rules and actions", async () => {
    env = await governedService();
    const spec = await env.service.visualize(casey, { scope: { capability: "capability.returns" }, view: "process" });
    const steps = els(spec).filter((e) => e.role === "step").sort((a, b) => Number(a.fields.order) - Number(b.fields.order)).map((e) => e.id);
    expect(steps).toEqual(["step.check-eligibility", "step.approve-refund", "step.issue-refund", "step.notify-customer"]);
    expect(els(spec).filter((e) => e.role === "lane").map((e) => e.id).sort()).toEqual(["process.gift-card-reconciliation", "process.refund-handling"]);
    // Rules enforced on the capability's actions belong in the picture, even when they live in another capability.
    expect(els(spec).some((e) => e.role === "rule" && e.id === "rule.loyalty-clawback")).toBe(true);
    expect(els(spec).some((e) => e.role === "rule" && e.id === "rule.refund-window")).toBe(true);
  });
});

describe("overlays", () => {
  it("the conflicts overlay marks the refund window rule in the refunds process view", async () => {
    env = await governedService();
    const spec = await env.service.visualize(casey, { scope: { capability: "capability.returns" }, view: "process", overlays: ["conflicts"] });
    const window = els(spec).find((e) => e.id === "rule.refund-window");
    expect(window?.marks).toEqual({ conflicts: ["refund window for Gold members"] });
    expect(els(spec).find((e) => e.id === "rule.refund-approval-limit")?.marks).toEqual({});
  });

  it("confidence, ownership, enforcement and pending-delta overlays mark the elements they apply to", async () => {
    env = await governedService();
    const { delta_id } = await env.service.propose_delta(casey, {
      title: "x",
      rationale: "x",
      changes: [{ op: "modify", id: "rule.refund-window", content: edited("rules/refund-window.md", "title: Refund window", "title: Refund request window") }],
    });
    const spec = await env.service.visualize(casey, {
      scope: { delta: delta_id },
      view: "explorer",
      overlays: ["confidence", "ownership", "enforcement", "pending-delta"],
    });
    expect(els(spec)[0]?.marks).toEqual({
      confidence: "inferred",
      owner: ["role.head-of-cs"],
      enforcement: ["kb-layer", "component.returns-service"],
      pending: "modified",
    });
    const gap = await env.service.visualize(casey, { scope: { focus: "rule.eu-withdrawal-refund", depth: 0 }, view: "explorer", overlays: ["enforcement"] });
    expect(els(gap)[0]?.marks).toEqual({ enforcement: "not enforced" });
  });
});

describe("large subsets", () => {
  function bigKb(): KbNode[] {
    const nodes = loadKb(SAMPLE_KB).nodes;
    const extra: KbNode[] = [];
    for (let i = 1; i <= 42; i++) {
      const parsed = parseNodeFile(
        `---\nid: rule.payment-${i}\nkind: BusinessRule\ntitle: Payment rule ${i}\nstatement: Rule ${i}.\npart-of: [capability.returns]\nimplemented-by: [component.payments-service]\nenforcement: {kb-layer: false}\n---\n`,
        `rules/payment-${i}.md`,
      );
      if ("message" in parsed) throw new Error(parsed.message);
      parsed.data.part_of = ["component.payments-service"];
      extra.push(parsed);
    }
    return [...nodes, ...extra];
  }

  it("collapses 42 payment rules into one expandable element, and expands it on request", () => {
    const view = buildView("big", bigKb());
    const input = { scope: { focus: "component.payments-service", depth: 1 }, view: "explorer" as const };
    const spec = buildViewSpec({ view, viewId: "v1" }, input);
    const group = els(spec).find((e) => e.type === "group");
    expect(group).toMatchObject({ id: "group:BusinessRule:component.payments-service", title: "Payments service: 42 rules", count: 42 });
    expect(group?.members).toHaveLength(42);
    expect(els(spec).length).toBeLessThanOrEqual(VIEW_SIZE_LIMIT);
    const expanded = buildViewSpec({ view, viewId: "v2", expand: ["group:BusinessRule:component.payments-service"] }, input);
    expect(els(expanded).filter((e) => e.id.startsWith("rule.payment-"))).toHaveLength(42);
  });
});
