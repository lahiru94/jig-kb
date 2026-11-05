import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeltaStore, GitKbRepo, GitKbSource } from "@jig/governance";
import { AuditLog, KbService } from "../src/index";
import { FakeSystems } from "./fake-systems";
import { SAMPLE_KB } from "./helpers";

/** A KbService over a fresh git copy of the sample KB, with fake systems behind the bindings. */
export async function governedService(now = "2026-10-20T09:00:00.000Z") {
  const root = mkdtempSync(join(tmpdir(), "jig-svc-"));
  const repo = GitKbRepo.create(join(root, "kb"), SAMPLE_KB, "demo-start");
  let seq = 0;
  const store = new DeltaStore(repo, () => new Date(now), () => `delta-${++seq}`);
  const source = new GitKbSource(repo, store);
  const audit = await AuditLog.open();
  const systems = new FakeSystems();
  let req = 0;
  let clock = new Date(now);
  const service = new KbService({
    kb: source,
    audit,
    governance: { source, store },
    executor: systems.executor(),
    now: () => clock,
    newId: (p) => `${p}-${++req}`,
  });
  return {
    service,
    audit,
    repo,
    store,
    source,
    systems,
    setNow: (iso: string) => (clock = new Date(iso)),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Sample KB file content with one replacement, as delta content. */
export function edited(path: string, from: string, to: string): string {
  const text = readFileSync(join(SAMPLE_KB, path), "utf8");
  if (!text.includes(from)) throw new Error(`'${from}' not found in ${path}`);
  return text.replace(from, to);
}

export const casey = { user: "actor.casey", viaAgent: true };
export const alex = { user: "actor.alex", viaAgent: false };
export const morgan = { user: "actor.morgan", viaAgent: false };
