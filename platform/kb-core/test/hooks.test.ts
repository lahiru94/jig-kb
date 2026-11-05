import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installPreCommitHook } from "../src/index";

const fixture = fileURLToPath(new URL("./fixtures/kb", import.meta.url));
let repo: string;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "jig-hook-"));
  cpSync(fixture, join(repo, "kb"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  installPreCommitHook(repo);
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("pre-commit hook", () => {
  it("allows a commit of a valid KB", () => {
    git("add", ".");
    const result = spawnSync("git", ["commit", "-q", "-m", "valid KB"], { cwd: repo, encoding: "utf8" });
    expect(result.status).toBe(0);
  }, 30_000);

  it("blocks an invalid commit, reporting the file, field and schema version", () => {
    writeFileSync(join(repo, "kb", "rules", "broken.md"), "---\nid: rule.broken\nkind: BusinessRule\ntitle: Broken\nenforcement: {kb-layer: false}\n---\n");
    git("add", ".");
    const result = spawnSync("git", ["commit", "-q", "-m", "invalid KB"], { cwd: repo, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rules/broken.md [statement]: missing required field 'statement' (schema 0.1.0)");
    expect(result.stderr).toContain("Commit blocked");
    const log = execFileSync("git", ["log", "--oneline"], { cwd: repo, encoding: "utf8" });
    expect(log.trim().split("\n")).toHaveLength(1);
  }, 30_000);

  it("validates the staged content, not the working tree", () => {
    writeFileSync(join(repo, "kb", "rules", "broken.md"), "---\nid: rule.broken\nkind: BusinessRule\ntitle: Fixed\nstatement: Now valid.\nenforcement: {kb-layer: false}\n---\n");
    git("add", ".");
    writeFileSync(join(repo, "kb", "rules", "broken.md"), "not valid any more");
    const result = spawnSync("git", ["commit", "-q", "-m", "staged fix"], { cwd: repo, encoding: "utf8" });
    expect(result.status).toBe(0);
  }, 30_000);
});
