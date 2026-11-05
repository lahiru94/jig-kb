import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface Violation {
  file: string;
  line: number;
  term: string;
  text: string;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...listFiles(path));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(path);
    }
  }
  return out;
}

/** Scans `<root>/platform/<package>/src` for capability-specific terms (case-insensitive). */
export function findViolations(root: string, terms: readonly string[]): Violation[] {
  const platformDir = join(root, "platform");
  const violations: Violation[] = [];
  const lowered = terms.map((t) => t.toLowerCase());
  for (const pkg of readdirSync(platformDir)) {
    const srcDir = join(platformDir, pkg, "src");
    let isDir = false;
    try {
      isDir = statSync(srcDir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;
    for (const file of listFiles(srcDir)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, index) => {
        const lower = text.toLowerCase();
        for (const term of lowered) {
          if (lower.includes(term)) {
            violations.push({ file: relative(root, file), line: index + 1, term, text: text.trim() });
          }
        }
      });
    }
  }
  return violations;
}

function main(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const config = JSON.parse(readFileSync(join(root, "scripts", "capability-terms.json"), "utf8")) as {
    terms: string[];
  };
  const violations = findViolations(root, config.terms);
  if (violations.length > 0) {
    console.error("Platform code must stay capability-agnostic. Move these into KB data:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  "${v.term}"  ${v.text}`);
    process.exit(1);
  }
  console.log("Capability-agnostic check passed.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
