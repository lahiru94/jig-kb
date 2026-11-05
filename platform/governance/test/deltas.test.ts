import { afterEach, describe, expect, it } from "vitest";
import { edited, fileIn, sampleRepo } from "./helpers";

let env: ReturnType<typeof sampleRepo>;
afterEach(() => env?.cleanup());

const raiseLimit = () => ({
  op: "modify" as const,
  id: "rule.refund-approval-limit",
  content: edited("rules/refund-approval-limit.md", "Refunds over $500 need a supervisor's approval.\npart-of", "Refunds over $800 need a supervisor's approval.\npart-of"),
});

describe("deltas as git branches", () => {
  it("a draft delta leaves the main KB unchanged and can be read before and after", () => {
    env = sampleRepo();
    const { repo, deltas, source, dir } = env;
    const mainBefore = repo.head();
    const fileBefore = fileIn(dir, "rules/refund-approval-limit.md");

    const delta = deltas.create({ title: "Raise the approval limit", rationale: "Supervisors approve almost all of them", proposer: "actor.casey", changes: [raiseLimit()] });
    expect(delta).toMatchObject({ id: "delta-1", status: "draft", base: mainBefore, branch: "delta/delta-1" });

    expect(repo.head()).toBe(mainBefore);
    expect(fileIn(dir, "rules/refund-approval-limit.md")).toBe(fileBefore);
    expect(repo.isDirty()).toBe(false);
    expect(source.current().index.get("rule.refund-approval-limit")?.data.statement).toBe("Refunds over $500 need a supervisor's approval.");

    expect(source.before("delta-1")?.index.get("rule.refund-approval-limit")?.data.statement).toBe("Refunds over $500 need a supervisor's approval.");
    expect(source.asOf("delta-1")?.index.get("rule.refund-approval-limit")?.data.statement).toBe("Refunds over $800 need a supervisor's approval.");

    // The branch itself holds the change.
    const onBranch = repo.nodes(delta.head).find((n) => n.id === "rule.refund-approval-limit");
    expect(onBranch?.data.statement).toBe("Refunds over $800 need a supervisor's approval.");
    expect(onBranch?.file).toBe("rules/refund-approval-limit.md");
    expect(repo.branches("delta/")).toEqual(["delta/delta-1"]);
  });

  it("adds new nodes under their kind's folder and removes nodes", () => {
    env = sampleRepo();
    const { repo, deltas } = env;
    const delta = deltas.create({
      title: "Restructure",
      rationale: "test",
      proposer: "actor.casey",
      changes: [
        { op: "add", id: "goal.fast-refunds", content: "---\nid: goal.fast-refunds\nkind: Goal\ntitle: Refund within a day\n---\n" },
        { op: "remove", id: "goal.customer-trust" },
      ],
    });
    const files = repo.files(delta.head).map((f) => f.path);
    expect(files).toContain("goals/fast-refunds.md");
    expect(files).not.toContain("goals/customer-trust.md");
  });

  it("tracks the status lifecycle and editing returns a delta to draft", () => {
    env = sampleRepo();
    const { deltas } = env;
    const delta = deltas.create({ title: "T", rationale: "R", proposer: "actor.casey", changes: [raiseLimit()] });
    expect(deltas.setStatus(delta.id, "proposed").status).toBe("proposed");
    const edited2 = deltas.update(delta.id, { title: "T2" });
    expect(edited2).toMatchObject({ status: "draft", title: "T2" });
    deltas.setStatus(delta.id, "applied");
    expect(() => deltas.update(delta.id, { title: "T3" })).toThrow("cannot be edited");
    expect(deltas.list().map((d) => d.id)).toEqual(["delta-1"]);
  });
});
