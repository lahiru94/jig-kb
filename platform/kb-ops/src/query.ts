import type { KbLink, KbNode } from "@jig/kb-core";
import type { KbView } from "@jig/kb-core";
import type { ToolInput, ToolOutput } from "./tools";

type Claim = { says: string; source: string; confidence: "inferred" | "stated" | "verified" };
type Confidence = Claim["confidence"] | "none";

const RANK: Record<Claim["confidence"], number> = { inferred: 0, stated: 1, verified: 2 };

/** The lowest confidence among a node's claims: a node is only as trustworthy as its weakest claim. */
export function nodeConfidence(node: KbNode): Confidence {
  const claims = (Array.isArray(node.data.claims) ? node.data.claims : []) as Claim[];
  if (claims.length === 0) return "none";
  return claims.reduce<Claim["confidence"]>((lowest, c) => (RANK[c.confidence] < RANK[lowest] ? c.confidence : lowest), "verified");
}

export function describeNode(node: KbNode): ToolOutput<"query">["nodes"][number] {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    file: node.file,
    data: node.data,
    claims: (Array.isArray(node.data.claims) ? node.data.claims : []) as Claim[],
    conflicts: (Array.isArray(node.data.conflicts) ? node.data.conflicts : []) as Array<Record<string, unknown>>,
    confidence: nodeConfidence(node),
  };
}

/** Runs a query: traversal from a focus node, then kind, attribute and text filters. */
export function runQuery(view: KbView, input: ToolInput<"query">): ToolOutput<"query"> {
  const { index } = view;
  let candidates: KbNode[];
  let links: KbLink[];
  if (input.focus !== undefined) {
    const traversal = index.traverse(input.focus, {
      depth: input.depth ?? 1,
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.link_types ? { linkTypes: input.link_types } : {}),
    });
    candidates = traversal.nodes.map((n) => index.get(n.id) as KbNode);
    links = traversal.links;
  } else {
    candidates = index.all();
    links = [];
  }
  const filtered = index.filter({ ...(input.kind !== undefined ? { kind: input.kind } : {}), ...(input.attrs ? { attrs: input.attrs } : {}) });
  const allowed = new Set(filtered.map((n) => n.id));
  let nodes = candidates.filter((n) => allowed.has(n.id));
  if (input.text !== undefined && input.text.trim() !== "") {
    const matches = new Set(index.search(input.text).map((n) => n.id));
    nodes = nodes.filter((n) => matches.has(n.id));
  }
  const ids = new Set(nodes.map((n) => n.id));
  if (input.focus === undefined) {
    links = nodes.flatMap((n) => index.outgoing(n.id)).filter((l) => ids.has(l.to));
  } else {
    // Keep links that connect the results to each other or to the focus.
    links = links.filter((l) => (ids.has(l.from) || l.from === input.focus) && (ids.has(l.to) || l.to === input.focus));
  }
  return { nodes: nodes.map(describeNode), links };
}
