import { extractLinks, type KbNode } from "@jig/kb-core";
import { changeNode, type DeltaReader, type KbView } from "@jig/kb-core";
import { OperationError } from "./types";

/** Checks that every id exists in the KB view. Throws `unknown_node` naming the first missing id. */
export function requireNodes(view: KbView, ids: ReadonlyArray<string | undefined>, field: string): void {
  for (const id of ids) {
    if (id !== undefined && !view.index.has(id)) {
      throw new OperationError("unknown_node", `unknown node '${id}' in '${field}'`, { id, field });
    }
  }
}

/** Requires a node of a given kind. */
export function requireNodeOfKind(view: KbView, id: string, kind: string, field: string): KbNode {
  requireNodes(view, [id], field);
  const node = view.index.get(id) as KbNode;
  if (node.kind !== kind) throw new OperationError("invalid_input", `'${id}' is a ${node.kind}, not a ${kind}`, { id, field });
  return node;
}

/**
 * Checks a delta's references against the base KB: modified and removed nodes must exist, and every
 * link in added or modified content must point at a node in the base KB or in the delta itself.
 */
export function requireDeltaReferences(base: KbView, deltas: DeltaReader | undefined, deltaId: string, meta: Parameters<typeof extractLinks>[1]) {
  const delta = deltas?.get(deltaId);
  if (!delta) throw new OperationError("not_found", `unknown delta '${deltaId}'`, { id: deltaId, field: "delta_id" });
  const added = new Set(delta.changes.filter((c) => c.op === "add").map((c) => c.id));
  for (const change of delta.changes) {
    if (change.op !== "add" && !base.index.has(change.id)) {
      throw new OperationError("unknown_node", `delta '${deltaId}' ${change.op === "remove" ? "removes" : "modifies"} unknown node '${change.id}'`, {
        id: change.id,
        delta_id: deltaId,
      });
    }
    if (change.op === "remove") continue;
    const node = changeNode(change);
    if ("message" in node) throw new OperationError("invalid_input", `delta '${deltaId}': ${node.message}`, { delta_id: deltaId, id: change.id });
    for (const link of extractLinks(node, meta)) {
      if (!base.index.has(link.to) && !added.has(link.to)) {
        throw new OperationError("unknown_node", `delta '${deltaId}' links '${change.id}' to unknown node '${link.to}'`, {
          id: link.to,
          delta_id: deltaId,
          from: change.id,
        });
      }
    }
  }
  return delta;
}

type FieldDef = { name?: unknown; type?: unknown; required?: unknown; values?: unknown; min?: unknown; max?: unknown };

/** Validates action inputs against the action's typed `inputs` declaration. */
export function validateActionInputs(action: KbNode, inputs: Record<string, unknown>): void {
  const defs = (Array.isArray(action.data.inputs) ? action.data.inputs : []) as FieldDef[];
  const known = new Set(defs.map((d) => d.name));
  for (const key of Object.keys(inputs)) {
    if (!known.has(key)) throw new OperationError("invalid_input", `${action.id} has no input '${key}'`, { field: key });
  }
  for (const def of defs) {
    if (typeof def.name !== "string") continue;
    const value = inputs[def.name];
    if (value === undefined || value === null) {
      if (def.required === true) throw new OperationError("invalid_input", `${action.id} requires input '${def.name}'`, { field: def.name });
      continue;
    }
    const ok =
      def.type === "int"
        ? Number.isInteger(value)
        : def.type === "decimal"
          ? typeof value === "number"
          : def.type === "bool"
            ? typeof value === "boolean"
            : def.type === "list"
              ? Array.isArray(value)
              : typeof value === "string";
    if (!ok) throw new OperationError("invalid_input", `input '${def.name}' of ${action.id} must be ${String(def.type)}`, { field: def.name });
    if (typeof value === "number") {
      if (typeof def.min === "number" && value < def.min) throw new OperationError("invalid_input", `input '${def.name}' must be at least ${def.min}`, { field: def.name });
      if (typeof def.max === "number" && value > def.max) throw new OperationError("invalid_input", `input '${def.name}' must be at most ${def.max}`, { field: def.name });
    }
    if (def.type === "enum" && Array.isArray(def.values) && !def.values.includes(value)) {
      throw new OperationError("invalid_input", `input '${def.name}' must be one of ${def.values.join(", ")}`, { field: def.name });
    }
  }
}
