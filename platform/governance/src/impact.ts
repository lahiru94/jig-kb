import type { KbIndex, KbView, NodeChange } from "@jig/kb-core";

/** How strongly a change propagates along each link type (design D9). Unlisted link types do not propagate. */
export const IMPACT_WEIGHTS: Readonly<Record<string, number>> = {
  "enforced-on": 1,
  "depends-on": 1,
  "implemented-by": 0.9,
  notifies: 0.9,
  "realized-by": 0.8,
  uses: 0.8,
  "enforcement.components": 0.8,
  "binds-to": 0.7,
  "steps.binding": 0.7,
  "facts.binding": 0.6,
  "facts.derivation": 0.6,
  defines: 0.6,
  resource: 0.6,
  "governed-by": 0.5,
  "fields.ref": 0.5,
  "steps.compensate.binding": 0.5,
  "part-of": 0.4,
};

/** Kinds where an unexpected change does the most damage rank higher. */
const KIND_FACTOR: Readonly<Record<string, number>> = {
  Action: 1,
  Job: 1,
  BusinessRule: 0.9,
  DataEntity: 0.9,
  Interface: 0.9,
  Component: 0.8,
  Process: 0.7,
  System: 0.6,
};

export const IMPACT_DEPTH = 3;

export interface ImpactedNode {
  id: string;
  kind: string;
  title: string;
  /** From a changed node to this one, alternating node ids and link steps such as `<- enforced-on`. */
  path: string[];
  /** 0..1, higher is riskier. */
  risk: number;
  mode?: string;
}

interface Frontier {
  id: string;
  path: string[];
  weight: number;
  depth: number;
}

function explore(index: KbIndex, starts: readonly string[], best: Map<string, Frontier>, depthLimit: number): void {
  let frontier: Frontier[] = starts.filter((id) => index.has(id)).map((id) => ({ id, path: [id], weight: 1, depth: 0 }));
  while (frontier.length > 0) {
    const next: Frontier[] = [];
    for (const item of frontier) {
      if (item.depth >= depthLimit) continue;
      const steps = [
        ...index.outgoing(item.id).map((l) => ({ other: l.to, label: `-> ${l.type}`, type: l.type })),
        ...index.incoming(item.id).map((l) => ({ other: l.from, label: `<- ${l.type}`, type: l.type })),
      ];
      for (const step of steps) {
        const w = IMPACT_WEIGHTS[step.type];
        if (w === undefined || !index.has(step.other)) continue;
        const candidate: Frontier = { id: step.other, path: [...item.path, step.label, step.other], weight: item.weight * w, depth: item.depth + 1 };
        const prior = best.get(step.other);
        if (!prior || candidate.weight > prior.weight || (candidate.weight === prior.weight && candidate.path.length < prior.path.length)) {
          best.set(step.other, candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * Lists every node reachable from a delta's changed nodes over impact-relevant links, in both directions,
 * with the best link path from the change and a risk rank (design D9). Links are taken from both the KB
 * before and after the change, so removed and added links both count. Deterministic.
 */
export function analyzeImpact(before: KbView, after: KbView, changes: readonly NodeChange[], depthLimit = IMPACT_DEPTH): { changed: string[]; impacted: ImpactedNode[] } {
  const changed = [...new Set(changes.map((c) => c.id))].sort();
  const best = new Map<string, Frontier>();
  explore(before.index, changed, best, depthLimit);
  explore(after.index, changed, best, depthLimit);
  const impacted: ImpactedNode[] = [];
  for (const [id, item] of best) {
    if (changed.includes(id)) continue;
    const node = after.index.get(id) ?? before.index.get(id);
    if (!node) continue;
    const enforcedInComponents = Array.isArray((node.data.enforcement as { components?: unknown[] } | undefined)?.components)
      ? ((node.data.enforcement as { components: unknown[] }).components.length > 0 ? 0.05 : 0)
      : 0;
    const risk = Math.min(1, Math.round((item.weight * (KIND_FACTOR[node.kind] ?? 0.5) + enforcedInComponents) * 1000) / 1000);
    impacted.push({
      id,
      kind: node.kind,
      title: node.title,
      path: item.path,
      risk,
      ...(typeof node.data.mode === "string" ? { mode: node.data.mode } : {}),
    });
  }
  impacted.sort((a, b) => b.risk - a.risk || a.id.localeCompare(b.id));
  return { changed, impacted };
}
