import type { KbNode } from "./loader";
import type { SchemaMeta } from "./schema-meta";

/** A typed, directed link between two nodes. */
export interface KbLink {
  from: string;
  to: string;
  /** Link type in kebab-case; nested links are prefixed by their container, for example `steps.binding`. */
  type: string;
  /** Frontmatter path the link was declared at, for example `steps[0].binding`. */
  path: string;
}

export interface NodeFilter {
  kind?: string | string[];
  /** Exact-match attribute filters on frontmatter (snake_case keys). Array attributes match if they contain the value. */
  attrs?: Record<string, unknown>;
}

export interface TraverseOptions {
  depth: number;
  direction?: "out" | "in" | "both";
  /** Restrict to these link types. */
  linkTypes?: readonly string[];
}

export interface Traversal {
  /** Node ids with their distance from the focus, in breadth-first order. */
  nodes: Array<{ id: string; depth: number }>;
  links: KbLink[];
}

const kebab = (s: string): string => s.replace(/_/g, "-");

function pathString(segments: Array<string | number>): string {
  return segments.map((s, i) => (typeof s === "number" ? `[${s}]` : `${i === 0 ? "" : "."}${kebab(s)}`)).join("");
}

/** Extracts every link a node declares, including links nested in objects such as action steps. */
export function extractLinks(node: KbNode, meta: SchemaMeta): KbLink[] {
  const links: KbLink[] = [];
  const walk = (className: string, obj: Record<string, unknown>, path: Array<string | number>, container: string[]): void => {
    const slots = meta.slotsOf(className);
    for (const key of Object.keys(obj).sort()) {
      const value = obj[key];
      const slot = slots.get(key);
      if (!slot) continue;
      if (slot.linkTargets) {
        const type = [...container, kebab(key)].join(".");
        const ids = Array.isArray(value) ? value : [value];
        ids.forEach((id, index) => {
          if (typeof id !== "string" || id === "") return;
          const segs = Array.isArray(value) ? [...path, key, index] : [...path, key];
          links.push({ from: node.id, to: id, type, path: pathString(segs) });
        });
      } else if (slot.range && meta.isClass(slot.range) && slot.range !== "Any") {
        const items = Array.isArray(value) ? value : [value];
        items.forEach((item, index) => {
          if (item === null || typeof item !== "object" || Array.isArray(item)) return;
          const segs = Array.isArray(value) ? [...path, key, index] : [...path, key];
          walk(slot.range as string, item as Record<string, unknown>, segs, [...container, kebab(key)]);
        });
      }
    }
  };
  walk(node.kind, node.data, [], []);
  return links;
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

function searchableText(node: KbNode): string {
  const d = node.data;
  const parts = [node.id, node.title, d.description, d.statement, d.definition, node.body];
  for (const claim of Array.isArray(d.claims) ? (d.claims as Array<Record<string, unknown>>) : []) parts.push(claim.says);
  return parts.filter((p): p is string => typeof p === "string").join(" ");
}

/** In-memory graph index derived from KB files (design D5). Rebuilding from the same files gives the same index. */
export class KbIndex {
  private readonly nodesById = new Map<string, KbNode>();
  private readonly out = new Map<string, KbLink[]>();
  private readonly inc = new Map<string, KbLink[]>();
  private readonly byKindMap = new Map<string, KbNode[]>();
  private readonly textIndex = new Map<string, Set<string>>();

  constructor(nodes: readonly KbNode[], meta: SchemaMeta) {
    const sorted = [...nodes].filter((n) => n.id).sort((a, b) => a.id.localeCompare(b.id));
    for (const node of sorted) {
      this.nodesById.set(node.id, node);
      const list = this.byKindMap.get(node.kind) ?? [];
      list.push(node);
      this.byKindMap.set(node.kind, list);
      for (const token of new Set(tokens(searchableText(node)))) {
        const ids = this.textIndex.get(token) ?? new Set<string>();
        ids.add(node.id);
        this.textIndex.set(token, ids);
      }
    }
    for (const node of sorted) {
      for (const link of extractLinks(node, meta)) {
        (this.out.get(link.from) ?? this.out.set(link.from, []).get(link.from)!).push(link);
        (this.inc.get(link.to) ?? this.inc.set(link.to, []).get(link.to)!).push(link);
      }
    }
  }

  get size(): number {
    return this.nodesById.size;
  }

  get(id: string): KbNode | undefined {
    return this.nodesById.get(id);
  }

  has(id: string): boolean {
    return this.nodesById.has(id);
  }

  all(): KbNode[] {
    return [...this.nodesById.values()];
  }

  byKind(kind: string): KbNode[] {
    return [...(this.byKindMap.get(kind) ?? [])];
  }

  filter(filter: NodeFilter): KbNode[] {
    const kinds = filter.kind === undefined ? undefined : new Set(Array.isArray(filter.kind) ? filter.kind : [filter.kind]);
    return this.all().filter((node) => {
      if (kinds && !kinds.has(node.kind)) return false;
      for (const [key, expected] of Object.entries(filter.attrs ?? {})) {
        const actual = node.data[key];
        if (Array.isArray(actual) ? !actual.includes(expected) : actual !== expected) return false;
      }
      return true;
    });
  }

  /** Links declared by a node. */
  outgoing(id: string): KbLink[] {
    return [...(this.out.get(id) ?? [])];
  }

  /** Links pointing at a node (backlinks). */
  incoming(id: string): KbLink[] {
    return [...(this.inc.get(id) ?? [])];
  }

  /** Breadth-first traversal from a focus node, up to `depth` links away. */
  traverse(focus: string, options: TraverseOptions): Traversal {
    const direction = options.direction ?? "both";
    const allowed = options.linkTypes ? new Set(options.linkTypes) : undefined;
    const seen = new Map<string, number>([[focus, 0]]);
    const order: Array<{ id: string; depth: number }> = this.has(focus) ? [{ id: focus, depth: 0 }] : [];
    const links = new Map<string, KbLink>();
    let frontier = this.has(focus) ? [focus] : [];
    for (let depth = 1; depth <= options.depth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        const candidates: Array<{ link: KbLink; other: string }> = [];
        if (direction !== "in") for (const link of this.outgoing(id)) candidates.push({ link, other: link.to });
        if (direction !== "out") for (const link of this.incoming(id)) candidates.push({ link, other: link.from });
        for (const { link, other } of candidates) {
          if (allowed && !allowed.has(link.type)) continue;
          if (!this.has(other)) continue;
          links.set(`${link.from}|${link.type}|${link.to}|${link.path}`, link);
          if (!seen.has(other)) {
            seen.set(other, depth);
            order.push({ id: other, depth });
            next.push(other);
          }
        }
      }
      frontier = next.sort();
    }
    return { nodes: order, links: [...links.values()].sort((a, b) => `${a.from}${a.type}${a.to}`.localeCompare(`${b.from}${b.type}${b.to}`)) };
  }

  /** Nodes whose text contains every query token. Results are sorted by id. */
  search(query: string): KbNode[] {
    const queryTokens = tokens(query);
    if (queryTokens.length === 0) return [];
    let result: Set<string> | undefined;
    for (const token of queryTokens) {
      const matches = new Set<string>();
      for (const [indexed, ids] of this.textIndex) if (indexed.startsWith(token)) for (const id of ids) matches.add(id);
      result = result ? new Set([...result].filter((id) => matches.has(id))) : matches;
    }
    return [...(result ?? [])].sort().map((id) => this.nodesById.get(id) as KbNode);
  }

  /** Identity fields of a DataEntity. */
  identityOf(entityId: string): string[] {
    const identity = this.get(entityId)?.data.identity;
    return Array.isArray(identity) ? identity.filter((f): f is string => typeof f === "string") : [];
  }

  /** A stable, serialisable snapshot of the whole index (used to check rebuilds). */
  snapshot(): { nodes: Array<{ id: string; kind: string; data: Record<string, unknown> }>; links: KbLink[] } {
    return {
      nodes: this.all().map((n) => ({ id: n.id, kind: n.kind, data: n.data })),
      links: this.all().flatMap((n) => this.outgoing(n.id)),
    };
  }
}
