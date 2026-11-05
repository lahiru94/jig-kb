import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeltaReader, NodeChange } from "@jig/kb-core";
import type { GitKbRepo } from "./git-repo";

export type DeltaStatus = "draft" | "proposed" | "approved" | "rejected" | "applied";

export interface DeltaApproval {
  approver: string;
  at: string;
  approved: boolean;
  comment?: string;
}

/** A proposed change to the KB (change-governance spec). Its changes live on the branch `delta/<id>`. */
export interface DeltaRecord {
  id: string;
  title: string;
  rationale: string;
  proposer: string;
  status: DeltaStatus;
  /** Commit of main the delta was drafted against. */
  base: string;
  branch: string;
  /** Head commit of the delta branch. */
  head: string;
  changes: NodeChange[];
  created_at: string;
  updated_at: string;
  /** Who the delta is assigned to, for example the owner of the rule it changes. */
  assigned_to?: string;
  /** Evidence behind an evidence-based proposal. */
  evidence?: Record<string, unknown>;
  level?: 1 | 2 | 3;
  simulation_id?: string;
  approvals: DeltaApproval[];
  /** Merge commit on main, once applied. */
  applied_commit?: string;
}

const EDITABLE: ReadonlySet<DeltaStatus> = new Set(["draft", "proposed"]);

/** Merges new changes into existing ones: the latest change to a node wins. */
export function mergeChanges(existing: readonly NodeChange[], incoming: readonly NodeChange[]): NodeChange[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  for (const change of incoming) {
    const prior = byId.get(change.id);
    // Modifying a node this delta adds keeps it an addition.
    byId.set(change.id, prior?.op === "add" && change.op === "modify" ? { ...change, op: "add" } : change);
  }
  return [...byId.values()];
}

/**
 * Stores delta records next to the KB repository (in `.git/jig/deltas`, outside the KB tree) and keeps
 * each delta's branch in step with its changes.
 */
export class DeltaStore implements DeltaReader {
  private readonly dir: string;

  constructor(
    private readonly repo: GitKbRepo,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => `delta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  ) {
    this.dir = join(repo.dir, ".git", "jig", "deltas");
    mkdirSync(this.dir, { recursive: true });
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private save(record: DeltaRecord): DeltaRecord {
    writeFileSync(this.file(record.id), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }

  record(id: string): DeltaRecord | undefined {
    const path = this.file(id);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DeltaRecord) : undefined;
  }

  get(id: string): { id: string; changes: NodeChange[] } | undefined {
    const record = this.record(id);
    return record ? { id: record.id, changes: record.changes } : undefined;
  }

  list(): DeltaRecord[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as DeltaRecord)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  }

  private commitBranch(record: Pick<DeltaRecord, "id" | "base" | "branch" | "title" | "changes">): string {
    const head = this.repo.commitChanges(record.base, [record.base], record.changes, `Delta ${record.id}: ${record.title}`);
    this.repo.setRef(`refs/heads/${record.branch}`, head);
    return head;
  }

  create(input: { title: string; rationale: string; proposer: string; changes: NodeChange[]; assigned_to?: string; evidence?: Record<string, unknown> }): DeltaRecord {
    const id = this.newId();
    const at = this.now().toISOString();
    const base = this.repo.head();
    const draft = { id, base, branch: `delta/${id}`, title: input.title, changes: mergeChanges([], input.changes) };
    const head = this.commitBranch(draft);
    const record: DeltaRecord = {
      ...draft,
      rationale: input.rationale,
      proposer: input.proposer,
      status: "draft",
      head,
      created_at: at,
      updated_at: at,
      approvals: [],
      ...(input.assigned_to ? { assigned_to: input.assigned_to } : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    };
    return this.save(record);
  }

  /** Updates a draft or proposed delta. Editing a proposed delta returns it to draft. */
  update(id: string, input: { title?: string; rationale?: string; changes?: NodeChange[] }): DeltaRecord {
    const record = this.require(id);
    if (!EDITABLE.has(record.status)) throw new Error(`delta ${id} is ${record.status} and cannot be edited`);
    const changes = input.changes ? mergeChanges(record.changes, input.changes) : record.changes;
    const updated: DeltaRecord = {
      ...record,
      title: input.title ?? record.title,
      rationale: input.rationale ?? record.rationale,
      changes,
      status: "draft",
      updated_at: this.now().toISOString(),
    };
    updated.head = this.commitBranch(updated);
    return this.save(updated);
  }

  setStatus(id: string, status: DeltaStatus, extra: Partial<DeltaRecord> = {}): DeltaRecord {
    const record = this.require(id);
    return this.save({ ...record, ...extra, status, updated_at: this.now().toISOString() });
  }

  addApproval(id: string, approval: DeltaApproval): DeltaRecord {
    const record = this.require(id);
    return this.save({ ...record, approvals: [...record.approvals, approval], updated_at: this.now().toISOString() });
  }

  /** Saves a simulation report for a delta and records its id on the delta. */
  saveSimulation(deltaId: string, report: Record<string, unknown>): string {
    const record = this.require(deltaId);
    const dir = join(this.dir, "..", "simulations");
    mkdirSync(dir, { recursive: true });
    const id = `sim-${deltaId}-${readdirSync(dir).filter((f) => f.startsWith(`sim-${deltaId}-`)).length + 1}`;
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify({ id, ...report }, null, 2)}\n`);
    this.save({ ...record, simulation_id: id, updated_at: this.now().toISOString() });
    return id;
  }

  simulation(id: string): Record<string, unknown> | undefined {
    const path = join(this.dir, "..", "simulations", `${id}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : undefined;
  }

  require(id: string): DeltaRecord {
    const record = this.record(id);
    if (!record) throw new Error(`unknown delta '${id}'`);
    return record;
  }
}
