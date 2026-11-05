import type { KbNode, Scope } from "@jig/kb-core";
import type { Executor, ExecutionResult } from "@jig/executor";
import type { AuditLog } from "./audit";
import { decide, resourceFor, type DecisionEngine } from "./evaluator";
import { resolveFacts, type RawCall } from "./facts";
import type { KbView } from "@jig/kb-core";
import type { ToolOutput } from "./tools";
import { OperationError, type Decision, type Principal } from "./types";

type ActOutput = ToolOutput<"act">;

/** An action request held at level 2, waiting for a person. */
export interface QueuedRequest {
  requestId: string;
  action: string;
  principal: Principal;
  inputs: Record<string, unknown>;
  facts: Record<string, unknown>;
  context: Record<string, unknown>;
  decision: Decision;
  kbVersion: string;
  queuedAt: string;
}

/** Context values the platform supplies to every evaluation. */
export function evaluationContext(at: string): Record<string, unknown> {
  return { evaluated_at: at };
}

/** The values a decision is made on: inputs, facts and `via_agent`. */
export function decisionContext(inputs: Record<string, unknown>, facts: Record<string, unknown>, viaAgent: boolean): Record<string, unknown> {
  return { ...inputs, ...facts, via_agent: viaAgent };
}

export function isOperable(action: KbNode): boolean {
  return action.data.mode === "connected" || action.data.mode === "native";
}

/**
 * Runs the operate loop for one action request (guarded-actions spec):
 * gather facts through bindings, derive, decide, then execute (level 1), queue (level 2) or stop (level 3).
 * Raw binding results are returned so the caller records them in the audit log.
 */
export class ActionRunner {
  private readonly queue = new Map<string, QueuedRequest>();

  constructor(
    private readonly engine: DecisionEngine,
    private readonly executor: Executor | undefined,
    private readonly audit: AuditLog,
  ) {}

  pending(): QueuedRequest[] {
    return [...this.queue.values()];
  }

  get(requestId: string): QueuedRequest | undefined {
    return this.queue.get(requestId);
  }

  private requireExecutor(): Executor {
    if (!this.executor) throw new OperationError("failed", "no executor is configured, so actions cannot reach any system");
    return this.executor;
  }

  async request(
    view: KbView,
    action: KbNode,
    principal: Principal,
    inputs: Record<string, unknown>,
    requestId: string,
    at: string,
  ): Promise<{ output: ActOutput; raw: RawCall[]; context: Record<string, unknown> }> {
    const executor = this.requireExecutor();
    const context = evaluationContext(at);
    let gathered: { facts: Record<string, unknown>; raw: RawCall[] };
    try {
      gathered = await resolveFacts(view, action, inputs, context, (binding, params) =>
        executor.callBinding(binding, params, { input: inputs, fact: {}, context }),
      );
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw new OperationError("failed", `could not gather the facts for ${action.id}: ${(error as Error).message}`);
    }
    const { facts, raw } = gathered;
    const decision = decide(this.engine, view, {
      principal: principal.user,
      action: action.id,
      resource: resourceFor(view, action.id, inputs),
      context: decisionContext(inputs, facts, principal.viaAgent),
    });
    const base = { request_id: requestId, decision, facts };
    if (decision.level === 3) return { output: { ...base, status: "denied", steps: [] }, raw, context };
    if (decision.level === 2) {
      this.queue.set(requestId, {
        requestId,
        action: action.id,
        principal,
        inputs,
        facts,
        context,
        decision,
        kbVersion: view.version,
        queuedAt: at,
      });
      return { output: { ...base, status: "queued", steps: [] }, raw, context };
    }
    const result = await this.execute(view, action, inputs, facts, context, requestId);
    this.audit.recordOutcome({ request_id: requestId, at, status: result.status, steps: result.steps });
    return { output: { ...base, status: result.status, steps: result.steps as unknown as ActOutput["steps"] }, raw, context };
  }

  private execute(view: KbView, action: KbNode, inputs: Record<string, unknown>, facts: Record<string, unknown>, context: Record<string, unknown>, requestId: string): Promise<ExecutionResult> {
    const scope: Scope = { input: inputs, fact: facts, context, run: { id: requestId } };
    return this.requireExecutor().run(action, scope, (id) => view.index.get(id));
  }

  /** A person approves or rejects a queued request. Approval executes it with the facts it was decided on. */
  async decideQueued(
    view: KbView,
    requestId: string,
    approver: Principal,
    approve: boolean,
    comment: string | undefined,
    at: string,
  ): Promise<ToolOutput<"approve">> {
    const queued = this.queue.get(requestId);
    if (!queued) throw new OperationError("not_found", `no pending request '${requestId}'`, { id: requestId });
    if (approver.viaAgent) throw new OperationError("denied", "Agents cannot approve. A person must approve from a view.");
    this.audit.recordApproval({ request_id: requestId, at, approver: approver.user, approved: approve, override: approve, comment: comment ?? null });
    this.queue.delete(requestId);
    if (!approve) {
      this.audit.recordOutcome({ request_id: requestId, at, status: "rejected", steps: [] });
      return { request_id: requestId, status: "rejected", decision: queued.decision };
    }
    const action = view.index.get(queued.action);
    if (!action) throw new OperationError("unknown_node", `action '${queued.action}' no longer exists`, { id: queued.action });
    const result = await this.execute(view, action, queued.inputs, queued.facts, queued.context, requestId);
    this.audit.recordOutcome({ request_id: requestId, at, status: result.status, steps: result.steps });
    return { request_id: requestId, status: result.status, decision: queued.decision };
  }
}
