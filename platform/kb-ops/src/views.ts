import { kindInfo, type KbIndex, type KbLink, type KbNode, type KbView, type NodeChange } from "@jig/kb-core";
import { analyzeImpact } from "@jig/governance";
import { nodeConfidence } from "./query";
import type { ToolInput, ToolOutput } from "./tools";
import { OperationError } from "./types";

export type ViewSpec = ToolOutput<"visualize">;
type Overlay = NonNullable<ToolInput<"visualize">["overlays"]>[number];

/** Above this many elements, groups of similar nodes collapse into summary elements (kb-visualization spec). */
export const VIEW_SIZE_LIMIT = 40;
/** A group collapses when it has more members than this. */
export const GROUP_MIN = 8;

export interface ViewElement {
  id: string;
  type: "node" | "group";
  kind: string;
  title: string;
  layer?: string;
  depth?: number;
  /** Fields the view shows, taken from the node. */
  fields: Record<string, unknown>;
  /** Where every element comes from: its KB node, file and claims. */
  provenance: { node: string; file: string; claims: unknown[]; confidence: string } | null;
  marks: Record<string, unknown>;
  /** For groups: the member ids and count. */
  members?: string[];
  count?: number;
  /** View-specific placement, such as the lane of a process step or the path of an impacted node. */
  role?: string;
  path?: string[];
  risk?: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  op?: string;
}

const SHOWN_FIELDS = ["statement", "definition", "description", "mode", "status", "level", "operation"];

function fieldsOf(node: KbNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SHOWN_FIELDS) if (node.data[key] !== undefined) out[key] = node.data[key];
  return out;
}

function element(node: KbNode, extra: Partial<ViewElement> = {}): ViewElement {
  return {
    id: node.id,
    type: "node",
    kind: node.kind,
    title: node.title,
    ...(kindInfo(node.kind) ? { layer: kindInfo(node.kind)?.layer as string } : {}),
    fields: fieldsOf(node),
    provenance: {
      node: node.id,
      file: node.file,
      claims: Array.isArray(node.data.claims) ? (node.data.claims as unknown[]) : [],
      confidence: nodeConfidence(node),
    },
    marks: {},
    ...extra,
  };
}

/** Marks for one element, for the requested overlays only. */
function overlayMarks(node: KbNode, overlays: readonly Overlay[], pending: Map<string, string>): Record<string, unknown> {
  const marks: Record<string, unknown> = {};
  for (const overlay of overlays) {
    switch (overlay) {
      case "confidence":
        marks.confidence = nodeConfidence(node);
        break;
      case "conflicts": {
        const conflicts = (Array.isArray(node.data.conflicts) ? node.data.conflicts : []) as Array<{ status?: string; about?: string }>;
        const open = conflicts.filter((c) => c.status === "open");
        if (open.length > 0) marks.conflicts = open.map((c) => c.about ?? "conflict");
        break;
      }
      case "ownership":
        if (Array.isArray(node.data.owned_by)) marks.owner = node.data.owned_by;
        break;
      case "enforcement": {
        const enforcement = node.data.enforcement as { kb_layer?: boolean; components?: string[] } | undefined;
        if (node.kind === "BusinessRule") {
          const where = [...(enforcement?.kb_layer ? ["kb-layer"] : []), ...(enforcement?.components ?? [])];
          marks.enforcement = where.length > 0 ? where : "not enforced";
        }
        break;
      }
      case "pending-delta":
        if (pending.has(node.id)) marks.pending = pending.get(node.id);
        break;
    }
  }
  return marks;
}

function linksAmong(index: KbIndex, ids: ReadonlySet<string>): KbLink[] {
  return [...ids].flatMap((id) => index.outgoing(id)).filter((l) => ids.has(l.to));
}

/** Nodes of a capability: its parts (transitively), the rules and actions on them, and what implements it. */
function capabilityScope(index: KbIndex, capabilityId: string): string[] {
  const ids = new Set<string>([capabilityId]);
  const parts = index.traverse(capabilityId, { depth: 3, direction: "in", linkTypes: ["part-of"] });
  for (const n of parts.nodes) ids.add(n.id);
  for (const id of [...ids]) {
    for (const l of index.outgoing(id)) if (["implemented-by", "realized-by"].includes(l.type)) ids.add(l.to);
    for (const l of index.incoming(id)) if (l.type === "enforced-on") ids.add(l.from);
  }
  return [...ids];
}

