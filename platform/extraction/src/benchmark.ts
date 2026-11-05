import type { KbNode, KbView } from "@jig/kb-core";
import type { Candidate } from "./types";

/** A known problem the benchmark checks for, and the ground-truth node and sources that represent it. */
export interface PlantedProblem {
  id: string;
  title: string;
  /** Ground-truth node that represents the problem. */
  node: string;
  /** Every one of these sources must be found (by some extracted claim) for the problem to count as found. */
  sources: string[];
}

interface Source {
  kind: string;
  file: string;
  from: number;
  to: number;
  anchor: string;
}

function parseSource(source: string): Source {
  const m = /^(\w+):([^#]+)(?:#(.*))?$/.exec(source);
  const kind = m?.[1] ?? "";
  const file = m?.[2] ?? source;
  const anchor = m?.[3] ?? "";
  const lines = /^L(\d+)(?:-L(\d+))?$/.exec(anchor);
  const from = lines ? Number(lines[1]) : 0;
  const to = lines ? Number(lines[2] ?? lines[1]) : 0;
  return { kind, file, from, to, anchor };
}

/** Two sources refer to the same thing: the same file and overlapping lines (code), or the same section (documents). */
export function sameSource(a: string, b: string): boolean {
  const x = parseSource(a);
  const y = parseSource(b);
  if (x.kind !== y.kind || x.file !== y.file) return false;
  if (x.kind === "code") return x.from > 0 && y.from > 0 ? x.from <= y.to && y.from <= x.to : x.anchor === y.anchor;
  return x.anchor === y.anchor;
}

function claimSources(node: KbNode): string[] {
  const claims = (Array.isArray(node.data.claims) ? node.data.claims : []) as Array<{ source?: string }>;
  return claims.map((c) => c.source).filter((s): s is string => typeof s === "string" && /^(code|doc):/.test(s));
}

export interface BenchmarkReport {
  rules: { extracted: number; truth: number; matched_extracted: number; matched_truth: number; precision: number; recall: number };
  links: { extracted: number; truth: number; matched: number; precision: number; recall: number };
  planted: Array<{ id: string; title: string; found: boolean }>;
  /** Extracted rules with no ground-truth match: noise, or things the ground truth leaves out. */
  unmatched: string[];
  /** Ground-truth rules nothing was extracted for. */
  missed: string[];
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
const LINK_TYPES = ["implemented_by", "part_of"] as const;

/**
 * Scores extraction against a ground-truth KB (kb-extraction spec). An extracted rule matches a ground-truth
 * node when one of its claims cites the same source. Rules: precision over extracted rules, recall over
 * ground-truth rules that cite code or documents. Links: implemented-by and part-of links whose ends both
 * map to ground truth. Planted problems: found when every source that represents them was found.
 */
export function scoreExtraction(candidates: readonly Candidate[], truth: KbView, planted: readonly PlantedProblem[]): BenchmarkReport {
  const truthNodes = truth.index.all().filter((n) => claimSources(n).length > 0);
  const extractedRules = candidates.filter((c) => c.kind === "BusinessRule");
  const matchesOf = (candidate: Candidate): KbNode[] =>
    truthNodes.filter((n) => claimSources(n).some((s) => candidate.claims.some((c) => sameSource(c.source, s))));

  // A candidate can support several ground-truth nodes (one document section can state a constraint and a rule).
  // For precision and links it maps to the best one: the same kind if there is one.
  const matched = new Map<string, KbNode>();
  const hitTruth = new Set<string>();
  for (const c of candidates) {
    const all = matchesOf(c);
    for (const n of all) hitTruth.add(n.id);
    const best = all.find((n) => n.kind === c.kind) ?? all[0];
    if (best) matched.set(c.id, best);
  }
  const matchedExtractedRules = extractedRules.filter((c) => matched.has(c.id));
  const truthRules = truthNodes.filter((n) => n.kind === "BusinessRule");
  const matchedTruthRules = truthRules.filter((n) => hitTruth.has(n.id));

  // Links: map extracted ends to ground-truth ids (matched nodes, or the same id).
  const mapId = (id: string): string | undefined => matched.get(id)?.id ?? (truth.index.has(id) ? id : undefined);
  let extractedLinks = 0;
  let matchedLinks = 0;
  for (const c of candidates) {
    for (const type of LINK_TYPES) {
      const targets = Array.isArray(c.fields[type]) ? (c.fields[type] as string[]) : [];
      for (const target of targets) {
        const from = mapId(c.id);
        const to = mapId(target);
        if (!from || !to) continue;
        extractedLinks++;
        const truthTargets = truth.index.get(from)?.data[type];
        if (Array.isArray(truthTargets) && truthTargets.includes(to)) matchedLinks++;
      }
    }
  }
  const truthLinks = truth.index
    .all()
    .filter((n) => n.kind === "BusinessRule" || n.kind === "DataEntity")
    .reduce((sum, n) => sum + LINK_TYPES.reduce((s, t) => s + (Array.isArray(n.data[t]) ? (n.data[t] as unknown[]).length : 0), 0), 0);

  const allSources = candidates.flatMap((c) => c.claims.map((cl) => cl.source));
  return {
    rules: {
      extracted: extractedRules.length,
      truth: truthRules.length,
      matched_extracted: matchedExtractedRules.length,
      matched_truth: matchedTruthRules.length,
      precision: extractedRules.length === 0 ? 0 : round(matchedExtractedRules.length / extractedRules.length),
      recall: truthRules.length === 0 ? 0 : round(matchedTruthRules.length / truthRules.length),
    },
    links: {
      extracted: extractedLinks,
      truth: truthLinks,
      matched: matchedLinks,
      precision: extractedLinks === 0 ? 0 : round(matchedLinks / extractedLinks),
      recall: truthLinks === 0 ? 0 : round(matchedLinks / truthLinks),
    },
    planted: planted.map((p) => ({ id: p.id, title: p.title, found: p.sources.every((s) => allSources.some((found) => sameSource(found, s))) })),
    unmatched: extractedRules.filter((c) => !matched.has(c.id)).map((c) => c.id),
    missed: truthRules.filter((n) => !hitTruth.has(n.id)).map((n) => n.id),
  };
}

/** Renders a report as Markdown. */
export function reportMarkdown(report: BenchmarkReport, label: string): string {
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  return [
    `## ${label}`,
    "",
    "| Measure | Extracted | Ground truth | Matched | Precision | Recall |",
    "|---|---|---|---|---|---|",
    `| Rules | ${report.rules.extracted} | ${report.rules.truth} | ${report.rules.matched_extracted} extracted / ${report.rules.matched_truth} truth | ${pct(report.rules.precision)} | ${pct(report.rules.recall)} |`,
    `| Links | ${report.links.extracted} | ${report.links.truth} | ${report.links.matched} | ${pct(report.links.precision)} | ${pct(report.links.recall)} |`,
    "",
    "| Planted problem | Found |",
    "|---|---|",
    ...report.planted.map((p) => `| ${p.id}. ${p.title} | ${p.found ? "yes" : "no"} |`),
    "",
    `Ground-truth rules missed: ${report.missed.length > 0 ? report.missed.map((m) => `\`${m}\``).join(", ") : "none"}.`,
    "",
  ].join("\n");
}
