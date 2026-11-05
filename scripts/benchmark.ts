import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KbValidator, buildView, loadKb } from "../platform/kb-core/src/index";
import { extract, readSources, reportMarkdown, scoreExtraction, type PlantedProblem } from "../platform/extraction/src/index";

/** Runs extraction on the sample retailer with an empty KB and scores it against the ground-truth KB. */
export async function runBenchmark() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = readSources(root, ["sample-org/services", "sample-org/legacy-erp", "sample-org/docs"]);
  const result = await extract(files, buildView("empty", []), new KbValidator());
  const truth = buildView("ground-truth", loadKb(`${root}sample-org/kb`).nodes);
  const planted = JSON.parse(readFileSync(`${root}sample-org/benchmark/planted.json`, "utf8")) as PlantedProblem[];
  return { report: scoreExtraction(result.candidates, truth, planted), files: files.length, valid: result.validation.valid };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { report, files, valid } = await runBenchmark();
  const markdown = reportMarkdown(report, "Heuristic passes (no model)");
  console.log(markdown);
  if (process.argv.includes("--write")) {
    const path = fileURLToPath(new URL("../platform/extraction/BENCHMARK.md", import.meta.url));
    writeFileSync(
      path,
      [
        "# Extraction benchmark",
        "",
        "Extraction runs on the sample retailer's code and documents (" + files + " files) with an empty KB, and is scored against the hand-written ground-truth KB in `sample-org/kb`. Regenerate with `npm run benchmark -- --write`.",
        "",
        "- An extracted rule **matches** a ground-truth node when one of its claims cites the same source: the same file with overlapping lines (code), or the same section (documents).",
        "- **Rules** precision is over extracted rules; recall is over ground-truth rules.",
        "- **Links** counts implemented-by and part-of links whose two ends both map to ground truth.",
        "- A **planted problem** is found when every source that represents it was found.",
        `- The extraction delta was ${valid ? "valid" : "INVALID"} against the KB schema.`,
        "",
        markdown,
        "These are the baseline numbers for the deterministic passes. Model-backed passes, which plug into the same `ExtractionPass` interface, are expected to raise precision by writing statements instead of copying comments, and to raise recall by reading code without comments.",
        "",
      ].join("\n"),
    );
    console.log(`Wrote ${path}`);
  }
}
