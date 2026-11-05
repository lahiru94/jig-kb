import type { NodeChange } from "@jig/kb-core";
import type { Decision, Level, Principal } from "./types";

/**
 * Hard floors (design D8). They are enforced in code before any KB policy is consulted, and no KB
 * content can change them, because KB content is what they protect:
 * - agents never approve anything; approval is a human-only step;
 * - deltas that change permission declarations or policies are at least level 2;
 * - every call is audited (enforced by `KbService.run`).
 */
export const GUARDRAIL_KINDS: ReadonlySet<string> = new Set(["Permission", "Policy"]);

/** Whether a set of changes touches guardrails: permission declarations or policies. */
export function changesGuardrails(changes: readonly NodeChange[], kindOf: (change: NodeChange) => string | undefined): boolean {
  return changes.some((c) => GUARDRAIL_KINDS.has(kindOf(c) ?? ""));
}

function raise(decision: Decision, level: Level, source: string, reason: string): Decision {
  return {
    level: decision.level > level ? decision.level : level,
    reasons: [...decision.reasons, { source, kind: "floor", level, reason }],
  };
}

export interface FloorInput {
  /** The KB operation, for example `kb.approve`. */
  operation: string;
  principal: Principal;
  /** True when the call applies or approves a delta that changes guardrails. */
  changesGuardrails?: boolean;
}

/** Applies the floors to a decision. Floors only ever make a decision stricter. */
export function applyFloors(input: FloorInput, decision: Decision): Decision {
  let result = decision;
  if (input.operation === "kb.approve" && input.principal.viaAgent) {
    result = raise(result, 3, "floor.agents-never-approve", "Agents cannot approve. A person must approve from a view.");
  }
  if ((input.operation === "kb.apply-delta" || input.operation === "kb.approve") && input.changesGuardrails) {
    result = raise(result, 2, "floor.guardrail-changes-need-a-human", "Changes to permissions or policies always need a person's approval.");
  }
  return result;
}
