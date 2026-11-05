import { KB_OBJECT_TYPE, KbValidator, loadSchemaMeta, type SchemaMeta } from "@jig/kb-core";
import { DeltaApplyError, analyzeImpact, applyDelta, draftEvidenceProposals, nodeFileContent, setFrontmatterField, findOverrides, simulateDelta, type DeltaRecord, type OverrideFinding, changeScope, changedKinds, validateDelta, type DeltaStore, type GitKbSource } from "@jig/governance";
import type { Executor } from "@jig/executor";
import { ActionRunner, isOperable } from "./actions";
import type { AuditLog, NewCall } from "./audit";
import { CedarEngine, decide, type DecisionEngine } from "./evaluator";
import { applyFloors, changesGuardrails } from "./floors";
import { changeNode, type DeltaReader, type KbSource, type KbView } from "@jig/kb-core";
import type { KbOperations } from "./mcp";
import type { ToolInput, ToolName, ToolOutput } from "./tools";
import { OPERATION_PERMISSION, OperationError, type Decision, type Principal } from "./types";
import { runQuery } from "./query";
import { buildViewSpec } from "./views";
import { reevaluate } from "./replay";
import type { AuditCall } from "./audit";
import { requireDeltaReferences, requireNodeOfKind, requireNodes, validateActionInputs } from "./validation";

export interface KbServiceDeps {
  kb: KbSource;
  audit: AuditLog;
  deltas?: DeltaReader;
  meta?: SchemaMeta;
  engine?: DecisionEngine;
  /** Reaches real systems for fact gathering and action steps. */
  executor?: Executor;
  /** Change governance: the git-backed KB and its deltas. Required for propose, apply and approve of deltas. */
  governance?: { source: GitKbSource; store: DeltaStore };
  validator?: KbValidator;
  /** Clock, injectable so tests and replays are deterministic. */
  now?: () => Date;
  newId?: (prefix: string) => string;
}

/** What an operation returns to `run`: its result, plus anything extra to record in the audit log. */
export interface Execution<T> {
  result: T;
  audit?: Partial<Pick<NewCall, "raw_facts" | "context" | "decision" | "outcome" | "kb_version">>;
}

/** Per-call context handed to operation implementations. */
export interface CallContext {
  requestId: string;
  at: string;
  view: KbView;
  /** The guardrail decision for the operation itself, set before `execute` runs. */
  opDecision?: Decision;
}

/** What an operation tells the guard about itself, beyond who is calling. */
export interface OperationContext {
  changed_kinds?: string[];
  changes_guardrails?: boolean;
  change_scope?: string;
}

type Steps<N extends ToolName> = {
  validate: (ctx: CallContext) => void;
  /** Extra facts for the operation's own permission check, for example what a delta changes. */
  context?: (ctx: CallContext) => OperationContext;
  execute: (ctx: CallContext) => Promise<Execution<ToolOutput<N>>> | Execution<ToolOutput<N>>;
};

let counter = 0;
const defaultId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Implements the KB operations. Every call is validated before any effect, checked against guardrails,
 * and recorded in the audit log, whether it succeeds, is denied or is invalid (kb-operations spec).
 */
export class KbService implements KbOperations {
  protected readonly kb: KbSource;
  protected readonly audit: AuditLog;
  protected readonly deltas: DeltaReader | undefined;
  protected readonly meta: SchemaMeta;
  protected readonly engine: DecisionEngine;
  readonly actions: ActionRunner;
  protected readonly governance: { source: GitKbSource; store: DeltaStore } | undefined;
  protected readonly validator: KbValidator;
  protected readonly now: () => Date;
  protected readonly newId: (prefix: string) => string;

  constructor(deps: KbServiceDeps) {
    this.kb = deps.kb;
    this.audit = deps.audit;
    this.governance = deps.governance;
    this.deltas = deps.deltas ?? deps.governance?.store;
    this.meta = deps.meta ?? loadSchemaMeta();
    this.engine = deps.engine ?? new CedarEngine();
    this.validator = deps.validator ?? new KbValidator(this.meta);
    this.actions = new ActionRunner(this.engine, deps.executor, deps.audit);
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? defaultId;
  }

