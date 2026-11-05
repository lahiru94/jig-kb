import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KbIndex, loadKb, loadSchemaMeta } from "../src/index";

const fixture = fileURLToPath(new URL("./fixtures/kb", import.meta.url));
const meta = loadSchemaMeta();
const build = (root: string) => new KbIndex(loadKb(root).nodes, meta);
const index = build(fixture);

describe("KB graph index", () => {
  it("records links in both directions (backlinks)", () => {
    const incoming = index.incoming("component.order-service").map((l) => `${l.from} ${l.type}`);
    expect(new Set(incoming)).toEqual(
      new Set([
        "binding.get-order binds-to",
        "entity.order part-of",
        "interface.order-email part-of",
        "rule.order-limit enforcement.components",
        "rule.order-limit implemented-by",
      ]),
    );
    expect(index.outgoing("rule.order-limit").map((l) => l.type)).toContain("implemented-by");
  });

  it("extracts nested links with their paths", () => {
    const links = index.outgoing("action.place-order").map((l) => `${l.type} ${l.to} @${l.path}`);
    expect(links).toContain("steps.binding binding.submit-order @steps[0].binding");
    expect(links).toContain("steps.compensate.binding binding.cancel-submission @steps[0].compensate.binding");
    expect(links).toContain("facts.binding binding.get-order @facts[0].binding");
  });

  it("filters by kind and by attribute", () => {
    expect(index.byKind("Binding").map((n) => n.id)).toEqual(["binding.cancel-submission", "binding.get-order", "binding.submit-order"]);
    expect(index.filter({ kind: "Binding", attrs: { binding_type: "sql" } }).map((n) => n.id)).toEqual([
      "binding.cancel-submission",
      "binding.submit-order",
    ]);
    expect(index.filter({ attrs: { roles: "role.ops-lead" } }).map((n) => n.id)).toEqual([
      "actor.sam",
      "agent.order-assistant",
      "permission.ops-place-order",
    ]);
  });

  it("traverses to a limited depth in breadth-first order", () => {
    const one = index.traverse("capability.ordering", { depth: 1 });
    expect(one.nodes[0]).toEqual({ id: "capability.ordering", depth: 0 });
    expect(one.nodes.every((n) => n.depth <= 1)).toBe(true);
    expect(one.nodes.map((n) => n.id)).toContain("rule.order-limit");
    const two = index.traverse("capability.ordering", { depth: 2 });
    expect(two.nodes.length).toBeGreaterThan(one.nodes.length);
    const outOnly = index.traverse("rule.order-limit", { depth: 1, direction: "out", linkTypes: ["implemented-by"] });
    expect(outOnly.nodes.map((n) => n.id)).toEqual(["rule.order-limit", "component.order-service"]);
  });

  it("searches text across titles, statements, claims and bodies", () => {
    expect(index.search("fraud").map((n) => n.id)).toEqual(["rule.order-limit"]);
    expect(index.search("order approval").map((n) => n.id)).toContain("rule.order-limit");
    expect(index.search("")).toEqual([]);
  });

  it("exposes data entity identity", () => {
    expect(index.identityOf("entity.order")).toEqual(["order_id"]);
  });

  it("rebuilds identically from the files", () => {
    const copy = mkdtempSync(join(tmpdir(), "jig-kb-"));
    try {
      cpSync(fixture, copy, { recursive: true });
      expect(build(copy).snapshot()).toEqual(index.snapshot());
      expect(build(fixture).snapshot()).toEqual(index.snapshot());
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
