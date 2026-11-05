import type { KbValidator } from "@jig/kb-core";
import { validateDelta } from "./checks";
import type { DeltaRecord, DeltaStore } from "./deltas";
import type { GitKbRepo } from "./git-repo";
import type { GitKbSource } from "./git-source";

export class DeltaApplyError extends Error {
  constructor(
    message: string,
    readonly errors: Array<{ file: string; message: string }> = [],
  ) {
    super(message);
  }
}

/**
 * Applies a delta (design D6): a merge commit on main whose tree is main with the delta's changes,
 * whose parents are main and the delta branch, and whose message records approvers and the simulation.
 * The delta is validated against the current main first, so a delta drafted on an older main still
 * produces a valid KB.
 */
export function applyDelta(
  repo: GitKbRepo,
  store: DeltaStore,
  source: GitKbSource,
  validator: KbValidator,
  id: string,
  approvedBy: string[],
): DeltaRecord {
  const record = store.require(id);
  if (record.status === "applied") throw new DeltaApplyError(`delta ${id} is already applied`);
  if (record.status === "rejected") throw new DeltaApplyError(`delta ${id} was rejected`);
  const current = source.current();
  const report = validateDelta(validator, current, record.changes);
  if (!report.valid) throw new DeltaApplyError(`delta ${id} would make the KB invalid`, report.errors);
  const main = repo.head();
  const message = [
    `Apply ${id}: ${record.title}`,
    "",
    record.rationale,
    "",
    `Proposed-by: ${record.proposer}`,
    `Approved-by: ${approvedBy.length > 0 ? approvedBy.join(", ") : "automatic (level 1)"}`,
    `Simulation: ${record.simulation_id ?? "none"}`,
  ].join("\n");
  const commit = repo.commitChanges(main, [main, record.head], record.changes, message);
  repo.advanceMain(commit);
  return store.setStatus(id, "applied", { applied_commit: commit });
}
