import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, generateHistory, overrideRate } from "../../../sample-org/history/src/generate";
import { loadHistoryIntoAudit } from "../../../sample-org/history/src/audit";
import { casey, governedService } from "./governed";

let env: Awaited<ReturnType<typeof governedService>>;
afterEach(() => env?.cleanup());

describe("evidence-based proposals on seeded history", () => {
  it("drafts the approval-limit proposal, assigned to the rule owner and citing the evidence", async () => {
    env = await governedService(DEFAULT_OPTIONS.now);
    const history = generateHistory();
    loadHistoryIntoAudit(history, env.audit);
    const expected = overrideRate(history, "rule.refund-approval-limit");

    const { findings, drafted } = env.service.evaluateEvidence();
    expect(findings).toEqual([
      {
        rule: "rule.refund-approval-limit",
        owner: "role.head-of-cs",
        window: { from: "2026-08-03T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" },
        held: expected.held,
        approved: expected.approved,
        rate: Math.round(expected.rate * 1000) / 1000,
        threshold: 0.8,
        min_samples: 10,
      },
    ]);
    expect(drafted).toHaveLength(1);
    expect(drafted[0]).toMatchObject({
      status: "draft",
      assigned_to: "role.head-of-cs",
      proposer: "agent.evidence-evaluator",
      evidence: { rule: "rule.refund-approval-limit", held: expected.held },
    });
    expect(drafted[0]?.title).toMatch(/^Review rule\.refund-approval-limit: people override it \d+% of the time$/);
    expect(drafted[0]?.rationale).toContain(`held ${expected.held} requests and people approved ${expected.approved}`);
    expect(env.audit.calls({ operation: "evaluate_evidence" })[0]?.outcome).toBe(`drafted ${drafted[0]?.id}`);
  });

  it("does not draft a second proposal for a rule that already has an open one", async () => {
    env = await governedService(DEFAULT_OPTIONS.now);
    loadHistoryIntoAudit(generateHistory(), env.audit);
    expect(env.service.evaluateEvidence().drafted).toHaveLength(1);
    expect(env.service.evaluateEvidence().drafted).toHaveLength(0);
  });

  it("does nothing without enough evidence", async () => {
    env = await governedService(DEFAULT_OPTIONS.now);
    expect(env.service.evaluateEvidence()).toEqual({ findings: [], drafted: [] });
  });

  it("the drafted proposal can be completed by an agent and simulated over the seeded history", async () => {
    env = await governedService(DEFAULT_OPTIONS.now);
    loadHistoryIntoAudit(generateHistory(), env.audit);
    const [draft] = env.service.evaluateEvidence().drafted;
    if (!draft) throw new Error("expected a draft");
    const { readFileSync } = await import("node:fs");
    const { SAMPLE_KB } = await import("./helpers");
    const content = readFileSync(`${SAMPLE_KB}/rules/refund-approval-limit.md`, "utf8").replace("context.amount_cents > 50000", "context.amount_cents > 80000");
    await env.service.propose_delta(casey, { delta_id: draft.id, changes: [{ op: "modify", id: "rule.refund-approval-limit", content }] });
    const report = await env.service.simulate(casey, { delta_id: draft.id, window_days: 90 });
    expect(report.replayed).toBeGreaterThan(50);
    expect(report.insufficient_facts).toBe(0);
    expect(report.by_outcome["2->1"]).toBeGreaterThan(0);
  });
});
