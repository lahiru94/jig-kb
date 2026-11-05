import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { KB_OBJECT_TYPE, PRINCIPAL_TYPE, ROLE_TYPE, collectPolicies, entityTypeName, type KbNode } from "@jig/kb-core";
import type { KbView } from "@jig/kb-core";
import type { Decision, DecisionReason, Level } from "./types";

/** A request to the decision engine (design D7: engine-neutral). */
export interface EvaluationRequest {
  /** Actor id of the user; their roles come from the KB. */
  principal: string;
  /** An action id or a KB operation such as `kb.approve`. */
  action: string;
  resource: { type: string; id: string };
  /** Facts and inputs the policies may read. Values are plain JSON; decimals are numbers. */
  context: Record<string, unknown>;
}

/** A policy whose condition held, with the annotations it carries. */
export interface MatchedPolicy {
  policyId: string;
  nodeId: string;
  effect: "permit" | "forbid";
  annotations: Record<string, string>;
}

export interface EngineResult {
  matched: MatchedPolicy[];
  /** Policies that could not be evaluated, for example because a fact was missing. */
  errors: Array<{ policyId: string; nodeId: string; message: string }>;
}

/** The only interface the platform uses to reach a policy engine. */
export interface DecisionEngine {
  evaluate(view: KbView, request: EvaluationRequest): EngineResult;
}

interface PreparedPolicy {
  id: string;
  nodeId: string;
  text: string;
  effect: "permit" | "forbid";
  annotations: Record<string, string>;
}

const CATCH_ALL = "permit (principal, action, resource);";

/** Converts plain context values into Cedar JSON: decimals become the `decimal` extension. */
function cedarValue(value: unknown, decimal: boolean): unknown {
  if (decimal && typeof value === "number") return { __extn: { fn: "decimal", arg: value.toFixed(4) } };
  if (Array.isArray(value)) return value.map((v) => cedarValue(v, false));
  return value;
}

/** The Cedar adapter (design D7). Policies come from rule checks, Policy nodes and Permission declarations. */
export class CedarEngine implements DecisionEngine {
  private cache: { version: string; nodes: KbNode[]; policies: PreparedPolicy[]; errors: EngineResult["errors"] } | undefined;

  private prepare(view: KbView): { policies: PreparedPolicy[]; errors: EngineResult["errors"] } {
    if (this.cache && this.cache.version === view.version && this.cache.nodes === view.nodes) return this.cache;
    const { policies, errors } = collectPolicies(view.nodes);
    const prepared: PreparedPolicy[] = [];
    const prepErrors: EngineResult["errors"] = errors.map((e) => ({ policyId: e.nodeId, nodeId: e.nodeId, message: e.message }));
    for (const policy of policies) {
      const json = cedar.policyToJson(policy.text);
      if (json.type !== "success") {
        prepErrors.push({ policyId: policy.id, nodeId: policy.nodeId, message: json.errors.map((e) => e.message).join("; ") });
        continue;
      }
      const annotations: Record<string, string> = {};
      for (const [key, value] of Object.entries(json.json.annotations ?? {})) if (typeof value === "string") annotations[key] = value;
      prepared.push({ id: policy.id, nodeId: policy.nodeId, text: policy.text, effect: json.json.effect === "forbid" ? "forbid" : "permit", annotations });
    }
    this.cache = { version: view.version, nodes: view.nodes, policies: prepared, errors: prepErrors };
    return this.cache;
  }

  /** Builds the Cedar entities for the request: the user, their roles from the KB, and the resource. */
  static entities(view: KbView, request: EvaluationRequest): cedar.Entities {
    const actor = view.index.get(request.principal);
    const roles = actor && Array.isArray(actor.data.roles) ? (actor.data.roles as unknown[]).filter((r): r is string => typeof r === "string") : [];
    return [
      { uid: { type: PRINCIPAL_TYPE, id: request.principal }, attrs: {}, parents: roles.map((id) => ({ type: ROLE_TYPE, id })) },
      ...roles.map((id) => ({ uid: { type: ROLE_TYPE, id }, attrs: {}, parents: [] })),
      { uid: request.resource, attrs: {}, parents: [] },
    ];
  }

