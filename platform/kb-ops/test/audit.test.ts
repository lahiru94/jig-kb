import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog, KbService, OperationError, type CallContext, type Principal, type ToolName } from "../src/index";
import { FIXTURE_KB, MemoryDeltas, agent } from "./helpers";
import { DirectoryKbSource } from "../src/index";

class DenyingService extends KbService {
  protected override guard(operation: ToolName, principal: Principal, _ctx: CallContext): void {
    if (operation === "query" && principal.viaAgent) {
      throw new OperationError("denied", "agents cannot query here", { decision: { level: 3, reasons: [] } });
    }
  }
}

const call = {
  request_id: "req-1",
  at: "2026-10-15T12:00:00.000Z",
  principal: "actor.sam",
  via_agent: true,
  operation: "act",
  target: "action.place-order",
  inputs: { order_id: "o1" },
  kb_version: "v1",
  raw_facts: { order: { total_cents: 100 } },
  context: { evaluated_at: "2026-10-15T12:00:00.000Z" },
  decision: { level: 2 },
  outcome: "queued",
  error: null,
};

describe("append-only audit log", () => {
  it("records denied calls with their decision", async () => {
    const audit = await AuditLog.open();
    const service = new DenyingService({ kb: new DirectoryKbSource(FIXTURE_KB, new MemoryDeltas()), audit });
    await expect(service.query(agent, { text: "order" })).rejects.toThrow("agents cannot query here");
    const [row] = audit.calls();
    expect(row).toMatchObject({ operation: "query", principal: "actor.sam", via_agent: true, outcome: "denied", decision: { level: 3, reasons: [] } });
  });

  it("writes one row per call and links approvals and outcomes by request id", async () => {
    const audit = await AuditLog.open();
    audit.recordCall(call);
    audit.recordApproval({ request_id: "req-1", at: "2026-10-15T13:00:00.000Z", approver: "actor.morgan", approved: true, override: true, comment: null });
    audit.recordOutcome({ request_id: "req-1", at: "2026-10-15T13:00:01.000Z", status: "executed", steps: [{ name: "submit", status: "ok" }] });
    expect(audit.calls({ requestId: "req-1" })).toEqual([{ id: 1, ...call }]);
    expect(audit.approvals("req-1")[0]).toMatchObject({ approver: "actor.morgan", approved: true, override: true });
    expect(audit.outcomes("req-1")[0]).toMatchObject({ status: "executed", steps: [{ name: "submit", status: "ok" }] });
  });

  it("never updates or deletes rows", async () => {
    const audit = await AuditLog.open();
    audit.recordCall(call);
    expect(() => audit.unsafeExec("UPDATE calls SET outcome = 'executed'")).toThrow("append-only");
    expect(() => audit.unsafeExec("DELETE FROM calls")).toThrow("append-only");
    expect(() => audit.unsafeExec("UPDATE approvals SET approved = 0")).not.toThrow(); // no rows to touch
    audit.recordApproval({ request_id: "req-1", at: call.at, approver: "actor.morgan", approved: true, override: false, comment: null });
    expect(() => audit.unsafeExec("UPDATE approvals SET approved = 0")).toThrow("append-only");
    expect(audit.calls()[0]?.outcome).toBe("queued");
  });

  it("persists to a file and reopens with the same rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jig-audit-"));
    try {
      const file = join(dir, "audit.sqlite");
      (await AuditLog.open(file)).recordCall(call);
      const reopened = await AuditLog.open(file);
      expect(reopened.calls()).toHaveLength(1);
      expect(() => reopened.unsafeExec("DELETE FROM calls")).toThrow("append-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
