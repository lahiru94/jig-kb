import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeltaStore, GitKbRepo, GitKbSource } from "../src/index";

export const SAMPLE_KB = fileURLToPath(new URL("../../../sample-org/kb", import.meta.url));

/** A fresh git KB repository built from the sample KB, in a temp directory. */
export function sampleRepo() {
  const root = mkdtempSync(join(tmpdir(), "jig-gov-"));
  const dir = join(root, "kb");
  const repo = GitKbRepo.create(dir, SAMPLE_KB, "demo-start");
  let seq = 0;
  const deltas = new DeltaStore(repo, () => new Date("2026-10-20T09:00:00Z"), () => `delta-${++seq}`);
  const source = new GitKbSource(repo, deltas);
  return { root, dir, repo, deltas, source, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function fileIn(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

/** The sample KB file for a node, with a text replacement applied, as delta content. */
export function edited(path: string, from: string, to: string): string {
  const text = readFileSync(join(SAMPLE_KB, path), "utf8");
  if (!text.includes(from)) throw new Error(`'${from}' not found in ${path}`);
  return text.replace(from, to);
}