export interface ViewContext {
  view: KbView;
  /** For delta scopes: the KB before, the KB after and the changes. */
  delta?: { id: string; before: KbView; after: KbView; changes: NodeChange[] };
  viewId: string;
  expand?: readonly string[];
}

/** Collapses large groups of same-kind siblings into summary elements, unless they are expanded. */
function collapse(elements: ViewElement[], index: KbIndex, expand: ReadonlySet<string>): ViewElement[] {
  if (elements.length <= VIEW_SIZE_LIMIT) return elements;
  const groups = new Map<string, ViewElement[]>();
  for (const el of elements) {
    if (el.type !== "node" || (el.depth ?? 1) === 0) continue;
    const node = index.get(el.id);
    const parent = Array.isArray(node?.data.part_of) ? String((node?.data.part_of as string[])[0]) : "none";
    const key = `group:${el.kind}:${parent}`;
    groups.set(key, [...(groups.get(key) ?? []), el]);
  }
  const collapsed = new Set<string>();
  const summaries: ViewElement[] = [];
  for (const [key, members] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    if (members.length <= GROUP_MIN || expand.has(key)) continue;
    const [, kind = "", parent = "none"] = key.split(":");
    const parentNode = index.get(parent);
    const label = kindInfo(kind)?.dir ?? kind;
    summaries.push({
      id: key,
      type: "group",
      kind,
      title: `${parentNode?.title ?? "Other"}: ${members.length} ${label}`,
      fields: {},
      provenance: null,
      marks: {},
      members: members.map((m) => m.id),
      count: members.length,
    });
    for (const m of members) collapsed.add(m.id);
  }
  return [...elements.filter((e) => !collapsed.has(e.id)), ...summaries];
}

