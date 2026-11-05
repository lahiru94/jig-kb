import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { KbNode, KbView, KbValidator, ValidationReport } from "@jig/kb-core";
import { validateDelta } from "@jig/governance";
import { HEURISTIC_PASSES } from "./heuristics";
import { mergeCandidates, type MergeResult } from "./merge";
import type { Candidate, ExtractionPass, ProgressListener, SourceFile } from "./types";

const SKIP = new Set(["node_modules", ".git", "dist", "kb", "data", "test", ".venv"]);

/** Reads source files under `roots` (relative to `base`), skipping KB folders, build output and tests. */
export function readSources(base: string, roots: readonly string[]): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP.has(entry) || entry.startsWith(".")) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|js|mjs|md)$/.test(entry)) out.push({ path: relative(base, path).split(sep).join("/"), content: readFileSync(path, "utf8") });
    }
  };
  for (const root of roots) walk(join(base, root));
  return out;
}

export interface ExtractionResult extends MergeResult {
  candidates: Candidate[];
  validation: ValidationReport;
}

/**
 * Runs the three extraction passes (inventory, rules, documents) and merges what they find into the KB as
 * changes, validated as if applied (kb-extraction spec). Progress is reported as nodes are drafted.
 */
export async function extract(
  files: readonly SourceFile[],
  view: KbView,
  validator: KbValidator,
  options: { passes?: readonly ExtractionPass[]; onProgress?: ProgressListener; fileOf?: (node: KbNode) => string | undefined } = {},
): Promise<ExtractionResult> {
  const passes = options.passes ?? HEURISTIC_PASSES;
  const candidates: Candidate[] = [];
  for (const pass of passes) {
    options.onProgress?.({ pass: pass.name, message: `Reading ${pass.name === "documents" ? "documents" : "code"} (${pass.name})...`, drafted: [] });
    const found = await pass.run(files, { inventory: candidates.filter((c) => c.pass === "inventory") });
    candidates.push(...found);
    options.onProgress?.({ pass: pass.name, message: `${pass.name}: drafted ${found.length} node${found.length === 1 ? "" : "s"}`, drafted: found.map((c) => c.id) });
  }
  const merged = mergeCandidates(view, candidates, options.fileOf ?? (() => undefined));
  // Links to nodes the extraction does not know about (and the KB lacks) are dropped rather than left dangling.
  const validation = validateDelta(validator, view, merged.changes);
  return { ...merged, candidates, validation };
}
