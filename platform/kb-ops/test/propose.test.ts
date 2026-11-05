import { afterEach, describe, expect, it } from "vitest";
import { casey, edited, governedService } from "./governed";

let env: Awaited<ReturnType<typeof governedService>>;
afterEach(() => env?.cleanup());

describe("propose_delta and validation as if applied", () => {
  it("creates a draft without changing the main KB", async () => {
    env = await governedService();
    const head = env.repo.head();
    const result = await env.service.propose_delta(casey, {
      title: "Clarify the refund window",
      rationale: "Wording",
      changes: [{ op: "modify", id: "rule.refund-window", content: edited("rules/refund-window.md", "title: Refund window", "title: Refund request window") }],
    });
    expect(result).toEqual({ delta_id: "delta-1", status: "draft", errors: [], changed: ["rule.refund-window"] });
    expect(env.repo.head()).toBe(head);
  });

  it("blocks a delta that would break links: each broken link is reported and the delta stays a draft", async () => {
    env = await governedService();
    const result = await env.service.propose_delta(casey, {
      title: "Drop the one-refund rule",
      rationale: "We think the ERP was fixed",
      changes: [{ op: "remove", id: "rule.single-refund-per-order" }],
      propose: true,
    });
    expect(result.status).toBe("draft");
    expect(result.errors.map((e) => e.message)).toEqual([
      "job.nightly-finance links to missing node 'rule.single-refund-per-order' via 'depends-on'",
    ]);
    expect(env.store.record("delta-1")?.status).toBe("draft");
  });

  it("reports invalid content in an added node", async () => {
    env = await governedService();
    const result = await env.service.propose_delta(casey, {
      title: "Add a rule",
      rationale: "x",
      changes: [{ op: "add", id: "rule.new", content: "---\nid: rule.new\nkind: BusinessRule\ntitle: New\nenforcement: {kb-layer: false}\nimplemented-by: [component.ghost]\n---\n" }],
      propose: true,
    });
    expect(result.status).toBe("draft");
    expect(result.errors.map((e) => e.message).sort()).toEqual([
      "missing required field 'statement'",
      "rule.new links to missing node 'component.ghost' via 'implemented-by'",
    ]);
  });

  it("refuses to modify or remove nodes that do not exist", async () => {
    env = await governedService();
    await expect(env.service.propose_delta(casey, { title: "x", changes: [{ op: "remove", id: "rule.ghost" }] })).rejects.toThrow("cannot remove unknown node 'rule.ghost'");
  });
});
