import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reportMarkdown } from "@jig/extraction";
import { runBenchmark } from "../../scripts/benchmark";

describe("extraction benchmark on the sample organization", () => {
  it("produces a report, and the recorded baseline in BENCHMARK.md matches the current run", async () => {
    const { report, valid } = await runBenchmark();
    expect(valid).toBe(true);
    expect(report.rules.extracted).toBeGreaterThan(0);
    expect(report.planted).toHaveLength(6);
    const recorded = readFileSync(fileURLToPath(new URL("../../platform/extraction/BENCHMARK.md", import.meta.url)), "utf8");
    expect(recorded).toContain(reportMarkdown(report, "Heuristic passes (no model)"));
  }, 60_000);

  it("finds every planted problem with the heuristic passes", async () => {
    const { report } = await runBenchmark();
    expect(report.planted.filter((p) => !p.found)).toEqual([]);
  }, 60_000);
});
