import { Environment } from "@marcbachmann/cel-js";
import { resolveTemplate, type KbNode, type Scope } from "@jig/kb-core";
import type { KbView } from "@jig/kb-core";
import { OperationError } from "./types";

/** One recorded binding call: what was asked and what came back (design D7: raw facts are recorded). */
export interface RawCall {
  binding: string;
  params: Record<string, unknown>;
  response: unknown;
}

/** Gets a binding's response. Live requests call the system; replay looks the call up in the audit log. */
export type FactSource = (binding: KbNode, params: Record<string, unknown>) => Promise<unknown>;

export interface FactSpec {
  name: string;
  type: string;
  binding?: string;
  derivation?: string;
  with?: Record<string, unknown>;
  path?: string;
}

/** Raised when replay needs a fact that was never recorded. */
export class InsufficientFacts extends Error {
  constructor(readonly missing: string) {
    super(`insufficient facts: ${missing}`);
  }
}

function atPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let current = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const CEL_TYPES: Record<string, string> = { int: "int", decimal: "double", bool: "bool", timestamp: "google.protobuf.Timestamp", list: "list" };

function toCel(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return value;
  switch (type) {
    case "int":
      return BigInt(Math.trunc(Number(value)));
    case "decimal":
      return Number(value);
    case "timestamp":
      return new Date(String(value));
    default:
      return value;
  }
}

function fromCel(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Evaluates a Derivation node's CEL expression over typed inputs. Pure: no clock, no I/O. */
export function evaluateDerivation(derivation: KbNode, inputs: Record<string, unknown>): unknown {
  const env = new Environment();
  const defs = (Array.isArray(derivation.data.inputs) ? derivation.data.inputs : []) as Array<{ name: string; type: string }>;
  const values: Record<string, unknown> = {};
  for (const def of defs) {
    env.registerVariable(def.name, CEL_TYPES[def.type] ?? "string");
    if (inputs[def.name] === undefined || inputs[def.name] === null) {
      throw new InsufficientFacts(`${derivation.id} needs '${def.name}'`);
    }
    values[def.name] = toCel(inputs[def.name], def.type);
  }
  return fromCel(env.evaluate(String(derivation.data.expression), values));
}

/** The facts an action declares, in order. */
export function factSpecs(action: KbNode): FactSpec[] {
  return (Array.isArray(action.data.facts) ? action.data.facts : []) as FactSpec[];
}

/**
 * Resolves an action's facts in declared order: binding facts through `source` (each distinct call made once),
 * derivation facts with CEL. Returns the facts and the raw calls, which the audit log records.
 */
export async function resolveFacts(
  view: KbView,
  action: KbNode,
  input: Record<string, unknown>,
  context: Record<string, unknown>,
  source: FactSource,
): Promise<{ facts: Record<string, unknown>; raw: RawCall[] }> {
  const facts: Record<string, unknown> = {};
  const raw: RawCall[] = [];
  const cache = new Map<string, unknown>();
  for (const spec of factSpecs(action)) {
    const scope: Scope = { input, fact: facts, context };
    const params = (resolveTemplate(spec.with ?? {}, scope) ?? {}) as Record<string, unknown>;
    if (spec.binding) {
      const binding = view.index.get(spec.binding);
      if (!binding) throw new OperationError("unknown_node", `fact '${spec.name}' uses unknown binding '${spec.binding}'`, { id: spec.binding });
      const key = `${spec.binding}|${JSON.stringify(params)}`;
      if (!cache.has(key)) {
        const response = await source(binding, params);
        cache.set(key, response);
        raw.push({ binding: spec.binding, params, response });
      }
      facts[spec.name] = atPath(cache.get(key), spec.path);
    } else if (spec.derivation) {
      const derivation = view.index.get(spec.derivation);
      if (!derivation) throw new OperationError("unknown_node", `fact '${spec.name}' uses unknown derivation '${spec.derivation}'`, { id: spec.derivation });
      facts[spec.name] = evaluateDerivation(derivation, params);
    }
  }
  return { facts, raw };
}

/** A fact source that answers only from recorded calls, for replay. */
export function recordedSource(raw: readonly RawCall[]): FactSource {
  return async (binding, params) => {
    const key = JSON.stringify(params);
    const hit = raw.find((r) => r.binding === binding.id && JSON.stringify(r.params) === key);
    if (!hit) throw new InsufficientFacts(`no recorded result for ${binding.id} ${key}`);
    return hit.response;
  };
}
