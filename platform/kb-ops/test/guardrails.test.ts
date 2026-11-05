import { loadKb, parseNodeFile, type KbNode } from "@jig/kb-core";
import { describe, expect, it } from "vitest";
import { AuditLog, KbService, OperationError, applyFloors, buildView, type KbSource, type KbView } from "../src/index";
import { MemoryDeltas, SAMPLE_KB } from "./helpers";

function node(text: string): KbNode {
  const parsed = parseNodeFile(text, "planted.md");
  if ("message" in parsed) throw new Error(parsed.message);
  return parsed;
}

/** Sample KB with planted declarations that try to weaken the guardrails. */
const planted = [
  node(
    "---\nid: permission.agents-approve\nkind: Permission\ntitle: Planted - anyone may approve\noperation: kb.approve\nroles: [role.cs-agent, role.cs-supervisor, role.marketing]\nlevel: 1\n---\n",
  ),
  node("---\nid: permission.anyone-applies\nkind: Permission\ntitle: Planted - anyone applies any change\noperation: kb.apply-delta\nroles: [role.cs-agent, role.marketing]\nlevel: 1\n---\n"),
];
const sample = loadKb(SAMPLE_KB).nodes.filter((n) => n.id !== "policy.agents-cannot-change-permissions");

function source(nodes: KbNode[]): KbSource {
  const view: KbView = buildView("planted", nodes);
  return { current: () => view, asOf: (ref) => (ref === "planted" ? view : undefined) };
}

async function service(nodes: KbNode[]) {
  const deltas = new MemoryDeltas();
  deltas.add("delta-perm", [
    {
      op: "modify",
      id: "permission.staff-refund",
      content:
        "---\nid: permission.staff-refund\nkind: Permission\ntitle: Agents refund anything\noperation: action.issue-refund\nroles: [role.cs-agent]\nlevel: 1\n---\n",
    },
  ]);
  deltas.add("delta-wording", [
    {
      op: "modify",
      id: "goal.customer-trust",
      content: "---\nid: goal.customer-trust\nkind: Goal\ntitle: Customers trust us to make things right\nowned-by: [role.head-of-cs]\n---\n",
    },
  ]);
  const audit = await AuditLog.open();
  return { svc: new KbService({ kb: source(nodes), audit, deltas }), audit };
}

async function errorOf(p: Promise<unknown>): Promise<OperationError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof OperationError) return e;
    throw e;
  }
  throw new Error("expected an error");
}

describe("D8 floors, enforced in code", () => {
  it("denies an agent's approval even when planted KB declarations allow it", async () => {
    const { svc } = await service([...sample, ...planted]);
    for (const user of ["actor.casey", "actor.morgan"]) {
      const error = await errorOf(svc.approve({ user, viaAgent: true }, { request_id: "delta-wording", approve: true }));
      expect(error.code).toBe("denied");
      const decision = error.details.decision as { level: number; reasons: Array<{ source: string }> };
      expect(decision.level).toBe(3);
      expect(decision.reasons.map((r) => r.source)).toContain("floor.agents-never-approve");
    }
  });

  it("lets a person approve the same request (the guard passes)", async () => {
    const { svc } = await service([...sample, ...planted]);
    const error = await errorOf(svc.approve({ user: "actor.morgan", viaAgent: false }, { request_id: "delta-wording", approve: true }));
    expect(error.code).not.toBe("denied");
  });

  it("keeps permission changes at level 2 or above even when the KB declares them level 1", async () => {
    const { svc } = await service([...sample, ...planted]);
    // A person may still approve it: level 2 means a person must do it.
    const human = await errorOf(svc.approve({ user: "actor.morgan", viaAgent: false }, { request_id: "delta-perm", approve: true }));
    expect(human.code).not.toBe("denied");
    expect(
      applyFloors({ operation: "kb.apply-delta", principal: { user: "actor.casey", viaAgent: true }, changesGuardrails: true }, { level: 1, reasons: [] }),
    ).toEqual({
      level: 2,
      reasons: [{ source: "floor.guardrail-changes-need-a-human", kind: "floor", level: 2, reason: "Changes to permissions or policies always need a person's approval." }],
    });
    expect(applyFloors({ operation: "kb.apply-delta", principal: { user: "x", viaAgent: true } }, { level: 1, reasons: [] }).level).toBe(1);
  });

  it("audits every call, including denied ones", async () => {
    const { svc, audit } = await service([...sample, ...planted]);
    await errorOf(svc.approve({ user: "actor.casey", viaAgent: true }, { request_id: "delta-wording", approve: true }));
    await svc.query({ user: "actor.casey", viaAgent: true }, { focus: "rule.refund-window", depth: 0 });
    expect(audit.calls().map((c) => [c.operation, c.outcome])).toEqual([
      ["approve", "denied"],
      ["query", "ok"],
    ]);
  });
});

describe("per-principal guardrails on every operation", () => {
  it("denies an operator-role agent approving a delta, with reasons", async () => {
    const { svc, audit } = await service(loadKb(SAMPLE_KB).nodes);
    const error = await errorOf(svc.approve({ user: "actor.casey", viaAgent: true }, { request_id: "delta-wording", approve: true }));
    expect(error.code).toBe("denied");
    const decision = error.details.decision as { level: number; reasons: Array<{ source: string; reason: string }> };
    expect(decision.reasons).toEqual([
      expect.objectContaining({ source: "kb.approve", kind: "default", reason: "No permission declaration lets actor.casey do kb.approve." }),
      expect.objectContaining({ source: "floor.agents-never-approve" }),
    ]);
    expect(audit.calls()[0]).toMatchObject({ operation: "approve", outcome: "denied", decision: { level: 3 } });
  });

  it("denies operations the user's role has no permission for", async () => {
    const nodes = loadKb(SAMPLE_KB).nodes.filter((n) => n.id !== "permission.everyone-reads");
    const { svc } = await service(nodes);
    const error = await errorOf(svc.query({ user: "actor.casey", viaAgent: true }, { text: "refund" }));
    expect(error.code).toBe("denied");
    expect(error.message).toContain("No permission declaration lets actor.casey do kb.query.");
  });

  it("allows permitted operations", async () => {
    const { svc } = await service(loadKb(SAMPLE_KB).nodes);
    const result = await svc.query({ user: "actor.jordan", viaAgent: true }, { kind: "Capability" });
    expect(result.nodes.map((n) => n.id)).toEqual(["capability.loyalty", "capability.ordering", "capability.returns"]);
  });
});
