import type { KbOperation } from "@jig/kb-core";

/** Who is calling: the logged-in user, and whether an agent is acting for them (design D17). */
export interface Principal {
  /** Actor id of the logged-in user, for example `actor.casey`. */
  user: string;
  viaAgent: boolean;
}

/** Permission level: 1 autonomous, 2 human-required, 3 forbidden (design D17). */
export type Level = 1 | 2 | 3;

export interface DecisionReason {
  /** The KB node behind this reason: a rule, policy or permission id. */
  source: string;
  kind: "rule" | "policy" | "permission" | "floor" | "default";
  level: Level;
  /** Plain-language reason, for people. */
  reason: string;
  /** For rules: the rule's plain-language statement. */
  statement?: string;
}

/** A guardrail decision, returned whenever a call is denied or needs approval (kb-operations spec). */
export interface Decision {
  level: Level;
  reasons: DecisionReason[];
}

/** Structured error for invalid calls. Invalid calls have no side effects. */
export class OperationError extends Error {
  constructor(
    readonly code: "invalid_input" | "unknown_node" | "not_operable" | "denied" | "not_found" | "conflict" | "failed",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type OperationName = "query" | "visualize" | "propose_delta" | "analyze_impact" | "simulate" | "act" | "approve";

/** Maps MCP tool names to the KB operations their permissions are declared on. */
export const OPERATION_PERMISSION: Record<OperationName, KbOperation> = {
  query: "kb.query",
  visualize: "kb.visualize",
  propose_delta: "kb.propose-delta",
  analyze_impact: "kb.analyze-impact",
  simulate: "kb.simulate",
  act: "kb.act",
  approve: "kb.approve",
};
