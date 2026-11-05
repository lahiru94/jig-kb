import { HEURISTIC_PASSES, extract, readSources, type ExtractionPass } from "@jig/extraction";
import type { KbService, Principal, ToolInput } from "@jig/kb-ops";
import type { ClientMessage, InteractionEvent, PendingApproval, Role, ServerMessage, ViewSpec } from "./protocol";

/** What the agent is told about the screen: the views shown and what the user selected (design D12). */
export class WorkingSet {
  private readonly views = new Map<string, ViewSpec>();
  private readonly inputs = new Map<string, ToolInput<"visualize">>();
  private readonly approvals = new Map<string, PendingApproval>();
  selection: string[] = [];

  addView(spec: ViewSpec, input?: ToolInput<"visualize">): void {
    this.views.set(spec.view_id, spec);
    if (input) this.inputs.set(spec.view_id, input);
  }

  /** The visualize input a view was made from, so it can be redrawn (for example to expand a group). */
  input(viewId: string): ToolInput<"visualize"> | undefined {
    return this.inputs.get(viewId);
  }

  addApproval(approval: PendingApproval): void {
    this.approvals.set(approval.view_id, approval);
  }

  view(id: string): ViewSpec | undefined {
    return this.views.get(id);
  }

  approval(viewId: string): PendingApproval | undefined {
    return this.approvals.get(viewId);
  }

  shown(): ViewSpec[] {
    return [...this.views.values()];
  }

  select(target: string): void {
    this.selection = [target];
  }

  /** A compact description for the agent's context. */
  describe(): string {
    const lines: string[] = [];
    const views = this.shown().slice(-5);
    if (views.length === 0) lines.push("No views are on screen.");
    for (const v of views) {
      const ids = v.elements.slice(0, 30).map((e) => e.id);
      lines.push(`View ${v.view_id} (${v.view}): "${v.title}" showing ${ids.join(", ")}${v.elements.length > 30 ? ", ..." : ""}`);
    }
    for (const a of this.approvals.values()) lines.push(`Approval card ${a.view_id}: request ${a.request_id} for ${a.action}, waiting for a person.`);
    lines.push(this.selection.length > 0 ? `The user has selected: ${this.selection.join(", ")}. "This" or "that" refers to it.` : "Nothing is selected.");
    return lines.join("\n");
  }
}

/** Turns an interaction event into text the agent reads. */
export function describeEvent(event: InteractionEvent): string {
  const text = event.text ? `: "${event.text}"` : "";
  return `[view event] ${event.action} on ${event.target} in ${event.view_id}${text}`;
}

/** Runs the agent for one session. The Claude Agent SDK implementation lives in agent.ts. */
export interface AgentDriver {
  /** Sends a user turn (text, or a described event) and streams the agent's reply text. */
  respond(input: string, session: Session): AsyncIterable<string>;
}

/** Where live extraction reads from, and how it paces its passes for people watching. */
export interface ExtractionConfig {
  /** Repository root the roots are relative to. */
  base: string;
  roots: string[];
  /** Pause between passes so the view visibly grows (milliseconds). */
  paceMs?: number;
  passes?: readonly ExtractionPass[];
}

export interface SessionDeps {
  id: string;
  service: KbService;
  users: Role[];
  user: Role;
  send: (message: ServerMessage) => void;
  agent?: (session: Session) => AgentDriver;
  extraction?: ExtractionConfig;
}

/**
 * One user's session. The agent acts as the logged-in user with `viaAgent: true`; approvals the user
 * makes in a view go straight to the KB layer as the person (`viaAgent: false`), never through the agent.
 */
