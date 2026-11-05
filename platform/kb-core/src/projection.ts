import jsonld from "jsonld";
import type { KbNode } from "./loader";
import { loadJsonLdContext, type SchemaMeta } from "./schema-meta";

/** Namespace for KB node IRIs: `rule.order-limit` becomes `https://jig.skaleminds.com/kb/rule.order-limit`. */
export const KB_NAMESPACE = "https://jig.skaleminds.com/kb/";
export const SCHEMA_NAMESPACE = "https://jig.skaleminds.com/schema/jig/";

/** Slots whose order is meaningful (conflicts refer to claims by index), projected as RDF lists. */
const ORDERED_SLOTS = ["claims", "fields", "inputs", "facts", "steps", "identity"];

/** Nested attributes that hold node ids. */
const NESTED_LINK_ATTRIBUTES = ["components", "ref", "binding", "derivation"];

function buildContext(meta: SchemaMeta): unknown[] {
  const generated = (loadJsonLdContext()["@context"] ?? {}) as Record<string, unknown>;
  const overrides: Record<string, unknown> = { "@base": KB_NAMESPACE };
  for (const slot of [...meta.linkSources.keys(), ...NESTED_LINK_ATTRIBUTES]) {
    overrides[slot] = { "@id": `${SCHEMA_NAMESPACE}${slot}`, "@type": "@id" };
  }
  for (const slot of ORDERED_SLOTS) {
    const existing = overrides[slot] as Record<string, unknown> | undefined;
    overrides[slot] = { ...(existing ?? { "@id": `${SCHEMA_NAMESPACE}${slot}` }), "@container": "@list" };
  }
  // Conflict claim indexes share the `claims` name with node claims; keep them typed integers in a list.
  return [generated, overrides];
}

/**
 * Projects KB nodes to RDF (design D4). The result is canonical N-Quads (URDNA2015), one triple per
 * line, so the same files always give exactly the same triples.
 */
export class RdfProjector {
  private readonly context: unknown[];

  constructor(meta: SchemaMeta) {
    this.context = buildContext(meta);
  }

  toJsonLd(node: KbNode): Record<string, unknown> {
    const { id: _id, ...rest } = node.data;
    return {
      "@context": this.context,
      "@id": node.id,
      "@type": `${SCHEMA_NAMESPACE}${node.kind}`,
      ...rest,
    };
  }

  /** Canonical N-Quads lines for one node, sorted. */
  async project(node: KbNode): Promise<string[]> {
    // Safe mode makes canonize throw instead of silently dropping data that does not map to RDF.
    const options = { algorithm: "URDNA2015", format: "application/n-quads", safe: true } as jsonld.Options.Normalize;
    const nquads = (await jsonld.canonize(this.toJsonLd(node) as jsonld.JsonLdDocument, options)) as unknown as string;
    return nquads.split("\n").filter((line) => line.length > 0);
  }

  /** Canonical N-Quads for a whole KB, sorted by node id. Blank node labels are scoped per node. */
  async projectAll(nodes: readonly KbNode[]): Promise<string[]> {
    const out: string[] = [];
    for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      const lines = await this.project(node);
      out.push(...lines.map((line) => line.replace(/_:c14n(\d+)/g, (_m, n: string) => `_:${node.id.replace(/[^A-Za-z0-9]/g, "_")}_${n}`)));
    }
    return out;
  }
}
