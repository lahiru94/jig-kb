import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKb } from "./loader";
import { KbValidator, type ValidationError, type ValidationReport } from "./validator";

/** A directory is a KB root when it contains this marker file. */
export const KB_MARKER = ".jigkb";

/** Finds KB roots (directories holding the marker) under `dir`, skipping node_modules and .git. */
export function findKbRoots(dir: string): string[] {
  const roots: string[] = [];
  const walk = (current: string): void => {
    if (existsSync(join(current, KB_MARKER))) {
      roots.push(current);
      return;
    }
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".venv") continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
    }
  };
  walk(dir);
  return roots.sort();
}

export function formatError(e: ValidationError): string {
  const where = e.field ? `${e.file} [${e.field}]` : e.file;
  return `${where}: ${e.message} (schema ${e.schemaVersion})`;
}

export interface DirReport {
  root: string;
  report: ValidationReport;
}

/** Validates every KB root under `dir`. */
export function validateKbRoots(dir: string, validator = new KbValidator()): DirReport[] {
  return findKbRoots(dir).map((root) => {
    const { nodes, issues } = loadKb(root);
    return { root, report: validator.validate(nodes, issues) };
  });
}

/** Validates the staged contents of a git repository (what the commit would contain). */
export function validateStaged(repoDir: string, validator = new KbValidator()): DirReport[] {
  const snapshot = mkdtempSync(join(tmpdir(), "jig-staged-"));
  try {
    execFileSync("git", ["checkout-index", "--all", `--prefix=${snapshot}/`], { cwd: repoDir });
    return validateKbRoots(snapshot, validator).map((r) => ({ ...r, root: relative(snapshot, r.root) || "." }));
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

const HOOK_SCRIPT = fileURLToPath(new URL("../../../scripts/kb-validate.ts", import.meta.url));

/** Installs a pre-commit hook that blocks commits whose staged KB files fail validation. */
export function installPreCommitHook(repoDir: string): string {
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const hookPath = join(repoDir, ".git", "hooks", "pre-commit");
  const script = [
    "#!/bin/sh",
    "# Installed by jig: validates staged KB files against the KB schema (design D4).",
    `exec "${process.execPath}" "${tsxCli}" "${HOOK_SCRIPT}" --staged "$(git rev-parse --show-toplevel)"`,
    "",
  ].join("\n");
  writeFileSync(hookPath, script);
  chmodSync(hookPath, 0o755);
  return hookPath;
}
