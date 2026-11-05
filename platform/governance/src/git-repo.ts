import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kindInfo, parseNodeFile, type KbNode, type NodeChange } from "@jig/kb-core";

const MAIN = "main";
const IDENTITY = ["-c", "user.name=jig", "-c", "user.email=jig@localhost"];

/** A file in a git tree. */
interface TreeFile {
  path: string;
  content: string;
}

/**
 * A KB stored as a git repository (design D6). Deltas are branches; applying a delta is a merge commit.
 * Branch commits are written with plumbing commands, so drafting a delta never touches the working tree.
 */
export class GitKbRepo {
  constructor(readonly dir: string) {}

  private git(args: string[], options: { input?: string; env?: Record<string, string> } = {}): string {
    return execFileSync("git", [...IDENTITY, ...args], {
      cwd: this.dir,
      encoding: "utf8",
      input: options.input,
      env: { ...process.env, ...options.env },
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  /** Creates a KB repository from a directory of KB files, with one initial commit (and an optional tag). */
  static create(dir: string, fromDir: string, tag?: string): GitKbRepo {
    cpSync(fromDir, dir, { recursive: true });
    const repo = new GitKbRepo(dir);
    repo.git(["init", "-q", "-b", MAIN]);
    repo.git(["add", "-A"]);
    repo.git(["commit", "-q", "--no-verify", "-m", "Initial KB"]);
    if (tag) repo.git(["tag", tag]);
    return repo;
  }

  static open(dir: string): GitKbRepo {
    if (!existsSync(join(dir, ".git"))) throw new Error(`${dir} is not a git repository`);
    return new GitKbRepo(dir);
  }

  head(ref = MAIN): string {
    return this.git(["rev-parse", ref]).trim();
  }

  resolve(ref: string): string | undefined {
    const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: this.dir, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : undefined;
  }

  /** Every file in a commit's tree. */
  files(ref: string): TreeFile[] {
    const paths = this.git(["ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean);
    if (paths.length === 0) return [];
    const batch = this.git(["cat-file", "--batch"], { input: paths.map((p) => `${ref}:${p}`).join("\n") + "\n" });
    const files: TreeFile[] = [];
    let offset = 0;
    const buffer = Buffer.from(batch, "utf8");
    for (const path of paths) {
      const headerEnd = buffer.indexOf(10, offset);
      const header = buffer.subarray(offset, headerEnd).toString("utf8");
      const size = Number(header.split(" ")[2]);
      const content = buffer.subarray(headerEnd + 1, headerEnd + 1 + size).toString("utf8");
      files.push({ path, content });
      offset = headerEnd + 1 + size + 1;
    }
    return files;
  }

  /** KB nodes in a commit (Markdown node files only). */
  nodes(ref: string): KbNode[] {
    const nodes: KbNode[] = [];
    for (const file of this.files(ref)) {
      if (!file.path.endsWith(".md") || file.path.toLowerCase().endsWith("readme.md")) continue;
      const parsed = parseNodeFile(file.content, file.path);
      if (!("message" in parsed)) nodes.push(parsed);
    }
    return nodes.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Where a node's file lives: its existing path, or `<kind dir>/<slug>.md` for a new node. */
  private pathFor(change: NodeChange, existing: Map<string, string>): string {
    const known = existing.get(change.id);
    if (known) return known;
    const parsed = change.content ? parseNodeFile(change.content, "new.md") : undefined;
    const kind = parsed && !("message" in parsed) ? kindInfo(parsed.kind) : undefined;
    const slug = change.id.slice(change.id.indexOf(".") + 1);
    return `${kind?.dir ?? "nodes"}/${slug}.md`;
  }

  /**
   * Writes a commit whose tree is `base`'s tree with `changes` applied, without touching the working tree.
   * Returns the new commit id.
   */
  commitChanges(base: string, parents: string[], changes: readonly NodeChange[], message: string): string {
    const existing = new Map(this.nodes(base).map((n) => [n.id, n.file]));
    const indexDir = mkdtempSync(join(tmpdir(), "jig-index-"));
    const env = { GIT_INDEX_FILE: join(indexDir, "index") };
    try {
      this.git(["read-tree", base], { env });
      for (const change of changes) {
        const path = this.pathFor(change, existing);
        if (change.op === "remove") {
          this.git(["update-index", "--force-remove", path], { env });
          continue;
        }
        const tmp = join(indexDir, "blob");
        writeFileSync(tmp, change.content ?? "");
        const blob = this.git(["hash-object", "-w", tmp]).trim();
        this.git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
      }
      const tree = this.git(["write-tree"], { env }).trim();
      return this.git(["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message]).trim();
    } finally {
      rmSync(indexDir, { recursive: true, force: true });
    }
  }

  setRef(ref: string, commit: string): void {
    this.git(["update-ref", ref, commit]);
  }

  /** Moves main to a commit and makes the working tree match it. */
  advanceMain(commit: string): void {
    this.setRef(`refs/heads/${MAIN}`, commit);
    this.git(["read-tree", "-u", "--reset", MAIN]);
  }

  /** Resets main and the working tree to a ref (for demo reset). */
  resetTo(ref: string): void {
    this.git(["reset", "-q", "--hard", ref]);
    this.git(["clean", "-qfd"]);
  }

  branches(prefix: string): string[] {
    return this.git(["for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}`]).split("\n").filter(Boolean);
  }

  deleteBranch(name: string): void {
    this.git(["branch", "-q", "-D", name]);
  }

  log(ref = MAIN): Array<{ commit: string; parents: string[]; message: string }> {
    return this.git(["log", "--format=%H %P%x1f%B%x1e", ref])
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [ids = "", message = ""] = entry.split("\x1f");
        const [commit = "", ...parents] = ids.trim().split(" ");
        return { commit, parents, message: message.trim() };
      });
  }

  /** Whether the working tree has uncommitted changes. */
  isDirty(): boolean {
    return this.git(["status", "--porcelain"]).trim() !== "";
  }
}
