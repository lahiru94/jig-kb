import type { KbView } from "@jig/kb-core";
import type { DeltaRecord, DeltaStore } from "./deltas";

/** The audit facts the evaluator reads: held requests and what people decided about them. */
export interface HeldRequest {
  request_id: string;
  at: string;
  decision: Record<string, unknown> | null;
}

export interface ApprovalFact {
  request_id: string;
  approved: boolean;
}

export interface OverrideFinding {
  rule: string;
  owner: string | undefined;
  window: { from: string; to: string };
  held: number;
  approved: number;
  rate: number;
  threshold: number;
  min_samples: number;
}

interface Threshold {
  rate: number;
  window_days: number;
  min_samples?: number;
}

/** Rules a decision was held by at level 2. */
function heldBy(decision: Record<string, unknown> | null): string[] {
  const reasons = (decision?.reasons ?? []) as Array<{ source?: string; kind?: string; level?: number }>;
  return reasons.filter((r) => r.kind === "rule" && r.level === 2 && typeof r.source === "string").map((r) => r.source as string);
}

/**
 * Computes, for every rule with an `override-threshold`, how often people approved the requests it held
 * within its rolling window (design D11). A finding is returned when the rate reaches the threshold and
 * there are enough samples. Purely computed from the audit log, so the numbers are reproducible.
 */
export function findOverrides(view: KbView, requests: readonly HeldRequest[], approvals: readonly ApprovalFact[], now: string): OverrideFinding[] {
  const decided = new Map<string, boolean>();
  for (const a of approvals) decided.set(a.request_id, a.approved);
  const findings: OverrideFinding[] = [];
  for (const rule of view.index.byKind("BusinessRule")) {
    const threshold = rule.data.override_threshold as Threshold | undefined;
    if (!threshold) continue;
    const window = { from: new Date(new Date(now).getTime() - threshold.window_days * 86_400_000).toISOString(), to: now };
    const held = requests.filter((r) => r.at >= window.from && r.at < window.to && heldBy(r.decision).includes(rule.id) && decided.has(r.request_id));
    const approved = held.filter((r) => decided.get(r.request_id) === true).length;
    const rate = held.length === 0 ? 0 : approved / held.length;
    const minSamples = threshold.min_samples ?? 1;
    if (held.length >= minSamples && rate >= threshold.rate) {
      const owners = Array.isArray(rule.data.owned_by) ? (rule.data.owned_by as string[]) : [];
      findings.push({
        rule: rule.id,
        owner: owners[0],
        window,
        held: held.length,
        approved,
        rate: Math.round(rate * 1000) / 1000,
        threshold: threshold.rate,
        min_samples: minSamples,
      });
    }
  }
  return findings;
}

/**
 * Drafts one delta per finding, assigned to the rule's owner and citing the evidence. A rule that
 * already has an open evidence-based delta gets no second one. The delta starts without changes:
 * an agent drafts the concrete change, and people review it like any other delta.
 */
export function draftEvidenceProposals(store: DeltaStore, findings: readonly OverrideFinding[], proposer = "agent.evidence-evaluator"): DeltaRecord[] {
  const open = store.list().filter((d) => (d.status === "draft" || d.status === "proposed") && d.evidence?.rule !== undefined);
  const drafted: DeltaRecord[] = [];
  for (const finding of findings) {
    if (open.some((d) => d.evidence?.rule === finding.rule)) continue;
    const percent = Math.round(finding.rate * 100);
    drafted.push(
      store.create({
        title: `Review ${finding.rule}: people override it ${percent}% of the time`,
        rationale:
          `In the ${Math.round((Date.parse(finding.window.to) - Date.parse(finding.window.from)) / 86_400_000)} days to ${finding.window.to.slice(0, 10)}, ` +
          `${finding.rule} held ${finding.held} requests and people approved ${finding.approved} of them (${percent}%), ` +
          `above the configured threshold of ${Math.round(finding.threshold * 100)}%. The rule may no longer match how the business works.`,
        proposer,
        changes: [],
        ...(finding.owner ? { assigned_to: finding.owner } : {}),
        evidence: { ...finding },
      }),
    );
  }
  return drafted;
}
