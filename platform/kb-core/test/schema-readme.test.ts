import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KINDS, KbValidator, SCHEMA_DIR, parseNodeFile, type KbNode } from "../src/index";

/** Extracts each ````markdown example file from the schema README, with the path shown before it. */
function readmeExamples(): KbNode[] {
  const text = readFileSync(`${SCHEMA_DIR}README.md`, "utf8");
  const nodes: KbNode[] = [];
  for (const match of text.matchAll(/File `([^`]+)`:\n\n````markdown\n([\s\S]*?)\n````/g)) {
    const parsed = parseNodeFile(`${match[2] ?? ""}\n`, match[1] ?? "");
    if ("message" in parsed) throw new Error(`${parsed.file}: ${parsed.message}`);
    nodes.push(parsed);
  }
  return nodes;
}

describe("schema README", () => {
  const examples = readmeExamples();

  it("documents every node kind with an example file", () => {
    expect(new Set(examples.map((n) => n.kind))).toEqual(new Set(KINDS.map((k) => k.kind)));
  });

  it("has examples that all pass the validator", () => {
    const report = new KbValidator().validate(examples);
    expect(report.errors).toEqual([]);
  });
});