  evaluate(view: KbView, request: EvaluationRequest): EngineResult {
    const { policies, errors: prepErrors } = this.prepare(view);
    const decimals = new Set(decimalFields(view, request.action));
    const context: Record<string, cedar.CedarValueJson> = {};
    for (const [key, value] of Object.entries(request.context)) {
      if (value !== undefined && value !== null) context[key] = cedarValue(value, decimals.has(key)) as cedar.CedarValueJson;
    }
    const entities = CedarEngine.entities(view, request);
    const call = (set: PreparedPolicy[], extra?: string) => {
      const staticPolicies: Record<string, string> = {};
      for (const p of set) staticPolicies[p.id] = p.text;
      if (extra) staticPolicies["__catch_all"] = extra;
      const answer = cedar.isAuthorized({
        principal: { type: PRINCIPAL_TYPE, id: request.principal },
        action: { type: "Action", id: request.action },
        resource: request.resource,
        context,
        policies: { staticPolicies },
        entities,
      });
      if (answer.type !== "success") throw new Error(`Cedar failed: ${answer.errors.map((e) => e.message).join("; ")}`);
      return answer.response;
    };
    const byId = new Map(policies.map((p) => [p.id, p]));
    const matched: MatchedPolicy[] = [];
    const errors: EngineResult["errors"] = [...prepErrors];
    const collect = (response: cedar.Response): void => {
      for (const id of response.diagnostics.reason) {
        const p = byId.get(id);
        if (p) matched.push({ policyId: p.id, nodeId: p.nodeId, effect: p.effect, annotations: p.annotations });
      }
      for (const e of response.diagnostics.errors) {
        const p = byId.get(e.policyId);
        errors.push({ policyId: e.policyId, nodeId: p?.nodeId ?? e.policyId, message: e.error.message });
      }
    };
    // Permits alone report every permit that holds; forbids with a catch-all permit report every forbid that holds.
    collect(call(policies.filter((p) => p.effect === "permit")));
    collect(call(policies.filter((p) => p.effect === "forbid"), CATCH_ALL));
    matched.sort((a, b) => a.policyId.localeCompare(b.policyId));
    return { matched, errors };
  }
}

function decimalFields(view: KbView, actionId: string): string[] {
  const action = view.index.get(actionId);
  if (!action) return [];
  const fields = [...(Array.isArray(action.data.inputs) ? action.data.inputs : []), ...(Array.isArray(action.data.facts) ? action.data.facts : [])] as Array<{
    name?: unknown;
    type?: unknown;
  }>;
  return fields.filter((f) => f.type === "decimal" && typeof f.name === "string").map((f) => f.name as string);
}

function toLevel(value: string | undefined, fallback: Level): Level {
  return value === "1" || value === "2" || value === "3" ? (Number(value) as Level) : fallback;
}

/**
 * Assembles a decision (design D17). Permission declarations grant: the user gets the most permissive
 * matching declaration, and an operation with none is level 3. Matching rules and policies then raise
 * the level; the most restrictive one wins. Policies that cannot be evaluated fail closed at level 3.
 */
export function assembleDecision(view: KbView, request: EvaluationRequest, result: EngineResult): Decision {
  const reasons: DecisionReason[] = [];
  const grants = result.matched.filter((m) => m.effect === "permit" && m.annotations.permission !== undefined);
  let level: Level;
  if (grants.length === 0) {
    level = 3;
    reasons.push({
      source: request.action,
      kind: "default",
      level: 3,
      reason: `No permission declaration lets ${request.principal} do ${request.action}.`,
    });
  } else {
    const best = grants.reduce((a, b) => (toLevel(b.annotations.level, 3) < toLevel(a.annotations.level, 3) ? b : a));
    level = toLevel(best.annotations.level, 3);
    if (level > 1) {
      reasons.push({ source: best.nodeId, kind: "permission", level, reason: best.annotations.reason ?? "Permission requires a human." });
    }
  }
  for (const m of result.matched.filter((x) => x.effect === "forbid")) {
    const ruleLevel = toLevel(m.annotations.level, 3);
    const node = view.index.get(m.annotations.rule ?? m.nodeId);
    const reason: DecisionReason = {
      source: node?.id ?? m.nodeId,
      kind: node?.kind === "BusinessRule" ? "rule" : "policy",
      level: ruleLevel,
      reason: m.annotations.reason ?? `Held by ${m.nodeId}.`,
    };
    if (node?.kind === "BusinessRule" && typeof node.data.statement === "string") reason.statement = node.data.statement;
    reasons.push(reason);
    if (ruleLevel > level) level = ruleLevel;
  }
  for (const e of result.errors) {
    const policy = view.index.get(e.nodeId);
    // A permission that cannot be evaluated simply does not grant; a rule or policy that cannot be evaluated fails closed.
    if (policy?.kind === "Permission") continue;
    reasons.push({ source: e.nodeId, kind: policy?.kind === "BusinessRule" ? "rule" : "policy", level: 3, reason: `Could not evaluate ${e.nodeId}: ${e.message}` });
    level = 3;
  }
  return { level, reasons };
}

/** Resource for an action request: the action's resource entity, identified by its identity fields. */
export function resourceFor(view: KbView, actionId: string, inputs: Record<string, unknown>): { type: string; id: string } {
  const action = view.index.get(actionId);
  const entityId = action && typeof action.data.resource === "string" ? action.data.resource : undefined;
  if (!action || !entityId) return { type: KB_OBJECT_TYPE, id: actionId };
  const identity = view.index.identityOf(entityId);
  const id = identity.map((field) => String(inputs[field] ?? "")).join("/") || "unknown";
  return { type: entityTypeName(entityId), id };
}

/** Evaluates a request and assembles its decision. */
export function decide(engine: DecisionEngine, view: KbView, request: EvaluationRequest): Decision {
  return assembleDecision(view, request, engine.evaluate(view, request));
}
