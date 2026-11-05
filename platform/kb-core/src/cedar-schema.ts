import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import type { KbNode } from "./loader";

/** KB operations exposed to agents (design D12, kb-operations spec). Each is a Cedar action. */
export const KB_OPERATIONS = [
  "kb.query",
  "kb.visualize",
  "kb.propose-delta",
  "kb.analyze-impact",
  "kb.simulate",
  "kb.act",
  "kb.approve",
  "kb.apply-delta",
] as const;

export type KbOperation = (typeof KB_OPERATIONS)[number];

export const PRINCIPAL_TYPE = "User";
export const ROLE_TYPE = "Role";
export const KB_OBJECT_TYPE = "KbObject";

interface FieldLike {
  name?: unknown;
  type?: unknown;
  required?: unknown;
}

type CedarType = Record<string, unknown>;

/** Maps a KB field type to a Cedar type. Dates and timestamps are strings: date arithmetic belongs in CEL derivations (design D7). */
export function cedarTypeFor(fieldType: string): CedarType {
  switch (fieldType) {
    case "int":
      return { type: "Long" };
    case "bool":
      return { type: "Boolean" };
    case "decimal":
      return { type: "Extension", name: "decimal" };
    case "list":
      return { type: "Set", element: { type: "String" } };
    default:
      return { type: "String" };
  }
}

/** Cedar entity type name for a DataEntity id, for example `entity.order-line` becomes `OrderLine`. */
export function entityTypeName(entityId: string): string {
  const slug = entityId.slice(entityId.indexOf(".") + 1);
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function asFields(value: unknown): FieldLike[] {
  return Array.isArray(value) ? (value as FieldLike[]) : [];
}

/** Context attributes an action's policies may read: its inputs, its facts, and `via_agent`. */
export function actionContextAttributes(action: KbNode): Record<string, CedarType> {
  const attributes: Record<string, CedarType> = { via_agent: { type: "Boolean", required: true } };
  for (const input of asFields(action.data.inputs)) {
    if (typeof input.name !== "string" || typeof input.type !== "string") continue;
    attributes[input.name] = { ...cedarTypeFor(input.type), required: input.required === true };
  }
  for (const fact of asFields(action.data.facts)) {
    if (typeof fact.name !== "string" || typeof fact.type !== "string") continue;
    attributes[fact.name] = { ...cedarTypeFor(fact.type), required: true };
  }
  return attributes;
}

const KB_OPERATION_CONTEXT: Record<string, CedarType> = {
  via_agent: { type: "Boolean", required: true },
  changed_kinds: { type: "Set", element: { type: "String" }, required: false },
  changes_guardrails: { type: "Boolean", required: false },
  /** What a delta changes: `wording` (text only) or `structure` (anything else). */
  change_scope: { type: "String", required: false },
};

/** Builds the Cedar schema (JSON form, empty namespace) from the KB. */
export function buildCedarSchema(nodes: readonly KbNode[]): Record<string, unknown> {
  const entityTypes: Record<string, unknown> = {
    [PRINCIPAL_TYPE]: { memberOfTypes: [ROLE_TYPE] },
    [ROLE_TYPE]: {},
    [KB_OBJECT_TYPE]: {},
  };
  for (const node of nodes) {
    if (node.kind === "DataEntity") entityTypes[entityTypeName(node.id)] = {};
  }
  const actions: Record<string, unknown> = {};
  for (const op of KB_OPERATIONS) {
    actions[op] = {
      appliesTo: {
        principalTypes: [PRINCIPAL_TYPE],
        resourceTypes: [KB_OBJECT_TYPE],
        context: { type: "Record", attributes: KB_OPERATION_CONTEXT },
      },
    };
  }
  for (const node of nodes) {
    if (node.kind !== "Action") continue;
    const resource = typeof node.data.resource === "string" ? node.data.resource : undefined;
    actions[node.id] = {
      appliesTo: {
        principalTypes: [PRINCIPAL_TYPE],
        resourceTypes: [resource ? entityTypeName(resource) : KB_OBJECT_TYPE],
        context: { type: "Record", attributes: actionContextAttributes(node) },
      },
    };
  }
  return { "": { entityTypes, actions } };
}

/** One Cedar policy with the KB node it came from. */
export interface CompiledPolicy {
  /** Unique policy id: `<node id>#<index>`. */
  id: string;
  nodeId: string;
  text: string;
}

function escapeCedarString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Compiles a Permission node into a Cedar permit policy annotated with its level. */
export function compilePermission(node: KbNode): string {
  const roles = Array.isArray(node.data.roles) ? (node.data.roles as unknown[]).filter((r): r is string => typeof r === "string") : [];
  const operation = typeof node.data.operation === "string" ? node.data.operation : "";
  const level = typeof node.data.level === "number" ? node.data.level : 3;
  const roleClause = roles.map((r) => `principal in ${ROLE_TYPE}::"${escapeCedarString(r)}"`).join(" || ") || "false";
  const condition = typeof node.data.condition === "string" && node.data.condition.trim() !== "" ? node.data.condition : "true";
  return [
    `@permission("${escapeCedarString(node.id)}")`,
    `@level("${level}")`,
    `@reason("${escapeCedarString(node.title)}")`,
    `permit (principal, action == Action::"${escapeCedarString(operation)}", resource)`,
    `when { (${roleClause}) && (${condition}) };`,
  ].join("\n");
}

/** Splits Cedar policy text into individual policies. Throws with Cedar's message if it does not parse. */
export function splitPolicies(text: string): string[] {
  const parts = cedar.policySetTextToParts(text);
  if (parts.type !== "success") throw new Error(parts.errors.map((e) => e.message).join("; "));
  return parts.policies;
}

/** Every Cedar policy in the KB: rule checks, Policy nodes and compiled Permission declarations. */
export function collectPolicies(nodes: readonly KbNode[]): { policies: CompiledPolicy[]; errors: Array<{ nodeId: string; message: string }> } {
  const policies: CompiledPolicy[] = [];
  const errors: Array<{ nodeId: string; message: string }> = [];
  for (const node of nodes) {
    let text: string | undefined;
    if (node.kind === "BusinessRule" && typeof node.data.check === "string") text = node.data.check;
    else if (node.kind === "Policy" && typeof node.data.policy_text === "string") text = node.data.policy_text;
    else if (node.kind === "Permission") text = compilePermission(node);
    if (text === undefined) continue;
    try {
      splitPolicies(text).forEach((policyText, index) => policies.push({ id: `${node.id}#${index}`, nodeId: node.id, text: policyText }));
    } catch (error) {
      errors.push({ nodeId: node.id, message: `Cedar policy does not parse: ${(error as Error).message}` });
    }
  }
  return { policies, errors };
}
