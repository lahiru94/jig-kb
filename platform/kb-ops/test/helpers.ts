import { fileURLToPath } from "node:url";
import { AuditLog, DirectoryKbSource, KbService, type DeltaReader, type NodeChange } from "../src/index";

export const FIXTURE_KB = fileURLToPath(new URL("../../kb-core/test/fixtures/kb", import.meta.url));
export const SAMPLE_KB = fileURLToPath(new URL("../../../sample-org/kb", import.meta.url));

export class MemoryDeltas implements DeltaReader {
  private readonly deltas = new Map<string, { id: string; changes: NodeChange[] }>();
  add(id: string, changes: NodeChange[]): void {
    this.deltas.set(id, { id, changes });
  }
  get(id: string) {
    return this.deltas.get(id);
  }
}

export async function makeService(dir = FIXTURE_KB) {
  const deltas = new MemoryDeltas();
  const audit = await AuditLog.open();
  const kb = new DirectoryKbSource(dir, deltas);
  let seq = 0;
  const service = new KbService({ kb, audit, deltas, now: () => new Date("2026-10-15T12:00:00Z"), newId: (p) => `${p}-${++seq}` });
  return { service, audit, deltas, kb };
}

export const agent = { user: "actor.sam", viaAgent: true };
export const human = { user: "actor.sam", viaAgent: false };