  /** Validates, runs and audits one operation call. */
  protected async run<N extends ToolName>(
    operation: N,
    principal: Principal,
    input: ToolInput<N>,
    target: string | null,
    steps: Steps<N>,
  ): Promise<ToolOutput<N>> {
    const ctx: CallContext = { requestId: this.newId("req"), at: this.now().toISOString(), view: this.kb.current() };
    const base: NewCall = {
      request_id: ctx.requestId,
      at: ctx.at,
      principal: principal.user,
      via_agent: principal.viaAgent,
      operation,
      target,
      inputs: input as Record<string, unknown>,
      kb_version: ctx.view.version,
      raw_facts: null,
      context: null,
      decision: null,
      outcome: "ok",
      error: null,
    };
    try {
      steps.validate(ctx);
      this.guard(operation, principal, ctx, steps.context?.(ctx) ?? {}, target);
      const { result, audit } = await steps.execute(ctx);
      this.audit.recordCall({ ...base, ...audit });
      return result;
    } catch (error) {
      const operationError = error instanceof OperationError ? error : undefined;
      this.audit.recordCall({
        ...base,
        outcome: operationError?.code === "denied" ? "denied" : operationError ? "invalid" : "failed",
        decision: (operationError?.details.decision as Record<string, unknown> | undefined) ?? null,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Per-principal guardrails for the operation itself (kb-operations spec): the user's permission
   * declarations for the KB operation, then the D8 floors. Level 3 is denied. Level 2 means a person
   * must do it: agents are denied, except where the operation itself queues work for a person
   * (`act` queues held actions, `propose_delta` only drafts).
   */
  protected guard(operation: ToolName, principal: Principal, ctx: CallContext, opContext: OperationContext, target: string | null): void {
    const kbOperation = OPERATION_PERMISSION[operation];
    const context: Record<string, unknown> = { via_agent: principal.viaAgent, ...opContext };
    const raw = decide(this.engine, ctx.view, {
      principal: principal.user,
      action: kbOperation,
      resource: { type: KB_OBJECT_TYPE, id: target ?? kbOperation },
      context,
    });
    const decision = applyFloors({ operation: kbOperation, principal, changesGuardrails: opContext.changes_guardrails === true }, raw);
    ctx.opDecision = decision;
    const queues = operation === "act" || operation === "propose_delta";
    if (decision.level === 3 || (decision.level === 2 && principal.viaAgent && !queues)) {
      const reasons = decision.reasons.map((r) => r.reason).join(" ");
      throw new OperationError("denied", `${principal.user}${principal.viaAgent ? " (via agent)" : ""} may not ${operation}: ${reasons}`, { decision });
    }
  }

  /** What a delta changes, for permission checks and floors. */
  protected deltaContext(ctx: CallContext, deltaId: string): OperationContext {
    const delta = this.deltas?.get(deltaId);
    if (!delta) return {};
    const kindOf = (c: { id: string; op: string; content?: string }) => {
      const node = c.op === "remove" ? undefined : changeNode(c as Parameters<typeof changeNode>[0]);
      return node && !("message" in node) ? node.kind : ctx.view.index.get(c.id)?.kind;
    };
    return {
      changed_kinds: changedKinds(ctx.view, delta.changes),
      changes_guardrails: changesGuardrails(delta.changes, kindOf),
      change_scope: changeScope(ctx.view, delta.changes),
    };
  }

  /** The current KB view. */
  currentView() {
    return this.kb.current();
  }

  /** The validator this service checks deltas with. */
  validatorForViews(): KbValidator {
    return this.validator;
  }

  /** A node's current file content (from git when governance is configured). */
  nodeFile(nodeId: string): string | undefined {
    return this.governance ? nodeFileContent(this.governance.source.repo, nodeId)?.content : undefined;
  }

  /** A delta's record, for screens that show its status. */
  deltaRecord(id: string): DeltaRecord | undefined {
    return this.governance?.store.record(id);
  }

  protected requireGovernance(): { source: GitKbSource; store: DeltaStore } {
    if (!this.governance) throw new OperationError("failed", "change governance is not configured for this KB");
    return this.governance;
  }

  /** The level at which `principal` may apply a delta: their kb.apply-delta permission, raised by the floors. */
  protected applyLevel(ctx: CallContext, principal: Principal, deltaId: string): Decision {
    const opContext = this.deltaContext(ctx, deltaId);
    const raw = decide(this.engine, ctx.view, {
      principal: principal.user,
      action: "kb.apply-delta",
      resource: { type: KB_OBJECT_TYPE, id: deltaId },
      context: { via_agent: principal.viaAgent, ...opContext },
    });
    return applyFloors({ operation: "kb.apply-delta", principal, changesGuardrails: opContext.changes_guardrails === true }, raw);
  }

  /** Applies a delta, turning validation problems into a structured error. */
  protected apply(deltaId: string, approvedBy: string[]) {
    const { source, store } = this.requireGovernance();
    try {
      return applyDelta(source.repo, store, source, this.validator, deltaId, approvedBy);
    } catch (error) {
      if (error instanceof DeltaApplyError) throw new OperationError("conflict", error.message, { errors: error.errors });
      throw error;
    }
  }

  protected notImplemented(name: string): never {
    throw new OperationError("failed", `${name} is not available yet`);
  }

  /** Resolves `as_of` to a KB view, or the current one. */
  protected viewFor(ctx: CallContext, asOf: string | undefined): KbView {
    if (asOf === undefined) return ctx.view;
    const view = this.kb.asOf(asOf);
    if (!view) throw new OperationError("not_found", `unknown KB version or delta '${asOf}'`, { id: asOf, field: "as_of" });
    return view;
  }

  query = (principal: Principal, input: ToolInput<"query">) =>
    this.run("query", principal, input, input.focus ?? null, {
      validate: (ctx) => requireNodes(this.viewFor(ctx, input.as_of), [input.focus], "focus"),
      execute: (ctx) => ({ result: runQuery(this.viewFor(ctx, input.as_of), input) }),
    });

  visualize = (principal: Principal, input: ToolInput<"visualize">) =>
    this.run("visualize", principal, input, input.scope.focus ?? input.scope.capability ?? input.scope.delta ?? null, {
      validate: ({ view }) => {
        requireNodes(view, [input.scope.focus], "scope.focus");
        requireNodes(view, [input.scope.capability], "scope.capability");
        if (input.scope.delta !== undefined) requireDeltaReferences(view, this.deltas, input.scope.delta, this.meta);
      },
      execute: (ctx) => {
        const base = this.viewFor(ctx, input.as_of);
        const deltaId = input.scope.delta;
        let delta;
        if (deltaId !== undefined) {
          const record = this.deltas?.get(deltaId);
          const after = this.kb.asOf(deltaId);
          if (!record || !after) throw new OperationError("not_found", `unknown delta '${deltaId}'`, { id: deltaId });
          delta = { id: deltaId, before: this.governance?.source.before(deltaId) ?? base, after, changes: record.changes };
        }
        const spec = buildViewSpec(
          { view: delta ? delta.after : base, viewId: `view-${ctx.requestId}`, ...(delta ? { delta } : {}), ...(input.expand ? { expand: input.expand } : {}) },
          input,
        );
        return { result: spec };
      },
    });

  propose_delta = (principal: Principal, input: ToolInput<"propose_delta">) =>
    this.run("propose_delta", principal, input, input.delta_id ?? null, {
      validate: ({ view }) => {
        const { store } = this.requireGovernance();
        if (input.delta_id !== undefined && !store.record(input.delta_id)) {
          throw new OperationError("not_found", `unknown delta '${input.delta_id}'`, { id: input.delta_id, field: "delta_id" });
        }
        if (input.delta_id === undefined && (!input.title || !input.changes?.length)) {
          throw new OperationError("invalid_input", "a new delta needs a title and at least one change", { field: "title" });
        }
        for (const change of input.changes ?? []) {
          if (change.op !== "add" && !view.index.has(change.id)) {
            throw new OperationError("unknown_node", `cannot ${change.op} unknown node '${change.id}'`, { id: change.id, field: "changes" });
          }
          if (change.op !== "remove" && change.content === undefined) {
            throw new OperationError("invalid_input", `change to '${change.id}' needs content`, { id: change.id, field: "changes" });
          }
        }
      },
      execute: (ctx) => {
        const { store } = this.requireGovernance();
        const changes = (input.changes ?? []).map((c) => ({ op: c.op, id: c.id, ...(c.content !== undefined ? { content: c.content } : {}) }));
        let record = input.delta_id
          ? store.update(input.delta_id, {
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
              ...(changes.length ? { changes } : {}),
            })
          : store.create({ title: input.title ?? "", rationale: input.rationale ?? "", proposer: principal.user, changes });
        const changed = record.changes.map((c) => c.id);
        if (!input.propose) {
          return { result: { delta_id: record.id, status: record.status, errors: [], changed }, audit: { outcome: "draft" } };
        }
        const report = validateDelta(this.validator, ctx.view, record.changes);
        if (!report.valid) {
          const errors = report.errors.map((e) => ({ ...e }));
          return { result: { delta_id: record.id, status: "draft" as const, errors, changed }, audit: { outcome: "invalid-delta" } };
        }
        // Level 1 for the proposer applies at once (and is audited). Otherwise the delta waits for a
        // person who may apply it; who that is gets checked when they approve.
        const decision = this.applyLevel(ctx, principal, record.id);
        if (decision.level === 1) {
          record = this.apply(record.id, []);
        } else {
          record = store.setStatus(record.id, "proposed", { level: decision.level });
        }
        return {
          result: { delta_id: record.id, status: record.status, level: decision.level, errors: [], changed },
          audit: { outcome: record.status, decision: decision as unknown as Record<string, unknown> },
        };
      },
    });

  analyze_impact = (principal: Principal, input: ToolInput<"analyze_impact">) =>
    this.run("analyze_impact", principal, input, input.delta_id, {
      validate: ({ view }) => void requireDeltaReferences(view, this.deltas, input.delta_id, this.meta),
      execute: ({ view }) => {
        const delta = this.deltas?.get(input.delta_id);
        const after = this.kb.asOf(input.delta_id);
        if (!delta || !after) throw new OperationError("not_found", `unknown delta '${input.delta_id}'`, { id: input.delta_id });
        const before = this.governance?.source.before(input.delta_id) ?? view;
        return { result: { delta_id: input.delta_id, ...analyzeImpact(before, after, delta.changes) } };
      },
    });

  simulate = (principal: Principal, input: ToolInput<"simulate">) =>
    this.run("simulate", principal, input, input.delta_id, {
      validate: ({ view }) => void requireDeltaReferences(view, this.deltas, input.delta_id, this.meta),
      execute: async ({ view, at }) => {
        const delta = this.deltas?.get(input.delta_id);
        const after = this.kb.asOf(input.delta_id);
        if (!delta || !after) throw new OperationError("not_found", `unknown delta '${input.delta_id}'`, { id: input.delta_id });
        const before = this.governance?.source.before(input.delta_id) ?? view;
        const { changed, impacted } = analyzeImpact(before, after, delta.changes);
        const actionIds = new Set(
          [...changed, ...impacted.map((i) => i.id)].filter((id) => (after.index.get(id) ?? before.index.get(id))?.kind === "Action"),
        );
        const days = input.window_days ?? 30;
        const window = { from: new Date(new Date(at).getTime() - days * 86_400_000).toISOString(), to: at };
        const calls = this.audit.calls({ operation: "act" });
        const report = await simulateDelta(input.delta_id, before, after, calls, actionIds, window, (v, request) =>
          reevaluate(this.engine, v, request as AuditCall),
        );
        if (this.governance) this.governance.store.saveSimulation(input.delta_id, report as unknown as Record<string, unknown>);
        return { result: report };
      },
    });

  act = (principal: Principal, input: ToolInput<"act">) =>
    this.run("act", principal, input, input.action, {
      validate: ({ view }) => {
        const action = requireNodeOfKind(view, input.action, "Action", "action");
        if (!isOperable(action)) {
          throw new OperationError("not_operable", `${action.id} is not operable: its mode is ${String(action.data.mode)}`, { id: action.id, mode: action.data.mode });
        }
        validateActionInputs(action, input.inputs);
      },
      execute: async ({ view, requestId, at }) => {
        const action = view.index.get(input.action) as NonNullable<ReturnType<typeof view.index.get>>;
        const { output, raw, context } = await this.actions.request(view, action, principal, input.inputs, requestId, at);
        return {
          result: output,
          audit: { raw_facts: { calls: raw }, context, decision: output.decision as unknown as Record<string, unknown>, outcome: output.status },
        };
      },
    });

  approve = (principal: Principal, input: ToolInput<"approve">) =>
    this.run("approve", principal, input, input.request_id, {
      validate: () => {
        if (!this.actions.get(input.request_id) && !this.deltas?.get(input.request_id)) {
          throw new OperationError("not_found", `no pending request or delta '${input.request_id}'`, { id: input.request_id });
        }
      },
      context: (ctx) => this.deltaContext(ctx, input.request_id),
      execute: async (ctx) => {
        const { view, at } = ctx;
        if (this.actions.get(input.request_id)) {
          const result = await this.actions.decideQueued(view, input.request_id, principal, input.approve, input.comment, at);
          return { result, audit: { outcome: result.status } };
        }
        return this.approveDelta(principal, input, at, ctx);
      },
    });

  /**
   * Turns an edit made in a view into a draft delta (kb-visualization spec): the node's field is changed
   * on a delta branch, never in the main KB. Adds to an existing draft when one is given.
   */
  async draftEdit(principal: Principal, nodeId: string, field: string, value: string, deltaId?: string): Promise<ToolOutput<"propose_delta">> {
    const { source } = this.requireGovernance();
    const file = nodeFileContent(source.repo, nodeId);
    if (!file) throw new OperationError("unknown_node", `unknown node '${nodeId}'`, { id: nodeId });
    const content = setFrontmatterField(file.content, field, value);
    const title = this.kb.current().index.get(nodeId)?.title ?? nodeId;
    return this.propose_delta(principal, {
      ...(deltaId ? { delta_id: deltaId } : { title: `Edit ${field.replace(/_/g, " ")} of ${title}`, rationale: `Edited in a view by ${principal.user}.` }),
      changes: [{ op: "modify", id: nodeId, content }],
    });
  }

  /**
   * Runs the evidence evaluator (design D11): finds rules people override at or above their configured
   * rate, and drafts one delta per rule, assigned to its owner. Meant to run on a schedule. Audited.
   */
  evaluateEvidence(): { findings: OverrideFinding[]; drafted: DeltaRecord[] } {
    const { store } = this.requireGovernance();
    const at = this.now().toISOString();
    const view = this.kb.current();
    const findings = findOverrides(view, this.audit.calls({ operation: "act" }), this.audit.approvals(), at);
    const drafted = draftEvidenceProposals(store, findings);
    this.audit.recordCall({
      request_id: this.newId("req"),
      at,
      principal: "agent.evidence-evaluator",
      via_agent: true,
      operation: "evaluate_evidence",
      target: null,
      inputs: {},
      kb_version: view.version,
      raw_facts: null,
      context: null,
      decision: null,
      outcome: drafted.length > 0 ? `drafted ${drafted.map((d) => d.id).join(", ")}` : "no proposals",
      error: null,
    });
    return { findings, drafted };
  }

  /** A person approves (and so applies) or rejects a proposed delta. */
  protected async approveDelta(principal: Principal, input: ToolInput<"approve">, at: string, ctx: CallContext): Promise<Execution<ToolOutput<"approve">>> {
    const { store } = this.requireGovernance();
    const record = store.require(input.request_id);
    if (record.status !== "proposed") {
      throw new OperationError("conflict", `delta ${record.id} is ${record.status}, not proposed`, { id: record.id, status: record.status });
    }
    if (input.approve) {
      const decision = this.applyLevel(ctx, principal, record.id);
      if (decision.level === 3) {
        throw new OperationError("denied", `${principal.user} may not apply ${record.id}: ${decision.reasons.map((r) => r.reason).join(" ")}`, { decision });
      }
    }
    store.addApproval(record.id, { approver: principal.user, at, approved: input.approve, ...(input.comment ? { comment: input.comment } : {}) });
    if (!input.approve) {
      store.setStatus(record.id, "rejected");
      return { result: { request_id: record.id, status: "rejected" }, audit: { outcome: "rejected" } };
    }
    const approvers = [...record.approvals.filter((a) => a.approved).map((a) => a.approver), principal.user];
    const applied = this.apply(record.id, [...new Set(approvers)]);
    return { result: { request_id: record.id, status: applied.status }, audit: { outcome: "applied" } };
  }
}
