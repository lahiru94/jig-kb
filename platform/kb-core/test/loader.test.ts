import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KINDS, fencedBlocks, loadKb, parseNodeFile } from "../src/index";

const fixture = fileURLToPath(new URL("./fixtures/kb", import.meta.url));

describe("KB loader", () => {
  const { nodes, issues } = loadKb(fixture);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  it("loads a fixture KB covering every node kind without issues", () => {
    expect(issues).toEqual([]);
    expect(new Set(nodes.map((n) => n.kind))).toEqual(new Set(KINDS.map((k) => k.kind)));
  });

  it("normalises kebab-case keys to snake_case but leaves free-form maps alone", () => {
    const rule = byId.get("rule.order-limit");
    expect(rule?.data.implemented_by).toEqual(["component.order-service"]);
    expect(rule?.data.enforcement).toEqual({ kb_layer: true, components: ["component.order-service"] });
    expect(rule?.data.override_threshold).toEqual({ rate: 0.8, window_days: 7, min_samples: 10 });
    const action = byId.get("action.place-order");
    const steps = action?.data.steps as Array<Record<string, unknown>>;
    expect(steps[0]?.with).toEqual({ order_id: "$input.order_id" });
  });

  it("fills check, policy_text and expression slots from fenced body blocks", () => {
    expect(byId.get("rule.order-limit")?.data.check).toContain('forbid (principal, action == Action::"action.place-order"');
    expect(byId.get("policy.ops-only")?.data.policy_text).toContain("unless { principal in Role::\"role.ops-lead\" }");
    expect(byId.get("derivation.order-total")?.data.expression).toBe("subtotal + tax");
  });

  it("keeps dates as strings and records the relative file path", () => {
    const decision = byId.get("decision.2024-order-limit");
    expect(decision?.data.decided_at).toBe("2024-03-01");
    expect(decision?.file).toBe("decisions/2024-order-limit.md");
  });

  it("reports malformed files as issues instead of throwing", () => {
    expect(parseNodeFile("no frontmatter", "x.md")).toEqual({
      file: "x.md",
      message: "missing YAML frontmatter (the file must start with ---)",
    });
    const bad = parseNodeFile("---\nid: [unclosed\n---\n", "y.md");
    expect("message" in bad && bad.message.startsWith("invalid YAML frontmatter")).toBe(true);
  });

  it("extracts every fenced block of a language", () => {
    expect(fencedBlocks("```cel\na\n```\ntext\n```cel\nb\n```\n", "cel")).toEqual(["a", "b"]);
  });
});
