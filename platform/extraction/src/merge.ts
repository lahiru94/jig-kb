import { stringify } from "yaml";
import type { KbNode, KbView, NodeChange } from "@jig/kb-core";
import { slugify } from "./heuristics";
import type { Candidate, ExtractedClaim } from "./types";

const kebab = (key: string): string => key.replace(/_/g, "-");

function kebabKeys(value: unknown, freeForm = false): unknown {
  if (Array.isArray(value)) return value.map((v) => kebabKeys(v));
  if (value !== null && typeof value === "object" && !freeForm) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[kebab(k)] = kebabKeys(v, k === "config" || k === "with");
    return out;
  }
  return value;
}

/** Writes a node as a KB file: YAML frontmatter (kebab-case keys) and an optional body. */
export function nodeFile(data: Record<string, unknown>, body = ""): string {
  return `---\n${stringify(kebabKeys(data), { lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}

/** Words for matching: camelCase split, lower-cased, stop words removed, plurals stemmed. */
function tokens(text: string): Set<string> {
  const split = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  return new Set(
    slugify(split, 50)
      .split("-")
      .filter((t) => t.length > 2 && !/^\d+$/.test(t))
      .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t)),
  );
}

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function numbers(text: string): Set<string> {
  return new Set([...text.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => m[0]));
}

const MATCH_THRESHOLD = 0.4;

/** The existing rule an extracted rule describes, if any: the best title and statement overlap above a threshold. */
export function matchRule(view: KbView, candidate: Candidate): KbNode | undefined {
  const text = `${candidate.title} ${String(candidate.fields.statement ?? "")}`;
  let best: { node: KbNode; score: number } | undefined;
  for (const rule of view.index.byKind("BusinessRule")) {
    const claims = (Array.isArray(rule.data.claims) ? rule.data.claims : []) as ExtractedClaim[];
    const score = Math.max(
      similarity(text, `${rule.title} ${String(rule.data.statement ?? "")}`),
      ...claims.map((c) => similarity(text, c.says)),
    );
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { node: rule, score };
  }
  return best?.node;
}

/** Whether two claims disagree: they state different numbers about the same thing. */
export function disagrees(a: string, b: string): boolean {
  const na = numbers(a);
  const nb = numbers(b);
  if (na.size === 0 || nb.size === 0) return false;
  for (const n of na) if (!nb.has(n)) return true;
  for (const n of nb) if (!na.has(n)) return true;
  return false;
}

export interface MergeResult {
  changes: NodeChange[];
  added: string[];
  updated: string[];
  conflicts: Array<{ node: string; about: string; claims: [number, number] }>;
}

/**
 * Merges extraction candidates into the KB as a set of changes (kb-extraction spec). New nodes are added.
 * A candidate that describes an existing rule adds its claim to that rule instead; when the new claim
 * disagrees with an existing one, an open conflict is recorded rather than overwriting anything.
 */
export function mergeCandidates(view: KbView, candidates: readonly Candidate[], fileOf: (node: KbNode) => string | undefined): MergeResult {
  const result: MergeResult = { changes: [], added: [], updated: [], conflicts: [] };
  const updatedNodes = new Map<string, { node: KbNode; claims: ExtractedClaim[]; conflicts: Array<Record<string, unknown>> }>();
  const usedIds = new Set(view.index.all().map((n) => n.id));
  for (const candidate of candidates) {
    const existing = candidate.kind === "BusinessRule" ? matchRule(view, candidate) : view.index.get(candidate.id);
    if (existing) {
      const entry = updatedNodes.get(existing.id) ?? {
        node: existing,
        claims: [...((existing.data.claims as ExtractedClaim[] | undefined) ?? [])],
        conflicts: [...((existing.data.conflicts as Array<Record<string, unknown>> | undefined) ?? [])],
      };
      for (const claim of candidate.claims) {
        if (entry.claims.some((c) => c.source === claim.source)) continue;
        entry.claims.push(claim);
        const index = entry.claims.length - 1;
        const against = entry.claims.findIndex((c, i) => i !== index && disagrees(c.says, claim.says));
        if (against >= 0) {
          const about = `${existing.title.toLowerCase()} (${claim.source.split(":")[0] === "code" ? "code" : "documents"} disagree)`;
          entry.conflicts.push({ about, claims: [against, index], status: "open" });
          result.conflicts.push({ node: existing.id, about, claims: [against, index] });
        }
      }
      updatedNodes.set(existing.id, entry);
      continue;
    }
    let id = candidate.id;
    for (let n = 2; usedIds.has(id); n++) id = `${candidate.id}-${n}`;
    usedIds.add(id);
    const data: Record<string, unknown> = { id, kind: candidate.kind, title: candidate.title, ...candidate.fields, claims: candidate.claims };
    result.changes.push({ op: "add", id, content: nodeFile(data, "Drafted by extraction. Review before relying on it.\n") });
    result.added.push(id);
  }
  for (const { node, claims, conflicts } of updatedNodes.values()) {
    const original = fileOf(node);
    if (!original) continue;
    const parts = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(original);
    const body = parts?.[2] ?? "";
    const { id, kind, title, ...rest } = node.data as Record<string, unknown>;
    const data: Record<string, unknown> = { id, kind, title, ...rest, claims, ...(conflicts.length > 0 ? { conflicts } : {}) };
    // Fields filled from body blocks are written back by the body, not the frontmatter.
    delete data.check;
    delete data.policy_text;
    delete data.expression;
    result.changes.push({ op: "modify", id: node.id, content: nodeFile(data, body) });
    result.updated.push(node.id);
  }
  return result;
}