/** Builds a view spec from KB data only (kb-visualization spec). */
export function buildViewSpec(ctx: ViewContext, input: ToolInput<"visualize">): ViewSpec {
  const { view } = ctx;
  const index = view.index;
  const overlays = input.overlays ?? [];
  const pending = new Map<string, string>((ctx.delta?.changes ?? []).map((c) => [c.id, c.op === "add" ? "added" : c.op === "remove" ? "removed" : "modified"]));
  const scope = input.scope;
  let elements: ViewElement[] = [];
  let title = "";

  const nodeEl = (id: string, extra: Partial<ViewElement> = {}): ViewElement | undefined => {
    const node = index.get(id) ?? ctx.delta?.before.index.get(id);
    if (!node) return undefined;
    const el = element(node, extra);
    el.marks = overlayMarks(node, overlays, pending);
    return el;
  };

  switch (input.view) {
    case "explorer": {
      let ids: Array<{ id: string; depth: number }>;
      if (scope.focus) {
        ids = index.traverse(scope.focus, { depth: scope.depth ?? 1 }).nodes;
        title = `Around ${index.get(scope.focus)?.title ?? scope.focus}`;
      } else if (scope.capability) {
        ids = capabilityScope(index, scope.capability).map((id) => ({ id, depth: id === scope.capability ? 0 : 1 }));
        title = index.get(scope.capability)?.title ?? scope.capability;
      } else if (scope.query) {
        ids = index.search(scope.query).map((n) => ({ id: n.id, depth: 1 }));
        title = `Search: ${scope.query}`;
      } else if (ctx.delta) {
        ids = ctx.delta.changes.map((c) => ({ id: c.id, depth: 0 }));
        title = `Changes in ${ctx.delta.id}`;
      } else throw new OperationError("invalid_input", "explorer needs a focus, capability, query or delta scope", { field: "scope" });
      elements = ids.map((n) => nodeEl(n.id, { depth: n.depth })).filter((e): e is ViewElement => e !== undefined);
      break;
    }
    case "process": {
      const root = scope.capability ?? scope.focus;
      if (!root) throw new OperationError("invalid_input", "a process view needs a capability or process focus", { field: "scope" });
      const ids = capabilityScope(index, root);
      title = `How ${index.get(root)?.title ?? root} works`;
      const order = (n: KbNode): number => Number(/Step (\d+)/.exec(String(n.data.description ?? ""))?.[1] ?? 99);
      for (const id of ids) {
        const node = index.get(id);
        if (!node) continue;
        const role = node.kind === "Step" ? "step" : node.kind === "Process" ? "lane" : node.kind === "BusinessRule" ? "rule" : node.kind === "Action" ? "action" : "system";
        const el = nodeEl(id, { role, ...(node.kind === "Step" ? { fields: { ...fieldsOf(node), order: order(node) } } : {}) });
        if (el) elements.push(el);
      }
      break;
    }
    case "rule-card": {
      const ruleId = scope.focus;
      const rule = ruleId ? index.get(ruleId) : undefined;
      if (!rule || rule.kind !== "BusinessRule") throw new OperationError("invalid_input", "a rule card needs a BusinessRule focus", { field: "scope.focus" });
      title = rule.title;
      const enforcement = rule.data.enforcement as { kb_layer?: boolean; components?: string[] } | undefined;
      const card = nodeEl(rule.id, {
        role: "rule",
        fields: {
          ...fieldsOf(rule),
          claims: rule.data.claims ?? [],
          conflicts: rule.data.conflicts ?? [],
          owner: rule.data.owned_by ?? [],
          enforcement: { kb_layer: enforcement?.kb_layer ?? false, components: enforcement?.components ?? [] },
          has_check: typeof rule.data.check === "string",
        },
      });
      if (card) elements.push(card);
      const related = new Set<string>([...(enforcement?.components ?? []), ...((rule.data.owned_by as string[] | undefined) ?? [])]);
      for (const l of index.outgoing(rule.id)) if (["governed-by", "enforced-on", "decided-by"].includes(l.type)) related.add(l.to);
      for (const id of related) {
        const el = nodeEl(id, { role: "related" });
        if (el) elements.push(el);
      }
      break;
    }
    case "impact": {
      if (!ctx.delta) throw new OperationError("invalid_input", "an impact view needs a delta scope", { field: "scope.delta" });
      const { changed, impacted } = analyzeImpact(ctx.delta.before, ctx.delta.after, ctx.delta.changes);
      title = `What ${ctx.delta.id} touches`;
      for (const id of changed) {
        const el = nodeEl(id, { role: "changed", depth: 0 });
        if (el) elements.push(el);
      }
      for (const item of impacted) {
        const el = nodeEl(item.id, { role: "impacted", path: item.path, risk: item.risk, depth: (item.path.length - 1) / 2 });
        if (el) elements.push(el);
      }
      break;
    }
    case "before-after": {
      if (!ctx.delta) throw new OperationError("invalid_input", "a before/after view needs a delta scope", { field: "scope.delta" });
      title = `Before and after ${ctx.delta.id}`;
      for (const change of ctx.delta.changes) {
        const before = ctx.delta.before.index.get(change.id);
        const after = ctx.delta.after.index.get(change.id);
        const node = after ?? before;
        if (!node) continue;
        const el = element(node, {
          role: "change",
          op: change.op,
          before: before ? { title: before.title, ...before.data } : null,
          after: after ? { title: after.title, ...after.data } : null,
        });
        el.marks = { ...overlayMarks(node, overlays, pending), pending: pending.get(change.id) };
        elements.push(el);
      }
      break;
    }
  }

  const expand = new Set(ctx.expand ?? []);
  const shown = collapse(elements, index, expand);
  const ids = new Set(shown.filter((e) => e.type === "node").map((e) => e.id));
  const linkIndex = input.view === "impact" || input.view === "before-after" ? (ctx.delta?.after.index ?? index) : index;
  return {
    view_id: ctx.viewId,
    view: input.view,
    title,
    elements: shown as unknown as Array<Record<string, unknown>>,
    links: linksAmong(linkIndex, ids) as unknown as Array<Record<string, unknown>>,
    overlays,
    as_of: ctx.delta ? `${ctx.delta.id}@${view.version}` : view.version,
  };
}
