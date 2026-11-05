import type { KbView } from "@jig/kb-core";

/** A recorded action request, as replay needs it (the audit log's `act` rows satisfy this). */
export interface RecordedRequest {
  request_id: string;
  at: string;
  target: string | null;
  decision: Record<string, unknown> | null;
}

export type Replayed =
  | { status: "ok"; decision: { level: number; reasons: Array<{ source: string; reason: string }> } }
  | { status: "insufficient-facts"; missing: string }
  | { status: "not-an-action"; reason: string };

/** Re-evaluates one recorded request against a KB view, using only recorded facts. kb-ops supplies this. */
export type Reevaluator = (view: KbView, request: RecordedRequest) => Promise<Replayed>;

export interface SimulationReport {
  delta_id: string;
  window: { from: string; to: string };
  replayed: number;
  changed: number;
  insufficient_facts: number;
  /** Counts by `<level before>-><level after>`, for example `2->1`. */
  by_outcome: Record<string, number>;
  examples: Array<{ request_id: string; at: string; action: string; before: number; after: number; reasons: string[] }>;
}

const MAX_EXAMPLES = 5;

function levelOf(decision: Record<string, unknown> | null): number | undefined {
  const level = decision?.level;
  return typeof level === "number" ? level : undefined;
}

/**
 * Replays recorded action requests against the KB before and after a delta (design D10), and reports
 * how decisions would differ. Both sides are re-evaluated from the recorded facts, so only the delta's
 * effect shows, not differences between today's KB and whatever decided the request at the time.
 * Requests are taken in time order, so the same delta and window always give the same report.
 * Requests whose facts were never recorded are counted as insufficient, not guessed.
 */
export async function simulateDelta(
  deltaId: string,
  before: KbView,
  after: KbView,
  requests: readonly RecordedRequest[],
  actions: ReadonlySet<string>,
  window: { from: string; to: string },
  reevaluate: Reevaluator,
): Promise<SimulationReport> {
  const relevant = requests
    .filter((r) => r.target !== null && actions.has(r.target) && r.at >= window.from && r.at < window.to)
    .sort((a, b) => a.at.localeCompare(b.at) || a.request_id.localeCompare(b.request_id));
  const report: SimulationReport = { delta_id: deltaId, window, replayed: 0, changed: 0, insufficient_facts: 0, by_outcome: {}, examples: [] };
  for (const request of relevant) {
    if (levelOf(request.decision) === undefined) continue;
    const baseline = await reevaluate(before, request);
    const result = await reevaluate(after, request);
    if (baseline.status !== "ok" || result.status !== "ok") {
      if (baseline.status === "insufficient-facts" || result.status === "insufficient-facts") report.insufficient_facts++;
      continue;
    }
    report.replayed++;
    const beforeLevel = baseline.decision.level;
    const afterLevel = result.decision.level;
    const key = `${beforeLevel}->${afterLevel}`;
    report.by_outcome[key] = (report.by_outcome[key] ?? 0) + 1;
    if (afterLevel !== beforeLevel) {
      report.changed++;
      if (report.examples.length < MAX_EXAMPLES) {
        report.examples.push({
          request_id: request.request_id,
          at: request.at,
          action: request.target ?? "",
          before: beforeLevel,
          after: afterLevel,
          reasons: result.decision.reasons.map((r) => `${r.source}: ${r.reason}`),
        });
      }
    }
  }
  return report;
}
