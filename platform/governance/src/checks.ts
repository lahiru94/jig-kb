import { applyChanges, changeNode, type KbNode, type KbValidator, type KbView, type NodeChange, type ValidationReport } from "@jig/kb-core";

/** Fields whose change counts as wording only: text people read, not structure the platform acts on. */
const WORDING_FIELDS = new Set(["title", "description", "statement", "definition"]);

/**
 * Validates a delta as if it were applied to `base` (change-governance spec): the whole resulting KB
 * is validated, so removals that break links and additions with bad links are both caught. Errors are
 * limited to what the delta caused, so existing problems elsewhere do not block it.
 */
export function validateDelta(validator: KbValidator, base: KbView, changes: readonly NodeChange[]): ValidationReport {
  const parseErrors = changes.flatMap((c) => {
    if (c.op === "remove") return [];
    const node = changeNode(c);
    return "message" in node ? [{ file: `delta/${c.id}.md`, node: c.id, message: node.message, schemaVersion: validator.meta.version }] : [];
  });
  const after = applyChanges(base.nodes, changes);
  const report = validator.validate(after);
  const before = validator.validate(base.nodes);
  const known = new Set(before.errors.map((e) => `${e.file}|${e.field ?? ""}|${e.message}`));
  const errors = [...parseErrors, ...report.errors.filter((e) => !known.has(`${e.file}|${e.field ?? ""}|${e.message}`))];
  return { valid: errors.length === 0, schemaVersion: report.schemaVersion, errors };
}

function stripWording(node: KbNode): string {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.data)) if (!WORDING_FIELDS.has(k)) data[k] = v;
  // Executable blocks in the body are structure; prose is wording.
  const blocks = [...node.body.matchAll(/```(cedar|cel)[\s\S]*?```/g)].map((m) => m[0]);
  return JSON.stringify({ data, blocks });
}

/** `wording` when every change only edits text of existing nodes; `structure` otherwise. */
export function changeScope(base: KbView, changes: readonly NodeChange[]): "wording" | "structure" {
  for (const change of changes) {
    if (change.op !== "modify") return "structure";
    const before = base.index.get(change.id);
    const after = changeNode(change);
    if (!before || "message" in after) return "structure";
    if (stripWording(before) !== stripWording(after)) return "structure";
  }
  return "wording";
}

/** Node kinds a delta touches, from its new content or, for removals, the base KB. */
export function changedKinds(base: KbView, changes: readonly NodeChange[]): string[] {
  const kinds = changes.map((c) => {
    const node = c.op === "remove" ? undefined : changeNode(c);
    return node && !("message" in node) ? node.kind : base.index.get(c.id)?.kind;
  });
  return [...new Set(kinds.filter((k): k is string => k !== undefined))].sort();
}
