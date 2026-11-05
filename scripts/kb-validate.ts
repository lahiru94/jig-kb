import { resolve } from "node:path";
import { formatError, validateKbRoots, validateStaged } from "../platform/kb-core/src/index";

// Usage: kb-validate [--staged] [dir]. Validates every KB root (a directory with a .jigkb marker) under dir.
const args = process.argv.slice(2);
const staged = args.includes("--staged");
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const reports = staged ? validateStaged(dir) : validateKbRoots(dir);

let failed = false;
for (const { root, report } of reports) {
  if (report.valid) {
    console.log(`KB ${root}: valid (schema ${report.schemaVersion})`);
    continue;
  }
  failed = true;
  console.error(`KB ${root}: ${report.errors.length} error(s)`);
  for (const error of report.errors) console.error(`  ${formatError(error)}`);
}
if (reports.length === 0) console.log("No KB roots found.");
if (failed) {
  console.error("Commit blocked: fix the KB errors above.");
  process.exit(1);
}
