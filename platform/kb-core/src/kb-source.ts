import { KbIndex } from "./index-graph";
import { loadKb, parseNodeFile, type KbNode } from "./loader";
import { loadSchemaMeta, type SchemaMeta } from "./schema-meta";
import { KbValidator } from "./validator";

/** One version of the KB, ready to query. */
export interface KbView {
  /** Commit id, delta id or another stable version label. */
  version: string;
  nodes: KbNode[];
  index: KbIndex;
}

/** A change to one node in a delta. */
export interface NodeChange {
  op: "add" | "modify" | "remove";
  id: string;
  /** Full file content for add and modify. */
  content?: string;
}

/** Read access to deltas, as kb-ops needs it. Governance's delta store implements this. */
export interface DeltaReader {
  get(id: string): { id: string; changes: NodeChange[] } | undefined;
}

/** Where kb-ops reads the KB from. A git-backed source (change governance) implements `asOf` for commits and deltas. */
export interface KbSource {
  current(): KbView;
  /** The KB at a version (commit id), or with a delta applied (delta id). Undefined when unknown. */
  asOf(ref: string): KbView | undefined;
}

export function buildView(version: string, nodes: KbNode[], meta: SchemaMeta = loadSchemaMeta()): KbView {
  return { version, nodes, index: new KbIndex(nodes, meta) };
}

/** Parses a delta change's content into a node, or returns the parse problem. */
export function changeNode(change: NodeChange): KbNode | { message: string } {
  if (change.content === undefined) return { message: `change to '${change.id}' has no content` };
  const parsed = parseNodeFile(change.content, `delta/${change.id}.md`);
  if ("message" in parsed) return { message: parsed.message };
  if (parsed.id !== change.id) return { message: `change content has id '${parsed.id}', expected '${change.id}'` };
  return parsed;
}

/** Applies changes to a set of nodes (an overlay, without touching files). */
export function applyChanges(nodes: readonly KbNode[], changes: readonly NodeChange[]): KbNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const change of changes) {
    if (change.op === "remove") {
      byId.delete(change.id);
      continue;
    }
    const node = changeNode(change);
    if ("message" in node) continue;
    const prior = byId.get(change.id);
    byId.set(change.id, prior ? { ...node, file: prior.file } : node);
  }
  return [...byId.values()];
}

/** A KB loaded once from a directory. Delta views are overlays from the given delta reader. */
export class DirectoryKbSource implements KbSource {
  private view: KbView;
  private readonly meta: SchemaMeta;

  constructor(
    private readonly dir: string,
    private readonly deltas?: DeltaReader,
    readonly validator: KbValidator = new KbValidator(),
  ) {
    this.meta = validator.meta;
    this.view = buildView("working-tree", loadKb(dir).nodes, this.meta);
  }

  reload(): void {
    this.view = buildView("working-tree", loadKb(this.dir).nodes, this.meta);
  }

  current(): KbView {
    return this.view;
  }

  asOf(ref: string): KbView | undefined {
    if (ref === this.view.version) return this.view;
    const delta = this.deltas?.get(ref);
    if (!delta) return undefined;
    return buildView(ref, applyChanges(this.view.nodes, delta.changes), this.meta);
  }
}
