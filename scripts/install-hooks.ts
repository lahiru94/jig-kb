import { fileURLToPath } from "node:url";
import { installPreCommitHook } from "../platform/kb-core/src/index";

// Installs the KB validation pre-commit hook in this repository (or the repository given as an argument).
const repo = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
console.log(`Installed ${installPreCommitHook(repo)}`);