export class Session {
  readonly id: string;
  readonly workingSet = new WorkingSet();
  readonly service: KbService;
  readonly users: Role[];
  user: Role;
  private readonly send: (message: ServerMessage) => void;
  private readonly agent: AgentDriver | undefined;
  private readonly extraction: ExtractionConfig | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: SessionDeps) {
    this.id = deps.id;
    this.service = deps.service;
    this.users = deps.users;
    this.user = deps.user;
    this.send = deps.send;
    this.agent = deps.agent?.(this);
    this.extraction = deps.extraction;
  }

  /** The agent's principal: the logged-in user, through an agent. */
  get agentPrincipal(): Principal {
    return { user: this.user.user, viaAgent: true };
  }

  /** The person's own principal, used only for actions they take in the UI. */
  get personPrincipal(): Principal {
    return { user: this.user.user, viaAgent: false };
  }

  start(): void {
    this.send({ type: "session", session_id: this.id, user: this.user, available: this.users, features: { extraction: Boolean(this.extraction) } });
  }

  /** Shows a view: sends it to the screen and adds it to the working set. */
  showView(spec: ViewSpec, input?: ToolInput<"visualize">): void {
    const approvable = this.approvableFor(spec, input);
    const shown = approvable ? { ...spec, approvable } : spec;
    this.workingSet.addView(shown, input);
    this.send({ type: "view", spec: shown });
    this.sendWorkingSet();
  }

  /** Delta views of a proposed delta can carry approve and reject buttons. */
  private approvableFor(spec: ViewSpec, input?: ToolInput<"visualize">): ViewSpec["approvable"] {
    const deltaId = input?.scope.delta;
    if (!deltaId || (spec.view !== "before-after" && spec.view !== "impact")) return undefined;
    return this.service.deltaRecord(deltaId)?.status === "proposed" ? { kind: "delta", id: deltaId } : undefined;
  }

  /** Renders a view for the person (not the agent) and shows it. */
  async visualize(input: ToolInput<"visualize">, viewId?: string): Promise<ViewSpec> {
    const spec = (await this.service.visualize(this.personPrincipal, input)) as unknown as ViewSpec;
    const shown = viewId ? { ...spec, view_id: viewId } : spec;
    this.showView(shown, input);
    return shown;
  }

  showApproval(approval: PendingApproval): void {
    this.workingSet.addApproval(approval);
    this.send({ type: "approval", approval });
  }

  notify(level: "info" | "success" | "error", text: string): void {
    this.send({ type: "notice", level, text });
  }

  progress(text: string, nodes?: string[]): void {
    this.send({ type: "progress", text, ...(nodes ? { nodes } : {}) });
  }

  private sendWorkingSet(): void {
    this.send({ type: "working-set", views: this.workingSet.shown().map((v) => v.view_id), selection: this.workingSet.selection });
  }

  /** Handles one message from the browser. Messages are processed one at a time. */
  handle(message: ClientMessage): Promise<void> {
    this.queue = this.queue.then(() => this.process(message)).catch((error: unknown) => this.notify("error", (error as Error).message));
    return this.queue;
  }

  private async process(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "chat":
        this.send({ type: "user", text: message.text });
        await this.toAgent(message.text);
        return;
      case "switch-role": {
        const next = this.users.find((u) => u.user === message.user);
        if (!next) throw new Error(`unknown user ${message.user}`);
        this.user = next;
        this.start();
        await this.toAgent(`[session] The user switched to ${next.title} (${next.user}). Act with their permissions from now on.`, false);
        return;
      }
      case "event":
        await this.onEvent(message.event);
        return;
      case "extract":
        await this.runExtraction();
        return;
    }
  }

  /**
   * Runs extraction live (kb-extraction spec): after each pass, the nodes drafted so far are saved to a
   * draft delta and the explorer view of that delta is redrawn, so people watch the model grow.
   * The result is a draft delta for review; the main KB does not change.
   */
  async runExtraction(): Promise<string | undefined> {
    const config = this.extraction;
    if (!config) {
      this.notify("error", "Extraction is not configured for this session.");
      return undefined;
    }
    const files = readSources(config.base, config.roots);
    const passes = config.passes ?? HEURISTIC_PASSES;
    const viewId = `extraction-${this.id}-${Date.now().toString(36)}`;
    let deltaId: string | undefined;
    const done: ExtractionPass[] = [];
    this.progress(`Reading ${files.length} files...`);
    for (const pass of passes) {
      done.push(pass);
      const view = this.service.currentView();
      const result = await extract(files, view, this.service.validatorForViews(), {
        passes: done,
        fileOf: (node) => this.service.nodeFile(node.id),
        onProgress: (p) => this.progress(p.message, p.drafted),
      });
      if (result.changes.length === 0) continue;
      const draft = await this.service.propose_delta(this.personPrincipal, {
        ...(deltaId ? { delta_id: deltaId } : { title: `Extraction from ${config.roots.join(", ")}`, rationale: "Drafted by extraction from code and documents. Review before approving." }),
        changes: result.changes.map((c) => ({ op: c.op, id: c.id, ...(c.content !== undefined ? { content: c.content } : {}) })),
      });
      deltaId = draft.delta_id;
      await this.visualize({ scope: { delta: deltaId }, view: "explorer", overlays: ["confidence", "conflicts", "pending-delta"] }, viewId);
      if (config.paceMs) await new Promise((r) => setTimeout(r, config.paceMs));
    }
    this.progress(deltaId ? `Extraction finished: draft change ${deltaId} is ready for review.` : "Extraction found nothing new.");
    return deltaId;
  }

  private async onEvent(event: InteractionEvent): Promise<void> {
    if (event.action === "select") {
      this.workingSet.select(event.target);
      this.sendWorkingSet();
      if (event.target.startsWith("group:")) await this.expandGroup(event);
      return;
    }
    if (event.action === "suggest-edit" && event.edit) {
      await this.saveEdit(event, event.edit);
      return;
    }
    if (event.action === "approve" || event.action === "reject") {
      await this.onApproval(event);
      return;
    }
    if (event.action === "suggest-edit" || event.action === "ask" || event.action === "comment") {
      this.workingSet.select(event.target);
      await this.toAgent(describeEvent(event));
    }
  }

  /** Selecting a collapsed group redraws its view with the group expanded. */
  private async expandGroup(event: InteractionEvent): Promise<void> {
    const input = this.workingSet.input(event.view_id);
    if (!input) return;
    await this.visualize({ ...input, expand: [...(input.expand ?? []), event.target] }, event.view_id);
  }

  /** An edit made in a view becomes a draft delta; the screen shows its before and after. */
  private async saveEdit(event: InteractionEvent, edit: { field: string; value: string }): Promise<void> {
    const draft = await this.service.draftEdit(this.personPrincipal, event.target, edit.field, edit.value);
    await this.visualize({ scope: { delta: draft.delta_id }, view: "before-after" });
    this.notify("info", `Saved as a draft change (${draft.delta_id}). The KB is unchanged until it is approved.`);
    await this.toAgent(`[view event] ${this.user.title} edited ${edit.field} of ${event.target} in ${event.view_id}; saved as draft delta ${draft.delta_id}.`, false);
  }

  /**
   * A person approves or rejects in a view. Only allowed from a view that shows what is approved:
   * a before/after or impact view of the delta, or the approval card of a queued request.
   */
  async onApproval(event: InteractionEvent): Promise<void> {
    const view = this.workingSet.view(event.view_id);
    const card = this.workingSet.approval(event.view_id);
    const showsDelta = view?.approvable?.kind === "delta" && view.approvable.id === event.target && (view.view === "before-after" || view.view === "impact");
    const showsRequest = card?.request_id === event.target;
    if (!showsDelta && !showsRequest) {
      this.notify("error", "Approvals can only be given from a view that shows what is being approved.");
      return;
    }
    const approve = event.action === "approve";
    try {
      const result = await this.service.approve(this.personPrincipal, {
        request_id: event.target,
        approve,
        ...(event.text ? { comment: event.text } : {}),
      });
      this.notify("success", `${approve ? "Approved" : "Rejected"} ${event.target}: ${result.status}.`);
      await this.toAgent(`[view event] ${this.user.title} ${approve ? "approved" : "rejected"} ${event.target} in ${event.view_id}. Result: ${result.status}.`, false);
    } catch (error) {
      this.notify("error", (error as Error).message);
    }
  }

  private async toAgent(text: string, required = true): Promise<void> {
    if (!this.agent) {
      if (required) this.send({ type: "assistant", text: "The agent is not available in this session (no API key is configured).", done: true });
      return;
    }
    let any = false;
    for await (const chunk of this.agent.respond(text, this)) {
      any = true;
      this.send({ type: "assistant", text: chunk, done: false });
    }
    this.send({ type: "assistant", text: any ? "" : "(no reply)", done: true });
  }
}
