import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KB_NAMESPACE, RdfProjector, SCHEMA_NAMESPACE, loadKb, loadSchemaMeta, type KbNode } from "../src/index";

const fixture = fileURLToPath(new URL("./fixtures/kb", import.meta.url));
const projector = new RdfProjector(loadSchemaMeta());

type Scalar = string | number | boolean;

function scalarLeaves(value: unknown, out: Scalar[] = []): Scalar[] {
  if (Array.isArray(value)) value.forEach((v) => scalarLeaves(v, out));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((v) => scalarLeaves(v, out));
  else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out.push(value);
  return out;
}

describe("RDF projection", () => {
  it("projects the fixture KB to identical triples every time", async () => {
    const first = await projector.projectAll(loadKb(fixture).nodes);
    const second = await projector.projectAll(loadKb(fixture).nodes);
    expect(first.length).toBeGreaterThan(100);
    expect(second).toEqual(first);
  });

  it("types nodes and turns links into IRIs", async () => {
    const node = loadKb(fixture).nodes.find((n) => n.id === "rule.order-limit") as KbNode;
    const triples = await projector.project(node);
    const subject = `<${KB_NAMESPACE}rule.order-limit>`;
    expect(triples).toContain(`${subject} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${SCHEMA_NAMESPACE}BusinessRule> .`);
    expect(triples).toContain(`${subject} <${SCHEMA_NAMESPACE}implemented_by> <${KB_NAMESPACE}component.order-service> .`);
  });

  it("is lossless for frontmatter facts: every scalar value appears in the triples", async () => {
    for (const node of loadKb(fixture).nodes) {
      const text = (await projector.project(node)).join("\n");
      const numbers = new Set(
        [...text.matchAll(/"([^"]*)"\^\^<http:\/\/www\.w3\.org\/2001\/XMLSchema#(?:double|float|integer|decimal)>/g)].map((m) => Number(m[1])),
      );
      for (const leaf of scalarLeaves(node.data)) {
        const found = typeof leaf === "number" ? numbers.has(leaf) : text.includes(JSON.stringify(String(leaf)).slice(1, -1));
        expect(found, `${node.id}: value ${String(leaf)}`).toBe(true);
      }
    }
  });
});
