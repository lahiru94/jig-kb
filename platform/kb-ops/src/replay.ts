import type { AuditCall } from "./audit";
import { decisionContext } from "./actions";
import { decide, resourceFor, type DecisionEngine } from "./evaluator";
import { InsufficientFacts, recordedSource, resolveFacts, type RawCall } from "./facts";
import type { KbView } from "@jig/kb-core";
import type { Decision, Principal } from "./types";

export type Reevaluation =
  | { status: "ok"; decision: Decision; facts: Record<string, unknown> }
  | { status: "insufficient-facts"; missing: string }
  | { status: "not-an-action"; reason: string };

/**
 * Re-evaluates a recorded `act` call against a KB view, using only what the audit log recorded:
 * the inputs, the raw binding results and the context (design D7, D10). No system is called.
 * Derivations, rules, policies and permissions all come from `view`, so a delta's changes to any of
 * them show up in the result.
 */
export async function reevaluate(engine: DecisionEngine, view: KbView, call: AuditCall): Promise<Reevaluation> {
  if (call.operation !== "act" || !call.target) return { status: "not-an-action", reason: "only act calls can be replayed" };
  const action = view.index.get(call.target);
  if (!action) return { status: "insufficient-facts", missing: `action ${call.target} is not in this KB version` };
  const inputs = ((call.inputs as { inputs?: Record<string, unknown> }).inputs ?? {}) as Record<string, unknown>;
  const raw = ((call.raw_facts as { calls?: RawCall[] } | null)?.calls ?? []) as RawCall[];
  const context = call.context ?? {};
  try {
    const { facts } = await resolveFacts(view, action, inputs, context, recordedSource(raw));
    const principal: Principal = { user: call.principal, viaAgent: call.via_agent };
    const decision = decide(engine, view, {
      principal: principal.user,
      action: action.id,
      resource: resourceFor(view, action.id, inputs),
      context: decisionContext(inputs, facts, principal.viaAgent),
    });
    return { status: "ok", decision, facts };
  } catch (error) {
    if (error instanceof InsufficientFacts) return { status: "insufficient-facts", missing: error.missing };
    throw error;
  }
}
