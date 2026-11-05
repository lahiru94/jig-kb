import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs, { type Database } from "sql.js";

/** One call to a KB operation (design D15). Rows are appended, never updated. */
export interface AuditCall {
  id: number;
  request_id: string;
  at: string;
  principal: string;
  via_agent: boolean;
  operation: string;
  /** Action id, delta id or node id the call was about. */
  target: string | null;
  inputs: Record<string, unknown>;
  kb_version: string | null;
  /** Raw binding results recorded before evaluation (design D7). */
  raw_facts: Record<string, unknown> | null;
  /** Context values the platform supplied, such as `evaluated_at`. */
  context: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  /** Result of the call itself: executed, queued, denied, failed, ok or invalid. */
  outcome: string;
  error: string | null;
}

export interface AuditApproval {
  id: number;
  request_id: string;
  at: string;
  approver: string;
  approved: boolean;
  /** True when the approval let through something a rule held. */
  override: boolean;
  comment: string | null;
}

export interface AuditOutcome {
  id: number;
  request_id: string;
  at: string;
  status: string;
  steps: unknown[];
}

export type NewCall = Omit<AuditCall, "id">;
export type NewApproval = Omit<AuditApproval, "id">;
export type NewOutcome = Omit<AuditOutcome, "id">;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  at TEXT NOT NULL,
  principal TEXT NOT NULL,
  via_agent INTEGER NOT NULL,
  operation TEXT NOT NULL,
  target TEXT,
  inputs TEXT NOT NULL,
  kb_version TEXT,
  raw_facts TEXT,
  context TEXT,
  decision TEXT,
  outcome TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS calls_request ON calls(request_id);
CREATE INDEX IF NOT EXISTS calls_target ON calls(operation, target, at);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  at TEXT NOT NULL,
  approver TEXT NOT NULL,
  approved INTEGER NOT NULL,
  override INTEGER NOT NULL,
  comment TEXT
);
CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  at TEXT NOT NULL,
  status TEXT NOT NULL,
  steps TEXT NOT NULL
);
`;

const APPEND_ONLY = ["calls", "approvals", "outcomes"]
  .map(
    (t) => `
CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;`,
  )
  .join("\n");

const json = (value: unknown): string | null => (value === null || value === undefined ? null : JSON.stringify(value));
const parse = <T>(value: unknown): T | null => (typeof value === "string" ? (JSON.parse(value) as T) : null);

/** Append-only audit log in SQLite (design D15). In memory unless a file path is given. */
export class AuditLog {
  private constructor(
    private readonly db: Database,
    private readonly file: string | undefined,
  ) {}

  static async open(file?: string): Promise<AuditLog> {
    const SQL = await initSqlJs();
    const db = file && existsSync(file) ? new SQL.Database(readFileSync(file)) : new SQL.Database();
    db.exec(SCHEMA);
    db.exec(APPEND_ONLY);
    return new AuditLog(db, file);
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, Buffer.from(this.db.export()));
  }

  private insert(sql: string, params: Array<string | number | null>): number {
    this.db.run(sql, params);
    const id = Number(this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0]);
    this.persist();
    return id;
  }

  recordCall(call: NewCall): number {
    return this.insert(
      `INSERT INTO calls (request_id, at, principal, via_agent, operation, target, inputs, kb_version, raw_facts, context, decision, outcome, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        call.request_id,
        call.at,
        call.principal,
        call.via_agent ? 1 : 0,
        call.operation,
        call.target,
        JSON.stringify(call.inputs),
        call.kb_version,
        json(call.raw_facts),
        json(call.context),
        json(call.decision),
        call.outcome,
        call.error,
      ],
    );
  }

  recordApproval(approval: NewApproval): number {
    return this.insert("INSERT INTO approvals (request_id, at, approver, approved, override, comment) VALUES (?, ?, ?, ?, ?, ?)", [
      approval.request_id,
      approval.at,
      approval.approver,
      approval.approved ? 1 : 0,
      approval.override ? 1 : 0,
      approval.comment,
    ]);
  }

  recordOutcome(outcome: NewOutcome): number {
    return this.insert("INSERT INTO outcomes (request_id, at, status, steps) VALUES (?, ?, ?, ?)", [
      outcome.request_id,
      outcome.at,
      outcome.status,
      JSON.stringify(outcome.steps),
    ]);
  }

  private select(sql: string, params: Array<string | number> = []): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
    stmt.free();
    return rows;
  }

  private toCall(r: Record<string, unknown>): AuditCall {
    return {
      id: Number(r.id),
      request_id: String(r.request_id),
      at: String(r.at),
      principal: String(r.principal),
      via_agent: r.via_agent === 1,
      operation: String(r.operation),
      target: (r.target as string | null) ?? null,
      inputs: parse<Record<string, unknown>>(r.inputs) ?? {},
      kb_version: (r.kb_version as string | null) ?? null,
      raw_facts: parse(r.raw_facts),
      context: parse(r.context),
      decision: parse(r.decision),
      outcome: String(r.outcome),
      error: (r.error as string | null) ?? null,
    };
  }

  calls(filter: { operation?: string; target?: string; from?: string; to?: string; requestId?: string } = {}): AuditCall[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.operation) (where.push("operation = ?"), params.push(filter.operation));
    if (filter.target) (where.push("target = ?"), params.push(filter.target));
    if (filter.from) (where.push("at >= ?"), params.push(filter.from));
    if (filter.to) (where.push("at < ?"), params.push(filter.to));
    if (filter.requestId) (where.push("request_id = ?"), params.push(filter.requestId));
    const sql = `SELECT * FROM calls ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at, id`;
    return this.select(sql, params).map((r) => this.toCall(r));
  }

  approvals(requestId?: string): AuditApproval[] {
    const rows = requestId ? this.select("SELECT * FROM approvals WHERE request_id = ? ORDER BY id", [requestId]) : this.select("SELECT * FROM approvals ORDER BY id");
    return rows.map((r) => ({
      id: Number(r.id),
      request_id: String(r.request_id),
      at: String(r.at),
      approver: String(r.approver),
      approved: r.approved === 1,
      override: r.override === 1,
      comment: (r.comment as string | null) ?? null,
    }));
  }

  outcomes(requestId?: string): AuditOutcome[] {
    const rows = requestId ? this.select("SELECT * FROM outcomes WHERE request_id = ? ORDER BY id", [requestId]) : this.select("SELECT * FROM outcomes ORDER BY id");
    return rows.map((r) => ({ id: Number(r.id), request_id: String(r.request_id), at: String(r.at), status: String(r.status), steps: parse<unknown[]>(r.steps) ?? [] }));
  }

  /** Runs raw SQL. Only for tests that check the append-only guarantee. */
  unsafeExec(sql: string): void {
    this.db.exec(sql);
  }
}
