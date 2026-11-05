import { applyChanges, buildView, loadSchemaMeta, type KbSource, type KbView, type SchemaMeta } from "@jig/kb-core";
import type { DeltaStore } from "./deltas";
import type { GitKbRepo } from "./git-repo";

/**
 * Reads the KB from git (design D6): the current KB is main's head; `asOf` takes a commit id (or any
 * git ref) for history, or a delta id for the KB as that delta would make it (main plus the delta's
 * changes, as an overlay, without checking anything out).
 */
export class GitKbSource implements KbSource {
  private readonly commits = new Map<string, KbView>();

  constructor(
    readonly repo: GitKbRepo,
    readonly deltas: DeltaStore,
    private readonly meta: SchemaMeta = loadSchemaMeta(),
  ) {}

  private atCommit(commit: string): KbView {
    let view = this.commits.get(commit);
    if (!view) {
      view = buildView(commit, this.repo.nodes(commit), this.meta);
      this.commits.set(commit, view);
    }
    return view;
  }

  current(): KbView {
    return this.atCommit(this.repo.head());
  }

  asOf(ref: string): KbView | undefined {
    const delta = this.deltas.record(ref);
    if (delta) {
      const base = delta.status === "applied" && delta.applied_commit ? this.atCommit(delta.applied_commit) : this.current();
      if (delta.status === "applied") return base;
      return buildView(`${ref}@${base.version}`, applyChanges(base.nodes, delta.changes), this.meta);
    }
    const commit = this.repo.resolve(ref);
    return commit ? this.atCommit(commit) : undefined;
  }

  /** The KB a delta was drafted against. */
  before(deltaId: string): KbView | undefined {
    const delta = this.deltas.record(deltaId);
    return delta ? this.atCommit(delta.base) : undefined;
  }
}
