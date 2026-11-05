import { afterEach, describe, expect, it } from "vitest";
import { OperationError } from "../src/index";
import { alex, casey, edited, governedService, morgan } from "./governed";

let env: Awaited<ReturnType<typeof governedService>>;
afterEach(() => env?.cleanup());

async function denied(p: Promise<unknown>): Promise<OperationError> {
  const error = await p.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OperationError);
  expect((error as OperationError).code).toBe("denied");
  return error as OperationError;
}

describe("delta application by permission level", () => {
  it("a level 1 wording fix is applied automatically and audited", async () => {
    env = await governedService();
    const head = env.repo.head();
    const result = await env.service.propose_delta(casey, {
      title: "Fix the rule title",
      rationale: "Clearer wording",
      changes: [{ op: "modify", id: "rule.refund-window", content: edited("rules/refund-window.md", "title: Refund window", "title: Refund request window") }],
      propose: true,
    });
    expect(result).toMatchObject({ status: "applied", level: 1 });
    expect(env.repo.head()).not.toBe(head);
    expect(env.source.current().index.get("rule.refund-window")?.title).toBe("Refund request window");
    expect(env.audit.calls({ operation: "propose_delta" }).at(-1)).toMatchObject({ outcome: "applied", decision: { level: 1 } });
  });

  it("a level 2 delta waits for a person who may apply it", async () => {
    env = await governedService();
    const head = env.repo.head();
    const result = await env.service.propose_delta(casey, {
      title: "Raise the approval limit",
      rationale: "Supervisors approve nearly all of these",
      changes: [{ op: "modify", id: "rule.refund-approval-limit", content: edited("rules/refund-approval-limit.md", "context.amount_cents > 50000", "context.amount_cents > 80000") }],
      propose: true,
    });
    expect(result.status).toBe("proposed");
    expect(env.repo.head()).toBe(head);
    // The agent cannot approve it, and a supervisor without permission to apply structural changes cannot either.
    await denied(env.service.approve(casey, { request_id: result.delta_id, approve: true }));
    await denied(env.service.approve(morgan, { request_id: result.delta_id, approve: true }));
    expect(env.store.record(result.delta_id)?.status).toBe("proposed");
    // The Head of Customer Service may.
    const approved = await env.service.approve(alex, { request_id: result.delta_id, approve: true });
    expect(approved.status).toBe("applied");
    expect(env.repo.head()).not.toBe(head);
  });

  it("a delta raising agent autonomy still needs a person, even when the KB declares such changes level 1", async () => {
    env = await governedService();
    // Plant a declaration that makes every change level 1 for customer service agents.
    const planted = env.repo.commitChanges(env.repo.head(), [env.repo.head()], [
      {
        op: "add",
        id: "permission.agents-apply-anything",
        content: "---\nid: permission.agents-apply-anything\nkind: Permission\ntitle: Planted - agents apply anything\noperation: kb.apply-delta\nroles: [role.cs-agent]\nlevel: 1\n---\n",
      },
    ], "Plant a permissive declaration");
    env.repo.advanceMain(planted);
    const head = env.repo.head();

    const result = await env.service.propose_delta(casey, {
      title: "Let agents refund anything",
      rationale: "More autonomy",
      changes: [
        {
          op: "modify",
          id: "permission.staff-refund",
          content: edited("permissions/staff-refund.md", "title: Customer service may issue refunds", "title: Agents may issue any refund"),
        },
      ],
      propose: true,
    });
    expect(result.status).toBe("proposed");
    expect(result.level).toBe(2);
    expect(env.repo.head()).toBe(head);
    const error = await denied(env.service.approve(casey, { request_id: result.delta_id, approve: true }));
    expect(JSON.stringify(error.details.decision)).toContain("floor.agents-never-approve");
    const approved = await env.service.approve(alex, { request_id: result.delta_id, approve: true });
    expect(approved.status).toBe("applied");
  });

  it("rejection keeps the main KB unchanged", async () => {
    env = await governedService();
    const head = env.repo.head();
    const result = await env.service.propose_delta(casey, {
      title: "Raise the approval limit",
      rationale: "x",
      changes: [{ op: "modify", id: "rule.refund-approval-limit", content: edited("rules/refund-approval-limit.md", "context.amount_cents > 50000", "context.amount_cents > 80000") }],
      propose: true,
    });
    const rejected = await env.service.approve(alex, { request_id: result.delta_id, approve: false, comment: "Not yet" });
    expect(rejected.status).toBe("rejected");
    expect(env.repo.head()).toBe(head);
    expect(env.store.record(result.delta_id)?.approvals).toEqual([expect.objectContaining({ approver: "actor.alex", approved: false, comment: "Not yet" })]);
  });
});
